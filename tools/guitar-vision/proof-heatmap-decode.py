#!/usr/bin/env python3
"""Frozen heatmap postprocessing decoder (postprocessing-rescue mission).

Decodes TinyFCN heatmaps to boxes with FROZEN constants (selected on TRAIN,
see GUITAR_POSTPROCESS_RESCUE_PREREG.md). No weight updates, no training.

Pipeline (all image evidence only):
  1. Per-class peak extraction (3x3 NMS) at per-class thresholds.
  2. Cross-class argmax suppression (one box per location).
  3. Staff-comb gate for tabdigit (digit-anchored 6-line comb required).
  4. Fixed per-class median boxes (TRAIN canonical medians, frozen).

Eval convention: GT CORE boxes (box in each join closest to the frozen
class glyph area; single-box joins unchanged). Union-box numbers are also
reported for continuity, but selection and acceptance use core boxes:
the detector localizes glyph cores, and downstream consumers (fret/string
chain, rhythm graph) attach stems/parens afterwards.

Usage:
    from proof_heatmap_decode import decode_page, build_gt, match
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


crops_mod = _load("proof_context_crops_mod", "proof-context-crops.py")
detect_tab_lines = crops_mod.detect_tab_lines

CLASSES = ["note", "rest", "tabdigit"]

# ---- Frozen constants (TRAIN-selected, 2026-10-09; see rescue report) ----
MEDIANS = {"note": (226.08, 191.52), "rest": (198.72, 311.76),
           "tabdigit": (187.92, 252.72)}  # TRAIN canonical medians
GLYPH_AREA = {c: MEDIANS[c][0] * MEDIANS[c][1] for c in CLASSES}
THRESHOLDS = {"note": 0.4, "rest": 0.4, "tabdigit": 0.4}  # TRAIN knee
XCLASS_RADIUS = 12.0  # px: cross-class suppression radius
STAFF_GATE = True  # require digit-anchored TAB comb for tabdigit peaks
CORE_BOXES = True  # eval against GT core boxes (see module docstring)
IOU_MATCH = 0.5


def iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def classify(children) -> str | None:
    if "notehead" in children:
        return "note"
    if "rest" in children:
        return "rest"
    if "tab-text" in children:
        return "tabdigit"
    return None


def core_box(boxes, cls: str) -> list:
    """GT core: the box closest to the frozen class glyph area.

    Single-box joins return their box (union == core). Multi-box joins
    (notehead+stem, notehead+parens) resolve to the notehead glyph, which
    is what the heat peak localizes. Uses only the frozen TRAIN glyph
    stat, never per-sample truth beyond the boxes themselves.
    """
    if len(boxes) == 1:
        return boxes[0]
    areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in boxes]
    return boxes[int(np.argmin([abs(a - GLYPH_AREA[cls]) for a in areas]))]


def build_gt(joins, page_no, fx, fy, core: bool = CORE_BOXES) -> list:
    gt = []
    for sid, join in joins["joins"].items():
        if (join.get("page") or 1) != page_no or not join.get("boxes"):
            continue
        cls = classify(join.get("children", []))
        if cls is None:
            continue
        boxes = join["boxes"]
        target = core_box(boxes, cls) if core else [
            min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]
        gt.append({"cls": cls,
                   "box": [target[0] * fx, target[1] * fy, target[2] * fx, target[3] * fy]})
    for g in gt:
        g["cx"] = (g["box"][0] + g["box"][2]) / 2
        g["cy"] = (g["box"][1] + g["box"][3]) / 2
        g["matched"] = False
    return gt


def decode_page(heat: torch.Tensor, pixels_u8: np.ndarray, fx: float, fy: float,
                thresholds: dict | None = None, xclass_radius: float | None = None,
                staff_gate: bool | None = None) -> list:
    """Heat (3,H,W) + uint8 page -> kept predictions (cls/box/value)."""
    thresholds = thresholds or THRESHOLDS
    xclass_radius = XCLASS_RADIUS if xclass_radius is None else xclass_radius
    staff_gate = STAFF_GATE if staff_gate is None else staff_gate
    img_h, img_w = pixels_u8.shape
    preds = []
    for cls_index, cls in enumerate(CLASSES):
        channel = heat[cls_index]
        pooled = F.max_pool2d(channel.unsqueeze(0), 3, stride=1, padding=1)[0]
        mask = (channel == pooled) & (channel >= thresholds[cls])
        ys, xs = torch.nonzero(mask, as_tuple=True)
        mw, mh = MEDIANS[cls][0] * fx, MEDIANS[cls][1] * fy
        for x, y in zip(xs.tolist(), ys.tolist()):
            cx, cy = (x + 0.5) * 8, (y + 0.5) * 8
            preds.append({"cls": cls, "x": cx, "y": cy, "v": float(channel[y, x]),
                          "box": [cx - mw / 2, cy - mh / 2, cx + mw / 2, cy + mh / 2]})
    preds.sort(key=lambda p: -p["v"])
    # Cross-class argmax suppression: keep strongest within radius.
    kept = []
    for p in preds:
        if xclass_radius > 0 and any(abs(q["x"] - p["x"]) < xclass_radius and abs(q["y"] - p["y"]) < xclass_radius for q in kept):
            continue
        kept.append(p)
    # Staff-comb gate for tabdigit (image evidence only).
    if staff_gate:
        gated = []
        for p in kept:
            if p["cls"] == "tabdigit":
                _, tier = detect_tab_lines(pixels_u8, p["x"], p["y"], img_w, img_h)
                if tier is None:
                    continue
            gated.append(p)
        kept = gated
    return kept


def match(preds: list, gt: list, iou_min: float = IOU_MATCH) -> tuple[int, int, int]:
    """Consume-on-match greedy (strongest first). Returns (tp, fp, fn)."""
    for g in gt:
        g["matched"] = False
    tp = fp = 0
    for p in sorted(preds, key=lambda p: -p["v"]):
        best, best_iou = -1, 0.0
        for index, g in enumerate(gt):
            if g["cls"] != p["cls"] or g["matched"]:
                continue
            value = iou(p["box"], g["box"])
            if value > best_iou:
                best, best_iou = index, value
        if best >= 0 and best_iou >= iou_min:
            tp += 1
            gt[best]["matched"] = True
        else:
            fp += 1
    fn = sum(1 for g in gt if not g["matched"])
    return tp, fp, fn
