#!/usr/bin/env python3
"""M2 T2 clef-accidental classifier (ONE bounded experiment, preregistered).

Task: classify a staff-relative crop centred on a candidate key-signature
position as {sharp, flat, background}. 

Training data (symbol-level, renders): 1,429 keyAccid glyph boxes
(SMuFL E262/E260 labels) + 3,100 background crops at table positions
where the key signature has no accidental. Score-disjoint split: train on
190 scores, hold out 48 render scores for the first gate.

Architecture: TallCNN family (proven vertical-preserving), 32x64 input:
  C3(1,8)/BN/R -> C3(8,16)/BN/R -> MaxPool((1,2)) [width only]
  -> C3(16,32)/BN/R -> C3(32,32)/BN/R -> MaxPool((1,2)) [width only]
  -> C3(32,32)/BN/R [32x64x12, full height] -> AdaptiveAvgPool((24,1))
  -> FC(256) -> FC(3). ~0.3M params. No vertical pooling anywhere.

Validation (weak score-level labels, scans):
  TRAIN-side OLiMPiC samples (151, disjoint from the 10 verification
  samples): per-sample key assembly from the classifier's detections
  (column = x-column with >=1 non-background detection; key = majority
  sign + column count; abstain when the margin is thin).
  The 10 verification samples are used exactly once, at the end.

Preregistered gates (a two-stage gate; both must pass):
  (1) render held-out symbol accuracy >= 0.90
  (2) TRAIN-side scan key-sign accuracy >= 0.75 with abstention <= 0.40
On pass: save models/clefsym_head.pt and report the verification numbers
(integration still decided separately under M5). On fail: no artifact.

No known keys, score identities, or reference geometry at inference:
the scores are derived per-crop from pixels + the aligned table
(staff-relative positions only). TEST untouched. CPU only.
"""
from __future__ import annotations
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
sys.path.insert(0, str(HERE))

SEED = 0
EPOCHS, LR, BATCH = 10, 3e-4, 256
ARTIFACT = TRAIN / "models" / "clefsym_head.pt"


class TallCNN(nn.Module):
    def __init__(self, n_out=3):
        super().__init__()

        def C(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1),
                                 nn.BatchNorm2d(o), nn.ReLU())
        self.feat = nn.Sequential(
            C(1, 8), C(8, 16), nn.MaxPool2d((1, 2)),
            C(16, 32), C(32, 32), nn.MaxPool2d((1, 2)),
            C(32, 32), nn.AdaptiveAvgPool2d((24, 1)), nn.Flatten())
        self.mix = nn.Sequential(nn.Linear(32 * 24, 256), nn.ReLU())
        self.head = nn.Linear(256, n_out)

    def forward(self, t):
        return self.head(self.mix(self.feat(t)))


def build_xy(z, which):
    X = np.concatenate([z["Xp"], z["Xn"]]) if which == "render" else z["Xs"]
    y = (np.concatenate([z["yp"], np.full(len(z["Xn"]), 2)])
         if which == "render" else z["ys"])
    sid = (np.concatenate([z["sp"], z["sn"]]) if which == "render"
           else z["ks"])
    return X, y, sid


