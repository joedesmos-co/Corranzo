#!/usr/bin/env python3
"""Ignore-model evaluation with veto selection (TRAIN selects, DEV once).

Runs heatmap-ignore.pt (4ch), decodes object channels with the frozen v2
decoder, then applies the ignore veto: a note/rest(/tabdigit) peak is
dropped when the per-page-normalized ignore heat exceeds the normalized
class heat at its location. Compares against v2 (no veto) on the same
pages. Reports FP-bg (pure confusers) reduction + recall.

Usage:
    python3 tools/guitar-vision/proof-ignore-eval.py --split train --out <dir> [--tabdigit-veto]
    (DEV: --split validation, run once with the frozen veto choice.)
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


tr4 = _load("proof_ignore_train_mod", "proof-ignore-train.py")
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

SEED = 20261009
VETO_RADIUS_CELLS = 2  # ~12px at stride 8


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", default="train", choices=["train", "validation"])
    parser.add_argument("--out", required=True)
    parser.add_argument("--tabdigit-veto", action="store_true")
    parser.add_argument("--no-veto", action="store_true", help="v2-equivalent decode (control)")
    parser.add_argument("--weights", default="/tmp/proof/ignore-train/heatmap-ignore.pt")
    parser.add_argument("--samples", default=None)
    parser.add_argument("--no-norm", action="store_true")
    parser.add_argument("--hires", default="/tmp/proof/hires")
    parser.add_argument("--joins", default="joins.json")
    parser.add_argument("--work", required=False, action="append", default=[],
                        help="accepted for CLI compat; work roots come from /tmp/proof/workdirs.json")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    layout_suffix = ""
    for name in ("compact", "large", "bravura"):
        if args.joins == f"joins-{name}.json":
            layout_suffix = f"-{name}"
            break
    only = set(args.samples.split(',')) if args.samples else None
    want = args.split
    ids = set()
    for mp in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
               "datasets/guitar-vision/v2/dataset-manifest.json"]:
        for s in json.load(open(mp))["splits"]["assignments"]:
            if (want == "train") == (s["split"] == "train"):
                ids.add(s["sample"])
    ws = json.load(open("/tmp/proof/workdirs.json"))
    model = tr4.TinyFCN4().to(device)
    sd = torch.load(args.weights, map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()

    tp = fp = fn = fbg = 0
    by_cls = {c: {"tp": 0, "fp": 0, "fn": 0} for c in dec.CLASSES}
    n_pages = 0
    vetoed = 0
    with torch.no_grad():
        for mp in sorted(Path(hires_dir).glob("*-manifest.json")):
            sample = mp.name.replace("-manifest.json", "")
            if layout_suffix and sample.endswith(layout_suffix):
                sample = sample[: -len(layout_suffix)]
            if sample not in ids:
                continue
            if only is not None and sample not in only:
                continue
            man = json.load(open(mp))
            joins = None
            for root in ws:
                for cand in (f"{root}/{sample}/{args.joins}",
                             f"{root}/{args.joins}" if Path(root).name == sample else None):
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
                px = np.asarray(img, dtype=np.float32) / 255.0
                u8 = (px * 255).astype(np.uint8)
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                _nscale = 1.0
                if not args.no_norm:
                    u8, _nscale = dec.normalize_scale(u8)
                    fx, fy = fx * _nscale, fy * _nscale
                px = u8.astype(np.float32) / 255.0
                heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                obj = heat[:3]
                preds = dec.decode_page(obj, u8, fx, fy)
                if not args.no_veto:
                    ign = heat[3]
                    ign_n = ign / max(ign.max().item(), 1e-9)
                    kept = []
                    R = VETO_RADIUS_CELLS
                    for p in preds:
                        gx, gy = int(p["x"] / 8), int(p["y"] / 8)
                        x0, x1 = max(gx - R, 0), min(gx + R + 1, ign.shape[1])
                        y0, y1 = max(gy - R, 0), min(gy + R + 1, ign.shape[0])
                        ci = dec.CLASSES.index(p["cls"])
                        cls_n = obj[ci] / max(obj[ci].max().item(), 1e-9)
                        if p["cls"] == "tabdigit" and not args.tabdigit_veto:
                            kept.append(p)
                            continue
                        if ign_n[y0:y1, x0:x1].max().item() > cls_n[y0:y1, x0:x1].max().item():
                            vetoed += 1
                            continue
                        kept.append(p)
                    preds = kept
                gt = dec.build_gt(joins, pno, fx, fy, core=True)
                a, b, c = dec.match(preds, gt)
                tp, fp, fn = tp + a, fp + b, fn + c
                for cls in dec.CLASSES:
                    a2, b2, c2 = dec.match([p for p in preds if p["cls"] == cls],
                                           [dict(g) for g in gt if g["cls"] == cls])
                    by_cls[cls]["tp"] += a2
                    by_cls[cls]["fp"] += b2
                    by_cls[cls]["fn"] += c2
                n_pages += 1
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    report = {"pages": n_pages, "tp": tp, "fp": fp, "fn": fn,
              "precision": prec, "recall": rec,
              "f1": 2 * prec * rec / max(prec + rec, 1e-9),
              "vetoed": vetoed, "tabdigitVeto": args.tabdigit_veto,
              "noVeto": args.no_veto,
              "byClass": {c: {"tp": v["tp"], "fp": v["fp"], "fn": v["fn"],
                              "precision": v["tp"] / max(v["tp"] + v["fp"], 1),
                              "recall": v["tp"] / max(v["tp"] + v["fn"], 1)}
                          for c, v in by_cls.items()}}
    (out_dir / "ignore-eval.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
