#!/usr/bin/env python3
"""T1 vertical-preserving rhythm CNN (PREREGISTERED single capped experiment).

P1 (TRAIN-only panels, /tmp/p1): 3-gap x 12-gap stem-centered tall crops
(48x192) VERIFIED to contain countable 1/2/3 beams, boundary stubs (start:
beam extends right only), flags, open/filled heads, stems, and tuplet
numbers at the +-6 edge. 64-crops cut beams off; 128x24 strips alias count
away (S1 negative). Joins: oracle boxes + structural notehead cy (same rule
as build_inputs). Quarantine: beamed notes whose MEI-inherited dur is still
None or outside the 16-class vocab are dropped from rows (counted).

P2 architecture (frozen): TallCNN, NO vertical pooling —
  1x192x48 -> C3(1,32)/BN/R -> C3(32,64)/BN/R -> MaxPool(1,2) [width only]
  -> C3(64,128)/BN/R -> C3(128,128)/BN/R -> MaxPool(1,2) [width only]
  -> C3(128,128)/BN/R [128x192x12, full height] -> AdaptiveAvgPool((48,1))
  -> flatten 6144 -> FC+ReLU 256 -> heads {dur16, beams5, start2, end2, tup2}.
~1.9M params. Single crop per row (no siamese: beam count is a per-note
object; neighbors add clock noise, not beam evidence).

P3 supervision (frozen TRAIN identities): note rows with dur labels (MEI
chord inheritance, same rule as eval); beamcount {beamed? {8:1,16:2,32:3,
64:4} : 0}; boundaries from truth beam groups; tuplet from tuplet_id.
Stratified TRAIN subset: ALL 16/32/64/dotted/tuplet/beamed-non-8 rows +
seeded sample of 8ths and quarters-or-longer (exact counts printed);
DEV = all note rows (frozen, eval only). TEST sealed.

P4 PREREGISTRATION (frozen before the run): seed 0; AdamW 3e-4 (v1 recipe
lr for unfrozen CNNs); batch 256 (v1 budget precedent); 12-epoch cap (v1
budget); uniform multitask loss (v1: weights rejected); best-DEV-dur epoch
kept in memory, artifact saved ONLY on gate pass. HARD GATES (frozen DEV,
vs A1): dur agree >= 0.858 AND 16->8 confusion <= 700 (A1: 833; the motive
beam-count confusion) AND production joint-exact >= 15005 AND music21 99/99.
Beam-count acc, boundary F1, tuplet F1 reported as feasibility evidence (no
hard gate). No TEST, no sweep, no retraining.

P4 AMENDMENT (resource gate, documented before any amended run): the
as-registered 1.9M-param TallCNN benchmarks 14.6 s/iter on this Mac
(10-iter mean; 12 epochs ~= 14 hr) — infeasible on shared hardware and
beyond any session budget (priority 8 fails). Amended to TallCNN-S, same
vertical-preserving family (NO vertical pooling anywhere; AdaptiveAvgPool
(48,1) only at the very end):
  1x192x48 -> C3(1,8)/BN/R -> C3(8,16)/BN/R -> MaxPool(1,2) [width only]
  -> C3(16,32)/BN/R -> C3(32,32)/BN/R -> MaxPool(1,2) [width only]
  -> C3(32,32)/BN/R [32x192x12, full height] -> AdaptiveAvgPool((48,1))
  -> flatten 1536 -> FC+ReLU 96 -> heads {dur16, beams5, start2, end2, tup2}
(~0.15M params; benchmarked to fit ~40 min for 12 epochs on shared CPU).
Capacity caveat recorded: bars are simple features, but a negative result
retains capacity ambiguity (reported honestly either way).

Actions: --build (tall-crop caches), --train (the ONE capped run).
"""
from __future__ import annotations
import argparse
import gzip
import json
import re as _re
import sys
import time
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
sys.path.insert(0, str(HERE))
from infer import build_inputs  # noqa: E402
from staff_geometry import notehead_map as _nhmap  # noqa: E402

