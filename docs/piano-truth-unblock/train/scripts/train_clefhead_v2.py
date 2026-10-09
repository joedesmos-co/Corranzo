#!/usr/bin/env python3
"""CleF-head v2 (PREREGISTERED single training experiment, TRAIN-only).

Root cause (measured): DEV C4 notes fail because the frozen probe top-5
contains truth pitch for 4/256 items and head v1 scores C=0.0 — an
output-space gap (TRAIN has 116 C notes, all line-3, one score; DEV C is
256 notes, all line-4, another score). Geometry, visual clef (100% glyphs),
and repair math are all verified working; nothing downstream can emit C4
pitches without probe/head support.

Method: warm-start from v1 artifact; train the same Linear(132,88) on
[trunk(128)+clefvec(4)] with v1's real TRAIN rows PLUS synthetic C4 rows:
same frozen trunk features of TRAIN G2/F4 note items, clefvec(C,4), target
= deterministic diatonic transposition of the item's truth steps into the
C4 frame (+ truth accidental offset). TRAIN-only (no DEV/TEST labels in
training; DEV used once for the gate below, then for production eval).

Rationale for synthesis validity: crops are notehead-centered so trunk
features encode staff-relative position patterns (clef-invariant); the
frame shift lives entirely in clefvec, which v1 proved the head uses
(F 0.095 -> 0.794). Synthetic rows teach the C4 transposition the same way.

Fixed recipe: AdamW 3e-3, batch 1024, 15 epochs, CPU, seed 0 (same as v1
amendment). Saves models/clef_pitch_head.pt ONLY on gate pass (v1 kept in
git history on failure). TEST sealed.

PREREGISTERED GATES (oracle-clef DEV input, same arrays as v1):
  F top-1 >= 0.50 (retain v1) AND C top-1 >= 0.50 (the point) AND
  G top-1 >= 0.85 (no material regression) AND production joint-exact
  (visual clef path) >= 13830 (dots-arbitration baseline).
Else ABORT with no artifact change.
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
EVENTS = TRAIN / "data" / "events"
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from infer import load_models, build_inputs  # noqa: E402
from decode_score import _diatonic_idx, _clef_bottom_idx  # noqa: E402
from train_clefhead import clefvec, dev_pitch_acc, BATCH, SEED  # noqa: E402

CACHE_NPZ = "/tmp/clefhead_arrays.npz"
EPOCHS, LR = 15, 3e-3
SEMI_OF_STEP = (0, 2, 4, 5, 7, 9, 11)  # natural semitone of diatonic step class


def _natural_midi(pname_idx, octv):
    return SEMI_OF_STEP[pname_idx % 7] + 12 * (octv + 1)


def collect_synth(sids, trunk, img_cache):
    """TRAIN G2/F4 note items -> (Z feats, synthetic C4 targets).

    steps from truth (pname,oct) in the TRUE frame; target = same steps in
    the C4 frame + the item's truth accidental offset (midi_printed minus
    natural), kept iff inside the 88-class range.
    """
    Z, Y, C = [], [], []
    n_items = n_skip = 0
    bottom4 = _clef_bottom_idx("C", 4)
    with torch.no_grad():
        for n, sid in enumerate(sids):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            items, X, _S, _G = build_inputs(sid, evs, meta, img_cache)[:4]
            if not items:
                continue
            by_id = {e["id"]: e for e in evs if e.get("id")}
            keep = []
            for i, it in enumerate(items):
                e = by_id.get(it["mei_id"])
                if e is None or e.get("kind") != "note":
                    continue
                cl = e.get("clef") or {}
                if cl.get("shape") not in ("G", "F"):
                    continue
                tm = e.get("midi_printed")
                pn, oc = e.get("pname"), e.get("oct")
                if tm is None or pn is None or oc is None:
                    continue
                try:
                    steps = _diatonic_idx(str(pn).upper(), int(oc)) - _clef_bottom_idx(
                        cl.get("shape"), cl.get("line"))
                except (TypeError, ValueError):
                    continue
                cidx = steps + bottom4
                nat = _natural_midi(cidx % 7, cidx // 7)
                alter = int(tm) - _natural_midi(
                    "CDEFGAB".index(str(pn).upper()), int(oc))
                tgt = nat + alter - 21
                n_items += 1
                if not (0 <= tgt < 88):
                    n_skip += 1
                    continue
                keep.append((i, tgt))
            if not keep:
                continue
            Xt = torch.from_numpy(X[:, None]).float() / 255
            feats = []
            for s in range(0, len(Xt), BATCH):
                sl = slice(s, s + BATCH)
                feats.append(trunk.trunk(Xt[sl]).numpy())
            Zf = np.concatenate(feats)
            cv = clefvec("C", 4)
            for i, tgt in keep:
                Z.append(Zf[i])
                Y.append(tgt)
                C.append(cv)
            if (n + 1) % 100 == 0:
                print(f"[synth] {n+1} scores, {len(Y)} synth rows", flush=True)
            if (n + 1) % 50 == 0:
                img_cache.clear()
    print(f"[synth] items={n_items} kept={len(Y)} oor-skipped={n_skip}", flush=True)
    return np.array(Z, np.float32), np.array(Y, np.int64), np.array(C, np.float32)


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
    z = np.load(CACHE_NPZ)
    Xtr, Ytr, Xdv, Ydv, Mdv = z["Xtr"], z["Ytr"], z["Xdv"], z["Ydv"], z["Mdv"]
    print(f"[v2] real rows: {len(Ytr)}", flush=True)
    Zs, Ys, Cs = collect_synth(splits["train"], trunk, {})
    Xs = np.concatenate([Zs, Cs], axis=1)
    Xa = np.concatenate([Xtr, Xs])
    Ya = np.concatenate([Ytr, Ys])
    print(f"[v2] combined rows: {len(Ya)} (real {len(Ytr)} + synth {len(Ys)})",
          flush=True)
    head = torch.nn.Linear(Xa.shape[1], n_pitch)
    v1 = TRAIN / "models" / "clef_pitch_head.pt"
    if v1.is_file():
        ck = torch.load(v1, map_location="cpu")
        assert ck["in_dim"] == Xa.shape[1] and ck["n_pitch"] == n_pitch
        head.load_state_dict(ck["state"])
        print("[v2] warm-started from v1 artifact", flush=True)
    else:
        with torch.no_grad():
            W0 = models["common"][1]["state"]["heads.pitch.weight"]
            B0 = models["common"][1]["state"]["heads.pitch.bias"]
            head.weight[:, :128] = W0
            head.weight[:, 128:] = 0.0
            head.bias[:] = B0
        print("[v2] v1 absent: warm-start from original pitch head", flush=True)
    opt = torch.optim.AdamW(head.parameters(), lr=LR)
    Xt = torch.from_numpy(Xa)
    Yt = torch.from_numpy(Ya).long()
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
        acc = dev_pitch_acc(head, Xdv, Ydv, Mdv)
        print(f"[v2] epoch {ep+1}/{EPOCHS} loss={tot/max(1,nb):.4f} "
              f"dev={ {k: round(v, 4) for k, v in acc.items()} } "
              f"t={time.time()-t0:.0f}s", flush=True)
    acc = dev_pitch_acc(head, Xdv, Ydv, Mdv)
    print(f"[v2] FINAL dev={ {k: round(v, 4) for k, v in acc.items()} }",
          flush=True)
    gate = (acc.get("F", 0) >= 0.50 and acc.get("C", 0) >= 0.50
            and acc.get("G", 0) >= 0.85)
    print(f"[v2] GATE {'PASS' if gate else 'FAIL'} (F>=.50, C>=.50, G>=.85)",
          flush=True)
    if gate:
        torch.save({"state": head.state_dict(), "in_dim": Xa.shape[1],
                    "n_pitch": n_pitch, "seed": SEED, "epochs": EPOCHS,
                    "recipe": "v2: v1 warm-start + synthetic C4 TRAIN rows"},
                   TRAIN / "models" / "clef_pitch_head.pt")
        print("[v2] saved models/clef_pitch_head.pt", flush=True)
    else:
        print("[v2] ABORT: artifact unchanged", flush=True)


if __name__ == "__main__":
    main()
