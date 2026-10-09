#!/usr/bin/env python3
"""DEV evaluation with the frozen postprocessing decoder (run ONCE per layout).

Uses proof-heatmap-decode.py constants exactly as frozen on TRAIN. Reports
core-box P/R (primary) + union-box P/R (continuity) + per-class splits.

Usage:
    python3 tools/guitar-vision/proof-decode-eval.py --hires <dir> --work ... --weights <pt> --out <dir> [--joins joins-compact.json]
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


TinyFCN4 = _load("proof_ignore_train_mod", "proof-ignore-train.py").TinyFCN4
TinyFCN3 = _load("proof_heatmap_train_mod", "proof-heatmap-train.py").TinyFCN
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

SEED = 20261009


def load_dev_ids():
    dev = set()
    for manifest_path in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
                          "datasets/guitar-vision/v2/dataset-manifest.json"]:
        manifest = json.loads(Path(manifest_path).read_text())
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] == "validation":
                dev.add(sample["sample"])
    return dev


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--joins", default="joins.json")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    dev_ids = load_dev_ids()

    layout_suffix = ""
    for name in ("compact", "large", "bravura"):
        if args.joins == f"joins-{name}.json":
            layout_suffix = f"-{name}"
            break

    saved = torch.load(args.weights, map_location=device, weights_only=True)
    state = saved["state"] if "state" in saved else saved
    try:
        model = TinyFCN4().to(device)
        model.load_state_dict(state)
    except RuntimeError:
        model = TinyFCN3().to(device)
        model.load_state_dict(state)
    model.eval()

    frozen = {"thresholds": dict(dec.THRESHOLDS), "xclassRadius": dec.XCLASS_RADIUS,
              "staffGate": dec.STAFF_GATE, "coreBoxes": dec.CORE_BOXES,
              "boxScale": {k: list(v) for k, v in dec.BOX_SCALE.items()},
              "weights": dec.WEIGHTS, "ignoreVeto": dec.IGNORE_VETO,
              "vetoCells": dec.VETO_CELLS,
              "iouMatch": dec.IOU_MATCH, "medians": {k: list(v) for k, v in dec.MEDIANS.items()}}
    totals = {"core": {"tp": 0, "fp": 0, "fn": 0}, "union": {"tp": 0, "fp": 0, "fn": 0}}
    by_cls = {c: {"tp": 0, "fp": 0, "fn": 0} for c in dec.CLASSES}
    n_digits = {"matched": 0, "total": 0}
    n_pages = 0
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
                for path in (root / sample / args.joins, root / args.joins if root.name == sample else None):
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
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                heat = model(torch.from_numpy(pixels).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                preds = dec.decode_page(heat, (pixels * 255).astype(np.uint8), fx, fy)
                for core_flag, key in [(True, "core"), (False, "union")]:
                    gt = dec.build_gt(joins, page_no, fx, fy, core=core_flag)
                    a, b, c = dec.match(preds, gt)
                    totals[key]["tp"] += a
                    totals[key]["fp"] += b
                    totals[key]["fn"] += c
                gt_core = dec.build_gt(joins, page_no, fx, fy, core=True)
                # Per-class core splits (rematch per class via match on filtered sets).
                for cls in dec.CLASSES:
                    a, b, c = dec.match([p for p in preds if p["cls"] == cls],
                                        [dict(g) for g in gt_core if g["cls"] == cls])
                    by_cls[cls]["tp"] += a
                    by_cls[cls]["fp"] += b
                    by_cls[cls]["fn"] += c
                n_digits["total"] += sum(1 for g in gt_core if g["cls"] == "tabdigit")
                n_pages += 1

    def pr(d):
        tp, fp, fn = d["tp"], d["fp"], d["fn"]
        return {"tp": tp, "fp": fp, "fn": fn, "precision": tp / max(tp + fp, 1),
                "recall": tp / max(tp + fn, 1)}

    report = {"pages": n_pages, "frozen": frozen, "core": pr(totals["core"]),
              "union": pr(totals["union"]),
              "byClassCore": {c: pr(by_cls[c]) for c in dec.CLASSES},
              "tabdigitGT": n_digits["total"], "weights": args.weights}
    (out_dir / "decode-eval.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
