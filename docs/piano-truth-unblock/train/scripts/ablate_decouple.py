#!/usr/bin/env python3
"""P3 decoupling ablation (diagnostic, no artifact, no production change).

T1 multitask (dur/beams/start/end/tuplet on one small trunk) oscillated
dur 0.71-0.80; single-task A1 (dur only) reached 0.858. Question: on the
SAME features, does dur-only training recover A1-level dur (evidence that
interference, not representation, hurt T1's dur)?

Runs on the cached striphead arrays (/tmp/striphead_arrays.npz: 773-d
features). Dur-only linear head, warm-started from A1's neighbor block,
same optimizer/seed/epochs as T1. Reports dev dur only. No gates (this is
a diagnostic; the preregistered P3 experiment stays the R1 rest head).
"""
from __future__ import annotations
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"

SEED, EPOCHS, LR, BATCH = 0, 10, 3e-4, 256


def main():
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    z = np.load("/tmp/striphead_arrays.npz")
    Xtr, Yd = z["Xtr"], z["Yd_tr"]
    Xdv, Dd = z["Xdv"], z["Yd_dv"]
    n_dur = 16
    a1 = torch.load(TRAIN / "models" / "ctx_dur_head.pt", map_location="cpu")
    head = torch.nn.Linear(Xtr.shape[1], n_dur)
    with torch.no_grad():
        head.weight[:, :384] = a1["state"]["weight"]
        head.bias[:] = a1["state"]["bias"]
    opt = torch.optim.AdamW(head.parameters(), lr=LR)
    Xt = torch.from_numpy(Xtr)
    Yt = torch.from_numpy(Yd).long()
    Xd = torch.from_numpy(Xdv)
    t0 = time.time()
    for ep in range(EPOCHS):
        perm = torch.randperm(len(Xt), generator=torch.Generator().manual_seed(SEED + ep))
        for s in range(0, len(Xt), BATCH):
            idx = perm[s:s + BATCH]
            opt.zero_grad()
            F.cross_entropy(head(Xt[idx]), Yt[idx]).backward()
            opt.step()
        with torch.no_grad():
            acc = float((head(Xd).argmax(-1).numpy() == Dd).mean())
        print(f"[ablate] epoch {ep+1}/{EPOCHS} dur_only_dev={acc:.4f} "
              f"t={time.time()-t0:.0f}s", flush=True)
    print(f"[ablate] T1 multitask best was 0.804; A1 (crop-features) 0.858")


if __name__ == "__main__":
    main()
