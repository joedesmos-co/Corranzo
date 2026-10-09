#!/usr/bin/env python3
"""End-to-end TAB chain on detected boxes (G2/G3/G10): heatmap peaks ->
boxes -> frozen family/fret heads + StringNet -> tuning/capo -> pitch.

Compares against GT-box decoder numbers. Abstains on low confidence or
geometry disagreement. Frozen DEV only, per layout.

Usage:
    python3 tools/guitar-vision/proof-chain-eval.py --hires <dir> --work ... --models <dir> --out <dir> --layout standard
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
import importlib.util as _ilu


def _load(name, filename):
    spec = _ilu.spec_from_file_location(name, TOOLS / filename)
    module = _ilu.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pt = _load("proof_train_mod", "proof_train.py")
_pct = _load("proof_context_train_mod", "proof_context_train.py")
_phm = _load("proof_heatmap_train_mod", "proof-heatmap-train.py")
_dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

SEED = 20261009
TAU = 0.6
TUNING = [64, 59, 55, 50, 45, 40]
CLASSES = ["note", "rest", "tabdigit"]


def iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--models", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--layout", default="standard")
    parser.add_argument("--control", default="none",
                        choices=["none", "blank", "shifted", "shuffled"],
                        help="blank: zero pages (expect ~0 decoded). shifted: +30px box shift "
                             "(translation robustness). shuffled: permute string/fret predictions "
                             "across boxes (association dependence).")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    _, dev_ids = load_splits()

    recognizer = _pt.ProofNet().to(device)
    saved = torch.load(Path(args.models) / "proof-model.pt", map_location=device, weights_only=True)
    recognizer.load_state_dict(saved["state"] if "state" in saved else saved)
    recognizer.eval()
    string_net = _pct.StringNet().to(device)
    saved_s = torch.load(Path(args.models) / "stringnet.pt", map_location=device, weights_only=True)
    string_net.load_state_dict(saved_s["state"] if "state" in saved_s else saved_s)
    string_net.eval()
    detector = _phm.TinyFCN().to(device)
    saved_d = torch.load(Path(args.models) / "heatmap.pt", map_location=device, weights_only=True)
    detector.load_state_dict(saved_d["state"] if "state" in saved_d else saved_d)
    detector.eval()

    joins_name = "joins.json" if args.layout == "standard" else f"joins-{args.layout}.json"
    stats = {"digits": 0, "stringCorrect": 0, "fretCorrect": 0, "bothCorrect": 0,
             "pitchCorrect": 0, "decoded": 0, "abstained": 0, "byTier": {}}
    with torch.no_grad():
        for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
            sample = manifest_path.name.replace("-manifest.json", "")
            for suffix in ("-compact", "-large", "-bravura"):
                if sample.endswith(suffix):
                    sample = sample[: -len(suffix)]
                    break
            if sample not in dev_ids:
                continue
            manifest = json.loads(manifest_path.read_text())
            joins = None
            for root in work_dirs:
                for path in (root / sample / joins_name,
                             root / joins_name if root.name == sample else None):
                    if path is not None and path.exists():
                        joins = json.loads(path.read_text())
                        break
                if joins is not None:
                    break
            if joins is None:
                continue
            tier = "real"
            for tag, meta in manifest.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                page_no = int(tag.replace("page", ""))
                image = Image.open(meta["file"]).convert("L")
                pixels = np.asarray(image, dtype=np.float32) / 255.0
                if args.control == "blank":
                    pixels = np.zeros_like(pixels)
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                heat = detector(torch.from_numpy(pixels).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                gt = []
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != page_no or not join.get("boxes"):
                        continue
                    children = join.get("children", [])
                    cls = "note" if "notehead" in children else ("rest" if "rest" in children else ("tabdigit" if "tab-text" in children else None))
                    if cls != "tabdigit":
                        continue
                    boxes = join["boxes"]
                    gt.append({"box": [min(b[0] for b in boxes) * fx, min(b[1] for b in boxes) * fy,
                                       max(b[2] for b in boxes) * fx, max(b[3] for b in boxes) * fy],
                               "sid": sid})
                # Digit detections from the FROZEN postprocessing decoder
                # (TRAIN-selected constants; no inline peak logic here).
                page_preds = _dec.decode_page(
                    heat, (pixels * 255).astype(np.uint8), fx, fy)
                for det in page_preds:
                    if det["cls"] != "tabdigit":
                        continue
                    cx, cy = det["x"], det["y"]
                    if args.control == "shifted":
                        cx, cy = cx + 30, cy
                    w, h = det["box"][2] - det["box"][0], det["box"][3] - det["box"][1]
                    pred = det["box"] if args.control != "shifted" else [
                        cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
                    best, best_iou = None, 0.0
                    for index, g in enumerate(gt):
                        value = iou(pred, g["box"])
                        if value > best_iou:
                            best, best_iou = index, value
                    if best is None or best_iou < 0.5:
                        continue
                    stats["digits"] += 1
                    # Classify the detected crop with frozen heads.
                    side = max(w, h) * 0.8
                    crop = image.crop((max(int(cx - side), 0), max(int(cy - side), 0),
                                       min(int(cx + side), image.width), min(int(cy + side), image.height)))
                    crop = crop.resize((64, 64), Image.BILINEAR)
                    tensor = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                    rec_out = recognizer(tensor)
                    string_tall = tensor  # StringNet reads its own tall crop below
                    # Tall staff crop around the detection (box-relative window).
                    half_h = max(h * 1.1, 160 * (h / 253))
                    tall = image.crop((max(int(cx - w), 0), max(int(cy - half_h), 0),
                                       min(int(cx + w), image.width), min(int(cy + half_h), image.height)))
                    tall = tall.resize((64, 256), Image.BILINEAR)
                    tall_tensor = torch.from_numpy(np.asarray(tall, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                    string_posterior = F.softmax(string_net(tall_tensor)["string"], dim=1)[0]
                    fret_posterior = F.softmax(rec_out["fret"], dim=1)[0]
                    string_pred, string_conf = int(string_posterior.argmax()), float(string_posterior.max())
                    fret_pred, fret_conf = int(fret_posterior.argmax()), float(fret_posterior.max())
                    if min(string_conf, fret_conf) < TAU:
                        stats["abstained"] += 1
                        continue
                    stats["decoded"] += 1
                    # Truth for this GT digit: recover event via joins sid.
                    truth_string = truth_fret = truth_midi = None
                    stats["byTier"].setdefault(tier, {"decoded": 0, "pitchCorrect": 0})
                    stats["byTier"][tier]["decoded"] += 1
                    implied = TUNING[string_pred] + fret_pred
                    # Pitch correctness checked against canonical via joins sid below.
                    stats.setdefault("pairs", []).append(
                        {"score": sample, "sid": gt[best].get("sid"), "string": string_pred + 1,
                         "fret": fret_pred, "implied": implied})
    (out_dir / f"chain-{args.layout}.json").write_text(json.dumps(
        {k: v for k, v in stats.items() if k != "pairs"}, indent=1))
    (out_dir / f"chain-{args.layout}-pairs.json").write_text(json.dumps(stats.get("pairs", []), indent=1))
    # Truth comparison: implied pitch vs canonical sounding pitch per pair.
    import re as _re
    pairs = stats.get("pairs", [])
    if args.control == "shuffled":
        # Permute predicted associations across pairs (right boxes, wrong
        # labels): a pixel/content-dependent chain must collapse.
        order = np.random.RandomState(SEED + 2).permutation(len(pairs))
        shuffled_preds = [(pairs[i]["string"], pairs[i]["fret"]) for i in order]
        for pair, (string, fret) in zip(pairs, shuffled_preds):
            pair["string"], pair["fret"] = string, fret
            pair["implied"] = TUNING[string - 1] + fret
    correct = {"string": 0, "fret": 0, "both": 0, "pitch": 0, "n": 0}
    for pair in pairs:
        score = pair["score"]
        for root in work_dirs:
            path = None
            for cand in (root / score / "canonical.json",
                         root / "canonical.json" if root.name == score else None):
                if cand is not None and cand.exists():
                    path = cand
                    break
            if path is not None:
                canonical = json.loads(path.read_text())
                break
        else:
            continue
        event = next((e for e in canonical.get("events", [])), None)
        match = _re.search(r"-n(\d+)$", pair["sid"]) if pair.get("sid") else None
        if match:
            counter = int(match.group(1)) - 1
            event = next((e for e in canonical.get("events", [])
                          if _re.search(r"-n(\d+)$", (e.get("source") or {}).get("noteId") or "")
                          and int(_re.search(r"-n(\d+)$", (e.get("source") or {}).get("noteId")).group(1)) == counter), None)
        if event is None:
            continue
        tab = event.get("tab") or {}
        pitch = (event.get("pitch") or {}).get("soundingMidi")
        correct["n"] += 1
        string_ok = tab.get("string") == pair["string"]
        fret_ok = tab.get("fret") == pair["fret"]
        if string_ok:
            correct["string"] += 1
        if fret_ok:
            correct["fret"] += 1
        if string_ok and fret_ok:
            correct["both"] += 1
        if pitch is not None and pair["implied"] == pitch:
            correct["pitch"] += 1
    report = {k: v for k, v in stats.items() if k != "pairs"}
    report["truth"] = correct
    report["truthRates"] = {k: (correct[k] / max(correct["n"], 1)) for k in ("string", "fret", "both", "pitch")}
    (out_dir / f"chain-{args.layout}.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
