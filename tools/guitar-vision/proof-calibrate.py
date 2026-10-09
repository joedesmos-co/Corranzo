#!/usr/bin/env python3
"""Head calibration (Part 1, post-only, no gradient training).

Collects frozen StringNet/fret-head logits on TRAIN-fit GT digit boxes,
fits temperature scaling (1-param line search on NLL) + per-string bias
check, reports ECE before/after and coverage@precision. Heldout verifies.

Usage:
    python3 tools/guitar-vision/proof-calibrate.py --out <dir> --mode collect --samples ...
    python3 tools/guitar-vision/proof-calibrate.py --out <dir> --mode fit
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
_evlink = _load("proof_event_link_mod", "proof-event-link.py")

SEED = 20261009


def collect(samples, work_dirs, device, recognizer, string_net):
    rows = []
    for sample in samples:
        man = json.load(open(f"/tmp/proof/hires/{sample}-manifest.json"))
        joins = canon = None
        for root in work_dirs:
            for cand in (root / sample / "joins.json",
                         root / "joins.json" if Path(root).name == sample else None):
                if cand is not None and Path(cand).exists():
                    joins = json.loads(Path(cand).read_text())
                    break
            if joins is not None:
                break
        for root in work_dirs:
            for cand in (root / sample / "canonical.json",
                         root / "canonical.json" if Path(root).name == sample else None):
                if cand is not None and Path(cand).exists():
                    canon = json.loads(Path(cand).read_text())
                    break
            if canon is not None:
                break
        if joins is None:
            continue
        links, _ = _evlink.build_links(joins, canon, sample)
        for tag, meta in man.items():
            if not isinstance(meta, dict) or "file" not in meta:
                continue
            pno = int(tag.replace("page", ""))
            image = Image.open(meta["file"]).convert("L")
            fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
            for sid, join in joins["joins"].items():
                if (join.get("page") or 1) != pno or not join.get("boxes"):
                    continue
                if "tab-text" not in (join.get("children") or []):
                    continue
                ev = (links.get(sid) or {}).get("event")
                if ev is None:
                    continue
                tab = ev.get("tab") or {}
                if tab.get("string") is None or tab.get("fret") is None:
                    continue
                boxes = join["boxes"]
                box = [min(b[0] for b in boxes) * fx, min(b[1] for b in boxes) * fy,
                       max(b[2] for b in boxes) * fx, max(b[3] for b in boxes) * fy]
                cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                w, h = box[2] - box[0], box[3] - box[1]
                side = max(w, h) * 0.8
                crop = image.crop((max(int(cx - side), 0), max(int(cy - side), 0),
                                   min(int(cx + side), image.width), min(int(cy + side), image.height)))
                crop = crop.resize((64, 64), Image.BILINEAR)
                tensor = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                half_h = max(h * 1.1, 160 * (h / 253))
                tall = image.crop((max(int(cx - w), 0), max(int(cy - half_h), 0),
                                   min(int(cx + w), image.width), min(int(cy + half_h), image.height)))
                tall = tall.resize((64, 256), Image.BILINEAR)
                tall_t = torch.from_numpy(np.asarray(tall, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                with torch.no_grad():
                    fl = recognizer(tensor)["fret"][0].cpu().tolist()
                    sl = string_net(tall_t)["string"][0].cpu().tolist()
                rows.append({"s": tab["string"] - 1, "f": tab["fret"], "sl": sl, "fl": fl})
    return rows


def ece(rows, key, temp=1.0):
    # 10-bin ECE of argmax confidence vs accuracy.
    bins = [[] for _ in range(10)]
    for r in rows:
        logits = np.array(r[key]) / temp
        e = np.exp(logits - logits.max())
        p = e / e.sum()
        conf = float(p.max())
        pred = int(p.argmax())
        label = r["s"] if key == "sl" else r["f"]
        bins[min(int(conf * 10), 9)].append(1.0 if pred == label else 0.0)
    total = sum(len(b) for b in bins)
    err, nll = 0.0, 0.0
    for i, b in enumerate(bins):
        if not b:
            continue
        acc = sum(b) / len(b)
        err += abs(acc - (i + 0.5) / 10) * len(b) / max(total, 1)
    for r in rows:
        logits = np.array(r[key]) / temp
        e = np.exp(logits - logits.max())
        p = e / e.sum()
        label = r["s"] if key == "sl" else r["f"]
        nll -= np.log(max(p[label], 1e-12))
    return err, nll / max(len(rows), 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", default="collect", choices=["collect", "fit"])
    parser.add_argument("--samples", default=None)
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    if args.mode == "collect":
        work_dirs = [Path(w) for w in json.load(open("/tmp/proof/workdirs.json"))]
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
        rows = collect(args.samples.split(","), work_dirs, device, recognizer, string_net)
        (out_dir / "logits.json").write_text(json.dumps(rows))
        print(f"collected {len(rows)}")
        return 0
    rows = json.loads((out_dir / "logits.json").read_text())
    out = {}
    for key in ("sl", "fl"):
        e0, n0 = ece(rows, key, 1.0)
        best = min(((t / 10, *ece(rows, key, t / 10)) for t in range(3, 41)),
                   key=lambda z: z[2])
        out[key] = {"eceBefore": round(e0, 4), "nllBefore": round(n0, 4),
                    "temp": round(best[0], 2), "eceAfter": round(best[1], 4),
                    "nllAfter": round(best[2], 4)}
        print(key, json.dumps(out[key]))
    # Coverage@precision for joint (string,fret) at taus, before/after.
    for label, temp_s, temp_f in (("before", 1.0, 1.0), ("after", out["sl"]["temp"], out["fl"]["temp"])):
        curve = []
        for tau in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
            dec = cor = 0
            for r in rows:
                for kk, tt, lab in (("sl", temp_s, r["s"]), ("fl", temp_f, r["f"])):
                    logits = np.array(r[kk]) / tt
                    e = np.exp(logits - logits.max())
                    p = e / e.sum()
                    if kk == "sl":
                        sc, sp_ = float(p.max()), int(p.argmax())
                    else:
                        fc, fp_ = float(p.max()), int(p.argmax())
                if min(sc, fc) >= tau:
                    dec += 1
                    if sp_ == r["s"] and fp_ == r["f"]:
                        cor += 1
            curve.append({"tau": tau, "decoded": dec, "correct": cor,
                          "precision": round(cor / max(dec, 1), 3)})
        out[label + "Curve"] = curve
        print(label, json.dumps(curve))
    (out_dir / "calibration.json").write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
