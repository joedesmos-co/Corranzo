#!/usr/bin/env python3
"""G2 scale-normalization probe (TRAIN-fit large pages, frozen v3, no training).

Rescales large pages by 1.32x (0.076 -> 0.100 fx, matching standard) and
re-runs the frozen decoder with adjusted fx/fy. If recall recovers toward
standard TRAIN levels, scale normalization is the bounded experiment
(inference-only, no training).

Usage:
    python3 tools/guitar-vision/proof-scale-probe.py --out <dir> --samples a,b,c
"""
from __future__ import annotations

import argparse
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


_pig = _load("proof_ignore_train_mod", "proof-ignore-train.py")
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

SCALE = 1.32  # large fx 0.076 -> standard 0.100
SEED = 20261009


def run_pages(hires, joins_name, suffix, wanted, work_dirs, model, device, scale: float):
    tp = fp = fn = 0
    n = 0
    with torch.no_grad():
        for mp in sorted(Path(hires).glob("*-manifest.json")):
            sample = mp.name.replace("-manifest.json", "")
            if suffix and sample.endswith(suffix):
                sample = sample[: -len(suffix)]
            if sample not in wanted:
                continue
            man = json.load(open(mp))
            joins = None
            for root in work_dirs:
                for cand in (f"{root}/{sample}/{joins_name}",
                             f"{root}/{joins_name}" if Path(root).name == sample else None):
                    if cand and Path(cand).exists():
                        joins = json.load(open(cand))
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
                if scale != 1.0:
                    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.BILINEAR)
                px = np.asarray(img, dtype=np.float32) / 255.0
                u8 = (px * 255).astype(np.uint8)
                fx = meta["cssWidth"] / meta["viewBox"][0] * scale  # scaled image: px per canonical unit grows
                fy = meta["height"] / meta["viewBox"][1] * scale
                heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                preds = dec.decode_page(heat, u8, fx, fy)
                gt = dec.build_gt(joins, pno, fx, fy, core=True)
                a, b, c = dec.match(preds, gt)
                tp, fp, fn = tp + a, fp + b, fn + c
                n += 1
    return {"tp": tp, "fp": fp, "fn": fn, "pages": n,
            "precision": tp / max(tp + fp, 1), "recall": tp / max(tp + fn, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", required=True)
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    wanted = set(args.samples.split(","))
    ws = json.load(open("/tmp/proof/workdirs.json"))
    model = _pig.TinyFCN4().to(device)
    sd = torch.load("datasets/guitar-vision/proof-detection/heatmap-ignore.pt",
                     map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()
    base = run_pages("/tmp/proof/hires-large", "joins-large.json", "-large",
                     wanted, ws, model, device, 1.0)
    scaled = run_pages("/tmp/proof/hires-large", "joins-large.json", "-large",
                       wanted, ws, model, device, SCALE)
    report = {"scale": SCALE, "baseline": base, "scaled": scaled}
    (out_dir / "scale-probe.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
