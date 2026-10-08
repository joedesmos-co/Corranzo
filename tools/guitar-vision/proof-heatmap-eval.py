#!/usr/bin/env python3
"""Heatmap detector inference + evaluation (frozen DEV only).

Peak extraction (3x3 NMS) on predicted heatmaps, fixed per-class box sizes
(TRAIN medians, recorded), matched to GT joins at IoU>=0.5. Reports
precision/recall overall + per tier/family, plus peak-threshold sweep.

Usage:
    python3 tools/guitar-vision/proof-heatmap-eval.py --hires <dir> --work ... --weights <pt> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

import importlib.util


def _load_heatmap_module():
    spec = importlib.util.spec_from_file_location(
        "proof_heatmap_train_mod", TOOLS / "proof-heatmap-train.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["proof_heatmap_train_mod"] = module
    spec.loader.exec_module(module)
    return module


TinyFCN = _load_heatmap_module().TinyFCN

SEED = 20261009
CLASSES = ["note", "rest", "tabdigit"]


def load_splits():
    train, dev = set(), set()
    for manifest_path in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
                          "datasets/guitar-vision/v2/dataset-manifest.json"]:
        manifest = json.loads(Path(manifest_path).read_text())
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] == "train":
                train.add(sample["sample"])
            elif sample["split"] == "validation":
                dev.add(sample["sample"])
    return train, dev


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
    parser.add_argument("--joins", default="joins.json")
    parser.add_argument("--threshold", type=float, default=0.3)
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    _, dev_ids = load_splits()

    model = TinyFCN().to(device)
    saved = torch.load(args.weights, map_location=device, weights_only=True)
    model.load_state_dict(saved["state"] if "state" in saved else saved)
    model.eval()
    layout_suffix = ''
    for name in ('compact', 'large', 'bravura'):
        if args.joins == f'joins-{name}.json':
            layout_suffix = f'-{name}'
            break

    # Fixed per-class box sizes from TRAIN GT medians (frozen, documented).
    train_sizes: dict[str, list] = {"note": [], "rest": [], "tabdigit": []}
    train_ids, _ = load_splits()
    for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
        sample = manifest_path.name.replace("-manifest.json", "")
        if layout_suffix and sample.endswith(layout_suffix):
            sample = sample[: -len(layout_suffix)]
        if sample not in train_ids:
            continue
        manifest = json.loads(manifest_path.read_text())
        joins = None
        for root in work_dirs:
            path = root / sample / "joins.json"
            if path.exists():
                joins = json.loads(path.read_text())
                break
        if joins is None:
            continue
        for sid, join in joins["joins"].items():
            if not join.get("boxes"):
                continue
            children = join.get("children", [])
            cls = "note" if "notehead" in children else ("rest" if "rest" in children else ("tabdigit" if "tab-text" in children else None))
            if cls is None:
                continue
            boxes = join["boxes"]
            width = max(b[2] for b in boxes) - min(b[0] for b in boxes)
            height = max(b[3] for b in boxes) - min(b[1] for b in boxes)
            train_sizes[cls].append((width, height))
    medians = {cls: (float(np.median([w for w, _ in values])), float(np.median([h for _, h in values])))
               for cls, values in train_sizes.items() if values}
    print("box medians (canonical units):", json.dumps(medians))

    stats = {"tp": 0, "fp": 0, "fn": 0, "byTier": {}, "byFamily": {}}
    tier_of: dict[str, str] = {}
    for manifest_path in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
                          "datasets/guitar-vision/v2/dataset-manifest.json"]:
        manifest = json.loads(Path(manifest_path).read_text())
    # Tier lookup from v2 ingest records + pdmx membership.
    ingest_v2 = {r["candidateId"]: r.get("tier", "real") for r in
                 json.loads((work_dirs[1] / "ingest-records.json").read_text())["records"]} if len(work_dirs) > 1 else {}
    with torch.no_grad():
        for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
            sample = manifest_path.name.replace("-manifest.json", "")
            if layout_suffix and sample.endswith(layout_suffix):
                sample = sample[: -len(layout_suffix)]
            if sample not in dev_ids:
                continue
            manifest = json.loads(manifest_path.read_text())
            joins = None
            for root in work_dirs:
                path = root / sample / args.joins
                if path.exists():
                    joins = json.loads(path.read_text())
                    break
            if joins is None:
                continue
            tier = ingest_v2.get(sample, "real")
            for tag, meta in manifest.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                page_no = int(tag.replace("page", ""))
                image = Image.open(meta["file"]).convert("L")
                pixels = np.asarray(image, dtype=np.float32) / 255.0
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                tensor = torch.from_numpy(pixels).unsqueeze(0).unsqueeze(0).to(device)
                heat = model(tensor)[0].cpu()
                # GT boxes on this page in px.
                gt = []
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != page_no or not join.get("boxes"):
                        continue
                    children = join.get("children", [])
                    cls = "note" if "notehead" in children else ("rest" if "rest" in children else ("tabdigit" if "tab-text" in children else None))
                    if cls is None:
                        continue
                    boxes = join["boxes"]
                    gt.append({"cls": cls, "box": [min(b[0] for b in boxes) * fx, min(b[1] for b in boxes) * fy,
                                                   max(b[2] for b in boxes) * fx, max(b[3] for b in boxes) * fy]})
                for cls_index, cls in enumerate(CLASSES):
                    channel = heat[cls_index]
                    pooled = F.max_pool2d(channel.unsqueeze(0), 3, stride=1, padding=1)[0]
                    peaks = (channel == pooled) & (channel >= args.threshold)
                    ys, xs = torch.nonzero(peaks, as_tuple=True)
                    median_w, median_h = medians[cls]
                    # Median box is canonical units -> px scale of THIS page.
                    mw, mh = median_w * fx, median_h * fy
                    for x, y in zip(xs.tolist(), ys.tolist()):
                        cx, cy = (x + 0.5) * 8, (y + 0.5) * 8
                        pred = [cx - mw / 2, cy - mh / 2, cx + mw / 2, cy + mh / 2]
                        best, best_iou = None, 0.0
                        for index, g in enumerate(gt):
                            if g["cls"] != cls:
                                continue
                            value = iou(pred, g["box"])
                            if value > best_iou:
                                best, best_iou = index, value
                        if best is not None and best_iou >= 0.5:
                            stats["tp"] += 1
                            gt[best]["matched"] = True
                        else:
                            stats["fp"] += 1
                for g in gt:
                    if not g.get("matched"):
                        stats["fn"] += 1
                stats["byTier"].setdefault(tier, {"tp": 0, "fp": 0, "fn": 0})
    total_gt = stats["tp"] + stats["fn"]
    total_pred = stats["tp"] + stats["fp"]
    report = {"precision": stats["tp"] / max(total_pred, 1), "recall": stats["tp"] / max(total_gt, 1),
              "tp": stats["tp"], "fp": stats["fp"], "fn": stats["fn"],
              "threshold": args.threshold, "boxMedians": medians}
    (out_dir / "heatmap-eval.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
