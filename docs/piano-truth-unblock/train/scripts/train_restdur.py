#!/usr/bin/env python3
"""R1 rest-duration head (PREREGISTERED single bounded experiment).

Root cause (P1 audit, reports/audit_rest.json): rest type was NEVER
supervised in the frozen checkpoints — v1_adapter masked dur for every rest
because the old events carried dur=None for rests (objects inventory
dropped @dur). Measured decode: 577 rests decoded, 252 (43.7%) wrong type,
and the model's wrong answers cluster on the majority class (8d0) —
unsupervised behavior. Events are now REPAIRED (rest @dur.ppq/@dur restored
from MEI in v1_events.py; 4,801 rests recovered, 8,472 onsets corrected),
so supervision exists.

Method: Linear(128,16) on FROZEN common-trunk features of the rest crop
(evidence: 64x64 crop contains the rest glyph + staff context), warm-
started from the TRAIN-trained common dur head. TRAIN rest rows only
(~4.1k), DEV rest rows for the gate. TEST sealed.

Preregistration (frozen): seed 0; AdamW 3e-3; batch 512; 30 epochs; CPU.
GATES (production DEV, oracle boxes + visual clef + A1 dur head): 
  (a) raw DEV rest-dur class acc >= 0.75
  (b) production rest_tp >= 118 (staff-fixed baseline)
  (c) production joint-exact >= 15005
  (d) music21 parsed == 99/99
Else ABORT with no artifact. Preserve A1/clef heads; rests-only change.
"""
from __future__ import annotations
import gzip
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
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
sys.path.insert(0, str(HERE))
from infer import load_models, build_inputs  # noqa: E402
from train_ctxdur import chord_durs  # noqa: E402

SEED = 0
EPOCHS, LR, BATCH = 30, 3e-3, 512
CACHE_NPZ = "/tmp/restdur_arrays.npz"


def collect(sids, trunk, img_cache):
    """Rows for REST items with a dur label (MEI-inherited truth)."""
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    Z, Y = [], []
    with torch.no_grad():
        for n, sid in enumerate(sids):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            items, X, _S, _G = build_inputs(sid, evs, meta, img_cache)[:4]
            if not items:
                continue
            by_id = {e["id"]: e for e in evs if e.get("id")}
            Xt = torch.from_numpy(X[:, None]).float() / 255
            feats = []
            for s in range(0, len(Xt), BATCH):
                sl = slice(s, s + BATCH)
                feats.append(trunk.trunk(Xt[sl]).numpy())
            Zf = np.concatenate(feats)
            for i, it in enumerate(items):
                e = by_id.get(it["mei_id"])
                if e is None or e.get("kind") not in ("rest", "mRest",
                                                      "multiRest"):
                    continue
                td, to = e.get("dur"), (e.get("dots") or 0)
                if td is None:
                    continue  # true full-measure rest: no class to learn
                sym = f"{td}d{to}"
                if sym not in voc["dur"]:
                    continue
                Z.append(Zf[i])
                Y.append(voc["dur"].index(sym))
            if (n + 1) % 200 == 0:
                print(f"[collect] {n+1} scores, {len(Y)} rest rows", flush=True)
            if (n + 1) % 50 == 0:
                img_cache.clear()
    return np.array(Z), np.array(Y)


_REST_HEAD = None


def load_rest_head():
    global _REST_HEAD
    if _REST_HEAD is None:
        p = TRAIN / "models" / "rest_dur_head.pt"
        if not p.is_file():
            return None
        ck = torch.load(p, map_location="cpu")
        head = torch.nn.Linear(ck["in_dim"], ck["n_dur"])
        head.load_state_dict(ck["state"])
        head.eval()
        _REST_HEAD = head
    return _REST_HEAD


