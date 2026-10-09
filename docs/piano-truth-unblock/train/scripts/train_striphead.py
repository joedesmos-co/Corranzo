#!/usr/bin/env python3
"""S1 strip+crop rhythm head (PREREGISTERED single capped experiment).

Evidence chain (see RECONSTRUCTION.md): 64x64 notehead crops exclude beams
by construction (+-3 gaps vs beams at stem ends); full-width strips (+-4
gaps, 128x24) contain them — DEV pixel check: edge-band ink 8th 0.102 vs
16th 0.151. The frozen context tower (32-d global avgpool, multitask) fails
to exploit it (dur 0.613). A1 tri-crop (0.858) lacks beam objects: oracle
groups + vote gains only +222 and the beamed-16ths C4 score stands still.

Method: multitask linear heads on FROZEN features —
[Z_prev,Z_self,Z_next (384, common trunk) + strip rows (384: context strip
tower pre-pool 32chx12rows, mean over width — vertical beam positions kept)
+ G (5)] = 773-d -> {dur16, is_start/2, is_end/2, tuplet/2}. Warm-start the
384 neighbor-crop block from the A1 artifact (strict superset of A1 inputs;
floor ~= A1). TRAIN note rows only (~122k, MEI chord inheritance); boundary
labels from truth beam groups; tuplet labels from tuplet_id. TRAIN support:
tuplet 3,500 notes/153 scores; beam starts/ends ~26k each. AdamW 3e-3,
batch 1024, 10 epochs, CPU, seed 0. Saves models/strip_dur_head.pt ONLY on
gate pass. TEST sealed.

PREREGISTERED GATES (frozen DEV): dur agree >= 0.858 (A1) AND production
joint-exact (visual path, v1 pitch head) >= 15005 AND music21 99/99.
Boundary/tuplet heads reported (F1) without hard gate (feasibility
evidence; decoder integration deferred). Else ABORT, no artifact.
"""
from __future__ import annotations
import gzip
import json
import sys
import time
import xml.etree.ElementTree as ET
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

SEED = 0
EPOCHS, LR, BATCH = 10, 3e-3, 1024
CACHE_NPZ = "/tmp/striphead_arrays.npz"
_NS = "{http://www.music-encoding.org/ns/mei}"
_XID = "{http://www.w3.org/XML/1998/namespace}id"


def dur_vocab():
    return json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]["dur"]


def chord_durs(sid):
    out = {}
    try:
        root = ET.parse(RENDER / sid / "score.mei").getroot()
        for el in root.iter(_NS + "chord"):
            for n in el.iter(_NS + "note"):
                if n.get(_XID):
                    out[n.get(_XID)] = (el.get("dur"), int(el.get("dots") or 0))
    except (OSError, ET.ParseError):
        pass
    return out


def beam_pos(evs, by_id):
    """note id -> 0 interior/singleton, 1 first, 2 last (truth beam groups)."""
    bg = {}
    for e in evs:
        if e.get("kind") == "note" and e.get("beam_id"):
            bg.setdefault(e["beam_id"], []).append(e["id"])
    pos = {}
    for ids in bg.values():
        ids.sort(key=lambda i: ((by_id[i].get("measure_index") or 0),
                                by_id[i].get("source_order", 0)))
        for j, i in enumerate(ids):
            pos[i] = (1 if j == 0 else 0, 1 if j == len(ids) - 1 else 0)
    return pos


def collect(sids, trunk, striptower, img_cache):
    VOC = dur_vocab()
    Xr, Yd, Ys, Ye, Yt = [], [], [], [], []
    with torch.no_grad():
        stower = torch.nn.Sequential(*list(striptower.children())[:-2]).eval()
        for n, sid in enumerate(sids):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            items, X, S, G = build_inputs(sid, evs, meta, img_cache)[:4]
            if not items:
                continue
            by_id = {e["id"]: e for e in evs if e.get("id")}
            cdr = chord_durs(sid)
            bpos = beam_pos(evs, by_id)
            Xt = torch.from_numpy(X[:, None]).float() / 255
            St = torch.from_numpy(S[:, None]).float() / 255
            Zf, Rf = [], []
            for s in range(0, len(Xt), BATCH):
                sl = slice(s, s + BATCH)
                Zf.append(trunk.trunk(Xt[sl]).numpy())
                # 32ch x 12rows x 64w -> mean over width -> 32x12 row features
                Rf.append(stower(St[sl]).mean(-1).reshape(len(St[sl]), -1).numpy())
            Zf = np.concatenate(Zf)
            Rf = np.concatenate(Rf)
            Gf = np.array(G, np.float32)
            zero = np.zeros(128, np.float32)
            for i, it in enumerate(items):
                e = by_id.get(it["mei_id"])
                if e is None or e.get("kind") != "note":
                    continue
                td, to = e.get("dur"), (e.get("dots") or 0)
                if td is None and e.get("id") in cdr:
                    td, to = cdr[e["id"]]
                if td is None:
                    continue
                sym = f"{td}d{to}"
                if sym not in VOC:
                    continue
                zp = Zf[i - 1] if i > 0 else zero
                zn = Zf[i + 1] if i + 1 < len(Zf) else zero
                Xr.append(np.concatenate([zp, Zf[i], zn, Rf[i], Gf[i]]))
                Yd.append(VOC.index(sym))
                st, en = bpos.get(e["id"], (0, 0))
                Ys.append(st)
                Ye.append(en)
                Yt.append(1 if e.get("tuplet_id") else 0)
            if (n + 1) % 100 == 0:
                print(f"[collect] {n+1} scores, {len(Yd)} rows", flush=True)
            if (n + 1) % 50 == 0:
                img_cache.clear()
    return (np.array(Xr, np.float32), np.array(Yd, np.int64),
            np.array(Ys, np.int64), np.array(Ye, np.int64), np.array(Yt, np.int64))