def main():
    t0 = time.time()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    z = np.load("/tmp/clefsym_data_lm4.npz", allow_pickle=True)
    Xr, yr, sr = build_xy(z, "render")
    # score-disjoint split on render scores
    scores = sorted(set(sr))
    rng = np.random.default_rng(SEED)
    hold = set(rng.choice(scores, size=min(48, len(scores) // 5),
                          replace=False).tolist())
    tr = np.array([s not in hold for s in sr])
    print(f"[T2] render train {tr.sum()} / held-out {(~tr).sum()}",
          flush=True)
    net = TallCNN(3)
    print(f"[T2] params {sum(p.numel() for p in net.parameters())}", flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=LR)
    Xt = torch.from_numpy(Xr[tr][:, None]).float() / 255
    Yt = torch.from_numpy(yr[tr]).long()
    Xh = torch.from_numpy(Xr[~tr][:, None]).float() / 255
    Yh = torch.from_numpy(yr[~tr]).long()
    n = len(Xt)
    for ep in range(EPOCHS):
        net.train()
        perm = torch.randperm(n, generator=torch.Generator().manual_seed(SEED + ep))
        tot, nb = 0.0, 0
        for s in range(0, n, BATCH):
            idx = perm[s:s + BATCH]
            opt.zero_grad()
            F.cross_entropy(net(Xt[idx]), Yt[idx]).backward()
            opt.step()
            tot += float(net(Xt[idx]).shape[0]) * 0
            nb += len(idx)
        net.eval()
        with torch.no_grad():
            acc = float((net(Xh).argmax(-1) == Yh).float().mean())
        print(f"[T2] epoch {ep+1} render_heldout_acc={acc:.4f} "
              f"t={time.time()-t0:.0f}s", flush=True)
    net.eval()
    with torch.no_grad():
        acc = float((net(Xh).argmax(-1) == Yh).float().mean())
    print(f"[T2] FINAL render held-out acc={acc:.4f}", flush=True)
    if acc < 0.90:
        print("[T2] GATE (1) FAIL: no artifact", flush=True)
        return
    # ---- scan assembly (TRAIN-side, weak sign labels)
    Xs, ys, ks = build_xy(z, "scan")
    with torch.no_grad():
        Ps = []
        for b in range(0, len(Xs), 1024):
            Ps.append(F.softmax(net(torch.from_numpy(
                Xs[b:b + 1024][:, None]).float() / 255), dim=-1).numpy())
    Ps = np.concatenate(Ps)
    per = defaultdict(list)
    for i, k in enumerate(ks):
        if ys[i] is None:
            continue
        per[k].append(i)
    ok = abst = wrong = 0
    detail = []
    for k, idxs in per.items():
        votes = []
        for i in idxs:
            p = Ps[i]
            fg = max(p[0], p[1])
            if fg > 0.6 and fg - p[2] > 0.25:
                votes.append(0 if p[0] > p[1] else 1)
        if not votes:
            abst += 1
            detail.append([k, None, "no_detection"])
            continue
        c = Counter(votes)
        top, n2 = c.most_common(1)[0]
        if n2 < 2 * (len(votes) - n2):
            abst += 1
            detail.append([k, None, "no_margin"])
            continue
        sign = int(top)
        truth = int(ys[idxs[0]])
        if sign == truth:
            ok += 1
        else:
            wrong += 1
            detail.append([k, sign, f"truth={truth}"])
    ntot = ok + wrong + abst
    print(f"[T2] TRAIN-side scan: ok {ok} wrong {wrong} abstain {abst} "
          f"(acc {ok/max(1,ok+wrong):.3f}, coverage {(ok+wrong)/max(1,ntot):.3f})",
          flush=True)
    if ok / max(1, ok + wrong) < 0.75 or abst / max(1, ntot) > 0.40:
        print("[T2] GATE (2) FAIL: no artifact", flush=True)
        return
    torch.save({"state": net.state_dict(), "seed": SEED, "epochs": EPOCHS},
               ARTIFACT)
    print("[T2] GATES PASS: saved models/clefsym_head.pt", flush=True)
    # ---- verification samples (used once)
    Xv, yv, kv = build_xy(z, "verify")
    with torch.no_grad():
        Pv = []
        for b in range(0, len(Xv), 1024):
            Pv.append(F.softmax(net(torch.from_numpy(
                Xv[b:b + 1024][:, None]).float() / 255), dim=-1).numpy())
    Pv = np.concatenate(Pv)
    per = defaultdict(list)
    for i, k in enumerate(kv):
        per[k].append(i)
    v_ok = v_wrong = v_abst = 0
    for k, idxs in per.items():
        votes = []
        for i in idxs:
            p = Pv[i]
            fg = max(p[0], p[1])
            if fg > 0.6 and fg - p[2] > 0.25:
                votes.append(0 if p[0] > p[1] else 1)
        if not votes:
            v_abst += 1
            continue
        c = Counter(votes)
        top, n2 = c.most_common(1)[0]
        if n2 < 2 * (len(votes) - n2):
            v_abst += 1
            continue
        truth = int(yv[idxs[0]])
        if int(top) == truth:
            v_ok += 1
        else:
            v_wrong += 1
    print(f"[T2] VERIFY: ok {v_ok} wrong {v_wrong} abstain {v_abst}", flush=True)


def build_xy(z, which):
    if which == "render":
        X = np.concatenate([z["Xp"], z["Xn"]])
        y = np.concatenate([z["yp"], np.full(len(z["Xn"]), 2)])
        sid = np.concatenate([z["sp"], z["sn"]])
        return X, y, sid
    if which == "scan":
        return z["Xs"], z["ys"], z["ks"]
    return z["Xv"], z["yv"], z["kv"]


if __name__ == "__main__":
    main()
