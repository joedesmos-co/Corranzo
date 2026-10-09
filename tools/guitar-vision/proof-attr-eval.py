#!/usr/bin/env python3
"""G1 end-to-end error attribution (TRAIN-fit/heldout/DEV by sample list).

Per GT TAB digit: detected? box? family? fret? string? staff? abstained?
paired? rhythm? Uses frozen detectors (per-layout map), frozen heads,
exact event links. Reports counts + oracle-swap headroom per stage.

Usage:
    python3 tools/guitar-vision/proof-attr-eval.py --hires <dir> --work ... --out <dir> --samples a,b,c [--joins joins.json] [--layout standard]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pt = _load("proof_train_mod", "proof_train.py")
_pct = _load("proof_context_train_mod", "proof_context_train.py")
_pig = _load("proof_ignore_train_mod", "proof-ignore-train.py")
_phm = _load("proof_heatmap_train_mod", "proof-heatmap-train.py")
_dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")
_evlink = _load("proof_event_link_mod", "proof-event-link.py")

SEED = 20261009
TAU = 0.6
TAU_GRID = [0.4, 0.5, 0.6, 0.7]  # abstention sweep in one pass (post-only)
TUNING = [64, 59, 55, 50, 45, 40]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--joins", default="joins.json")
    parser.add_argument("--layout", default="standard")
    parser.add_argument("--detector", default=None)
    parser.add_argument("--tag", default="attr")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    wanted = set(args.samples.split(","))

    det_path = args.detector or _dec.LAYOUT_DETECTOR.get(args.layout, _dec.WEIGHTS)
    recognizer = _pt.ProofNet().to(device)
    saved = torch.load(Path("/tmp/proof/chain-models") / "proof-model.pt",
                        map_location=device, weights_only=True)
    recognizer.load_state_dict(saved["state"] if "state" in saved else saved)
    recognizer.eval()
    string_net = _pct.StringNet().to(device)
    saved_s = torch.load(Path("/tmp/proof/chain-models") / "stringnet.pt",
                          map_location=device, weights_only=True)
    string_net.load_state_dict(saved_s["state"] if "state" in saved_s else saved_s)
    string_net.eval()
    saved_d = torch.load(det_path, map_location=device, weights_only=True)
    state_d = saved_d["state"] if "state" in saved_d else saved_d
    try:
        detector = _pig.TinyFCN4().to(device)
        detector.load_state_dict(state_d)
    except RuntimeError:
        detector = _phm.TinyFCN().to(device)
        detector.load_state_dict(state_d)
    detector.eval()

    stages = {"gt": 0, "missedDetection": 0, "wrongFamily": 0, "badBox": 0,
              "matched": 0, "abstained": 0, "fretWrong": 0, "stringWrong": 0,
              "bothCorrect": 0, "pitchCorrect": 0, "paired": 0, "pairedAgree": 0,
              "rhythmKnown": 0}
    tau_stats = {t: {"decoded": 0, "abstained": 0, "bothCorrect": 0, "pitchCorrect": 0} for t in TAU_GRID}
    n_pages = 0
    with torch.no_grad():
        for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
            sample = manifest_path.name.replace("-manifest.json", "")
            for suffix in ("-compact", "-large", "-bravura"):
                if sample.endswith(suffix):
                    sample = sample[: -len(suffix)]
                    break
            if sample not in wanted:
                continue
            manifest = json.loads(manifest_path.read_text())
            joins = canon = None
            for root in work_dirs:
                for cand in (root / sample / args.joins,
                             root / args.joins if root.name == sample else None):
                    if cand is not None and cand.exists():
                        joins = json.loads(cand.read_text())
                        break
                if joins is not None:
                    break
            for root in work_dirs:
                for cand in (root / sample / "canonical.json",
                             root / "canonical.json" if root.name == sample else None):
                    if cand is not None and cand.exists():
                        canon = json.loads(cand.read_text())
                        break
                if canon is not None:
                    break
            if joins is None:
                continue
            links, _ = _evlink.build_links(joins, canon, sample)
            # Pairing measured separately (x-column audit, CPU-only):
            # onset-group equality counts polyphony as disagreement.
            # See pair-xcol results in the mission report.
            for tag, meta in manifest.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                page_no = int(tag.replace("page", ""))
                image = Image.open(meta["file"]).convert("L")
                pixels = np.asarray(image, dtype=np.float32) / 255.0
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                preds, _ = _dec.infer_page_merged(detector, (pixels * 255).astype(np.uint8), fx, fy, device)
                gt_digits = []
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != page_no or not join.get("boxes"):
                        continue
                    if "tab-text" not in (join.get("children") or []):
                        continue
                    boxes = join["boxes"]
                    gt_digits.append({"sid": sid, "box": [
                        min(b[0] for b in boxes) * fx, min(b[1] for b in boxes) * fy,
                        max(b[2] for b in boxes) * fx, max(b[3] for b in boxes) * fy]})
                for g in gt_digits:
                    stages["gt"] += 1
                    gcx = (g["box"][0] + g["box"][2]) / 2
                    gcy = (g["box"][1] + g["box"][3]) / 2
                    best, best_iou = None, 0.0
                    for p in preds:
                        if p["cls"] != "tabdigit":
                            continue
                        v = _dec.iou(p["box"], g["box"])
                        if v > best_iou:
                            best, best_iou = p, v
                    if best is not None and best_iou >= 0.5:
                        stages["matched"] += 1
                        cx, cy = best["x"], best["y"]
                        w, h = best["box"][2] - best["box"][0], best["box"][3] - best["box"][1]
                    else:
                        near_box = any(p["cls"] == "tabdigit" and
                                       abs((p["box"][0] + p["box"][2]) / 2 - gcx) +
                                       abs((p["box"][1] + p["box"][3]) / 2 - gcy) < 25
                                       for p in preds)
                        if near_box:
                            stages["badBox"] += 1
                        elif any(p["cls"] != "tabdigit" and
                                 abs(p["x"] - gcx) + abs(p["y"] - gcy) < 12 for p in preds):
                            stages["wrongFamily"] += 1
                        else:
                            stages["missedDetection"] += 1
                        continue
                    # Frozen heads on the matched box.
                    side = max(w, h) * 0.8
                    crop = image.crop((max(int(cx - side), 0), max(int(cy - side), 0),
                                       min(int(cx + side), image.width), min(int(cy + side), image.height)))
                    crop = crop.resize((64, 64), Image.BILINEAR)
                    tensor = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                    rec_out = recognizer(tensor)
                    half_h = max(h * 1.1, 160 * (h / 253))
                    tall = image.crop((max(int(cx - w), 0), max(int(cy - half_h), 0),
                                       min(int(cx + w), image.width), min(int(cy + half_h), image.height)))
                    tall = tall.resize((64, 256), Image.BILINEAR)
                    tall_t = torch.from_numpy(np.asarray(tall, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                    sp = F.softmax(string_net(tall_t)["string"], dim=1)[0]
                    fp = F.softmax(rec_out["fret"], dim=1)[0]
                    s_pred, s_conf = int(sp.argmax()), float(sp.max())
                    f_pred, f_conf = int(fp.argmax()), float(fp.max())
                    # No pre-gate: per-tau stats decide (post-only selection).
                    if min(s_conf, f_conf) < TAU:
                        stages["abstained"] += 1
                    for tau in TAU_GRID:
                        if min(s_conf, f_conf) < tau:
                            tau_stats[tau]["abstained"] += 1
                            continue
                        tau_stats[tau]["decoded"] += 1
                    link = links.get(g["sid"], {})
                    ev = link.get("event")
                    if ev is None:
                        continue
                    tab = ev.get("tab") or {}
                    s_ok = tab.get("string") == s_pred + 1
                    f_ok = tab.get("fret") == f_pred
                    for tau in TAU_GRID:
                        if min(s_conf, f_conf) < tau:
                            continue
                        if s_ok and f_ok:
                            tau_stats[tau]["bothCorrect"] += 1
                            if (ev.get("pitch") or {}).get("soundingMidi") == TUNING[s_pred] + f_pred:
                                tau_stats[tau]["pitchCorrect"] += 1
                    if not f_ok:
                        stages["fretWrong"] += 1
                    if not s_ok:
                        stages["stringWrong"] += 1
                    if s_ok and f_ok:
                        stages["bothCorrect"] += 1
                        if (ev.get("pitch") or {}).get("soundingMidi") == TUNING[s_pred] + f_pred:
                            stages["pitchCorrect"] += 1
                    # stages.*Wrong/Correct above count ALL matched (ungated);
                    # frozen-TAU=0.6 decoded subset reported via tauGrid["0.6"].
                    t = (ev.get("time") or {})
                    if t.get("durationQuarters") is not None:
                        stages["rhythmKnown"] += 1
                n_pages += 1
    (out_dir / f"attr-{args.tag}.json").write_text(json.dumps(
        {"pages": n_pages, "detector": det_path, "tauGrid": tau_stats, **stages}, indent=1))
    print(json.dumps({"pages": n_pages, **stages}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
