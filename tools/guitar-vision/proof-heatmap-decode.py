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
# Per-class box-size multipliers (TRAIN-verified 2026-10-10): rest GTs form
# two height populations (whole/half vs quarter/flagged); x1.25 height is
# the full-population optimum (REST P/R 0.396/0.397 -> 0.506/0.507, ALL F1
# 0.387 -> 0.395). Width unbiased (1.0). v2 constants.
BOX_SCALE = {"note": (1.0, 1.0), "rest": (1.0, 1.25), "tabdigit": (1.0, 1.0)}
# '1' vs '4' glyph-width disambiguation (R2 fret audit: 16/19 Txo fret
# errors are 1<->4 confusion). '1' strokes are ~0.28sp wide, '4' ~0.47sp
# (Txo: 8-10px vs 14-22px at sp=32; staff rows excluded). '0' overlaps
# '4' (~0.44sp), so the rule fires only when the head says 1 or 4.
FRET_WIDTH_SPLIT = 0.375  # spacing units; narrow -> 1, wide -> 4
FRET_NARROW_ONE = 0.33  # below -> '1' regardless (truth-1 read as 0)
# Hole rule (R2-M7): '0' has exactly 1 hole, '3' has 0 (545/545 Txo+Qmek).
# Fire 3->0 on 1 hole only (never 0->3: broken-print '0's have 0 holes).
# v3 (2026-10-10): ignore-channel veto (ONE capped run, GUITAR_IGNORECLASS_
# PREREG.md). Drop a peak when per-page-normalized ignore heat exceeds the
# normalized class heat within VETO_CELLS. TRAIN-selected with tabdigit
# veto (F1 0.4422 vs 0.4417). Heat may be 3ch (veto skipped) or 4ch.
WEIGHTS = "datasets/guitar-vision/proof-detection/heatmap-ignore.pt"
VETO_CELLS = 2
IGNORE_VETO = True
# Scale normalization (G2, TRAIN-fit selected): rescale pages so the staff
# line gap matches TARGET_GAP px (standard TRAIN median) before inference;
# map boxes back afterwards. Corrects engraving-scale drift with NO
# retraining (large TRAIN-fit P/R 0.310/0.260 -> 0.525/0.470 at 1.32x).
TARGET_GAP = 26.0  # TRAIN-fit standard-page median staff gap in px
SCALE_CLAMP = (0.7, 1.6)
import os as _os
RESAMPLE = _os.environ.get("NORM_INTERP", "bilinear")  # bilinear|nearest (bilinear: notes robust; digits+rests come from the native pass)


def estimate_staff_gap(pixels_u8: np.ndarray) -> float | None:
    """Median in-system staff-line gap in px (image only).

    Full-width row profile -> line bands -> gaps; in-system gaps are the
    numerous small ones (<100px); inter-system gaps are 100px+. Needs >=4
    samples or returns None (no rescale).
    """
    h, w = pixels_u8.shape
    if w < 100 or h < 100:
        return None
    prof = (pixels_u8[:, int(w * 0.2):int(w * 0.8)] < 128).mean(axis=1)
    rows = np.nonzero(prof > 0.3)[0]
    if len(rows) < 5:
        return None
    bands = []
    start, prev = rows[0], rows[0]
    for r in rows[1:]:
        if r - prev > 2:
            bands.append((start + prev) / 2)
            start = r
        prev = r
    bands.append((start + prev) / 2)
    if len(bands) < 5:
        return None
    small = [g for g in np.diff(bands) if g < 100]
    if len(small) < 4:
        return None
    return float(np.median(small))


def normalize_scale(pixels_u8: np.ndarray) -> tuple[np.ndarray, float]:
    """Rescale page to TARGET_GAP staff scale. Returns (pixels, scale)."""
    from PIL import Image as _Image
    gap = estimate_staff_gap(pixels_u8)
    if gap is None or gap <= 0:
        return pixels_u8, 1.0
    scale = min(max(TARGET_GAP / gap, SCALE_CLAMP[0]), SCALE_CLAMP[1])
    if abs(scale - 1.0) < 0.05:
        return pixels_u8, 1.0
    # Bilinear default (heldout: notes equal-or-better vs nearest at scale;
    # thin/small glyphs bypass resampling via the native merged pass).
    _filt = {"nearest": _Image.NEAREST, "bilinear": _Image.BILINEAR}[RESAMPLE]
    img = _Image.fromarray(pixels_u8).resize(
        (int(pixels_u8.shape[1] * scale), int(pixels_u8.shape[0] * scale)), _filt)
    return np.asarray(img), scale


def infer_page_merged(model, pixels_u8: np.ndarray, fx: float, fy: float,
                      device, gate_retry: bool = True) -> tuple[list, float]:
    """Two-pass merged inference (TRAIN-heldout selected).

    Notes come from the scale-normalized pass (large glyphs robust);
    digits+rests come from the native pass (thin/small glyphs are
    blur-fragile under resampling). No cross-pass suppression (xclass
    dups measured negligible); gate native in both passes via infer_page.
    Returns (merged preds, norm scale).
    """
    preds_on, scale = infer_page(model, pixels_u8, fx, fy, device, normalize=True,
                                 gate_retry=gate_retry)
    if scale == 1.0:
        return preds_on, scale
    preds_off, _ = infer_page(model, pixels_u8, fx, fy, device, normalize=False,
                              gate_retry=gate_retry)
    merged = ([p for p in preds_on if p["cls"] == "note"] +
              [p for p in preds_off if p["cls"] != "note"])
    return merged, scale


