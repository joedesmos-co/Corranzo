#!/usr/bin/env python3
"""Scale-norm verification on TRAIN-heldout (norm on/off x layouts).

Uses frozen per-layout detectors (LAYOUT_DETECTOR). No selection here
beyond the frozen universal-vs-conditional decision this output informs.

Usage:
    python3 tools/guitar-vision/proof-norm-verify.py --out <dir> --samples a,b,c
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
_phm = _load("proof_heatmap_train_mod", "proof-heatmap-train.py")
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

LAYOUTS = {"standard": ("/tmp/proof/hires", "joins.json", ""),
           "compact": ("/tmp/proof/hires-compact", "joins-compact.json", "-compact"),
           "large": ("/tmp/proof/hires-large", "joins-large.json", "-large"),
           "bravura": ("/tmp/proof/hires-bravura", "joins-bravura.json", "-bravura")}
import os as _os
INTERP = _os.environ.get("NORM_INTERP", "nearest")  # bilinear|nearest (heldout-selected)
SEED = 20261009


def load_model(weights, device):
    saved = torch.load(weights, map_location=device, weights_only=True)
    state = saved["state"] if "state" in saved else saved
    try:
        model = _pig.TinyFCN4().to(device)
        model.load_state_dict(state)
    except RuntimeError:
        model = _phm.TinyFCN().to(device)
        model.load_state_dict(state)
    model.eval()
    return model


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
    models = {layout: load_model(w, device) for layout, w in dec.LAYOUT_DETECTOR.items()}
    report: dict = {}
    with torch.no_grad():
        for layout, (hires, joins_name, suffix) in LAYOUTS.items():
            acc = {"off": {"tp": 0, "fp": 0, "fn": 0}, "on": {"tp": 0, "fp": 0, "fn": 0},
                   "merged": {"tp": 0, "fp": 0, "fn": 0}}
            cls_acc = {"off": {c: {"tp": 0, "fp": 0, "fn": 0} for c in dec.CLASSES},
                       "on": {c: {"tp": 0, "fp": 0, "fn": 0} for c in dec.CLASSES},
                       "merged": {c: {"tp": 0, "fp": 0, "fn": 0} for c in dec.CLASSES}}
            scales = []
            n_pages = 0
            for mp in sorted(Path(hires).glob("*-manifest.json")):
                sample = mp.name.replace("-manifest.json", "")
                if suffix and sample.endswith(suffix):
                    sample = sample[: -len(suffix)]
                if sample not in wanted:
                    continue
                man = json.load(open(mp))
                joins = None
                for root in ws:
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
                    u8 = np.asarray(Image.open(meta["file"]).convert("L"))
                    fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                    gt = dec.build_gt(joins, pno, fx, fy, core=True)
                    page_preds = {}
                    for key, norm in (("off", False), ("on", True)):
                        preds, scale = dec.infer_page(models[layout], u8, fx, fy, device, normalize=norm)
                        if norm:
                            scales.append(scale)
                        page_preds[key] = preds
                        a, b, c = dec.match(preds, [dict(g) for g in gt])
                        acc[key]["tp"] += a
                        acc[key]["fp"] += b
                        acc[key]["fn"] += c
                        for cls in dec.CLASSES:
                            a2, b2, c2 = dec.match([p for p in preds if p["cls"] == cls],
                                                   [dict(g) for g in gt if g["cls"] == cls])
                            cls_acc[key][cls]["tp"] += a2
                            cls_acc[key][cls]["fp"] += b2
                            cls_acc[key][cls]["fn"] += c2
                    # Merged: notes from normed pass, digits+rests from native.
                    merged = ([p for p in page_preds["on"] if p["cls"] == "note"] +
                              [p for p in page_preds["off"] if p["cls"] != "note"])
                    a, b, c = dec.match(merged, [dict(g) for g in gt])
                    acc["merged"]["tp"] += a
                    acc["merged"]["fp"] += b
                    acc["merged"]["fn"] += c
                    for cls in dec.CLASSES:
                        a2, b2, c2 = dec.match([p for p in merged if p["cls"] == cls],
                                               [dict(g) for g in gt if g["cls"] == cls])
                        cls_acc["merged"][cls]["tp"] += a2
                        cls_acc["merged"][cls]["fp"] += b2
                        cls_acc["merged"][cls]["fn"] += c2
                    n_pages += 1
            out = {}
            for key in ("off", "on", "merged"):
                d = acc[key]
                out[key] = {**d, "precision": d["tp"] / max(d["tp"] + d["fp"], 1),
                            "recall": d["tp"] / max(d["tp"] + d["fn"], 1),
                            "byClass": {c: {"tp": v["tp"], "fp": v["fp"], "fn": v["fn"],
                                            "precision": v["tp"] / max(v["tp"] + v["fp"], 1),
                                            "recall": v["tp"] / max(v["tp"] + v["fn"], 1)}
                                        for c, v in cls_acc[key].items()}}
            out["pages"] = n_pages
            out["scaleMed"] = round(float(np.median(scales)), 3) if scales else 1.0
            report[layout] = out
            print(layout, json.dumps(out), flush=True)
    (out_dir / "norm-verify.json").write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
