#!/usr/bin/env python3
"""P3 — expanded target adapter: canonical PianoEvents -> supervised items.

Covers the V1 vocabulary with per-event heads (common + membership + context)
and the fixed rare-class strategy:
  1. unbiased train100 for common heads,
  2. targeted trainRare supplementation (deterministic feature search, TRAIN only),
  3. sqrt inverse-frequency loss weights from train items only.

Inputs are crops + system strips + geometry; strips are sliced on the fly from
page PNGs by stored band coordinates.

Outputs: train/data/v1_{train100,trainRare,dev20}.npz + manifests/v1_items.json
"""
from __future__ import annotations
import gzip
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"

CROP, MARGIN_GAPS = 64, 3.0
STRIP_W, STRIP_H, STRIP_GAPS = 256, 48, 8.0
SUBSET_SEED = "piano-v1-items"

HEADS_CAT = ["kind", "pitch", "dur", "dots", "staff", "acc", "voice"]
HEADS_BIN = ["grace", "cue", "in_beam", "tie_start", "tie_end", "slur_member",
             "tuplet_member", "has_artic", "has_ornament", "has_fingering",
             "arpeg_member", "gliss_member", "pedal_active", "octave_shifted",
             "hairpin_member", "chord_tone", "dotted", "accidental"]
HEADS = HEADS_CAT + HEADS_BIN

RARE_FEATURES = ["grace", "cue", "oct_ges", "arpeg", "gliss", "ornament",
                 "fingering", "pedal", "hairpin", "ending", "repeat",
                 "tuplet", "tie", "slur"]


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def rank(ids, tag):
    return sorted(ids, key=lambda s: hashlib.sha256(f"{SUBSET_SEED}|{tag}|{s}".encode()).hexdigest())


def has_feature(ev, feat):
    if feat == "grace":
        return bool(ev.get("grace"))
    if feat == "cue":
        return bool(ev.get("cue"))
    if feat == "oct_ges":
        return bool(ev.get("oct_ges"))
    if feat == "arpeg":
        return bool(ev.get("arpeg_id"))
    if feat == "gliss":
        return bool(ev.get("links_out")) and any(l["rel"] == "gliss" for l in ev["links_out"])
    if feat == "ornament":
        return bool(ev.get("ornament"))
    if feat == "fingering":
        return bool(ev.get("fingering"))
    if feat == "pedal":
        return bool(ev.get("pedal_active"))
    if feat == "hairpin":
        return bool(ev.get("hairpin_id"))
    if feat == "ending":
        return False
    if feat == "repeat":
        return False
    if feat == "tuplet":
        return bool(ev.get("tuplet_id"))
    if feat == "tie":
        return bool(ev.get("ties"))
    if feat == "slur":
        return bool(ev.get("links_out")) and any(l["rel"] == "slur" for l in ev["links_out"])
    return False


