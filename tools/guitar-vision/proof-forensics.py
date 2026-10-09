#!/usr/bin/env python3
"""Phase-B forensics (TRAIN only, v2 decoder, no training).

1. FP structure: clef-zone fraction, title-zone fraction, ink mass, and
   distance to nearest GT per class (what remains after v2?).
2. GT canonical-size distributions per layout per class (do TRAIN medians
   transfer across layouts? why is large weak?).
3. Rest height population split (confirm two populations).

Usage:
    python3 tools/guitar-vision/proof-forensics.py --out <dir>
    (uses /tmp/proof/hires* + workdirs.json; standard + large TRAIN pages)
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
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
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

LAYOUTS = {"standard": ("/tmp/proof/hires", "joins.json", ""),
           "large": ("/tmp/proof/hires-large", "joins-large.json", "-large")}


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(20261009)
    np.random.seed(20261009)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    train = set()
    for mp in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
               "datasets/guitar-vision/v2/dataset-manifest.json"]:
        for s in json.load(open(mp))["splits"]["assignments"]:
            if s["split"] == "train":
                train.add(s["sample"])
    ws = json.load(open("/tmp/proof/workdirs.json"))
    model = TinyFCN().to(device)
    sd = torch.load("datasets/guitar-vision/proof-detection/heatmap16ep.pt",
                     map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()

    report: dict = {"layouts": {}}
    with torch.no_grad():
        for layout, (hires, joins_name, suffix) in LAYOUTS.items():
            fp_zone = {"clef": 0, "title": 0, "other": 0}
            fp_ink, fp_near = [], []
            fp_by_cls = {"note": 0, "rest": 0, "tabdigit": 0}
            fn_total, tp_total = 0, 0
            Canon = {c: [] for c in dec.CLASSES}  # canonical w/h per class
            rest_h = []
            n_pages = 0
            for mp in sorted(Path(hires).glob("*-manifest.json")):
                sample = mp.name.replace("-manifest.json", "")
                if suffix and sample.endswith(suffix):
                    sample = sample[: -len(suffix)]
                if sample not in train:
                    continue
                man = json.load(open(mp))
                joins = None
                for root in ws:
                    for c in (f"{root}/{sample}/{joins_name}",
                              f"{root}/{joins_name}" if Path(root).name == sample else None):
                        if c and Path(c).exists():
                            joins = json.load(open(c))
                            break
                    if joins:
                        break
                if joins is None:
                    continue
                # Canonical GT sizes (SVG units, layout-native).
                for sid, join in joins["joins"].items():
                    cls = dec.classify(join.get("children", []))
                    if cls is None or not join.get("boxes"):
                        continue
                    boxes = join["boxes"]
                    tgt = dec.core_box(boxes, cls)
                    Canon[cls].append((tgt[2] - tgt[0], tgt[3] - tgt[1]))
                    if cls == "rest":
                        union = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                                 max(b[2] for b in boxes), max(b[3] for b in boxes)]
                        rest_h.append(union[3] - union[1])
                for tag, meta in man.items():
                    if not isinstance(meta, dict) or "file" not in meta:
                        continue
                    pno = int(tag.replace("page", ""))
                    img = Image.open(meta["file"]).convert("L")
                    px = np.asarray(img, dtype=np.float32) / 255.0
                    u8 = (px * 255).astype(np.uint8)
                    fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                    heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                    preds = dec.decode_page(heat, u8, fx, fy)
                    gt = dec.build_gt(joins, pno, fx, fy, core=True)
                    for g in gt:
                        g["_m"] = False
                    for p in sorted(preds, key=lambda q: -q["v"]):
                        best, bi = -1, 0.0
                        for i, g in enumerate(gt):
                            if g["cls"] != p["cls"] or g["_m"]:
                                continue
                            v = dec.iou(p["box"], g["box"])
                            if v > bi:
                                best, bi = i, v
                        if best >= 0 and bi >= 0.5:
                            gt[best]["_m"] = True
                            tp_total += 1
                        else:
                            fp_by_cls[p["cls"]] += 1
                            xfrac = p["x"] / u8.shape[1]
                            yfrac = p["y"] / u8.shape[0]
                            fp_zone["clef" if xfrac < 0.15 else ("title" if yfrac < 0.12 else "other")] += 1
                            x0, y0 = max(int(p["box"][0]), 0), max(int(p["box"][1]), 0)
                            x1, y1 = min(int(p["box"][2]), u8.shape[1]), min(int(p["box"][3]), u8.shape[0])
                            if x1 > x0 and y1 > y0:
                                fp_ink.append(float((u8[y0:y1, x0:x1] < 128).mean()))
                            dmin = min([abs(g["cx"] - p["x"]) + abs(g["cy"] - p["y"]) for g in gt
                                        if g["cls"] == p["cls"]] or [1e9])
                            fp_near.append(min(dmin, 2000.0))
                    fn_total += sum(1 for g in gt if not g["_m"])
                    n_pages += 1
            hist, edges = np.histogram(rest_h, bins=10) if rest_h else ([], [])
            report["layouts"][layout] = {
                "pages": n_pages, "tp": tp_total, "fn": fn_total, "fpByClass": fp_by_cls,
                "fpZone": fp_zone,
                "fpInkMedian": float(np.median(fp_ink)) if fp_ink else 0.0,
                "fpNearMedian": float(np.median(fp_near)) if fp_near else 0.0,
                "fpNearP90": float(np.percentile(fp_near, 90)) if fp_near else 0.0,
                "canonMedian": {c: [round(float(np.median([w for w, _ in v])), 1),
                                    round(float(np.median([h for _, h in v])), 1)] if v else [0, 0]
                                for c, v in Canon.items()},
                "restHeightHist": [int(x) for x in hist],
                "restHeightEdges": [round(float(x), 1) for x in edges]}
            print(layout, json.dumps(report["layouts"][layout]), flush=True)
    (out_dir / "forensics.json").write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
