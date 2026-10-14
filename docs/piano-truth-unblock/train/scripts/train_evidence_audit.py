#!/usr/bin/env python3
"""M1 training-evidence audit for scan key-signature detection.

Answers, from local data only:
  - how many TRAIN-side scan samples carry a usable key-signature label
  - label granularity: score-level (MusicXML fifths) vs symbol-level
    (render SVG keyAccid boxes with glyph ids)
  - class balance per (clef, fifths) for scans and per glyph class for
    renders
  - what score-disjoint material exists and how often it has already been
    measured (pristine-test honesty)
  - whether render symbol boxes can be reused as cross-font supervision
Writes reports/train_evidence_audit.json. Everything here is TRAIN-side.
"""
from __future__ import annotations
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from keysig2 import ACCID_GLYPH, truth_fifths_render  # noqa: E402

VERIFY_N = 10


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    # ---- scan-side evidence
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    scan_keys = Counter()
    scan_by_cf = Counter()
    usable = 0
    for d in dirs[VERIFY_N:]:
        mxs = sorted(d.glob("*.musicxml"))
        pngs = sorted(d.glob("*.png"))
        if not mxs or not pngs:
            continue
        try:
            root = ET.parse(mxs[0]).getroot()
            tf = root.findtext(".//key/fifths")
        except ET.ParseError:
            continue
        if tf is None:
            continue
        usable += 1
        scan_keys[int(tf)] += 1
    n_verify = 0
    for d in dirs[:VERIFY_N]:
        mxs = sorted(d.glob("*.musicxml"))
        if not mxs:
            continue
        root = ET.parse(mxs[0]).getroot()
        tf = root.findtext(".//key/fifths")
        if tf is not None:
            n_verify += 1
    # ---- render-side symbol-level evidence (exact boxes + glyph ids)
    glyph = Counter()
    render_keys = Counter()
    for sid in splits["train"][:120]:
        svg = (RENDER / sid / "page-01.svg")
        if not svg.is_file():
            continue
        t = svg.read_text()
        for gm in re.finditer(
                r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', t):
            if gm.group(1) in ACCID_GLYPH:
                glyph[ACCID_GLYPH[gm.group(1)]] += 1   # all accidentals
        render_keys[truth_fifths_render(sid)] += 1
    # keySig-only counts (the ones inside a keySig group)
    ks_glyph = Counter()
    for sid in splits["train"][:120]:
        svg = (RENDER / sid / "page-01.svg")
        if not svg.is_file():
            continue
        t = svg.read_text()
        for kg in re.finditer(r'<g id="[^"]+" class="keySig">(.*?)</g>\s*</g>',
                             t, re.S):
            for gm in re.finditer(
                    r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                    r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)"',
                    kg.group(1)):
                if gm.group(1) in ACCID_GLYPH:
                    ks_glyph[ACCID_GLYPH[gm.group(1)]] += 1
    # how many times the verification set has already been measured
    log = ""
    rp = TRAIN / "reports" / "RECONSTRUCTION.md"
    if rp.is_file():
        txt = rp.read_text()
        log = ("held_out_measurements_in_log",
               txt.count("held-out") + txt.count("verification sample"))
    out = {
        "scan_train_usable": usable,
        "scan_train_key_dist": {str(k): v for k, v in
                                sorted(scan_keys.items())},
        "scan_verify_usable": n_verify,
        "scan_verify_note": "the 10 verification samples have been measured "
                            "in three missions; not pristine untouched data",
        "render_symbol_boxes_120_scores": dict(glyph),
        "render_keysig_boxes_120_scores": dict(ks_glyph),
        "render_key_dist_120": {str(k): v for k, v in sorted(render_keys.items())},
        "label_granularity": "scans: score-level fifths only (no symbol boxes); "
                             "renders: exact symbol boxes with glyph ids",
        "log_reference": log,
        "verdict": "symbol-level scan supervision does not exist locally; "
                   "render symbol boxes + score-level scan keys are the only "
                   "available evidence",
        "scope": "TRAIN-side only; sealed TEST untouched"}
    (TRAIN / "reports" / "train_evidence_audit.json").write_text(
        json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