def infer_page(model, pixels_u8: np.ndarray, fx: float, fy: float,
               device, normalize: bool = True, gate_retry: bool = True) -> tuple[list, float]:
    """Full inference path with optional scale normalization.

    Rescales to TARGET_GAP staff scale, runs the model, decodes, and maps
    boxes back to original px. The TAB staff-comb gate ALWAYS runs at
    NATIVE scale (its strip constants were TRAIN-calibrated in native px;
    gating on rescaled images kills real digits). Returns (preds, scale).
    """
    if normalize:
        scaled, scale = normalize_scale(pixels_u8)
    else:
        scaled, scale = pixels_u8, 1.0
    tensor = torch.from_numpy(scaled.astype(np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
    with torch.no_grad():
        heat = model(tensor)[0].cpu()
    preds = decode_page(heat, scaled, fx * scale, fy * scale, staff_gate=False)
    if scale != 1.0:
        for p in preds:
            p["x"] /= scale
            p["y"] /= scale
            p["box"] = [v / scale for v in p["box"]]
    # Native-scale staff gate for tabdigit (image evidence only).
    # Same +-8px quantization retry as decode_page (gate prereg).
    img_h, img_w = pixels_u8.shape
    gated = []
    for p in preds:
        if p["cls"] == "tabdigit":
            _, tier = detect_tab_lines(pixels_u8, p["x"], p["y"], img_w, img_h)
            if tier is None and gate_retry and p.get("v", 0) >= GATE_RETRY_MIN_V:
                for dx, dy in ((8, 0), (-8, 0), (0, 8), (0, -8)):
                    qx = min(max(p["x"] + dx, 0), img_w - 1)
                    qy = min(max(p["y"] + dy, 0), img_h - 1)
                    _, tier = detect_tab_lines(pixels_u8, qx, qy, img_w, img_h)
                    if tier is not None:
                        break
            if tier is None:
                continue
        gated.append(p)
    return gated, scale
# v4 layout-inclusive run (2026-10-11, GUITAR_MULTILAYOUT_PREREG.md G2)
# regressed standard/large/bravura (veto-mined negatives self-reinforce on
# unseen scales; 12ep/3 layouts underfit). Per-layout preservation (G3):
# compact adopts v4; all other layouts stay v3. Drivers pass --detector.
LAYOUT_DETECTOR = {"standard": "datasets/guitar-vision/proof-detection/heatmap-ignore.pt",
                   "compact": "datasets/guitar-vision/proof-detection/heatmap-v4.pt",
                   "large": "datasets/guitar-vision/proof-detection/heatmap-ignore.pt",
                   "bravura": "datasets/guitar-vision/proof-detection/heatmap-ignore.pt"}
XCLASS_RADIUS = 12.0  # px: cross-class suppression radius
GATE_RETRY_MIN_V = 0.8  # retry admits strong peaks only (amendment 1)
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
                staff_gate: bool | None = None, gate_retry: bool = True) -> list:
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
        sx, sy = BOX_SCALE[cls]
        mw, mh = MEDIANS[cls][0] * sx * fx, MEDIANS[cls][1] * sy * fy
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
    # Staff-comb gate for tabdigit (image evidence only). Quantization
    # robustness: retry 4-neighbors at +-8px when the peak center finds
    # no tier (prereg GUITAR_GATE_PREREG.md; else single misses shift
    # whole downstream measure numbering).
    if staff_gate:
        gated = []
        for p in kept:
            if p["cls"] == "tabdigit":
                _, tier = detect_tab_lines(pixels_u8, p["x"], p["y"], img_w, img_h)
                if tier is None and gate_retry and p.get("v", 0) >= GATE_RETRY_MIN_V:
                    for dx, dy in ((8, 0), (-8, 0), (0, 8), (0, -8)):
                        qx = min(max(p["x"] + dx, 0), img_w - 1)
                        qy = min(max(p["y"] + dy, 0), img_h - 1)
                        _, tier = detect_tab_lines(pixels_u8, qx, qy, img_w, img_h)
                        if tier is not None:
                            break
                if tier is None:
                    continue
            gated.append(p)
        kept = gated
    # v3 ignore veto (4ch heat only): drop peaks where normalized ignore
    # heat exceeds normalized class heat within VETO_CELLS.
    if IGNORE_VETO and heat.shape[0] >= 4:
        ign = heat[3]
        ign_n = ign / max(float(ign.max()), 1e-9)
        vetoed = []
        R = VETO_CELLS
        for p in kept:
            gx, gy = int(p["x"] / 8), int(p["y"] / 8)
            x0, x1 = max(gx - R, 0), min(gx + R + 1, ign.shape[1])
            y0, y1 = max(gy - R, 0), min(gy + R + 1, ign.shape[0])
            ci = CLASSES.index(p["cls"])
            cls_h = heat[ci]
            cls_n = cls_h / max(float(cls_h.max()), 1e-9)
            if float(ign_n[y0:y1, x0:x1].max()) > float(cls_n[y0:y1, x0:x1].max()):
                continue
            vetoed.append(p)
        kept = vetoed
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