SEED = 0
EPOCHS, BATCH, LR = 12, 256, 3e-4
W_GAPS, H_GAPS = 1.5, 6.0
TW, TH = 48, 192
CACHE_TR = "/tmp/tallcrops_train.npz"
CACHE_DV = "/tmp/tallcrops_dev.npz"
BEAM_OF_DUR = {"8": 1, "16": 2, "32": 3, "64": 4}
SUBSEED = 0
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


def tall_crop_for(img, cx, cy, gap, sx):
    hw = int(round(W_GAPS * gap * sx))
    hh = int(round(H_GAPS * gap * sx))
    x0, y0 = int(round(cx - hw)), int(round(cy - hh))
    tall = np.full((2 * hh, 2 * hw), 255, np.uint8)
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(img.shape[1], x0 + 2 * hw), min(img.shape[0], y0 + 2 * hh)
    if ix1 > ix0 and iy1 > iy0:
        tall[iy0 - y0:iy0 - y0 + (iy1 - iy0),
             ix0 - x0:ix0 - x0 + (ix1 - ix0)] = img[iy0:iy1, ix0:ix1]
    t = cv2.resize(tall, (TW, TH), interpolation=cv2.INTER_AREA)
    return t, float(t.std())


def page_ctx(sid, pg, meta, img_cache, nh_cache, svg_cache):
    key = (sid, pg)
    if key not in img_cache:
        img_cache[key] = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                                    cv2.IMREAD_GRAYSCALE)
    if pg not in nh_cache:
        svg_cache[pg] = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
        nh_cache[pg] = _nhmap(svg_cache[pg])
    img = img_cache[key]
    pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
    sx = img.shape[1] / pw
    gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"] if p["page"] == pg)
    return img, sx, gap, nh_cache[pg], svg_cache[pg]


def margin_of(svg_t):
    m = _re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg_t)
    return (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)


def build_cache(sids, path):
    """Tall crops + geometry for note/rest items; uint8 npz (mmap-friendly)."""
    TT, GG, META = [], [], []
    n_blank = 0
    img_cache, nh_cache, svg_cache = {}, {}, {}
    for n, sid in enumerate(sids):
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        items, X, S, G, _sk = build_inputs(sid, evs, meta, img_cache)
        by_id = {e["id"]: e for e in evs if e.get("id")}
        for i, it in enumerate(items):
            e = by_id.get(it["mei_id"])
            pg = int(it["page"])
            img, sx, gap, nh, svg_t = page_ctx(sid, pg, meta, img_cache,
                                              nh_cache, svg_cache)
            tx, ty = margin_of(svg_t)
            pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
            if pos:
                cx, cy = (pos[0] + tx) / 10 * sx, (pos[1] + ty) / 10 * sx
            else:
                b = e["bbox"]
                cx = (b["x"] + b["w"] / 2 + tx) / 10 * sx
                cy = (b["y"] + b["h"] / 2 + ty) / 10 * sx
            t, std = tall_crop_for(img, cx, cy, gap, sx)
            if std < 1.0:
                n_blank += 1
                continue
            TT.append(t)
            GG.append(G[i])
            META.append((sid, it["mei_id"]))
        if (n + 1) % 100 == 0:
            print(f"[tall] {n+1} scores, {len(TT)} crops", flush=True)
        if (n + 1) % 50 == 0:
            img_cache.clear()
            nh_cache.clear()
            svg_cache.clear()
    np.savez_compressed(path, T=np.stack(TT), G=np.stack(GG),
                        meta=np.array(META))
    print(f"[tall] wrote {path}: {len(TT)} crops, blank-skipped {n_blank}",
          flush=True)