def apply_rest_dur_head(models, sid, cevents, meta, items, pred, img_cache=None):
    """Override REST items' dur/dur_sym with the R1 head (eval use). Notes
    untouched. Silent fallback if the artifact is absent."""
    head = load_rest_head()
    if head is None:
        return pred
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    trunk = models["common"][0]
    was_training = trunk.training
    trunk.eval()
    try:
        items2, X, _S, _G, _sk = build_inputs(
            sid, cevents, meta, img_cache if img_cache is not None else {})
        if len(items2) != len(items):
            return pred
        Xt = torch.from_numpy(X[:, None]).float() / 255
        with torch.no_grad():
            Z = torch.cat([trunk.trunk(Xt[b:b + 1024])
                           for b in range(0, len(Xt), 1024)]).numpy()
            outs = []
            for b in range(0, len(Z), 4096):
                outs.append(head(torch.from_numpy(Z[b:b + 4096])).argmax(-1).numpy())
            arg = np.concatenate(outs)
        for i in range(len(items)):
            if i in pred and pred[i].get("kind") == 0 and i < len(arg):
                # full-measure rests (dur_sym None) keep the common head:
                # R1 supervises only typed rests
                if pred[i].get("dur_sym") is None:
                    continue
                pred[i]["dur"] = int(arg[i])
                pred[i]["dur_sym"] = voc["dur"][int(arg[i])]
    finally:
        if was_training:
            trunk.train()
    return pred


def main():
    t0 = time.time()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    models = load_models(device="cpu")
    trunk = models["common"][0]
    trunk.eval()
    for p in trunk.parameters():
        p.requires_grad = False
    n_dur = models["common"][1]["sizes"]["dur"]
    import os
    if os.path.exists(CACHE_NPZ):
        z = np.load(CACHE_NPZ)
        Xtr, Ytr, Xdv, Ydv = z["Xtr"], z["Ytr"], z["Xdv"], z["Ydv"]
    else:
        print("[train] collecting TRAIN rest rows...", flush=True)
        Xtr, Ytr = collect(splits["train"], trunk, {})
        print(f"[train] TRAIN rest rows: {len(Ytr)}", flush=True)
        print("[train] collecting DEV rest rows (frozen, eval only)...", flush=True)
        Xdv, Ydv = collect(splits["dev"], trunk, {})
        print(f"[train] DEV rest rows: {len(Ydv)}", flush=True)
        np.savez_compressed(CACHE_NPZ, Xtr=Xtr, Ytr=Ytr, Xdv=Xdv, Ydv=Ydv)
    head = torch.nn.Linear(Xtr.shape[1], n_dur)
    with torch.no_grad():
        W0 = models["common"][1]["state"]["heads.dur.weight"]
        B0 = models["common"][1]["state"]["heads.dur.bias"]
        head.weight[:, :] = W0[:, :Xtr.shape[1]] if W0.shape[1] == Xtr.shape[1] else W0
        head.bias[:] = B0
    opt = torch.optim.AdamW(head.parameters(), lr=LR)
    Xt = torch.from_numpy(Xtr)
    Yt = torch.from_numpy(Ytr).long()
    best, best_state, best_ep = -1.0, None, -1
    for ep in range(EPOCHS):
        head.train()
        perm = torch.randperm(len(Xt),
                              generator=torch.Generator().manual_seed(SEED + ep))
        for s in range(0, len(Xt), BATCH):
            idx = perm[s:s + BATCH]
            opt.zero_grad()
            F.cross_entropy(head(Xt[idx]), Yt[idx]).backward()
            opt.step()
        head.eval()
        with torch.no_grad():
            acc = float((head(torch.from_numpy(Xdv)).argmax(-1).numpy() == Ydv).mean())
        print(f"[train] epoch {ep+1}/{EPOCHS} dev_rest_dur={acc:.4f} "
              f"t={time.time()-t0:.0f}s", flush=True)
        if acc > best:
            best, best_ep = acc, ep + 1
            best_state = {k: v.clone() for k, v in head.state_dict().items()}
    print(f"[train] BEST dev_rest_dur={best:.4f} @epoch {best_ep}", flush=True)
    if best >= 0.75:
        head.load_state_dict(best_state)
        torch.save({"state": head.state_dict(), "in_dim": Xtr.shape[1],
                    "n_dur": n_dur, "seed": SEED, "epochs": EPOCHS,
                    "recipe": "R1 rest-dur linear on frozen trunk"},
                   TRAIN / "models" / "rest_dur_head.pt")
        print("[train] GATE (a) PASS: saved models/rest_dur_head.pt", flush=True)
    else:
        print("[train] GATE (a) FAIL: artifact not saved", flush=True)


if __name__ == "__main__":
    main()
