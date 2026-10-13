#!/usr/bin/env python3
"""Build per-source per-class clef templates (render + independent scan).

Source A: Verovio render clef instances (SMuFL glyph labels, TRAIN).
Source B: OLiMPiC scanned frames with the sample's own MusicXML clef as
supervision - TRAIN-side samples only; the first 10 samples (verification)
are excluded.
Output: models/clef_templates2.npz with keys render_{G,F,C}, scan_{G,F,C}
(per-source mean NCC templates). clef_detect scores each class by the max
over sources, so neither source's font dominates.
"""
from __future__ import annotations
import json
import re as _re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
sys.path.insert(0, str(HERE))
from clef_variants import collect_render, collect_scan  # noqa: E402


def main():
    all_dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    verify_dirs = all_dirs[:10]
    train_dirs = all_dirs[10:]
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    scan_rows = collect_scan(train_dirs)
    render_rows = collect_render(splits)
    print("[tpl2] render:", Counter(k for k, _ in render_rows),
          "scan:", Counter(k for k, _ in scan_rows), flush=True)
    out = {}
    for src, rows in (("render", render_rows), ("scan", scan_rows)):
        for cls in ("G", "F", "C"):
            xs = [c for k, c in rows if k == cls]
            if xs:
                out[f"{src}_{cls}"] = np.mean(xs, axis=0)
    np.savez_compressed(TRAIN / "models" / "clef_templates2.npz", **out)
    print("[tpl2] saved", sorted(out), flush=True)
    # sanity: self-classification accuracy on the training crops
    C = Counter()
    for src, rows in (("render", render_rows), ("scan", scan_rows)):
        for cls, cr in rows:
            best = (None, -9.0)
            for k in out:
                c2 = k.split("_", 1)[1]
                v = float((cr * out[k]).sum())
                if v > best[1]:
                    best = (c2, v)
            C[src + "_n"] += 1
            C[src + "_ok" + ("1" if best[0] == cls else "0")] += 1
    for src in ("render", "scan"):
        n = C[src + "_n"]
        ok = C[src + "_ok1"]
        print(f"[tpl2] train self-acc {src}: {ok}/{n} = {ok/max(1,n):.4f}")


if __name__ == "__main__":
    main()
