#!/usr/bin/env python3
"""T5/T8/T9 — small supervised fit proof with shortcut controls.

One minimal multi-head CNN probe (NOT an architecture proposal): given a
notehead/rest crop, predict kind/pitch/duration/dots/staff/accidental/grace/
cue/voice. Proves the stack can fit verified TRAIN truth, improve DEV over
initialization, and depend on notation pixels.

Modes:
  normal    centered crops
  blank     zeroed inputs (content-removed control)
  shuffled  train labels permuted (wrong-association control)
  geometry  MLP on bbox geometry only, no pixels (shortcut-ceiling control)

Preregistered budget: 12 epochs, batch 256, AdamW lr=3e-4, seed 7, CPU.
No extension, no tuning on DEV.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"

EPOCHS, BATCH, LR, SEED = 12, 256, 3e-4, 7
HEADS = ["kind", "pitch", "dur", "dots", "staff", "acc", "grace", "cue", "voice"]


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


class Trunk(nn.Module):
    def __init__(self):
        super().__init__()
        def blk(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o),
                                 nn.ReLU(), nn.MaxPool2d(2))
        self.f = nn.Sequential(blk(1, 32), blk(32, 64), blk(64, 128),
                               nn.AdaptiveAvgPool2d(1), nn.Flatten())

    def forward(self, x):
        return self.f(x)


class Probe(nn.Module):
    def __init__(self, sizes):
        super().__init__()
        self.trunk = Trunk()
        self.heads = nn.ModuleDict({h: nn.Linear(128, n) for h, n in sizes.items()})

    def forward(self, x):
        z = self.trunk(x)
        return {h: l(z) for h, l in self.heads.items()}


class GeoMLP(nn.Module):
    def __init__(self, sizes):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(4, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU())
        self.heads = nn.ModuleDict({h: nn.Linear(64, n) for h, n in sizes.items()})

    def forward(self, x):
        z = self.net(x)
        return {h: l(z) for h, l in self.heads.items()}


def load_items(subset):
    d = np.load(TRAIN / "data" / f"crops_{subset}.npz")
    meta = json.load(open(TRAIN / "manifests" / f"items_{subset}_meta.json"))
    voc = json.loads((TRAIN / "manifests" / "items.json").read_text())["vocab"]
    X = d["X"].astype(np.float32) / 255.0
    Y = {h: d[f"y_{h}"].astype(np.int64) for h in HEADS}
    M = {h: d[f"m_{h}"].astype(np.float32) for h in HEADS}
    Y["pitch"] = np.clip(Y["pitch"], -1, 200)
    Yp = Y["pitch"].copy()
    Yp[Yp >= 0] -= 21
    Y["pitch"] = Yp
    sizes = {"kind": 2, "pitch": 88, "dur": len(voc["dur"]), "dots": 4,
             "staff": len(voc["staff"]), "acc": len(voc["acc"]), "grace": 2,
             "cue": 2, "voice": len(voc["voice"])}
    return X, Y, M, meta, voc, sizes


def geometry_features(meta):
    """Normalized [cx, cy, w, h] of each item's bbox in page space."""
    cache = {}
    G = []
    for mi in meta:
        sid = mi["sid"]
        if sid not in cache:
            m = json.loads((RENDER / sid / "meta.json").read_text())
            cache[sid] = {p["page"]: (p["width"], p["height"]) for p in m["page_geometry"]}
            cache[sid + ":obj"] = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
        W, H = cache[sid][mi["page"]]
        o = cache[sid + ":obj"][mi["obj_index"]]
        b = o["bbox"]
        G.append([(b["x"] + b["w"] / 2) / 10 / W, (b["y"] + b["h"] / 2) / 10 / H,
                  (b["w"] / 10) / W, (b["h"] / 10) / H])
    return np.array(G, np.float32)


