#!/usr/bin/env python3
"""Reference-staff correspondence (EVALUATION ONLY).

The earlier key-position study assumed frames[0] == SVG staff rank 0, which
is wrong: detected frames are ordered by pixel y over the whole page while
SVG/MEI staff ranks are per-measure document order. This module matches a
detected frame to the reference staff in PIXEL space (same transform as
infer.build_inputs: (svg_y + ty)/10 * sx), so the correspondence is a
measurement, not an assumption.

STRICTLY EVALUATION-SIDE: inference must never import this module.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from staff_geometry import parse_page  # noqa: E402

MARGIN = re.compile(r'<g class="page-margin" transform="translate\('
                    r'([-0-9.]+),\s*([-0-9.]+)\)')
GLYPH_CLEF = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
              "E052": ("G", 2)}
_CLEF_CACHE = {}


def ref_staves_px(sid, pg, gray_shape):
    """[{rank, n, lines_px, clef}] for one page in PIXEL coordinates.

    rank  = document order of real 5-line staves (per measure, ranked)
    n     = MEI staff number from the merged events (measure scope)
    lines_px = 5 pixel y positions (same transform as build_inputs)
    clef  = (shape, line) from the SVG clef glyph
    """
    key = (sid, pg, gray_shape)
    if key in _CLEF_CACHE:
        return _CLEF_CACHE[key]
    svg = (PILOT / "data" / "render" / sid / f"page-{pg:02d}.svg").read_text()
    meta = json.loads((PILOT / "data" / "render" / sid / "meta.json").read_text())
    pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
    sx = gray_shape[1] / pw
    m = MARGIN.search(svg)
    tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
    out = []
    for meas in parse_page(svg):
        for st in meas["staves"]:
            if len(st["lines"]) != 5:
                continue
            lines_px = [(y + ty) / 10 * sx for y in st["lines"]]
            clef = None
            for c in meas["clefs"]:
                if c["rank"] == st["rank"] and c["glyph"] in GLYPH_CLEF:
                    clef = GLYPH_CLEF[c["glyph"]]
            out.append({"measure": meas["svg_id"], "rank": st["rank"],
                        "lines_px": lines_px, "clef": clef})
    _CLEF_CACHE[key] = out
    return out


def match_frame(frame, refs, tol_px=6.0):
    """Nearest reference staff to a detected frame's 5 lines (pixel space)."""
    best = (None, 1e18)
    for r in refs:
        d = sum(abs(a - b) for a, b in zip(frame, r["lines_px"])) / 5.0
        if d < best[1]:
            best = (r, d)
    if best[1] <= tol_px:
        return best[0], best[1]
    return None, best[1]


import json  # noqa: E402  (used above; kept late for readability)
