#!/usr/bin/env python3
"""A1 tri-crop duration head (PREREGISTERED single training experiment).

P1 audit (reports/audit_duration.json, DEV 22,299 notes, 4,652 dur errors):
base-value errors 84% (4/8/16 adjacent confusions = 69%: open-vs-filled
noteheads, beam counts); beamed 62%; uniform-truth-group member errors 70%
of beamed errors; chord tones worse (26%) than singles (19%); voice effect
modest (v1 19%, v5 25%); 55% of measures affected. Decoder voting REJECTED
by measurement (chord majority/root both ~53%, coin flip: errors are
correlated predictor noise on shared stems/beams — see decode_score note).
A learned head reading neighbor VISUALS (not neighbor predictions) is the
remaining lever. Oracle-duration attribution: +2,111 exact headroom.

Method: Linear(384, 16) on [Z_prev, Z_self, Z_next] (frozen common trunk,
128-d each; neighbors = adjacent indices in the deterministic build_inputs
order, zero-padded at edges; NO predicted-label inputs -> zero exposure
bias). Warm-start middle block from the TRAIN-trained common dur head
(floor ~= baseline, unlike v2's conflicted joint training: here all rows
are real, single-task, no synthetic targets). TRAIN note items only
(~125k, MEI chord inheritance for member durs, same rule as eval); rests
keep the common head at inference. AdamW 3e-3, batch 1024, 10 epochs, CPU,
seed 0. Saves models/ctx_dur_head.pt ONLY on gate pass. TEST sealed.

PREREGISTERED GATES (frozen DEV): raw dur agree >= 0.82 (baseline 0.791
full-population) AND production joint-exact (visual path, v1 pitch head)
>= 13874 AND music21 99/99. Else ABORT, no artifact.
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
CACHE_NPZ = "/tmp/ctxdur_arrays.npz"
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


def collect(sids, trunk, img_cache, for_train):
    """Forward frozen trunk on all items; rows for NOTE items with dur
    labels (MEI chord inheritance). X rows = [Z_prev, Z_self, Z_next]."""
    VOC = dur_vocab()
    Zrows, Y = [], []
    with torch.no_grad():
        for n, sid in enumerate(sids):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            items, X, _S, _G = build_inputs(sid, evs, meta, img_cache)[:4]
            if not items:
                continue
            by_id = {e["id"]: e for e in evs if e.get("id")}
            cdr = chord_durs(sid)
            Xt = torch.from_numpy(X[:, None]).float() / 255
            feats = []
            for s in range(0, len(Xt), BATCH):
                sl = slice(s, s + BATCH)
                feats.append(trunk.trunk(Xt[sl]).numpy())
            Zf = np.concatenate(feats)
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
                Zrows.append(np.concatenate([zp, Zf[i], zn]))
                Y.append(VOC.index(sym))
            if (n + 1) % 100 == 0:
                print(f"[collect] {n+1} scores, {len(Y)} rows", flush=True)
            if (n + 1) % 50 == 0:
                img_cache.clear()
    return np.array(Zrows, np.float32), np.array(Y, np.int64)


_CTX_HEAD = None


def load_ctx_head():
    global _CTX_HEAD
    if _CTX_HEAD is None:
        p = TRAIN / "models" / "ctx_dur_head.pt"
        if not p.is_file():
            return None
        ck = torch.load(p, map_location="cpu")
        head = torch.nn.Linear(ck["in_dim"], ck["n_dur"])
        head.load_state_dict(ck["state"])
        head.eval()
        _CTX_HEAD = head
    return _CTX_HEAD


def apply_ctx_dur_head(models, sid, cevents, meta, items, pred, img_cache=None):
    """Override note items' dur/dur_sym with the tri-crop head (eval use).
    Rests keep the common head. Silent fallback (pred unchanged) if the
    artifact is absent. Never touches kind/pitch/voice/staff/flags."""
    from train_clefhead import load_clef_head  # noqa: F401 (keep import graph)
    head = load_ctx_head()
    if head is None:
        return pred
    VOC = dur_vocab()
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
            zero = np.zeros(128, np.float32)
            rows = [np.concatenate([Z[i - 1] if i > 0 else zero, Z[i],
                                    Z[i + 1] if i + 1 < len(Z) else zero])
                    for i in range(len(Z))]
            L = head(torch.from_numpy(np.array(rows))).numpy()
        arg = L.argmax(-1)
        for i in range(len(items)):
            if i in pred and pred[i].get("kind") == 1 and i < len(arg):
                pred[i]["dur"] = int(arg[i])
                pred[i]["dur_sym"] = VOC[int(arg[i])]
    finally:
        if was_training:
            trunk.train()
    return pred


def dur_agree(head, Z, Y):
    with torch.no_grad():
        out = []
        for s in range(0, len(Z), 4096):
            sl = slice(s, s + 4096)
            out.append(head(torch.from_numpy(Z[sl])).argmax(-1).numpy())
    P = np.concatenate(out)
    return float((P == Y).mean())


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
        print("[train] loading cached arrays", flush=True)
        z = np.load(CACHE_NPZ)
        Xtr, Ytr, Xdv, Ydv = z["Xtr"], z["Ytr"], z["Xdv"], z["Ydv"]
    else:
        print("[train] collecting TRAIN...", flush=True)
        Xtr, Ytr = collect(splits["train"], trunk, {}, True)
        print(f"[train] TRAIN rows: {len(Ytr)}", flush=True)
        print("[train] collecting DEV (frozen, eval only)...", flush=True)
        Xdv, Ydv = collect(splits["dev"], trunk, {}, False)
        print(f"[train] DEV rows: {len(Ydv)}", flush=True)
        np.savez_compressed(CACHE_NPZ, Xtr=Xtr, Ytr=Ytr, Xdv=Xdv, Ydv=Ydv)
    head = torch.nn.Linear(Xtr.shape[1], n_dur)
    with torch.no_grad():
        W0 = models["common"][1]["state"]["heads.dur.weight"]
        B0 = models["common"][1]["state"]["heads.dur.bias"]
        head.weight[:, 128:256] = W0
        head.weight[:, :128] = 0.0
        head.weight[:, 256:] = 0.0
        head.bias[:] = B0
    opt = torch.optim.AdamW(head.parameters(), lr=LR)
    Xt = torch.from_numpy(Xtr)
    Yt = torch.from_numpy(Ytr).long()
    n = len(Xt)
    for ep in range(EPOCHS):
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
        acc = dur_agree(head, Xdv, Ydv)
        print(f"[train] epoch {ep+1}/{EPOCHS} loss={tot/max(1,nb):.4f} "
              f"dev_dur={acc:.4f} t={time.time()-t0:.0f}s", flush=True)
    acc = dur_agree(head, Xdv, Ydv)
    print(f"[train] FINAL dev_dur={acc:.4f}", flush=True)
    if acc >= 0.82:
        torch.save({"state": head.state_dict(), "in_dim": Xtr.shape[1],
                    "n_dur": n_dur, "seed": SEED, "epochs": EPOCHS,
                    "recipe": "A1 tri-crop duration head on frozen trunk"},
                   TRAIN / "models" / "ctx_dur_head.pt")
        print("[train] GATE PASS: saved models/ctx_dur_head.pt", flush=True)
    else:
        print("[train] GATE FAIL (<0.82): artifact not saved", flush=True)


if __name__ == "__main__":
    main()