class TallCNN(nn.Module):
    """Amended small config (see P4 AMENDMENT): same vertical-preserving
    family, ~0.15M params to fit shared-hardware CPU budget."""

    def __init__(self, sizes):
        super().__init__()

        def C(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1),
                                 nn.BatchNorm2d(o), nn.ReLU())
        self.feat = nn.Sequential(
            C(1, 8), C(8, 16), nn.MaxPool2d((1, 2)),
            C(16, 32), C(32, 32), nn.MaxPool2d((1, 2)),
            C(32, 32), nn.AdaptiveAvgPool2d((48, 1)), nn.Flatten())
        self.mix = nn.Sequential(nn.Linear(32 * 48 + 5, 96), nn.ReLU())
        self.heads = nn.ModuleDict(
            {h: nn.Linear(96, n) for h, n in sizes.items()})

    def forward(self, t, g):
        z = torch.cat([self.feat(t), g], dim=1)
        z = self.mix(z)
        return {h: l(z) for h, l in self.heads.items()}


_TALL = None


def load_tall():
    global _TALL
    if _TALL is None:
        p = TRAIN / "models" / "tall_rhythm.pt"
        if not p.is_file():
            return None
        ck = torch.load(p, map_location="cpu")
        m = TallCNN(ck["sizes"])
        m.load_state_dict(ck["state"])
        m.eval()
        _TALL = m
    return _TALL


def apply_tall_dur(models, sid, cevents, meta, items, pred, img_cache=None):
    """Override note items' dur/dur_sym with the T1 head (eval use). Rests
    keep the common head. Silent fallback if absent. Dur only."""
    m = load_tall()
    if m is None:
        return pred
    VOC = dur_vocab()
    try:
        items2, X, S, G, _sk = build_inputs(
            sid, cevents, meta, img_cache if img_cache is not None else {})
        if len(items2) != len(items):
            return pred
        by_id = {e["id"]: e for e in cevents if e.get("id")}
        pages, nhc, svgc = {}, {}, {}
        T, GG = [], []
        for i, it in enumerate(items):
            e = by_id.get(it["mei_id"])
            pg = int(it["page"])
            img, sx, gap, nh, svg_t = page_ctx(
                sid, pg, meta, pages if isinstance(img_cache, dict) else {},
                nhc, svgc)
            tx, ty = margin_of(svg_t)
            pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
            if pos:
                cx, cy = (pos[0] + tx) / 10 * sx, (pos[1] + ty) / 10 * sx
            else:
                b = e["bbox"]
                cx = (b["x"] + b["w"] / 2 + tx) / 10 * sx
                cy = (b["y"] + b["h"] / 2 + ty) / 10 * sx
            t, _ = tall_crop_for(img, cx, cy, gap, sx)
            T.append(t)
            GG.append(G[i])
        with torch.no_grad():
            Tt = torch.from_numpy(np.stack(T)[:, None]).float() / 255
            Gt = torch.from_numpy(np.stack(GG)).float()
            outs = []
            for b in range(0, len(Tt), 256):
                sl = slice(b, b + 256)
                outs.append(m(Tt[sl], Gt[sl])["dur"].argmax(-1).numpy())
            arg = np.concatenate(outs)
        for i in range(len(items)):
            if i in pred and pred[i].get("kind") == 1 and i < len(arg):
                pred[i]["dur"] = int(arg[i])
                pred[i]["dur_sym"] = VOC[int(arg[i])]
    except (OSError, KeyError, ValueError):
        return pred
    return pred


def sup_labels(sids):
    """Per (sid, mei_id): (dur_class, beams, start, end, tup). Quarantine
    counted. Rows only for labels inside the 16-class vocab."""
    VOC = dur_vocab()
    rows, quar = [], Counter()
    for sid in sids:
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        by_id = {e["id"]: e for e in evs if e.get("id")}
        cdr = chord_durs(sid)
        bg = {}
        for e in evs:
            if e.get("kind") == "note" and e.get("beam_id"):
                bg.setdefault(e["beam_id"], []).append(e["id"])
        bpos = {}
        for ids in bg.values():
            ids.sort(key=lambda i: ((by_id[i].get("measure_index") or 0),
                                    by_id[i].get("source_order", 0)))
            for j, i in enumerate(ids):
                bpos[i] = (1 if j == 0 else 0, 1 if j == len(ids) - 1 else 0)
        for e in evs:
            if e.get("kind") != "note":
                continue
            td, to = e.get("dur"), (e.get("dots") or 0)
            if td is None and e.get("id") in cdr:
                td, to = cdr[e["id"]]
            sym = f"{td}d{to}" if td is not None else None
            if sym not in VOC:
                quar["dur_oov"] += 1
                continue
            beams = BEAM_OF_DUR.get(td, 0) if e.get("beam_id") else 0
            st, en = bpos.get(e["id"], (0, 0))
            rows.append((sid, e["id"], VOC.index(sym), beams, st, en,
                         1 if e.get("tuplet_id") else 0))
    return rows, quar


