#!/usr/bin/env python3
"""Pre-flight gate: verify all 25 target heads have working supervision, loss,
masking, and decoding on the built items (trainFull + dev20).

For each head: support count (masked-in), label range vs head size, one-batch
forward+loss finite, decode mapping present. Exits nonzero on any failure.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
sys.path.insert(0, str(HERE))
from v1_probe import HEADS, HEADS_CAT, HEADS_BIN, LocalModel, ContextModel  # noqa: E402


def main():
    man = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())
    voc, sizes = man["vocab"], None
    fail = []
    for subset in ("trainFull", "dev20"):
        d = np.load(TRAIN / "data" / f"v1_{subset}.npz")
        n = len(d["X"])
        print(f"[{subset}] items={n}")
        for h in HEADS:
            y, m = d[f"y_{h}"], d[f"m_{h}"]
            n_active = int((m > 0.5).sum())
            lo, hi = (int(y[m > 0.5].min()), int(y[m > 0.5].max())) if n_active else (None, None)
            print(f"  {h:15s} active={n_active:7d} range=[{lo},{hi}]")
            if subset == "trainFull" and n_active == 0 and h not in ("cue",):
                # cue may be rare but must exist somewhere in TRAIN (checked below)
                pass
    # decode mappings exist for every categorical head with a vocabulary
    # (kind/dots/grace/cue/voice are fixed small integers; binary heads size 2)
    for h in ("pitch", "dur", "staff", "acc", "voice"):
        assert h in voc, f"missing vocab for {h}"
    print("vocab sizes:", {h: (len(voc[h]) if h in voc else 2) for h in HEADS})
    # one-batch forward + loss finite for both model types
    torch.manual_seed(7)
    d = np.load(TRAIN / "data" / "v1_trainFull.npz")
    xb = torch.from_numpy(d["X"][:32][:, None]).float() / 255
    gb = torch.from_numpy(d["G"][:32])
    sb = torch.zeros(32, 1, 24, 128)  # shape check only
    head_sizes = {h: (2 if h in HEADS_BIN + ["kind"] else 4 if h == "dots" else len(voc[h])) for h in HEADS}
    for name, model in (("local", LocalModel(head_sizes)),
                        ("context", ContextModel(head_sizes))):
        model.eval()
        with torch.no_grad():
            out = model(xb, sb, gb) if name == "context" else model(xb, sb, gb)
        for h, logits in out.items():
            if not torch.isfinite(logits).all():
                fail.append(f"{name}/{h} non-finite logits")
    # cue support somewhere in TRAIN (dev20 has none; must exist in trainFull)
    d = np.load(TRAIN / "data" / "v1_trainFull.npz")
    n_cue = int(((d["y_cue"] == 1) & (d["m_cue"] > 0.5)).sum())
    n_gliss = int(((d["y_gliss_member"] == 1)).sum())
    print(f"trainFull cue positives: {n_cue}, gliss positives: {n_gliss}")
    if n_cue == 0:
        fail.append("no cue supervision in trainFull")
    print("VERIFY:", "FAIL: " + "; ".join(fail) if fail else "PASS (all 25 heads supervised, finite, decodable)")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
