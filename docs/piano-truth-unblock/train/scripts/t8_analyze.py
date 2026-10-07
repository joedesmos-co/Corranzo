#!/usr/bin/env python3
"""T8 — notation-family and rare-class metrics from a saved probe.

Loads models/probe_<mode>.pt, evaluates on dev20 (+train100 reference), and
reports per-head accuracy, per-duration-class accuracy, and rare subsets
(grace, cue, octave-shifted notes, minority durations). DEV only; TEST sealed.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OBJECTS = PILOT / "data" / "objects"
sys.path.insert(0, str(HERE))
from t5_fit import Probe, HEADS  # noqa: E402


def load(subset):
    d = np.load(TRAIN / "data" / f"crops_{subset}.npz")
    meta = json.load(open(TRAIN / "manifests" / f"items_{subset}_meta.json"))
    X = torch.from_numpy(d["X"][:, None].astype(np.float32) / 255.0)
    Y = {h: torch.from_numpy(d[f"y_{h}"]) for h in HEADS}
    Y["pitch"] = torch.clamp(Y["pitch"], min=-1)
    Y["pitch"][Y["pitch"] >= 0] -= 21  # same midi->index mapping as training
    M = {h: torch.from_numpy(d[f"m_{h}"]).float() for h in HEADS}
    return X, Y, M, meta


def flags(meta):
    """rare-subset flags per item from truth objects."""
    cache = {}
    out = []
    for mi in meta:
        sid = mi["sid"]
        if sid not in cache:
            cache[sid] = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
        o = cache[sid][mi["obj_index"]]
        out.append({"grace": bool(o.get("grace")), "cue": bool(o.get("cue")),
                    "oct_shift": bool(o.get("oct_ges")),
                    "pname": o.get("pname"), "dur": o.get("dur"),
                    "dots": int(o.get("dots") or 0)})
    return out


def evaluate(mode):
    ckpt = torch.load(TRAIN / "models" / f"probe_{mode}.pt", map_location="cpu")
    model = Probe(ckpt["sizes"])
    model.load_state_dict(ckpt["state"])
    model.eval()
    voc = json.loads((TRAIN / "manifests" / "items.json").read_text())["vocab"]
    res = {}
    for subset in ("train100", "dev20"):
        X, Y, M, meta = load(subset)
        fl = flags(meta)
        with torch.no_grad():
            logits = model(X)
            pred = {h: logits[h].argmax(-1).numpy() for h in HEADS}
        r = {"heads": {}, "dur_per_class": {}, "rare": {}}
        for h in HEADS:
            m = M[h].numpy() > 0.5
            r["heads"][h] = float((pred[h][m] == Y[h].numpy()[m]).mean()) if m.sum() else float("nan")
        yp = Y["pitch"].numpy()
        mp = M["pitch"].numpy() > 0.5
        for di, dsym in enumerate(voc["dur"]):
            m = (Y["dur"].numpy() == di) & (M["dur"].numpy() > 0.5)
            if m.sum():
                r["dur_per_class"][dsym] = {"acc": float((pred["dur"][m] == di).mean()), "n": int(m.sum())}
        fla = np.array([(f["grace"], f["cue"], f["oct_shift"]) for f in fl])
        for name, col in (("grace", 0), ("cue", 1), ("oct_shifted", 2)):
            m = (fla[:, col]) & mp
            if m.sum():
                r["rare"][name] = {"pitch_acc": float((pred["pitch"][m] == yp[m]).mean()), "n": int(m.sum())}
        r["n"] = len(X)
        res[subset] = r
    (TRAIN / "manifests" / f"analyze_{mode}.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({s: {"heads": res[s]["heads"], "rare": res[s]["rare"]} for s in res}, indent=1))


if __name__ == "__main__":
    evaluate(sys.argv[1] if len(sys.argv) > 1 else "normal")
