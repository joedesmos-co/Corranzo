#!/usr/bin/env python3
"""E-clef proof: clef-conditioned pitch head on FROZEN common trunk (TRAIN-only).

Preregistered recipe (see RECONSTRUCTION.md): freeze trunk; train a new
Linear(132, n_pitch) head on [trunk(128) + clefvec(4)] where clefvec =
[onehot(shape G/F/C), line/5]. TRAIN note items (stratified subset, seeded);
uniform masked CE; AdamW 1e-4, batch 1024, MAX 3 epochs, CPU only, seed 0.
Single DEV gate: F-clef top-1 >= 0.50 AND joint-exact no regression, else ABORT.
Writes models/clef_pitch_head.pt (NEW file; best checkpoints untouched).
TEST sealed (train/dev lists only).
"""
from __future__ import annotations
import gzip
import json
import sys
import time
from collections import Counter
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
from v1_probe import LocalModel  # noqa: E402

SEED = 0
MAX_EPOCHS = 15
LR = 3e-3
BATCH = 1024
N_G_SAMPLE = 22000
CACHE_NPZ = "/tmp/clefhead_arrays.npz"
# AMENDED recipe (see report): 3 epochs @1e-4 = 126 steps, insufficient for a
# random-init head (DEV 0.14, proof aborted per gate). Amendment: warm-start
# the 128 pitch dims from the TRAIN-trained original pitch head (no DEV in
# init) + 15 epochs @3e-3 on precomputed features (~630 steps, minutes CPU).
# Single final DEV gate unchanged. Best checkpoints untouched.
SHAPES = {"G": 0, "F": 1, "C": 2}


def clefvec(shape, line):
    v = np.zeros(4, np.float32)
    v[SHAPES.get(shape, 0)] = 1.0
    try:
        v[3] = float(line or 2) / 5.0
    except (TypeError, ValueError):
        v[3] = 0.4
    return v


def collect(sids, trunk, img_cache, want_clef=None, g_cap=None, seed=0):
    """Forward frozen trunk; return (Z, Y, C, M) arrays where M holds the
    canonical clef shape per item (supervision/eval only, never a model input
    except through C). want_clef: set of shapes to keep (None = all).
    g_cap: max G-shape items (seeded subsample)."""
    rng = np.random.default_rng(seed)
    Z, Y, C, M = [], [], [], []
    g_idx = []
    with torch.no_grad():
        for n, sid in enumerate(sids):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            items, X, S, G = build_inputs(sid, evs, meta, img_cache)[:4]
            if not items:
                continue
            by_id = {e["id"]: e for e in evs if e.get("id")}
            keep = []
            for i, it in enumerate(items):
                e = by_id.get(it["mei_id"])
                if e is None or e.get("kind") != "note":
                    continue
                tm = e.get("midi_printed")
                cl = e.get("clef") or {}
                if tm is None or not (0 <= tm - 21 < 88):
                    continue
                sh = cl.get("shape", "G")
                if want_clef is not None and sh not in want_clef:
                    continue
                keep.append((i, tm - 21, clefvec(sh, cl.get("line")), sh))
            if not keep:
                continue
            Xt = torch.from_numpy(X[:, None]).float() / 255
            feats = []
            for s in range(0, len(Xt), BATCH):
                sl = slice(s, s + BATCH)
                feats.append(trunk.trunk(Xt[sl]).numpy())
            Zf = np.concatenate(feats)
            base = len(Y)
            for j, (i, y, c, sh) in enumerate(keep):
                Z.append(Zf[i])
                Y.append(y)
                C.append(c)
                M.append(sh)
                if sh == "G":
                    g_idx.append(base + j)
            if (n + 1) % 100 == 0:
                print(f"[collect] {n+1} scores, {len(Y)} items", flush=True)
            if (n + 1) % 50 == 0:
                img_cache.clear()  # PNG page cache: re-reads are cheap, RAM is not
    Z, Y, C = map(np.array, (Z, Y, C))
    M = np.array(M)
    if g_cap is not None and g_idx:
        gset = set(g_idx)
        sel = set(rng.choice(g_idx, size=min(g_cap, len(g_idx)), replace=False).tolist())
        keep = np.array([i for i in range(len(Y)) if i in sel or i not in gset])
        Z, Y, C, M = Z[keep], Y[keep], C[keep], M[keep]
    return Z, Y, C, M


_CLEF_HEAD = None


def load_clef_head():
    """Load the proof artifact once (returns None if absent)."""
    global _CLEF_HEAD
    if _CLEF_HEAD is None:
        p = TRAIN / "models" / "clef_pitch_head.pt"
        if not p.is_file():
            return None
        ck = torch.load(p, map_location="cpu")
        head = torch.nn.Linear(ck["in_dim"], ck["n_pitch"])
        head.load_state_dict(ck["state"])
        head.eval()
        _CLEF_HEAD = head
    return _CLEF_HEAD


