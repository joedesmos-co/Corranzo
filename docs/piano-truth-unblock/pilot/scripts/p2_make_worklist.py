#!/usr/bin/env python3
"""P2 helper — build the raster worklist from PASS render outputs.

Writes data/render/raster_worklist.json (svg -> png) for pages missing PNGs.

Usage:
  python3 p2_make_worklist.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"


def main():
    items = []
    scores = 0
    for meta in sorted(RENDER.glob("*/meta.json")):
        try:
            m = json.loads(meta.read_text())
        except Exception:
            continue
        if m.get("status") != "PASS":
            continue
        scores += 1
        sid = m["source_id"]
        for svg in sorted(meta.parent.glob("page-*.svg")):
            items.append({"svg": str(svg), "png": str(svg.with_suffix(".png")),
                          "source_id": sid})
    out = RENDER / "raster_worklist.json"
    out.write_text(json.dumps(items, indent=0))
    print(f"[worklist] {len(items)} pages from {scores} PASS scores -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
