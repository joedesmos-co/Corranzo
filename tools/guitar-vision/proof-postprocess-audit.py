#!/usr/bin/env python3
"""Postprocessing audit (TRAIN only, frozen detector weights).

Runs the frozen heatmap model on TRAIN pages and categorizes every FP/FN
with image evidence only. No training, no DEV. See
docs/guitar-vision/GUITAR_POSTPROCESS_RESCUE_PREREG.md.

Usage:
    python3 tools/guitar-vision/proof-postprocess-audit.py --hires <dir> --work ... --weights <pt> --out <dir>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


TinyFCN = _load("proof_heatmap_train_mod", "proof-heatmap-train.py").TinyFCN
crops_mod = _load("proof_context_crops_mod", "proof-context-crops.py")
detect_tab_lines = crops_mod.detect_tab_lines

SEED = 20261009
CLASSES = ["note", "rest", "tabdigit"]
FLOOR = 0.10  # low floor: also record sub-threshold peaks for FN-sub analysis


def load_train_ids():
    train = set()
    for manifest_path in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
                          "datasets/guitar-vision/v2/dataset-manifest.json"]:
        manifest = json.loads(Path(manifest_path).read_text())
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] == "train":
                train.add(sample["sample"])
    return train


def iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    train_ids = load_train_ids()

    model = TinyFCN().to(device)
    saved = torch.load(args.weights, map_location=device, weights_only=True)
    model.load_state_dict(saved["state"] if "state" in saved else saved)
    model.eval()

    # Frozen TRAIN medians (from committed heatmap-eval.json, canonical units).
    medians = {"note": (226.08, 191.52), "rest": (198.72, 311.76), "tabdigit": (187.92, 252.72)}

    fp_cats = {c: 0 for c in ["dup", "xclass", "text", "box", "halo", "bg"]}
    fn_cats = {c: 0 for c in ["sub", "xclass", "box", "none"]}
    fp_by_cls = {c: dict(fp_cats) for c in CLASSES}
    fn_by_cls = {c: dict(fn_cats) for c in CLASSES}
    gate_tp = {"exact": 0, "anchored": 0, "none": 0}
    gate_fp = {"exact": 0, "anchored": 0, "none": 0}
    center_hit_ious = {c: [] for c in CLASSES}  # IoU when center within 25px
    scale_ratios = {c: [] for c in CLASSES}  # (gt_w/mw, gt_h/mh) at center hits
    # Threshold sweep storage: per-page preds + gt for exact recompute.
    pages_data: list[tuple[list, list]] = []
    n_pages = 0
    fp_samples: dict[str, list] = {c: [] for c in fp_cats}

    with torch.no_grad():
        for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
            sample = manifest_path.name.replace("-manifest.json", "")
            if sample not in train_ids:
                continue
            manifest = json.loads(manifest_path.read_text())
            joins = None
            for root in work_dirs:
                # Roots may be work parents (<root>/<sample>/joins.json) or
                # per-sample dirs (<sample>/joins.json); try both.
                for path in (root / sample / "joins.json",
                             root / "joins.json" if root.name == sample else None):
                    if path is not None and path.exists():
                        joins = json.loads(path.read_text())
                        break
                if joins is not None:
                    break
            if joins is None:
                continue
            for tag, meta in manifest.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                page_no = int(tag.replace("page", ""))
                image = Image.open(meta["file"]).convert("L")
                pixels = np.asarray(image, dtype=np.float32) / 255.0
                img_h, img_w = pixels.shape
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                tensor = torch.from_numpy(pixels).unsqueeze(0).unsqueeze(0).to(device)
                heat = model(tensor)[0].cpu()
                gt = []
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != page_no or not join.get("boxes"):
                        continue
                    children = join.get("children", [])
                    cls = "note" if "notehead" in children else ("rest" if "rest" in children else ("tab-text" in children and "tabdigit" or None))
                    if cls is None:
                        continue
                    boxes = join["boxes"]
                    box = [min(b[0] for b in boxes) * fx, min(b[1] for b in boxes) * fy,
                           max(b[2] for b in boxes) * fx, max(b[3] for b in boxes) * fy]
                    gt.append({"cls": cls, "box": box,
                               "cx": (box[0] + box[2]) / 2, "cy": (box[1] + box[3]) / 2,
                               "matched": False})
                # Peak extraction per class at FLOOR.
                preds = []
                for cls_index, cls in enumerate(CLASSES):
                    channel = heat[cls_index]
                    pooled = F.max_pool2d(channel.unsqueeze(0), 3, stride=1, padding=1)[0]
                    mask = (channel == pooled) & (channel >= FLOOR)
                    ys, xs = torch.nonzero(mask, as_tuple=True)
                    mw, mh = medians[cls][0] * fx, medians[cls][1] * fy
                    for x, y in zip(xs.tolist(), ys.tolist()):
                        cx, cy = (x + 0.5) * 8, (y + 0.5) * 8
                        preds.append({"cls": cls, "x": cx, "y": cy,
                                      "v": float(channel[y, x]),
                                      "box": [cx - mw / 2, cy - mh / 2, cx + mw / 2, cy + mh / 2]})
                preds.sort(key=lambda p: -p["v"])
                # Consume-on-match greedy matching at operating threshold 0.3.
                for p in preds:
                    if p["v"] < 0.3:
                        p["op"] = "below"
                        continue
                    best, best_iou = None, 0.0
                    for index, g in enumerate(gt):
                        if g["cls"] != p["cls"] or g["matched"]:
                            continue
                        value = iou(p["box"], g["box"])
                        if value > best_iou:
                            best, best_iou = index, value
                    if best is not None and best_iou >= 0.5:
                        p["op"] = "tp"
                        gt[best]["matched"] = True
                        p["gt"] = best
                    else:
                        p["op"] = "fp"
                # Categorize FPs.
                raw = (pixels * 255).astype(np.uint8)
                for p in preds:
                    if p.get("op") != "fp":
                        continue
                    # FP-dup: IoU>=0.5 with an already-matched same-class GT.
                    dup = any(g["cls"] == p["cls"] and g["matched"] and iou(p["box"], g["box"]) >= 0.5 for g in gt)
                    if dup:
                        cat = "dup"
                    else:
                        # FP-xclass: within 12px of a kept peak of another class.
                        xclass = any(q.get("op") == "tp" and q["cls"] != p["cls"]
                                     and abs(q["x"] - p["x"]) < 12 and abs(q["y"] - p["y"]) < 12 for q in preds)
                        if xclass:
                            cat = "xclass"
                        elif p["cls"] == "tabdigit":
                            _, tier = detect_tab_lines(raw, p["x"], p["y"], img_w, img_h)
                            gate_fp[tier if tier else "none"] += 1
                            cat = "text" if tier is None else "other-tabdigit"
                        else:
                            cat = None
                    if cat == "other-tabdigit" or cat is None:
                        # Box/halo/bg split by nearest unmatched same-class GT.
                        best_d, best_iou = 1e9, 0.0
                        for g in gt:
                            if g["cls"] != p["cls"] or g["matched"]:
                                continue
                            d = abs(g["cx"] - p["x"]) + abs(g["cy"] - p["y"])
                            v = iou(p["box"], g["box"])
                            if v > best_iou:
                                best_iou = v
                            if d < best_d:
                                best_d = d
                        if best_d < 25 and best_iou < 0.5:
                            cat = "box"
                        elif best_iou >= 0.1:
                            cat = "halo"
                        else:
                            cat = "bg"
                    fp_cats[cat] += 1
                    fp_by_cls[p["cls"]][cat] += 1
                    if len(fp_samples[cat]) < 8:
                        fp_samples[cat].append({"page": f"{sample}:{tag}", "x": round(p["x"], 1), "y": round(p["y"], 1), "v": round(p["v"], 3), "cls": p["cls"]})
                # Gate measurement on TPs + center-hit IoUs.
                for p in preds:
                    if p.get("op") == "tp" and p["cls"] == "tabdigit":
                        _, tier = detect_tab_lines(raw, p["x"], p["y"], img_w, img_h)
                        gate_tp[tier if tier else "none"] += 1
                # Categorize FNs.
                for g in gt:
                    if g["matched"]:
                        continue
                    best_v, best_d, xhit = 0.0, 1e9, False
                    for p in preds:
                        if p["cls"] != g["cls"]:
                            continue
                        d = abs(g["cx"] - p["x"]) + abs(g["cy"] - p["y"])
                        if d < best_d:
                            best_d = d
                        if d < 25 and p["v"] > best_v:
                            best_v = p["v"]
                    if best_d < 25:
                        center_hit_ious[g["cls"]].append(max(
                            (iou({"box": [g["cx"] - medians[g["cls"]][0] * fx / 2, g["cy"] - medians[g["cls"]][1] * fy / 2,
                                                   g["cx"] + medians[g["cls"]][0] * fx / 2, g["cy"] + medians[g["cls"]][1] * fy / 2]}["box"], g["box"])), 0.0))
                        gw, gh = g["box"][2] - g["box"][0], g["box"][3] - g["box"][1]
                        scale_ratios[g["cls"]].append((gw / (medians[g["cls"]][0] * fx), gh / (medians[g["cls"]][1] * fy)))
                    if best_v >= 0.3:
                        cat = "box"
                    elif best_v >= FLOOR:
                        cat = "sub"
                    else:
                        # Wrong-class peak at center?
                        xhit = any(p.get("op") == "tp" and p["cls"] != g["cls"]
                                   and abs(g["cx"] - p["x"]) + abs(g["cy"] - p["y"]) < 25 for p in preds)
                        cat = "xclass" if xhit else "none"
                    fn_cats[cat] += 1
                    fn_by_cls[g["cls"]][cat] += 1
                # Sweep data: keep page preds + gt for exact threshold recompute.
                pages_data.append(([{"cls": p["cls"], "v": p["v"], "box": p["box"]} for p in preds],
                                   [{"cls": g["cls"], "box": g["box"]} for g in gt]))
                n_pages += 1

    # Exact threshold sweep per operating threshold (consume-on-match).
    sweep = {}
    for thr in [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]:
        tp = fp = fn = 0
        for preds, gt in pages_data:
            matched = [False] * len(gt)
            ordered = sorted([p for p in preds if p["v"] >= thr], key=lambda p: -p["v"])
            for p in ordered:
                best, best_iou = -1, 0.0
                for index, g in enumerate(gt):
                    if g["cls"] != p["cls"] or matched[index]:
                        continue
                    value = iou(p["box"], g["box"])
                    if value > best_iou:
                        best, best_iou = index, value
                if best >= 0 and best_iou >= 0.5:
                    tp += 1
                    matched[best] = True
                else:
                    fp += 1
            fn += sum(1 for m in matched if not m)
        sweep[str(thr)] = {"tp": tp, "fp": fp, "fn": fn,
                           "precision": tp / max(tp + fp, 1), "recall": tp / max(tp + fn, 1)}

    # Threshold sweep per class (greedy re-match approximated by value filter
    # on the 0.3-operating TP flags is invalid; instead recompute properly:
    # sort by value, consume-on-match needs boxes — redo per threshold below
    # is expensive; report operating-point stats + value histograms).
    report = {"pages": n_pages, "fp": fp_cats, "fn": fn_cats,
              "fpByClass": fp_by_cls, "fnByClass": fn_by_cls,
              "gateTP": gate_tp, "gateFP": gate_fp,
              "fpSamples": fp_samples, "sweep": sweep,
              "centerHitIoU": {c: {"n": len(v), "mean": float(np.mean(v)) if v else 0.0,
                                   "p50": float(np.median(v)) if v else 0.0,
                                   "fracGe05": float(np.mean([x >= 0.5 for x in v])) if v else 0.0} for c, v in center_hit_ious.items()},
              "scaleBias": {c: {"n": len(v), "wMed": float(np.median([x[0] for x in v])) if v else 0.0,
                                "hMed": float(np.median([x[1] for x in v])) if v else 0.0} for c, v in scale_ratios.items()}}
    (out_dir / "postprocess-audit.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
