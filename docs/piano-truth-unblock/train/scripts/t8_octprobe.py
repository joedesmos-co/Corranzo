#!/usr/bin/env python3
"""Octave-shift diagnostic: pitch accuracy of the saved probe on
octave-shifted notes from TRAIN scores never seen in training.

TRAIN split only; TEST sealed. Diagnostic, not a benchmark.
"""
from __future__ import annotations
import gzip
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"
sys.path.insert(0, str(HERE))
from t5_fit import Probe  # noqa: E402
from t1_adapter import midi_of, page_transform  # noqa: E402

STEP = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def main():
    scores = json.load(open(TRAIN / "manifests" / "oct_probe_scores.json"))
    ckpt = torch.load(TRAIN / "models" / "probe_normal.pt", map_location="cpu")
    model = Probe(ckpt["sizes"])
    model.load_state_dict(ckpt["state"])
    model.eval()
    n = ok = ok_src = 0
    with torch.no_grad():
        for sid in scores:
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            objs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
            img_cache = {}
            for o in objs:
                if o["tag"] != "note" or not o.get("oct_ges"):
                    continue
                pg = int(o["bbox"]["page"])
                if (sid, pg) not in img_cache:
                    img_cache[(sid, pg)] = cv2.imread(
                        str(RENDER / sid / f"page-{pg:02d}.png"), cv2.IMREAD_GRAYSCALE)
                img = img_cache[(sid, pg)]
                pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
                gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"] if p["page"] == pg)
                sx = img.shape[1] / pw
                tx, ty = page_transform(RENDER / sid / f"page-{pg:02d}.svg")
                b = o["bbox"]
                cx, cy = (b["x"] + tx) / 10 * sx, (b["y"] + ty) / 10 * sx
                half = int(round(3.0 * gap * sx))
                x0, y0 = int(cx - half), int(cy - half)
                crop = np.zeros((2 * half, 2 * half), np.uint8)
                ix0, iy0 = max(0, x0), max(0, y0)
                ix1, iy1 = min(img.shape[1], x0 + 2 * half), min(img.shape[0], y0 + 2 * half)
                if ix1 <= ix0 or iy1 <= iy0:
                    continue
                crop[iy0 - y0:iy0 - y0 + (iy1 - iy0), ix0 - x0:ix0 - x0 + (ix1 - ix0)] = img[iy0:iy1, ix0:ix1]
                crop = cv2.resize(crop, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
                logits = model(torch.from_numpy(crop[None, None]))["pitch"]
                pred_midi = int(logits.argmax(-1)) + 21
                printed = midi_of(o["pname"], o["oct"], o.get("accid_ges"))
                sourced = midi_of(o["pname"], o["oct_ges"], o.get("accid_ges"))
                n += 1
                ok += (pred_midi == printed)
                ok_src += (pred_midi == sourced)
    print(json.dumps({"oct_shifted_notes": n, "pitch_printed_acc": round(ok / max(1, n), 4),
                      "pitch_source_oct_acc": round(ok_src / max(1, n), 4)}))


if __name__ == "__main__":
    main()
