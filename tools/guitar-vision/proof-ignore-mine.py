#!/usr/bin/env python3
"""Mine ignore-class negatives (TRAIN only, v2 decoder, no training).

Runs the frozen v2 decoder on TRAIN standard+compact pages and records
pure-confuser bg-FPs: >25px Manhattan from any same-class GT center AND
IoU<0.1 with every GT box. Near-misses/halos excluded. Capped at 40/page.

Output: /tmp/proof/ignore/ignore-labels.json keyed by sample/layout/page
with hires-px coordinates.

Usage:
    python3 tools/guitar-vision/proof-ignore-mine.py --out <dir>
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
           "compact": ("/tmp/proof/hires-compact", "joins-compact.json", "-compact")}
CAP_PER_PAGE = 40
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
    model = TinyFCN().to(device)
    sd = torch.load("datasets/guitar-vision/proof-detection/heatmap16ep.pt",
                     map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()

    labels: dict = {}
    n_pages, n_neg = 0, 0
    with torch.no_grad():
        for layout, (hires, joins_name, suffix) in LAYOUTS.items():
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
                    fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                    heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                    preds = dec.decode_page(heat, u8, fx, fy)
                    gt = dec.build_gt(joins, pno, fx, fy, core=True)
                    cands = []
                    for p in sorted(preds, key=lambda q: -q["v"]):
                        best, bi = -1, 0.0
                        for i, g in enumerate(gt):
                            if g["cls"] != p["cls"]:
                                continue
                            v = dec.iou(p["box"], g["box"])
                            if v > bi:
                                best, bi = i, v
                        if best >= 0 and bi >= 0.5:
                            continue  # TP, not a confuser
                        near = any(g["cls"] == p["cls"] and
                                   abs(g["cx"] - p["x"]) + abs(g["cy"] - p["y"]) < 25 for g in gt)
                        bad = any(dec.iou(p["box"], g["box"]) >= 0.1 for g in gt)
                        if not near and not bad:
                            cands.append((p["v"], p["x"], p["y"], p["cls"]))
                    cands.sort(reverse=True)
                    kept = [{"x": x, "y": y, "v": v, "cls": c} for v, x, y, c in cands[:CAP_PER_PAGE]]
                    labels.setdefault(sample, {}).setdefault(layout, {})[tag] = kept
                    n_pages += 1
                    n_neg += len(kept)
    (out_dir / "ignore-labels.json").write_text(json.dumps(labels))
    print(f"pages: {n_pages}, negatives: {n_neg}")
    # Class mix of confusers (for the report).
    mix: dict = {}
    for s, ll in labels.items():
        for l, pp in ll.items():
            for t, kk in pp.items():
                for k in kk:
                    mix[k["cls"]] = mix.get(k["cls"], 0) + 1
    print("confuser mix:", json.dumps(mix))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
