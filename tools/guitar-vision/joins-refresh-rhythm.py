#!/usr/bin/env python3
"""Refresh joins.json rhythm primitives in place (additive only).

Re-joins local render.svg files with the current identity_join (which now
extracts stems/beams/dots/flags) and merges the `rhythm` record into each
existing join entry. Boxes, pages, merges, and masks are never touched.

Usage:
    python3 tools/guitar-vision/joins-refresh-rhythm.py --work <dir> [--scores a,b]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import verovio

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from render_identity import VEROVIO_OPTIONS, identity_join  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--scores", default=None)
    args = parser.parse_args()
    only = set(args.scores.split(",")) if args.scores else None
    updated, skipped = 0, 0
    for root in args.work:
        ingest = json.loads((Path(root) / "ingest-records.json").read_text())
        for record in ingest["records"]:
            if record["status"] != "PASS":
                continue
            sample = record["candidateId"]
            if only is not None and sample not in only:
                continue
            score_dir = Path(root) / sample
            joins_path = score_dir / "joins.json"
            if not joins_path.exists():
                skipped += 1
                continue
            joins = json.loads(joins_path.read_text())
            if joins.get("joins") and all(
                isinstance(entry.get("rhythm"), dict) for entry in joins["joins"].values()
            ):
                continue
            svg_path = score_dir / "render.svg"
            if not svg_path.exists():
                skipped += 1
                continue
            svg = svg_path.read_text(encoding="utf-8", errors="replace")
            stamped = (score_dir / "stamped.musicxml").read_text(encoding="utf-8", errors="replace")
            import re
            source_ids = re.findall(r'<note id="([^"]+)"', stamped)
            toolkit = verovio.toolkit()
            toolkit.setOptions(dict(VEROVIO_OPTIONS))
            toolkit.loadData(stamped)
            try:
                result = identity_join(svg, source_ids, toolkit)
            except Exception as error:  # noqa: BLE001
                print(f"SKIP {sample}: {error}")
                skipped += 1
                continue
            for sid, entry in result["joins"].items():
                if sid in joins["joins"] and isinstance(entry.get("rhythm"), dict):
                    joins["joins"][sid]["rhythm"] = entry["rhythm"]
            joins_path.write_text(json.dumps(joins, indent=1))
            updated += 1
    print(f"refreshed: {updated}, skipped: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
