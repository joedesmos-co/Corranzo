#!/usr/bin/env python3
"""T1 — target adapter: verified objects -> supervised items + targets.

Reads ONLY TRAIN/DEV members of the frozen splits (TEST ids are deleted from
memory before use). Selects deterministic subsets (train100/dev20), builds
notehead/rest crops from the rendered PNGs, and encodes masked multi-head
targets. Writes crops, targets, vocabularies and a manifest.

Layouts: pilot/data/render/<sid>/{page-XX.png,meta.json}, objects .json.gz
Outputs: train/data/crops_{train100,dev20}.npz, manifests/items.json
"""
from __future__ import annotations
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"

SUBSET_SEED = "piano-trainfit-v1"
N_TRAIN, N_DEV = 100, 20
CROP, MARGIN_GAPS = 64, 3.0

STEP_BASE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
ACCID_ALTER = {"s": 1, "f": -1, "n": 0, "ss": 2, "x": 2, "ff": -2,
               "su": 0.5, "sd": -0.5, "fu": 0, "fd": 0}


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    if name == "train":
        out = list(raw["train"])
    elif name == "dev":
        out = list(raw["dev"])
    else:
        raise SystemExit("only train/dev selectable")
    del raw  # sealed TEST ids are never materialized for use
    return out


def rank(ids, tag):
    return sorted(ids, key=lambda s: hashlib.sha256(f"{SUBSET_SEED}|{tag}|{s}".encode()).hexdigest())


def midi_of(pname, octv, acc):
    alter = ACCID_ALTER.get((acc or "n").lower(), 0)
    return 12 * (int(octv) + 1) + STEP_BASE[pname.lower()] + alter


def page_transform(svg_path):
    """Page-margin translate (SVG units) mapping bbox coords to page space.

    Verovio wraps page content in <g class="page-margin"
    transform="translate(tx, ty)">; page_px = (units + t) / 10.
    """
    text = Path(svg_path).read_text()
    m = re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', text)
    if not m:
        raise ValueError(f"no page-margin transform in {svg_path}")
    return float(m.group(1)), float(m.group(2))


