#!/usr/bin/env python3
"""Shared inference for the three frozen probes over oracle boxes.

Replicates scripts/v1_adapter.py preprocessing EXACTLY (corner-anchored
64x64 crops, 256x48 strips, 5-dim geometry, uint8->/255) and runs the
frozen best checkpoints. Combination rule (documented in MODEL_AUDIT.md):

  kind/pitch/dur/dots/acc -> common        staff/voice -> context
  grace/cue + 16 binary flags -> membership

Stage B oracle inputs: boxes + page/measure/staff/clef/key structure.
Never consumes truth labels. Sealed TEST sets are never touched; DEV only
via load_split("dev") which refuses any other split.
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
import torch

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
MODELS = TRAIN / "models"

sys.path.insert(0, str(HERE))
from v1_probe import LocalModel, ContextModel  # noqa: E402

CROP, MARGIN_GAPS = 64, 3.0
STRIP_W, STRIP_H, STRIP_GAPS = 256, 48, 8.0

COMBINE = {"kind": "common", "pitch": "common", "dur": "common",
           "dots": "common", "acc": "common", "staff": "context",
           "voice": "context", "grace": "membership", "cue": "membership",
           "in_beam": "membership", "tie_start": "membership",
           "tie_end": "membership", "slur_member": "membership",
           "tuplet_member": "membership", "has_artic": "membership",
           "has_ornament": "membership", "has_fingering": "membership",
           "arpeg_member": "membership", "gliss_member": "membership",
           "pedal_active": "membership", "octave_shifted": "membership",
           "hairpin_member": "membership", "chord_tone": "membership",
           "dotted": "membership", "accidental": "membership"}

CKPTS = {"common": MODELS / "full_common_normal_best.pt",
         "membership": MODELS / "full_membership_normal_best.pt",
         "context": MODELS / "full_context_normal_best.pt"}


def load_dev_sids():
    s = json.loads((PILOT / "manifests" / "splits.json").read_text())
    assert set(s) >= {"dev"}, "splits file malformed"
    return list(s["dev"])


def load_models(device="cpu"):
    models = {}
    for probe, path in CKPTS.items():
        if not path.is_file():
            raise FileNotFoundError(f"missing checkpoint {path}")
        c = torch.load(path, map_location=device)
        cls = ContextModel if probe == "context" else LocalModel
        m = cls(c["sizes"])
        m.load_state_dict(c["state"])
        m.eval()
        models[probe] = (m, c)
    return models


def build_inputs(sid, evs, meta, img_cache):
    """Replicates v1_adapter preprocessing exactly. Returns dict of arrays
    aligned with `items` = [(event_index, kind)] for note/rest objects, plus
    a `skipped` list of (event_index, kind, mei_id, reason) for objects that
    could not be imaged. Skipped objects are REJECTED (never hallucinated):
    downstream stages must account for them, not invent content for them.
    Blank-crop rule: a 64x64 uint8 crop with std < 1.0 is essentially uniform
    (no staff lines, no glyph) and therefore unreadable. Real crops always
    contain staff lines within the 3-gap margin, so this has no effect on
    readable renders (verified: zero occurrences on DEV)."""
    items, crops, strips, geos, skipped = [], [], [], [], []
    for j, e in enumerate(evs):
        if e["kind"] not in ("note", "rest", "mRest", "multiRest"):
            continue
        if not e.get("bbox"):
            skipped.append({"event": j, "kind": e["kind"], "mei_id": e["id"],
                            "reason": "no_bbox"})
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
        svg_t = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
        tm = re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg_t)
        tx, ty = (float(tm.group(1)), float(tm.group(2))) if tm else (0.0, 0.0)
        b = e["bbox"]
        cx = (b["x"] + tx) / 10 * sx
        cy = (b["y"] + ty) / 10 * sx
        gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"] if p["page"] == pg)
        half = int(round(MARGIN_GAPS * gap * sx))
        x0, y0 = int(round(cx - half)), int(round(cy - half))
        crop = np.zeros((2 * half, 2 * half), np.uint8)
        ix0, iy0 = max(0, x0), max(0, y0)
        ix1, iy1 = min(img.shape[1], x0 + 2 * half), min(img.shape[0], y0 + 2 * half)
        if ix1 <= ix0 or iy1 <= iy0:
            skipped.append({"event": j, "kind": e["kind"], "mei_id": e["id"],
                            "reason": "degenerate_crop"})
            continue
        crop[iy0 - y0:iy0 - y0 + (iy1 - iy0), ix0 - x0:ix0 - x0 + (ix1 - ix0)] = img[iy0:iy1, ix0:ix1]
        crop = cv2.resize(crop, (CROP, CROP), interpolation=cv2.INTER_AREA)
        if float(crop.std()) < 1.0:
            skipped.append({"event": j, "kind": e["kind"], "mei_id": e["id"],
                            "reason": "blank_crop"})
            continue
        sh = int(round(STRIP_GAPS * gap * sx))
        sy0, sy1 = int(round(cy - sh / 2)), int(round(cy + sh / 2))
        band = np.full((max(1, min(img.shape[0], sy1) - max(0, sy0)), img.shape[1]), 255, np.uint8)
        gy0, gy1 = max(0, sy0), min(img.shape[0], sy1)
        if gy1 > gy0:
            band[:gy1 - gy0, :] = img[gy0:gy1, :]
        strip = cv2.resize(band, (128, 24), interpolation=cv2.INTER_AREA)
        # NOTE: 128x24 is the model input size (see load_items); the
        # manifest strip:[256,48] documents the band definition.
        crops.append(crop)
        strips.append(strip)
        geos.append([(b["x"] + b["w"] / 2 + tx) / 10 / pw,
                     (b["y"] + b["h"] / 2 + ty) / 10 / ph,
                     (b["w"] / 10) / pw, (b["h"] / 10) / ph,
                     cy / img.shape[0]])
        items.append({"event": j, "kind": e["kind"], "mei_id": e["id"],
                      "page": pg, "measure": e.get("measure"),
                      "measure_index": e.get("measure_index"),
                      "staff_truth": e.get("staff"), "voice_truth": e.get("voice")})
    if not items:
        return items, None, None, None, skipped
    X = np.stack(crops).astype(np.uint8)
    S = np.stack(strips).astype(np.uint8)
    G = np.array(geos, np.float32)
    return items, X, S, G, skipped


def predict_score(models, sid, evs, meta, img_cache, batch=1024):
    """Run all three probes; return (items, combined argmax predictions, skipped)."""
    items, X, S, G, skipped = build_inputs(sid, evs, meta, img_cache)
    if not items:
        return items, {}, skipped
    Xt = torch.from_numpy(X[:, None]).float() / 255
    St = torch.from_numpy(S[:, None]).float() / 255
    Gt = torch.from_numpy(G)
    raw = {}
    with torch.no_grad():
        for probe, (model, ckpt) in models.items():
            outs = {}
            for start in range(0, len(Xt), batch):
                sl = slice(start, start + batch)
                lg = model(Xt[sl], St[sl], Gt[sl])
                for h, t in lg.items():
                    outs.setdefault(h, []).append(t.argmax(-1).numpy())
            raw[probe] = {h: np.concatenate(v) for h, v in outs.items()}
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    pred = {}
    for i in range(len(items)):
        p = {"_probe_source": {}}
        for head, probe in COMBINE.items():
            v = int(raw[probe][head][i])
            p[head] = v
            p["_probe_source"][head] = probe
        # both voice sources (P4 comparison); decode selects per voice_source
        p["voice_context"] = int(raw["context"]["voice"][i])
        p["voice_common"] = int(raw["common"]["voice"][i])
        # decode categorical heads to values for convenience
        p["pitch_midi"] = 21 + p["pitch"]
        p["dur_sym"] = voc["dur"][p["dur"]] if 0 <= p["dur"] < len(voc["dur"]) else None
        p["staff_id"] = voc["staff"][p["staff"]] if 0 <= p["staff"] < len(voc["staff"]) else None
        p["voice_id"] = voc["voice"][p["voice_context"]] if 0 <= p["voice_context"] < len(voc["voice"]) else None
        p["voice_id_common"] = voc["voice"][p["voice_common"]] if 0 <= p["voice_common"] < len(voc["voice"]) else None
        p["acc_cls"] = ["none", "f", "ff", "n", "s", "ss"][p["acc"]] if 0 <= p["acc"] < 6 else None
        pred[i] = p
    return items, pred, skipped


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--sids", nargs="*", default=None)
    ap.add_argument("--outdir", default=str(TRAIN / "data" / "decoded"))
    args = ap.parse_args()
    sids = args.sids or load_dev_sids()
    models = load_models()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    img_cache = {}
    for n, sid in enumerate(sids):
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        items, pred, skipped = predict_score(models, sid, evs, meta, img_cache)
        (outdir / f"{sid}.preds.json").write_text(json.dumps(
            {"sid": sid, "items": items, "skipped": skipped,
             "pred": {str(k): v for k, v in pred.items()}}))
        if (n + 1) % 20 == 0:
            print(f"[infer] {n+1}/{len(sids)}", flush=True)
    print(f"[infer] wrote {len(sids)} prediction files to {outdir}", flush=True)


if __name__ == "__main__":
    main()