def main():
    validated = json.loads((TRAIN / "manifests" / "items.json").read_text())
    train_ids = validated["subsets"]["train100"]["scores"]
    dev_ids = validated["subsets"]["dev20"]["scores"]
    assert len(train_ids) == 100 and len(dev_ids) == 20
    # NOTE: event files must exist (v1_events.py over TRAIN+DEV first)
    train100, dev20 = train_ids, dev_ids
    # targeted rare supplementation searches the FULL train split (TRAIN only)
    full_train = load_split("train")
    feat_scores = {f: [] for f in RARE_FEATURES}
    for sid in full_train:
        p = EVENTS / f"{sid}.events.json.gz"
        if not p.is_file():
            continue
        evs = json.load(gzip.open(p, "rt"))["events"]
        feats = {f for f in RARE_FEATURES if any(has_feature(e, f) for e in evs if e["kind"] == "note")}
        for f in feats:
            feat_scores[f].append(sid)
    rare = set()
    for f, sids in feat_scores.items():
        rare.update(rank(sids, f"rare-{f}")[:4])
    train_rare = sorted(rare - set(train100))
    print(f"[adapter] trainRare: {len(train_rare)} scores", file=sys.stderr)

    voc = {"dur": [], "pitch": list(range(21, 109)), "acc": ["none", "f", "ff", "n", "s", "ss"],
           "voice": [], "staff": []}
    durset, voiceset, staffset = set(), set(), set()
    for sid in full_train:
        for e in json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]:
            if e["kind"] in ("note", "rest"):
                if e.get("dur") is not None:
                    durset.add(str(e["dur"]) + "d%d" % int(e.get("dots") or 0))
                if e.get("voice") is not None:
                    voiceset.add(str(e["voice"]))
                if e.get("staff") is not None:
                    staffset.add(str(e["staff"]))
    voc["dur"] = sorted(durset)
    voc["voice"] = sorted(voiceset, key=lambda v: (len(v), v))
    voc["staff"] = sorted(staffset, key=lambda v: (len(v), v))

    subsets = {"train100": train100, "trainRare": train_rare, "dev20": dev20,
               "trainFull": sorted(full_train)}
    out = {}
    img_cache, meta_cache = {}, {}
    for subset, ids in subsets.items():
        X, Y, M, G, META, skipped = [], [], [], [], [], 0
        for sid in ids:
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            meta_cache[sid] = meta
            for j, e in enumerate(evs):
                if e["kind"] not in ("note", "rest", "mRest", "multiRest"):
                    continue
                if not e.get("bbox"):
                    skipped += 1
                    continue
                pg = int(e["bbox"]["page"])
                key = (sid, pg)
                if key not in img_cache:
                    img_cache[key] = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                                               cv2.IMREAD_GRAYSCALE)
                img = img_cache[key]
                pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
                ph = next(p["height"] for p in meta["page_geometry"] if p["page"] == pg)
                sx = img.shape[1] / pw
                import re as _re
                svg_t = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
                tm = _re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg_t)
                tx, ty = (float(tm.group(1)), float(tm.group(2))) if tm else (0.0, 0.0)
                b = e["bbox"]
                # Corner-anchored framing (bbox top-left), matching the validated
                # probe recipe. Centered framing was tried and inexplicably failed
                # to support learning (see COMPREHENSIVE_PROBE.md); the validated
                # framing is proven, so it is adopted here.
                cx = (b["x"] + tx) / 10 * sx
                cy = (b["y"] + ty) / 10 * sx
                gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"] if p["page"] == pg)
                half = int(round(MARGIN_GAPS * gap * sx))
                x0, y0 = int(round(cx - half)), int(round(cy - half))
                crop = np.zeros((2 * half, 2 * half), np.uint8)
                ix0, iy0 = max(0, x0), max(0, y0)
                ix1, iy1 = min(img.shape[1], x0 + 2 * half), min(img.shape[0], y0 + 2 * half)
                if ix1 <= ix0 or iy1 <= iy0:
                    skipped += 1
                    continue
                crop[iy0 - y0:iy0 - y0 + (iy1 - iy0), ix0 - x0:ix0 - x0 + (ix1 - ix0)] = img[iy0:iy1, ix0:ix1]
                crop = cv2.resize(crop, (CROP, CROP), interpolation=cv2.INTER_AREA)
                is_note = e["kind"] == "note"
                dur_sym = (str(e["dur"]) + "d%d" % int(e.get("dots") or 0)) if e.get("dur") is not None else None
                links_out = {l["rel"] for l in e.get("links_out", [])}
                ties = e.get("ties", [])
                y = {
                    "kind": 1 if is_note else 0,
                    "pitch": (e["midi_printed"] - 21) if is_note else -1,
                    "dur": voc["dur"].index(dur_sym) if dur_sym in voc["dur"] else -1,
                    "dots": int(e.get("dots") or 0),
                    "staff": voc["staff"].index(str(e.get("staff"))) if str(e.get("staff")) in voc["staff"] else -1,
                    "acc": (["none", "f", "ff", "n", "s", "ss"].index(str(e.get("accid_ges") or "n")) if is_note else -1),
                    "voice": voc["voice"].index(str(e.get("voice"))) if str(e.get("voice")) in voc["voice"] else -1,
                    "grace": 1 if (is_note and e.get("grace")) else 0,
                    "cue": 1 if (is_note and e.get("cue")) else 0,
                    "in_beam": 1 if e.get("beam_id") else 0,
                    "tie_start": 1 if any(t.get("role") in ("start", "middle") for t in ties) else 0,
                    "tie_end": 1 if any(t.get("role") in ("end", "middle") for t in ties) else 0,
                    "slur_member": 1 if "slur" in links_out else 0,
                    "tuplet_member": 1 if e.get("tuplet_id") else 0,
                    "has_artic": 1 if e.get("artic") else 0,
                    "has_ornament": 1 if e.get("ornament") else 0,
                    "has_fingering": 1 if e.get("fingering") else 0,
                    "arpeg_member": 1 if e.get("arpeg_id") else 0,
                    "gliss_member": 1 if "gliss" in links_out else 0,
                    "pedal_active": 1 if e.get("pedal_active") else 0,
                    "octave_shifted": 1 if e.get("oct_ges") else 0,
                    "hairpin_member": 1 if e.get("hairpin_id") else 0,
                    "chord_tone": 1 if (e.get("chord_size") or 1) > 1 else 0,
                    "dotted": 1 if int(e.get("dots") or 0) > 0 else 0,
                    "accidental": 1 if e.get("accid_ges") else 0,
                }
                m = {"kind": 1, "pitch": 1 if is_note else 0,
                     "dur": 1 if y["dur"] >= 0 else 0, "dots": 1,
                     "staff": 1 if y["staff"] >= 0 else 0,
                     "acc": 1 if is_note else 0,
                     "voice": 1 if y["voice"] >= 0 else 0}
                for h in HEADS_BIN:
                    m[h] = 1 if is_note else 0
                X.append(crop); Y.append(y); M.append(m)
                G.append([(b["x"] + b["w"] / 2 + tx) / 10 / pw,
                          (b["y"] + b["h"] / 2 + ty) / 10 / ph,
                          (b["w"] / 10) / pw, (b["h"] / 10) / ph,
                          cy / img.shape[0]])
                # strip band: full width x 8 staff gaps around event center
                sh = int(round(STRIP_GAPS * gap * sx))
                META.append({"sid": sid, "page": pg, "event": j, "kind": e["kind"],
                             "mei_id": e["id"], "strip_y0": int(round(cy - sh / 2)),
                             "strip_y1": int(round(cy + sh / 2))})
        X = np.stack(X).astype(np.uint8)
        np.savez_compressed(TRAIN / "data" / f"v1_{subset}.npz", X=X, G=np.array(G, np.float32),
                            **{f"y_{k}": np.array([y[k] for y in Y]) for k in Y[0]},
                            **{f"m_{k}": np.array([m[k] for m in M]) for k in M[0]})
        out[subset] = {"scores": ids, "items": len(X), "skipped": skipped, "meta": META}

    # fixed loss weights from train items only (sqrt inverse frequency)
    weights = {}
    for h in HEADS_BIN + ["kind"]:
        arr = np.concatenate([np.load(TRAIN / "data" / f"v1_{s}.npz")[f"y_{h}"]
                              for s in ("train100", "trainRare")])
        msk = np.concatenate([np.load(TRAIN / "data" / f"v1_{s}.npz")[f"m_{h}"]
                              for s in ("train100", "trainRare")])
        v = arr[msk > 0.5]
        p = float((v == 1).mean()) if len(v) else 0.5
        weights[h] = {"pos_rate": p, "pos_weight": round(float((1 - p) ** 0.5 / max(p, 1e-6) ** 0.5), 3)}
    man = {"schema": "piano-v1-items/1", "seed": SUBSET_SEED, "crop": CROP,
           "margin_gaps": MARGIN_GAPS, "strip": [STRIP_W, STRIP_H, STRIP_GAPS],
           "heads": HEADS, "vocab": voc, "loss_weights": weights,
           "coordinate_mapping": "png = (svg_units + page_margin_translate)/10 * (png_w/svg_page_w); crops corner-anchored on bbox top-left (validated recipe)",
           "subsets": {k: {"scores": v["scores"], "items": v["items"], "skipped": v["skipped"]}
                       for k, v in out.items()}}
    (TRAIN / "manifests" / "v1_items.json").write_text(json.dumps(man, indent=1))
    for k, v in out.items():
        Path(TRAIN / "manifests" / f"v1_items_{k}_meta.json").write_text(json.dumps(v["meta"]))
    print(json.dumps({k: {"scores": len(v["scores"]), "items": v["items"]} for k, v in out.items()}, indent=1))


if __name__ == "__main__":
    main()