def masked_acc(logits, y, m):
    with torch.no_grad():
        idx = (m > 0.5)
        if idx.sum() == 0:
            return float("nan"), 0
        return float((logits.argmax(-1)[idx] == y[idx]).float().mean()), int(idx.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="normal", choices=["normal", "blank", "shuffled", "geometry"])
    args = ap.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(4)
    t_start = time.time()

    Xt, Yt, Mt, metat, voc, sizes = load_items("train100")
    Xd, Yd, Md, metad, _, _ = load_items("dev20")
    if args.mode == "blank":
        Xt = np.zeros_like(Xt)
        Xd = np.zeros_like(Xd)
    if args.mode == "shuffled":
        perm = np.random.RandomState(SEED).permutation(len(Xt))
        Yt = {h: v[perm] for h, v in Yt.items()}
        Mt = {h: v[perm] for h, v in Mt.items()}

    # majority-class baselines from TRAIN (for chance comparison)
    majority = {}
    for h in HEADS:
        vals, counts = np.unique(Yt[h][Mt[h] > 0.5], return_counts=True)
        majority[h] = {"label": int(vals[counts.argmax()]), "train_acc": float(counts.max() / counts.sum())}

    train_ds = torch.utils.data.TensorDataset(torch.from_numpy(Xt[:, None]),
                                              *[torch.from_numpy(Yt[h]) for h in HEADS],
                                              *[torch.from_numpy(Mt[h]) for h in HEADS])
    loader = torch.utils.data.DataLoader(train_ds, batch_size=BATCH, shuffle=True,
                                         generator=torch.Generator().manual_seed(SEED))
    Xd_t = torch.from_numpy(Xd[:, None])
    Yd_t = {h: torch.from_numpy(Yd[h]) for h in HEADS}
    Md_t = {h: torch.from_numpy(Md[h]) for h in HEADS}

    if args.mode == "geometry":
        Gt = torch.from_numpy(geometry_features(metat))
        Gd = torch.from_numpy(geometry_features(metad))
        model = GeoMLP(sizes)
    else:
        model = Probe(sizes)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    ce = nn.CrossEntropyLoss(reduction="none")

    def run_eval(X, Y, M):
        model.eval()
        out = {}
        with torch.no_grad():
            if args.mode == "geometry":
                G = Gd if X is Xd_t else Gt
                logits = model(G)
            else:
                logits = model(X)
            for h in HEADS:
                l = ce(logits[h], Y[h].clamp(min=0))
                l = (l * M[h]).sum() / M[h].sum().clamp(min=1)
                acc, n = masked_acc(logits[h], Y[h], M[h])
                out[h] = {"loss": float(l), "acc": acc, "n": n}
        return out

    curve = []
    if args.mode == "geometry":
        Gt = torch.from_numpy(geometry_features(metat))
        Gd = torch.from_numpy(geometry_features(metad))
        Yt_t = {h: torch.from_numpy(Yt[h]) for h in HEADS}
        Mt_t = {h: torch.from_numpy(Mt[h]) for h in HEADS}
        model = GeoMLP(sizes)
        opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
        for ep in range(EPOCHS):
            model.train()
            opt.zero_grad()
            logits = model(Gt)
            loss = 0.0
            for h in HEADS:
                l = ce(logits[h], Yt_t[h].clamp(min=0))
                loss = loss + (l * Mt_t[h]).sum() / Mt_t[h].sum().clamp(min=1)
            loss = loss / len(HEADS)
            loss.backward()
            opt.step()
            dev = run_eval(Xd_t, Yd_t, Md_t)
            curve.append({"epoch": ep + 1, "train_loss": float(loss),
                          "dev": {h: dev[h]["acc"] for h in HEADS}})
            print(f"[{args.mode}] epoch {ep+1}/{EPOCHS} train_loss={float(loss):.4f} "
                  f"dev_pitch={dev['pitch']['acc']:.3f}", flush=True)
    else:
        for ep in range(EPOCHS):
            model.train()
            tot, nstep = 0.0, 0
            for batch in loader:
                xb = batch[0]
                yb = {h: batch[1 + i] for i, h in enumerate(HEADS)}
                mb = {h: batch[1 + len(HEADS) + i] for i, h in enumerate(HEADS)}
                opt.zero_grad()
                logits = model(xb)
                loss = 0.0
                for h in HEADS:
                    l = ce(logits[h], yb[h].clamp(min=0))
                    loss = loss + (l * mb[h]).sum() / mb[h].sum().clamp(min=1)
                loss = loss / len(HEADS)
                loss.backward()
                opt.step()
                tot += float(loss)
                nstep += 1
            dev = run_eval(Xd_t, Yd_t, Md_t)
            curve.append({"epoch": ep + 1, "train_loss": tot / nstep,
                          "dev": {h: dev[h]["acc"] for h in HEADS}})
            print(f"[{args.mode}] epoch {ep+1}/{EPOCHS} train_loss={tot/nstep:.4f} "
                  f"dev_pitch={dev['pitch']['acc']:.3f} dev_dur={dev['dur']['acc']:.3f} "
                  f"dev_kind={dev['kind']['acc']:.3f}", flush=True)

    train_ev = run_eval(torch.from_numpy(Xt[:, None]),
                        {h: torch.from_numpy(Yt[h]) for h in HEADS},
                        {h: torch.from_numpy(Mt[h]) for h in HEADS})
    dev_ev = run_eval(Xd_t, Yd_t, Md_t)
    (TRAIN / "models").mkdir(exist_ok=True)
    mp = TRAIN / "models" / f"probe_{args.mode}.pt"
    torch.save({"state": model.state_dict(), "sizes": sizes, "mode": args.mode,
                "epochs": EPOCHS, "seed": SEED}, str(mp))
    res = {
        "schema": "piano-trainfit-fit/1", "mode": args.mode,
        "budget": {"epochs": EPOCHS, "batch": BATCH, "lr": LR, "seed": SEED, "device": "cpu"},
        "runtime_s": round(time.time() - t_start, 1),
        "model": str(mp.name),
        "model_sha256": hashlib.sha256(mp.read_bytes()).hexdigest(),
        "majority": majority,
        "train": train_ev, "dev": dev_ev, "curve": curve,
        "n_train": len(Xt), "n_dev": len(Xd),
    }
    (TRAIN / "manifests" / f"fit_{args.mode}.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({h: {"train": train_ev[h]["acc"], "dev": dev_ev[h]["acc"],
                           "maj": majority[h]["train_acc"]} for h in HEADS}, indent=1))


if __name__ == "__main__":
    main()