def train():
    t0 = time.time()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(8)
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    VOC = dur_vocab()
    sizes = {"dur": len(VOC), "beams": 5, "start": 2, "end": 2, "tup": 2}
    print("[train] labeling TRAIN (frozen identities)...", flush=True)
    rows, quar = sup_labels(splits["train"])
    print(f"[train] labeled={len(rows)} quarantined={dict(quar)}", flush=True)
    # stratified subset (AMENDED rule, frozen): all beam-count-relevant rows
    # (dur 16/32/64, dotted, tuplet, beamed non-8th) + seeded samples.
    rel = [r for r in rows if (VOC[r[2]] in ("16d0", "16d1", "32d0", "64d0")
                              or VOC[r[2]][-1] != "0" or r[6] == 1
                              or (r[3] > 0 and VOC[r[2]] != "8d0"))]
    eighths = [r for r in rows if VOC[r[2]] == "8d0"]
    longv = [r for r in rows if VOC[r[2]] not in ("8d0", "8d1")
             and not VOC[r[2]].startswith("16") and not VOC[r[2]].startswith("32")
             and not VOC[r[2]].startswith("64") and VOC[r[2]][-1] == "0"
             and r[6] == 0]
    rng = np.random.default_rng(SUBSEED)

    def sample(rs, k):
        rs = list(rs)
        ii = rng.choice(len(rs), size=min(k, len(rs)), replace=False)
        return [rs[int(j)] for j in ii]

    sub = rel + sample(eighths, 7000) + sample(longv, 3000)
    print(f"[train] subset: {len(sub)} (relevant {len(rel)}, 8ths "
          f"{sum(1 for r in sub if VOC[r[2]]=='8d0')}, 4ths "
          f"{sum(1 for r in sub if VOC[r[2]]=='4d0')})", flush=True)
    print("[train] labeling DEV (frozen, eval only)...", flush=True)
    drows, dquar = sup_labels(splits["dev"])
    print(f"[train] DEV rows={len(drows)} quarantined={dict(dquar)}", flush=True)
    z = np.load(CACHE_TR, mmap_mode="r")
    Ttr, Gtr, Mtr = z["T"], z["G"], z["meta"]
    zd = np.load(CACHE_DV, mmap_mode="r")
    Tdv, Gdv, Mdv = zd["T"], zd["G"], zd["meta"]
    key_tr = {(str(s), str(i)): j for j, (s, i) in enumerate(Mtr.tolist())}
    key_dv = {(str(s), str(i)): j for j, (s, i) in enumerate(Mdv.tolist())}

    def mat(sub_rows, key, T, G):
        # T stays uint8 in RAM (550MB not 2.2GB); float conversion per batch.
        # Missing keys = un-imageable items (no bbox / blank crop): legitimately
        # out of scope (input-quality rejection precedent); counted, skipped.
        kept = [r for r in sub_rows if (r[0], r[1]) in key]
        print(f"[mat] rows {len(sub_rows)} -> kept {len(kept)} "
              f"(missing {len(sub_rows)-len(kept)})", flush=True)
        ii = [key[(r[0], r[1])] for r in kept]
        return (np.asarray(T[ii]), G[ii].astype(np.float32),
                np.array([r[2] for r in kept]),
                np.array([r[3] for r in kept]),
                np.array([r[4] for r in kept]),
                np.array([r[5] for r in kept]),
                np.array([r[6] for r in kept]))

    Xtr, Gtrm, Yd, Yb, Ys, Ye, Yt = mat(sub, key_tr, Ttr, Gtr)
    Xdv, Gdvm, Dd, Db, Ds, De, Dt = mat(drows, key_dv, Tdv, Gdv)
    print(f"[train] matrices: train {Xtr.shape} uint8, dev {Xdv.shape} uint8",
          flush=True)
    m = TallCNN(sizes)
    opt = torch.optim.AdamW(m.parameters(), lr=LR)
    Xu = torch.from_numpy(Xtr[:, None])
    Gm = torch.from_numpy(Gtrm)
    Y = {h: torch.from_numpy(Y).long() for h, Y in
         (("dur", Yd), ("beams", Yb), ("start", Ys), ("end", Ye), ("tup", Yt))}
    n = len(Xu)
    Du = torch.from_numpy(Xdv[:, None])
    Gd = torch.from_numpy(Gdvm)

    def dev_rep():
        m.eval()
        outs = []
        with torch.no_grad():
            for s in range(0, len(Du), 512):
                sl = slice(s, s + 512)
                o = m(Du[sl].float() / 255, Gd[sl])
                outs.append({h: o[h].argmax(-1).numpy() for h in sizes})
        P = {h: np.concatenate([o[h] for o in outs]) for h in sizes}
        rep = {"dur": float((P["dur"] == Dd).mean())}
        c16 = int((((Dd == VOC.index("16d0")) & (P["dur"] == VOC.index("8d0")))).sum())
        rep["c16to8"] = c16
        for h, Y in (("beams", Db), ("start", Ds), ("end", De), ("tup", Dt)):
            p = P[h]
            if h == "beams":
                rep[h] = round(float((p == Y).mean()), 4)
            else:
                tp = int(((p == 1) & (Y == 1)).sum())
                fp = int(((p == 1) & (Y == 0)).sum())
                fn = int(((p == 0) & (Y == 1)).sum())
                rep[h] = {"f1": round(2 * tp / max(1, 2 * tp + fp + fn), 4),
                          "n_pos": int((Y == 1).sum())}
        return rep

    best, best_state = -1.0, None
    for ep in range(EPOCHS):
        m.train()
        perm = torch.randperm(n, generator=torch.Generator().manual_seed(SEED + ep))
        tot, nb = 0.0, 0
        for s in range(0, n, BATCH):
            idx = perm[s:s + BATCH]
            opt.zero_grad()
            o = m(Xu[idx].float() / 255, Gm[idx])
            loss = sum(F.cross_entropy(o[h], Y[h][idx]) for h in sizes) / len(sizes)
            loss.backward()
            opt.step()
            tot += float(loss) * len(idx)
            nb += len(idx)
        rep = dev_rep()
        print(f"[train] epoch {ep+1}/{EPOCHS} loss={tot/max(1,nb):.4f} "
              f"dev={rep} t={time.time()-t0:.0f}s", flush=True)
        if rep["dur"] > best:
            best = rep["dur"]
            best_state = {k: v.cpu().clone() for k, v in m.state_dict().items()}
    m.load_state_dict(best_state)
    rep = dev_rep()
    print(f"[train] BEST dev={rep} total_time={time.time()-t0:.0f}s", flush=True)
    if rep["dur"] >= 0.858 and rep["c16to8"] <= 700:
        torch.save({"state": m.state_dict(), "sizes": sizes, "seed": SEED,
                    "epochs": EPOCHS,
                    "recipe": "T1 vertical-preserving tall-crop CNN"},
                   TRAIN / "models" / "tall_rhythm.pt")
        print("[train] GATE PASS: saved models/tall_rhythm.pt", flush=True)
    else:
        print("[train] GATE FAIL: artifact not saved", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--train", action="store_true")
    args = ap.parse_args()
    if args.build:
        splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
        build_cache(splits["train"], CACHE_TR)
        build_cache(splits["dev"], CACHE_DV)
    if args.train:
        train()
    if not (args.build or args.train):
        print(__doc__.split("Actions:")[0].strip().splitlines()[0])