def main():
    train_ids = rank(load_split("train"), "train100")[:N_TRAIN]
    dev_ids = rank(load_split("dev"), "dev20")[:N_DEV]
    assert not (set(train_ids) & set(dev_ids)), "subset overlap"
    subsets = {"train100": train_ids, "dev20": dev_ids}

    voc = {"dur": [], "acc": ["none"], "voice": [], "staff": ["1", "2"]}
    # first pass: collect vocabularies from train100 only (DEV OOV -> masked)
    seen = {"dur": set(), "acc": set(), "voice": set(), "staff": set()}
    for sid in train_ids:
        objs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
        for o in objs:
            if o["tag"] in ("note", "rest", "mRest"):
                seen["staff"].add(str(o.get("staff")))
                if o.get("voice") is not None:
                    seen["voice"].add(str(o["voice"]))
                if o["tag"] == "note":
                    seen["acc"].add(str(o.get("accid_ges", "n")))
        # durations observed at note/rest level below; collect here too
    # dur vocab collected in second pass; finalize after scan:
    items_raw = {k: [] for k in subsets}
    staff_set, voice_set = set(), set()
    for subset, ids in subsets.items():
        for sid in ids:
            objs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
            for i, o in enumerate(objs):
                if o["tag"] not in ("note", "rest", "mRest"):
                    continue
                staff_set.add(str(o.get("staff")))
                if o.get("voice") is not None:
                    voice_set.add(str(o["voice"]))
                items_raw[subset].append((sid, i, o))
    voc["staff"] = sorted(staff_set)
    voc["voice"] = sorted(voice_set, key=lambda v: (len(v), v))
    # dur vocab from train items only
    durset = set()
    for sid, i, o in items_raw["train100"]:
        objs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
        oo = objs[i]
        if oo.get("dur") is not None:
            durset.add(str(oo.get("dur")) + ("d%d" % int(oo.get("dots") or 0)))
    dur_vocab = sorted(durset)
    pitch_vocab = sorted({m for m in range(21, 109)})  # full piano range, fixed

    out = {}
    img_cache = {}
    transforms = {}
    for subset, ids in subsets.items():
        X, Y, M, META, skipped = [], [], [], [], 0
        for sid, i, o in items_raw[subset]:
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            pg = int(o["bbox"]["page"])
            key = (sid, pg)
            if key not in img_cache:
                img_cache[key] = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"), cv2.IMREAD_GRAYSCALE)
            img = img_cache[key]
            tx, ty = page_transform(RENDER / sid / f"page-{pg:02d}.svg")
            transforms[f"{sid}/p{pg:02d}"] = [tx, ty]
            pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
            sx = img.shape[1] / pw  # png px per page px
            gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"] if p["page"] == pg)
            cx = (o["bbox"]["x"] + tx) / 10 * sx
            cy = (o["bbox"]["y"] + ty) / 10 * sx
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
            is_note = o["tag"] == "note"
            if o.get("dur") is None:
                dur_sym = None
            else:
                dur_sym = str(o.get("dur")) + ("d%d" % int(o.get("dots") or 0))
            pitch = midi_of(o["pname"], o["oct"], o.get("accid_ges")) if is_note else -1
            y = {
                "kind": 1 if is_note else 0,
                "pitch": pitch if is_note else -1,
                "dur": dur_vocab.index(dur_sym) if dur_sym in dur_vocab else -1,
                "dots": int(o.get("dots") or 0),
                "staff": voc["staff"].index(str(o.get("staff"))) if str(o.get("staff")) in voc["staff"] else -1,
                "acc": (["none"] + sorted({a for a in seen["acc"] if a != "n"} | {"n"})).index(str(o.get("accid_ges", "n"))) if is_note else -1,
                "grace": 1 if (is_note and o.get("grace")) else 0,
                "cue": 1 if (is_note and o.get("cue")) else 0,
                "voice": voc["voice"].index(str(o.get("voice"))) if str(o.get("voice")) in voc["voice"] else -1,
            }
            m = {
                "kind": 1, "pitch": 1 if is_note else 0,
                "dur": 1 if y["dur"] >= 0 else 0, "dots": 1,
                "staff": 1 if y["staff"] >= 0 else 0, "acc": 1 if is_note else 0,
                "grace": 1 if is_note else 0, "cue": 1 if is_note else 0,
                "voice": 1 if y["voice"] >= 0 else 0,
            }
            X.append(crop); Y.append(y); M.append(m)
            META.append({"sid": sid, "page": pg, "obj_index": i, "tag": o["tag"], "mei_id": o["mei_id"]})
        X = np.stack(X).astype(np.uint8)
        np.savez_compressed(TRAIN / "data" / f"crops_{subset}.npz", X=X,
                            **{f"y_{k}": np.array([y[k] for y in Y]) for k in Y[0]},
                            **{f"m_{k}": np.array([m[k] for m in M]) for k in M[0]})
        out[subset] = {"scores": ids, "items": len(X), "skipped": skipped, "meta": META}

    voc_full = {"dur": dur_vocab, "pitch": pitch_vocab,
                "acc": ["none"] + sorted({a for a in seen["acc"] if a != "n"} | {"n"}),
                "voice": voc["voice"], "staff": voc["staff"]}
    manifest = {"schema": "piano-trainfit-items/1", "seed": SUBSET_SEED,
                "crop": CROP, "margin_gaps": MARGIN_GAPS, "vocab": voc_full,
                "coordinate_mapping": "png_px = (svg_units + page_margin_translate) / 10 * (png_width / svg_page_width); translate parsed per page SVG",
                "page_transforms_distinct": sorted({tuple(v) for v in transforms.values()}),
                "subsets": {k: {"scores": v["scores"], "items": v["items"], "skipped": v["skipped"]} for k, v in out.items()}}
    (TRAIN / "manifests" / "items.json").write_text(json.dumps(manifest, indent=1))
    for k, v in out.items():
        Path(TRAIN / "manifests" / f"items_{k}_meta.json").write_text(json.dumps(v["meta"]))
    print(json.dumps({k: {"n_scores": len(v["scores"]), "items": v["items"], "skipped": v["skipped"]} for k, v in out.items()}, indent=1))
    print("vocab sizes:", {k: len(v) for k, v in voc_full.items()})


if __name__ == "__main__":
    (Path(__file__).resolve().parent.parent / "data").mkdir(exist_ok=True)
    main()
