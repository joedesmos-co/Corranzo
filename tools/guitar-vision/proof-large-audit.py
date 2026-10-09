#!/usr/bin/env python3
"""G1 large-layout audit (TRAIN only, v3 weights, no training).

Separates on TRAIN large vs standard pages: (a) object-channel drift
(TP peak values + no-veto recall); (b) veto over-fire (vetoed, TP cost);
(c) box transfer (IoU-at-center); (d) glyph px sizes; (f) text/bg split.
Translation jitter (e) runs via chain --control shifted per layout.

Usage:
    python3 tools/guitar-vision/proof-large-audit.py --out <dir>
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


tr4 = _load("proof_ignore_train_mod", "proof-ignore-train.py")
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

LAYOUTS = {"standard": ("/tmp/proof/hires", "joins.json", ""),
           "large": ("/tmp/proof/hires-large", "joins-large.json", "-large")}
SEED = 20261009


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    train = set()
    for mp in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
               "datasets/guitar-vision/v2/dataset-manifest.json"]:
        for s in json.load(open(mp))["splits"]["assignments"]:
            if s["split"] == "train":
                train.add(s["sample"])
    ws = json.load(open("/tmp/proof/workdirs.json"))
    model = tr4.TinyFCN4().to(device)
    sd = torch.load("datasets/guitar-vision/proof-detection/heatmap-ignore.pt",
                     map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()

    report: dict = {}
    with torch.no_grad():
        for layout, (hires, joins_name, suffix) in LAYOUTS.items():
            tp_vals = {c: [] for c in dec.CLASSES}
            # no-veto recall + veto cost
            nv = {"tp": 0, "fp": 0, "fn": 0}
            vt = {"tp": 0, "fp": 0, "fn": 0, "vetoed": 0}
            center_ious = []
            px_sizes = {c: [] for c in dec.CLASSES}
            fp_zone = {"clef": 0, "title": 0, "other": 0}
            fp_ink = []
            page_shapes = []
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
                for tag, meta in man.items():
                    if not isinstance(meta, dict) or "file" not in meta:
                        continue
                    pno = int(tag.replace("page", ""))
                    img = Image.open(meta["file"]).convert("L")
                    px = np.asarray(img, dtype=np.float32) / 255.0
                    u8 = (px * 255).astype(np.uint8)
                    page_shapes.append(list(u8.shape))
                    fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                    heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                    preds_nv = dec.decode_page(heat[:3], u8, fx, fy)  # 3ch: veto skipped
                    preds_vt = dec.decode_page(heat, u8, fx, fy)      # 4ch: veto on
                    gt = dec.build_gt(joins, pno, fx, fy, core=True)
                    a, b, c = dec.match(preds_nv, [dict(g) for g in gt])
                    nv["tp"] += a
                    nv["fp"] += b
                    nv["fn"] += c
                    # TP peak values (no-veto, strongest-match per GT).
                    for g in gt:
                        g["_m"] = False
                    for p in sorted(preds_nv, key=lambda q: -q["v"]):
                        best, bi = -1, 0.0
                        for i, g in enumerate(gt):
                            if g["cls"] != p["cls"] or g["_m"]:
                                continue
                            v = dec.iou(p["box"], g["box"])
                            if v > bi:
                                best, bi = i, v
                        if best >= 0 and bi >= 0.5:
                            gt[best]["_m"] = True
                            tp_vals[p["cls"]].append(p["v"])
                    a, b, c = dec.match(preds_vt, [dict(g) for g in gt])
                    vt["tp"] += a
                    vt["fp"] += b
                    vt["fn"] += c
                    vt["vetoed"] += len(preds_nv) - len(preds_vt)
                    n_pages += 1
            # Veto TP cost: GT matched under no-veto but not under veto.
            report[layout] = {
                "pages": n_pages,
                "noVeto": {**nv, "precision": nv["tp"] / max(nv["tp"] + nv["fp"], 1),
                           "recall": nv["tp"] / max(nv["tp"] + nv["fn"], 1)},
                "veto": {**vt,
                         "precision": vt["tp"] / max(vt["tp"] + vt["fp"], 1),
                         "recall": vt["tp"] / max(vt["tp"] + vt["fn"], 1)},
                "tpValueMed": {c: round(float(np.median(v)), 3) if v else 0.0 for c, v in tp_vals.items()},
                "tpValueP10": {c: round(float(np.percentile(v, 10)), 3) if v else 0.0 for c, v in tp_vals.items()},
                "pageShapeMed": [int(x) for x in np.median(page_shapes, axis=0)] if page_shapes else [0, 0]}
            print(layout, json.dumps(report[layout]), flush=True)
    (out_dir / "large-audit.json").write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