_STRIP_HEAD = None


def load_strip_head():
    global _STRIP_HEAD
    if _STRIP_HEAD is None:
        p = TRAIN / "models" / "strip_dur_head.pt"
        if not p.is_file():
            return None
        ck = torch.load(p, map_location="cpu")
        heads = torch.nn.ModuleDict(
            {h: torch.nn.Linear(ck["in_dim"], ck["sizes"][h]) for h in ck["sizes"]})
        heads.load_state_dict(ck["state"])
        heads.eval()
        _STRIP_HEAD = heads
    return _STRIP_HEAD


def apply_strip_dur_head(models, sid, cevents, meta, items, pred, img_cache=None):
    """Override note items' dur/dur_sym with the S1 head (eval use). Rests
    keep the common head. Silent fallback if absent. Dur only — boundary and
    tuplet heads are classification evidence (decoder integration deferred)."""
    heads = load_strip_head()
    if heads is None:
        return pred
    VOC = dur_vocab()
    trunk = models["common"][0]
    stower_full = models["context"][0].strip
    was_training = trunk.training
    trunk.eval()
    try:
        items2, X, S, G, _sk = build_inputs(
            sid, cevents, meta, img_cache if img_cache is not None else {})
        if len(items2) != len(items):
            return pred
        Xt = torch.from_numpy(X[:, None]).float() / 255
        St = torch.from_numpy(S[:, None]).float() / 255
        with torch.no_grad():
            stower = torch.nn.Sequential(*list(stower_full.children())[:-2]).eval()
            Z = torch.cat([trunk.trunk(Xt[b:b + 1024])
                           for b in range(0, len(Xt), 1024)]).numpy()
            R = torch.cat([stower(St[b:b + 1024]).mean(-1).reshape(
                min(1024, len(St) - b), -1)
                for b in range(0, len(St), 1024)]).numpy()
            Gf = np.array(G, np.float32)
            zero = np.zeros(128, np.float32)
            rows = [np.concatenate([Z[i - 1] if i > 0 else zero, Z[i],
                                    Z[i + 1] if i + 1 < len(Z) else zero,
                                    R[i], Gf[i]]) for i in range(len(Z))]
            L = heads["dur"](torch.from_numpy(np.array(rows))).numpy()
        arg = L.argmax(-1)
        for i in range(len(items)):
            if i in pred and pred[i].get("kind") == 1 and i < len(arg):
                pred[i]["dur"] = int(arg[i])
                pred[i]["dur_sym"] = VOC[int(arg[i])]
    finally:
        if was_training:
            trunk.train()
    return pred


