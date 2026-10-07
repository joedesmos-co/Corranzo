#!/usr/bin/env python3
"""P0 — pipeline parity check.

Runs the production module (pv_pipeline) over the same 11 scores as the
provenance proof and compares joins/counts against the committed proof summary.
This validates that the pilot pipeline is the same pipeline that was proven.

Usage:
  python3 p0_parity.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
PROOF = PILOT.parent / "proof"

sys.path.insert(0, str(HERE))
import pv_pipeline as pv  # noqa: E402


def proof_scores():
    import importlib.util
    spec = importlib.util.spec_from_file_location("rp", PROOF / "render_probe.py")
    rp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rp)
    return rp.REPO, rp.SCORES


def main():
    repo, scores = proof_scores()
    summary = {r["id"]: r for r in json.loads((PROOF / "out" / "summary.json").read_text())}
    ok_all = True
    print(f"{'id':26s} {'proof_notes':>11s} {'pilot_notes':>11s} {'join':>5s} {'state':>6s} {'identity':>8s}")
    for spec in scores:
        path = repo / spec["path"]
        tk, mei, svgs, pages = pv.render_score(path)
        records, counts, missing_ids, measure_order = pv.parse_mei(mei)
        all_ids = set()
        for svg in svgs:
            all_ids |= pv.svg_group_ids(svg)
        _, joined, missing = pv.id_join(records, all_ids)
        state = pv.state_join(tk, svgs, records, measure_order)
        identity = pv.source_identity_check(path, records, counts, measure_order)
        p = summary[spec["id"]]
        nonstate_missing = {t: n for t, n in missing.items() if t not in pv.STATE_TAGS and n}
        state_ok = all(v["rendered"] == v["matched"] + v["courtesy_matched"] + v["within_measure_matched"]
                       for v in state.values())
        row_ok = (joined["note"] == p["notes_joined"] and not nonstate_missing and state_ok)
        ok_all = ok_all and row_ok
        print(f"{spec['id']:26s} {p['notes_joined']:11d} {joined['note']:11d} "
              f"{'OK' if not nonstate_missing else 'FAIL':>5s} {'OK' if state_ok else 'FAIL':>6s} "
              f"{'OK' if identity['ok'] else 'FAIL':>8s}")
    print("PARITY:", "PASS" if ok_all else "FAIL")
    return 0 if ok_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