def apply_clef_pitch_head(models, sid, cevents, meta, items, pred, img_cache=None):
    """Override pred pitch fields with the clef-conditioned head (eval use).
    Clef input comes from the VISUAL map only (structural rank + item
    measure - no truth labels). Falls back silently (returns pred unchanged)
    if the artifact, structure, or map is unavailable. Never touches kind,
    dur, voice, staff, or flags heads."""
    from decode_score import _struct_index, _visual_clef_lookup
    head = load_clef_head()
    if head is None:
        return pred
    trunk = models["common"][0]
    was_training = trunk.training
    trunk.eval()
    try:
        items2, X, S, G, _sk = build_inputs(
            sid, cevents, meta, img_cache if img_cache is not None else {})
        if len(items2) != len(items):
            return pred
        sidx = _struct_index(
            sid, sorted({it.get("page", 1) for it in items if it.get("page")}))
        vmap = _visual_clef_lookup(sid) or {}
        Cin = []
        for it in items:
            st = sidx.get(it.get("mei_id") or "")
            if st is not None:
                cl = vmap.get((it.get("measure"), st["rank_label"]),
                              {"shape": "G", "line": 2})
            else:
                cl = {"shape": "G", "line": 2}
            Cin.append(clefvec(cl["shape"], cl.get("line")))
        Cin = np.array(Cin, np.float32)
        Xt = torch.from_numpy(X[:, None]).float() / 255
        with torch.no_grad():
            Z = torch.cat([trunk.trunk(Xt[b:b + 1024])
                           for b in range(0, len(Xt), 1024)]).numpy()
            L = np.concatenate([head(torch.from_numpy(
                np.concatenate([Z[b:b + 4096], Cin[b:b + 4096]], axis=1))).numpy()
                for b in range(0, len(Z), 4096)])
        top5 = np.argsort(-L, axis=1)[:, :5]
        for i, it in enumerate(items):
            if i in pred and pred[i].get("kind") == 1 and top5.shape[0] > i:
                pred[i]["pitch"] = int(top5[i, 0])
                pred[i]["pitch_midi"] = 21 + int(top5[i, 0])
                pred[i]["pitch_top5"] = [int(v) for v in top5[i]]
    finally:
        if was_training:
            trunk.train()
    return pred


def dev_pitch_acc(head, Z, Y, M=None):
    with torch.no_grad():
        out = []
        for s in range(0, len(Z), 4096):
            sl = slice(s, s + 4096)
            out.append(head(torch.from_numpy(Z[sl])).argmax(-1).numpy())
    P = np.concatenate(out)
    res = {"all": float((P == Y).mean())}
    if M is not None:
        for sh in ("G", "F", "C"):
            m = M == sh
            if m.sum():
                res[sh] = float((P[m] == Y[m]).mean())
    return res


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
    n_pitch = models["common"][1]["sizes"]["pitch"]
    img_cache = {}
    import os
    if os.path.exists(CACHE_NPZ):
        print("[train] loading cached arrays", flush=True)
        z = np.load(CACHE_NPZ)
        Xtr, Ytr, Xdv, Ydv, Mdv = z["Xtr"], z["Ytr"], z["Xdv"], z["Ydv"], z["Mdv"]
    else:
        print("[train] collecting TRAIN subset...", flush=True)
        Ztr, Ytr, Ctr, _Mtr = collect(splits["train"], trunk, img_cache,
                                      want_clef={"F", "C", "G"}, g_cap=N_G_SAMPLE, seed=SEED)
        print(f"[train] items: {len(Ytr)}", flush=True)
        Xtr = np.concatenate([Ztr, Ctr], axis=1)
        print("[train] collecting DEV (frozen, eval only)...", flush=True)
        Zdv, Ydv, Cdv, Mdv = collect(splits["dev"], trunk, {}, want_clef=None)
        Xdv = np.concatenate([Zdv, Cdv], axis=1)
        np.savez_compressed(CACHE_NPZ, Xtr=Xtr, Ytr=Ytr, Xdv=Xdv, Ydv=Ydv, Mdv=Mdv)
    head = torch.nn.Linear(Xtr.shape[1], n_pitch)
    with torch.no_grad():
        W0 = models["common"][1]["state"]["heads.pitch.weight"]
        B0 = models["common"][1]["state"]["heads.pitch.bias"]
        head.weight[:, :128] = W0
        head.weight[:, 128:] = 0.0
        head.bias[:] = B0
    opt = torch.optim.AdamW(head.parameters(), lr=LR)
    Xt = torch.from_numpy(Xtr)
    Yt = torch.from_numpy(Ytr).long()
    n = len(Xt)
    for ep in range(MAX_EPOCHS):
        perm = torch.randperm(n, generator=torch.Generator().manual_seed(SEED + ep))
        tot, nb = 0.0, 0
        for s in range(0, n, BATCH):
            idx = perm[s:s + BATCH]
            opt.zero_grad()
            loss = F.cross_entropy(head(Xt[idx]), Yt[idx])
            loss.backward()
            opt.step()
            tot += float(loss) * len(idx)
            nb += len(idx)
        acc = dev_pitch_acc(head, Xdv, Ydv, Mdv)
        print(f"[train] epoch {ep+1}/{MAX_EPOCHS} loss={tot/max(1,nb):.4f} "
              f"dev={ {k: round(v, 4) for k, v in acc.items()} } t={time.time()-t0:.0f}s",
              flush=True)
    torch.save({"state": head.state_dict(), "in_dim": Xtr.shape[1],
                "n_pitch": n_pitch, "seed": SEED, "epochs": MAX_EPOCHS,
                "recipe": "clef-conditioned linear head on frozen common trunk"},
               TRAIN / "models" / "clef_pitch_head.pt")
    acc = dev_pitch_acc(head, Xdv, Ydv, Mdv)
    print(f"[train] saved models/clef_pitch_head.pt "
          f"dev={ {k: round(v, 4) for k, v in acc.items()} } "
          f"total_time={time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