def rep_metrics(heads, Z, Yd, Ys, Ye, Yt):
    with torch.no_grad():
        outs = []
        for s in range(0, len(Z), 4096):
            sl = slice(s, s + 4096)
            t = torch.from_numpy(Z[sl])
            outs.append({h: heads[h](t).argmax(-1).numpy() for h in heads})
        P = {h: np.concatenate([o[h] for o in outs]) for h in heads}
    rep = {"dur": float((P["dur"] == Yd).mean())}
    for h, Y in (("start", Ys), ("end", Ye), ("tup", Yt)):
        p, y = P[h], Y
        tp = int(((p == 1) & (y == 1)).sum())
        fp = int(((p == 1) & (y == 0)).sum())
        fn = int(((p == 0) & (y == 1)).sum())
        rep[h] = {"f1": round(2 * tp / max(1, 2 * tp + fp + fn), 4),
                  "n_pos": int((y == 1).sum())}
    return rep


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
    striptower = models["context"][0].strip
    for p in striptower.parameters():
        p.requires_grad = False
    sizes = {"dur": models["common"][1]["sizes"]["dur"], "start": 2,
             "end": 2, "tup": 2}
    import os
    if os.path.exists(CACHE_NPZ):
        print("[train] loading cached arrays", flush=True)
        z = np.load(CACHE_NPZ)
        Xtr, Yd_tr, Ys_tr, Ye_tr, Yt_tr = (z["Xtr"], z["Yd_tr"], z["Ys_tr"],
                                           z["Ye_tr"], z["Yt_tr"])
        Xdv, Yd_dv, Ys_dv, Ye_dv, Yt_dv = (z["Xdv"], z["Yd_dv"], z["Ys_dv"],
                                           z["Ye_dv"], z["Yt_dv"])
    else:
        print("[train] collecting TRAIN...", flush=True)
        Xtr, Yd_tr, Ys_tr, Ye_tr, Yt_tr = collect(splits["train"], trunk,
                                                 striptower, {})
        print(f"[train] TRAIN rows: {len(Yd_tr)}", flush=True)
        print("[train] collecting DEV (frozen, eval only)...", flush=True)
        Xdv, Yd_dv, Ys_dv, Ye_dv, Yt_dv = collect(splits["dev"], trunk,
                                                 striptower, {})
        print(f"[train] DEV rows: {len(Yd_dv)}", flush=True)
        np.savez_compressed(CACHE_NPZ, Xtr=Xtr, Yd_tr=Yd_tr, Ys_tr=Ys_tr,
                            Ye_tr=Ye_tr, Yt_tr=Yt_tr, Xdv=Xdv, Yd_dv=Yd_dv,
                            Ys_dv=Ys_dv, Ye_dv=Ye_dv, Yt_dv=Yt_dv)
    heads = torch.nn.ModuleDict(
        {h: torch.nn.Linear(Xtr.shape[1], n) for h, n in sizes.items()})
    with torch.no_grad():
        a1p = TRAIN / "models" / "ctx_dur_head.pt"
        if a1p.is_file():
            ck = torch.load(a1p, map_location="cpu")
            heads["dur"].weight[:, :384] = ck["state"]["weight"]
            heads["dur"].bias[:] = ck["state"]["bias"]
            print("[train] dur neighbor block warm-started from A1", flush=True)
        else:
            W0 = models["common"][1]["state"]["heads.dur.weight"]
            B0 = models["common"][1]["state"]["heads.dur.bias"]
            heads["dur"].weight[:, 128:256] = W0
            heads["dur"].bias[:] = B0
            print("[train] A1 absent: dur center block from common head", flush=True)
    opt = torch.optim.AdamW(heads.parameters(), lr=LR)
    Xt = torch.from_numpy(Xtr)
    Ys = {h: torch.from_numpy(Y).long() for h, Y in
          (("dur", Yd_tr), ("start", Ys_tr), ("end", Ye_tr), ("tup", Yt_tr))}
    n = len(Xt)
    for ep in range(EPOCHS):
        perm = torch.randperm(n, generator=torch.Generator().manual_seed(SEED + ep))
        tot, nb = 0.0, 0
        for s in range(0, n, BATCH):
            idx = perm[s:s + BATCH]
            opt.zero_grad()
            loss = sum(F.cross_entropy(heads[h](Xt[idx]), Ys[h][idx])
                       for h in sizes) / len(sizes)
            loss.backward()
            opt.step()
            tot += float(loss) * len(idx)
            nb += len(idx)
        rep = rep_metrics(heads, Xdv, Yd_dv, Ys_dv, Ye_dv, Yt_dv)
        print(f"[train] epoch {ep+1}/{EPOCHS} loss={tot/max(1,nb):.4f} "
              f"dev={rep} t={time.time()-t0:.0f}s", flush=True)
    rep = rep_metrics(heads, Xdv, Yd_dv, Ys_dv, Ye_dv, Yt_dv)
    print(f"[train] FINAL dev={rep}", flush=True)
    if rep["dur"] >= 0.858:
        torch.save({"state": heads.state_dict(), "in_dim": Xtr.shape[1],
                    "sizes": sizes, "seed": SEED, "epochs": EPOCHS,
                    "recipe": "S1 multitask linear on frozen crop+strip-row features"},
                   TRAIN / "models" / "strip_dur_head.pt")
        print("[train] GATE PASS: saved models/strip_dur_head.pt", flush=True)
    else:
        print("[train] GATE FAIL (dur<0.858): artifact not saved", flush=True)


if __name__ == "__main__":
    main()
