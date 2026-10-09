#!/usr/bin/env python3
"""Per-clef production pitch accuracy (DEV only, no training).

New E-clef head (visual clef input) + visual-clef repair -> decoded midis,
scored against truth pitch by truth clef shape. Fully automatic path
(oracle boxes + pixels + structure; no note labels). TEST sealed.
Writes reports/clef_split.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
sys.path.insert(0, str(HERE))
from infer import load_models, build_inputs  # noqa: E402
from decode_score import decode_score  # noqa: E402
from to_musicxml import build_structure  # noqa: E402
from train_clefhead import load_clef_head, clefvec, apply_clef_pitch_head  # noqa: E402

DEV_SIDS = json.loads((PILOT / "manifests" / "splits.json").read_text())["dev"]


def main():
    models = load_models(device="cpu")
    img_cache = {}
    hit = Counter()
    tot = Counter()
    for n, sid in enumerate(DEV_SIDS):
        cevents = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        cache = json.load(open(TRAIN / "data" / "decoded" / f"{sid}.preds.json"))
        items = cache["items"]
        pred = {int(k): v for k, v in cache["pred"].items()}
        pred = apply_clef_pitch_head(models, sid, cevents, meta, items, pred, img_cache)
        structure = build_structure(sid)
        dec = decode_score(sid, items, pred, structure, voice_source="context",
                           clef_source="visual")
        truth = {e["id"]: e for e in cevents if e.get("id")}
        for e in dec["notes"]:
            t = truth.get(e["mei_id"])
            if t is None or t.get("midi_printed") is None:
                continue
            sh = (t.get("clef") or {}).get("shape", "?")
            tot[sh] += 1
            hit[sh] += (e["midi"] == t["midi_printed"])
        if (n + 1) % 25 == 0:
            print(f"[clef-split] {n+1}/{len(DEV_SIDS)}", flush=True)
    out = {sh: {"n": tot[sh], "acc": round(hit[sh] / max(1, tot[sh]), 4)}
           for sh in sorted(tot)}
    out["overall"] = {"n": sum(tot.values()),
                      "acc": round(sum(hit.values()) / max(1, sum(tot.values())), 4)}
    Path(TRAIN / "reports" / "clef_split.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
