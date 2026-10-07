#!/usr/bin/env python3
"""Determinism worker: re-render one score in a fresh process and print the
canonical hashes as JSON. Used by p2_determinism.py for cross-process checks.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pv_pipeline as pv  # noqa: E402


def main():
    mxl = Path(sys.argv[1])
    tk, mei, svgs, pages = pv.render_score(mxl)
    records, counts, missing_ids, measure_order = pv.parse_mei(mei)
    all_bbox = {}
    all_ids = set()
    for pg, svg in enumerate(svgs, 1):
        for eid, bb in pv.svg_bboxes(svg).items():
            bb["page"] = pg
            all_bbox[eid] = bb
        all_ids |= pv.svg_group_ids(svg)
    objects = pv.build_objects(tk, records, svgs, all_bbox, all_ids, {})
    canonical = pv.canonical_mei(mei)
    print(json.dumps({
        "mei_sha256": pv.sha256_bytes(canonical.encode()),
        "svg_sha256": pv.sha256_bytes("".join(svgs).encode()),
        "objects_sha256": pv.sha256_bytes(json.dumps(objects, separators=(",", ":")).encode()),
        "pages": pages,
    }))


if __name__ == "__main__":
    main()
