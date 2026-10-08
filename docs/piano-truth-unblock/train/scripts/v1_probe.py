#!/usr/bin/env python3
"""P12 — small comprehensive probe: page-context model over the V1 vocabulary.

Two towers (local crop + system strip + geometry) with 25 heads: 7 categorical
(kind/pitch/duration/dots/staff/accidental/voice) + 18 binary membership heads.
Proves every new head receives valid supervision, common heads learn, context
heads beat the crop-only limitation, rare heads follow support, and pixel
controls still hold.

Modes: normal / blank (zeroed pixels, geometry kept) / shuffled (labels).
Preregistered budget: 12 epochs, batch 256, AdamW lr=3e-4, seed 7, CPU.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import sys
import time
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"

EPOCHS, BATCH, LR, SEED = 12, 256, 3e-4, 7
HEADS_CAT = ["kind", "pitch", "dur", "dots", "staff", "acc", "voice"]
HEADS_BIN = ["grace", "cue", "in_beam", "tie_start", "tie_end", "slur_member",
             "tuplet_member", "has_artic", "has_ornament", "has_fingering",
             "arpeg_member", "gliss_member", "pedal_active", "octave_shifted",
             "hairpin_member", "chord_tone", "dotted", "accidental"]
HEADS = HEADS_CAT + HEADS_BIN


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


@lru_cache(maxsize=8)
def page_png(sid, pg):
    img = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"), cv2.IMREAD_GRAYSCALE)
    return img


def load_items(subset):
    d = np.load(TRAIN / "data" / f"v1_{subset}.npz")
    meta = json.load(open(TRAIN / "manifests" / f"v1_items_{subset}_meta.json"))
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    X = d["X"].astype(np.float32) / 255.0
    Y = {h: d[f"y_{h}"].astype(np.int64) for h in HEADS}
    M = {h: d[f"m_{h}"].astype(np.float32) for h in HEADS}
    G = d["G"].astype(np.float32)
    # NOTE: v1 adapter already stores pitch as midi-21 indices (0-87);
    # do NOT shift again (a double shift corrupted an earlier run).
    S = np.zeros((len(X), 1, 24, 128), np.uint8)
    for j, mi in enumerate(meta):
        img = page_png(mi["sid"], mi["page"])
        y0 = max(0, mi["strip_y0"])
        y1 = min(img.shape[0], mi["strip_y1"])
        band = np.full((max(1, y1 - y0), img.shape[1]), 255, np.uint8)
        band[: max(0, y1 - y0), :] = img[y0:y1, :]
        S[j, 0] = cv2.resize(band, (128, 24), interpolation=cv2.INTER_AREA)
    sizes = {"kind": 2, "pitch": 88, "dur": len(voc["dur"]), "dots": 4,
             "staff": len(voc["staff"]), "acc": len(voc["acc"]), "grace": 2,
             "cue": 2, "voice": len(voc["voice"])}
    for h in HEADS_BIN:
        sizes[h] = 2
    page_png.cache_clear()
    return X, S, G, Y, M, meta, voc, sizes


class LocalModel(nn.Module):
    def __init__(self, sizes):
        super().__init__()

        def blk(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o),
                                 nn.ReLU(), nn.MaxPool2d(2))
        self.trunk = nn.Sequential(blk(1, 32), blk(32, 64), blk(64, 128),
                                   nn.AdaptiveAvgPool2d(1), nn.Flatten())
        self.heads = nn.ModuleDict({h: nn.Linear(128, n) for h, n in sizes.items()})

    def forward(self, x, s, g):
        z = self.trunk(x)
        return {h: l(z) for h, l in self.heads.items()}


class ContextModel(nn.Module):
    def __init__(self, sizes):
        super().__init__()
        self.strip = nn.Sequential(
            nn.Conv2d(1, 16, 5, padding=2), nn.BatchNorm2d(16), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten())
        self.mix = nn.Sequential(nn.Linear(32 + 5, 128), nn.ReLU())
        self.heads = nn.ModuleDict({h: nn.Linear(128, n) for h, n in sizes.items()})

    def forward(self, x, s, g):
        z = torch.cat([self.strip(s), g], dim=1)
        z = self.mix(z)
        return {h: l(z) for h, l in self.heads.items()}


class Model(nn.Module):
    def __init__(self, sizes):
        super().__init__()
        def blk(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o),
                                 nn.ReLU(), nn.MaxPool2d(2))
        self.local = nn.Sequential(blk(1, 32), blk(32, 64), blk(64, 128),
                                   nn.AdaptiveAvgPool2d(1), nn.Flatten())
        self.strip = nn.Sequential(
            nn.Conv2d(1, 16, 5, padding=2), nn.BatchNorm2d(16), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten())
        self.mix = nn.Sequential(nn.Linear(128 + 32 + 5, 256), nn.ReLU())
        self.heads = nn.ModuleDict({h: nn.Linear(256, n) for h, n in sizes.items()})

    def forward(self, x, s, g):
        z = torch.cat([self.local(x), self.strip(s), g], dim=1)
        z = self.mix(z)
        return {h: l(z) for h, l in self.heads.items()}


def masked_acc(logits, y, m):
    with torch.no_grad():
        idx = (m > 0.5)
        if idx.sum() == 0:
            return float("nan"), 0
        return float((logits.argmax(-1)[idx] == y[idx]).float().mean()), int(idx.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="normal", choices=["normal", "blank", "shuffled"])
    ap.add_argument("--probe", default="common",
                    choices=["common", "membership", "context"],
                    help="common: crop trunk + 9 original heads (validated recipe); "
                         "membership: crop trunk + 16 binary membership heads; "
                         "context: strip+geometry + staff/voice (+kind/pitch/dur reference)")
    args = ap.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(4)
    t_start = time.time()
    PROBE_HEADS = {"common": ["kind", "pitch", "dur", "dots", "staff", "acc", "grace", "cue", "voice"],
                   "membership": HEADS_BIN,
                   "context": ["staff", "voice", "kind", "pitch", "dur"]}[args.probe]

    Xt, St, Gt, Yt, Mt, metat, voc, sizes = load_items("train100")
    # targeted rare supplementation (TRAIN only)
    Xr, Sr, Gr, Yr, Mr, metar, _, _ = load_items("trainRare")
    Xt = np.concatenate([Xt, Xr])
    St = np.concatenate([St, Sr])
    Gt = np.concatenate([Gt, Gr])
    Yt = {h: np.concatenate([Yt[h], Yr[h]]) for h in HEADS}
    Mt = {h: np.concatenate([Mt[h], Mr[h]]) for h in HEADS}
    metat = metat + metar
    Xd, Sd, Gd, Yd, Md, metad, _, _ = load_items("dev20")

    if args.mode == "blank":
        Xt = np.zeros_like(Xt)
        St = np.zeros_like(St)
        Xd = np.zeros_like(Xd)
        Sd = np.zeros_like(Sd)
    if args.mode == "shuffled":
        perm = np.random.RandomState(SEED).permutation(len(Xt))
        Yt = {h: v[perm] for h, v in Yt.items()}
        Mt = {h: v[perm] for h, v in Mt.items()}

    # fixed loss weights from train items only (sqrt inverse frequency)
    weights = {}
    for h in HEADS_BIN + ["kind"]:
        v = Yt[h][Mt[h] > 0.5]
        p = float((v == 1).mean()) if len(v) else 0.5
        weights[h] = min(5.0, float((1 - p) ** 0.5 / max(p, 1e-6) ** 0.5))
    cat_w = {}
    for h in ["pitch", "dur", "dots", "staff", "acc", "voice"]:
        v = Yt[h][Mt[h] > 0.5]
        vals, counts = np.unique(v[v >= 0], return_counts=True)
        w = {int(k): min(5.0, float((len(v) / max(c, 1)) ** 0.5)) for k, c in zip(vals, counts)}
        cat_w[h] = w

    majority = {}
    for h in PROBE_HEADS:
        vals, counts = np.unique(Yt[h][Mt[h] > 0.5], return_counts=True)
        majority[h] = {"label": int(vals[counts.argmax()]), "train_acc": float(counts.max() / counts.sum())}

    Xd_t = torch.from_numpy(Xd[:, None]).float()  # already [0,1] from load_items
    Sd_t = torch.from_numpy(Sd).float() / 255
    Gd_t = torch.from_numpy(Gd)
    Yd_t = {h: torch.from_numpy(Yd[h]) for h in HEADS}
    Md_t = {h: torch.from_numpy(Md[h]) for h in HEADS}

    ph_sizes = {h: sizes[h] for h in PROBE_HEADS}
    model = {"common": LocalModel, "membership": LocalModel, "context": ContextModel}[args.probe](ph_sizes)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    ce = nn.CrossEntropyLoss(reduction="none")

    def run_eval():
        model.eval()
        out = {}
        with torch.no_grad():
            logits = model(Xd_t, Sd_t, Gd_t)
            for h in PROBE_HEADS:
                l = ce(logits[h], Yd_t[h].clamp(min=0))
                l = (l * Md_t[h]).sum() / Md_t[h].sum().clamp(min=1)
                acc, n = masked_acc(logits[h], Yd_t[h], Md_t[h])
                out[h] = {"loss": float(l), "acc": acc, "n": n}
        return out

    lut = {}
    for h in HEADS_BIN + ["kind"]:
        lut[h] = weights[h]
    for h in ["pitch", "dur", "dots", "staff", "acc", "voice"]:
        t = torch.ones(sizes[h])
        for k, v in cat_w[h].items():
            t[k] = v
        lut[h] = t

    # UNIFORM loss: sqrt inverse-frequency weighting was evaluated and
    # REJECTED — it collapses the shared trunk to constant rare-class
    # predictions (dev pitch -> 0.00). Rare support comes from targeted
    # trainRare data, not weights. See COMPREHENSIVE_PROBE.md.
    def head_loss(logits, y, m, h):
        l = ce(logits, y.clamp(min=0))
        return (l * m).sum() / m.sum().clamp(min=1)

    curve = []
    order = np.arange(len(Xt))
    for ep in range(EPOCHS):
        np.random.RandomState(SEED + ep).shuffle(order)
        model.train()
        tot, nstep = 0.0, 0
        for start in range(0, len(Xt), BATCH):
            sl = order[start:start + BATCH]
            xb = torch.from_numpy(Xt[sl][:, None]).float()  # already [0,1]
            sb = torch.from_numpy(St[sl]).float() / 255
            gb = torch.from_numpy(Gt[sl])
            yb = {h: torch.from_numpy(Yt[h][sl]) for h in HEADS}
            mb = {h: torch.from_numpy(Mt[h][sl]) for h in HEADS}
            opt.zero_grad()
            logits = model(xb, sb, gb)
            loss = sum(head_loss(logits[h], yb[h], mb[h], h) for h in PROBE_HEADS) / len(PROBE_HEADS)
            loss.backward()
            opt.step()
            tot += float(loss.detach())
            nstep += 1
        dev = run_eval()
        curve.append({"epoch": ep + 1, "train_loss": tot / nstep,
                      "dev": {h: dev[h]["acc"] for h in PROBE_HEADS}})
        show = " ".join(f"dev_{h}={dev[h]['acc']:.3f}" for h in PROBE_HEADS[:3])
        print(f"[{args.probe}/{args.mode}] epoch {ep+1}/{EPOCHS} train_loss={tot/nstep:.4f} {show}", flush=True)

    # final train eval on a sample (full train is large; use all — still cheap)
    model.eval()
    train_acc = {}
    with torch.no_grad():
        for start in range(0, len(Xt), 2048):
            sl = slice(start, start + 2048)
            logits = model(torch.from_numpy(Xt[sl][:, None]).float(),
                           torch.from_numpy(St[sl]).float() / 255,
                           torch.from_numpy(Gt[sl]))
            for h in PROBE_HEADS:
                a, n = masked_acc(logits[h], torch.from_numpy(Yt[h][sl]),
                                  torch.from_numpy(Mt[h][sl]))
                train_acc.setdefault(h, []).append((a, n))
    train_ev = {h: sum(a * n for a, n in v) / max(1, sum(n for _, n in v)) for h, v in train_acc.items()}
    dev_ev = run_eval()
    (TRAIN / "models").mkdir(exist_ok=True)
    mp = TRAIN / "models" / f"v1_probe_{args.probe}_{args.mode}.pt"
    torch.save({"state": model.state_dict(), "sizes": sizes, "mode": args.mode,
                "epochs": EPOCHS, "seed": SEED}, str(mp))
    res = {"schema": "piano-v1-fit/1", "mode": args.mode, "probe": args.probe,
           "budget": {"epochs": EPOCHS, "batch": BATCH, "lr": LR, "seed": SEED, "device": "cpu"},
           "runtime_s": round(time.time() - t_start, 1),
           "model": str(mp.name), "model_sha256": hashlib.sha256(mp.read_bytes()).hexdigest(),
           "majority": majority,
           "loss": "uniform (sqrt weights evaluated on train100 and rejected: shared-trunk collapse)",
           "loss_weights_rejected": weights,
           "train": {h: {"acc": train_ev[h]} for h in PROBE_HEADS},
           "dev": dev_ev, "curve": curve,
           "n_train": len(Xt), "n_dev": len(Xd)}
    (TRAIN / "manifests" / f"v1_fit_{args.probe}_{args.mode}.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({h: {"train": round(train_ev[h], 3), "dev": round(dev_ev[h]["acc"], 3)}
                      for h in PROBE_HEADS}, indent=1))


if __name__ == "__main__":
    main()
