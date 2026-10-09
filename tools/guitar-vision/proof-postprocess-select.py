#!/usr/bin/env python3
"""TRAIN selection for the frozen postprocessing decoder (no DEV, no training).

Caches frozen-model heats per TRAIN standard page once, then evaluates the
bounded config grid with ablations. Selects ONE combination to freeze.
Also collects FP-bg forensics (clef-zone fraction, ink mass) and the TP
value distribution for the threshold rationale.

Usage:
    python3 tools/guitar-vision/proof-postprocess-select.py --hires <dir> --work ... --weights <pt> --out <dir>
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


TinyFCN = _load("proof_heatmap_train_mod", "proof-heatmap-train.py").TinyFCN
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

SEED = 20261009


def load_train_ids():
    train = set()
    for manifest_path in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
                          "datasets/guitar-vision/v2/dataset-manifest.json"]:
        manifest = json.loads(Path(manifest_path).read_text())
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] == "train":
                train.add(sample["sample"])
    return train


def find_joins(sample, work_dirs, name="joins.json"):
    for root in work_dirs:
        for path in (root / sample / name, root / name if root.name == sample else None):
            if path is not None and path.exists():
                return json.loads(path.read_text())
    return None


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

    # Cache heats + pixels + gt per TRAIN page (standard layout only).
    pages = []
    with torch.no_grad():
        for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
            sample = manifest_path.name.replace("-manifest.json", "")
            if sample not in train_ids:
                continue
            manifest = json.loads(manifest_path.read_text())
            joins = find_joins(sample, work_dirs)
            if joins is None:
                continue
            for tag, meta in manifest.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                page_no = int(tag.replace("page", ""))
                image = Image.open(meta["file"]).convert("L")
                pixels = np.asarray(image, dtype=np.float32) / 255.0
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                heat = model(torch.from_numpy(pixels).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                pages.append({"id": f"{sample}:{tag}", "heat": heat,
                              "u8": (pixels * 255).astype(np.uint8),
                              "fx": fx, "fy": fy, "joins": joins, "page": page_no,
                              "w": pixels.shape[1]})
    print(f"cached {len(pages)} TRAIN pages", flush=True)

    results = {}
    for core in [False, True]:
        gt_cache = [dec.build_gt(p["joins"], p["page"], p["fx"], p["fy"], core=core) for p in pages]
        for thr in [0.3, 0.4, 0.5]:
            thresholds = {c: thr for c in dec.CLASSES}
            for xclass in [0, 12.0]:
                for gate in [False, True]:
                    tp = fp = fn = 0
                    for p, gt in zip(pages, gt_cache):
                        preds = dec.decode_page(p["heat"], p["u8"], p["fx"], p["fy"],
                                                thresholds=thresholds, xclass_radius=xclass,
                                                staff_gate=gate)
                        a, b, c = dec.match(preds, [dict(g) for g in gt])
                        tp, fp, fn = tp + a, fp + b, fn + c
                    prec = tp / max(tp + fp, 1)
                    rec = tp / max(tp + fn, 1)
                    key = f"core={int(core)} thr={thr} xclass={xclass:g} gate={int(gate)}"
                    results[key] = {"tp": tp, "fp": fp, "fn": fn,
                                    "precision": prec, "recall": rec,
                                    "f1": 2 * prec * rec / max(prec + rec, 1e-9)}
                    print(key, "P=%.3f R=%.3f F1=%.3f" % (prec, rec, results[key]["f1"]), flush=True)

    # Forensics on the SELECTED config (core, 0.4, xclass, gate): FP-bg
    # clef-zone fraction + ink mass; TP value distribution.
    sel = {"core": True, "thresholds": {c: 0.4 for c in dec.CLASSES},
           "xclass": 12.0, "gate": True}
    bg_total = bg_clef = 0
    ink_masses = []
    tp_values = []
    for p in pages:
        gt = dec.build_gt(p["joins"], p["page"], p["fx"], p["fy"], core=True)
        preds = dec.decode_page(p["heat"], p["u8"], p["fx"], p["fy"],
                                thresholds=sel["thresholds"], xclass_radius=sel["xclass"],
                                staff_gate=sel["gate"])
        for pred in preds:
            pred["_m"] = False
        ordered = sorted(preds, key=lambda q: -q["v"])
        for pred in ordered:
            best, best_iou = -1, 0.0
            for idx, g in enumerate(gt):
                if g["cls"] != pred["cls"] or g.get("_m"):
                    continue
                v = dec.iou(pred["box"], g["box"])
                if v > best_iou:
                    best, best_iou = idx, v
            if best >= 0 and best_iou >= 0.5:
                gt[best]["_m"] = True
                pred["_m"] = True
                tp_values.append(pred["v"])
        for pred in preds:
            if pred["_m"]:
                continue
            # Nearest unmatched same-class GT?
            near = any(not g.get("_m") and g["cls"] == pred["cls"]
                       and abs(g["cx"] - pred["x"]) + abs(g["cy"] - pred["y"]) < 25 for g in gt)
            halo = any(not g.get("_m") and g["cls"] == pred["cls"]
                       and dec.iou(pred["box"], g["box"]) >= 0.1 for g in gt)
            if not near and not halo:
                bg_total += 1
                if pred["x"] < 0.15 * p["w"]:
                    bg_clef += 1
                x0, y0 = max(int(pred["box"][0]), 0), max(int(pred["box"][1]), 0)
                x1, y1 = min(int(pred["box"][2]), p["w"]), min(int(pred["box"][3]), p["u8"].shape[0])
                if x1 > x0 and y1 > y0:
                    ink_masses.append(float((p["u8"][y0:y1, x0:x1] < 128).mean()))
    tp_values.sort()
    forensics = {"fpBgTotal": bg_total, "fpBgClefZone": bg_clef,
                 "fpBgClefFrac": bg_clef / max(bg_total, 1),
                 "inkMassMedian": float(np.median(ink_masses)) if ink_masses else 0.0,
                 "inkMassP90": float(np.percentile(ink_masses, 90)) if ink_masses else 0.0,
                 "tpValueP5": tp_values[max(int(0.05 * len(tp_values)) - 1, 0)] if tp_values else 0.0,
                 "tpValueMin": tp_values[0] if tp_values else 0.0, "nTP": len(tp_values)}
    print("forensics:", json.dumps(forensics), flush=True)
    (out_dir / "postprocess-select.json").write_text(
        json.dumps({"grid": results, "forensics": forensics}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
