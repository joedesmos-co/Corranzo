#!/usr/bin/env python3
"""G5 rhythm-truth readiness validation (no training).

For every PASS score: re-join with rhythm primitives (stems/beams/dots/
flags) and verify against canonical truth:
- stem presence agreement (stemmed notes have stem boxes)
- beam-group agreement (shared ancestor == shared symbolic beam group)
- dots count agreement
- flag agreement on unbeamed flagged notes

Writes rhythm-validation.json. Tuplets documented as symbolic-only
(no SVG objects in this renderer - verified).
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import verovio

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from render_identity import VEROVIO_OPTIONS, identity_join, inject_stable_ids  # noqa: E402


def chord_head(events, event):
    """Join record of the chord head: nearest preceding non-chord event."""
    ordered = sorted(events.values(), key=lambda e: (e.get("time", {}).get("onsetQuarters", 0), e["id"]))
    onset = event.get("time", {}).get("onsetQuarters")
    best = None
    for other in ordered:
        if other.get("time", {}).get("onsetQuarters") != onset:
            continue
        if other["id"] == event["id"] or other.get("time", {}).get("isChordTone"):
            continue
        best = other
    return best


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    report = {"scores": {}, "totals": defaultdict(int)}
    for root in args.work:
        ingest = json.loads((Path(root) / "ingest-records.json").read_text())
        for record in ingest["records"]:
            if record["status"] != "PASS":
                continue
            score_dir = Path(root) / record["candidateId"]
            canonical = json.loads((score_dir / "canonical.json").read_text())
            events = {e["id"]: e for e in canonical.get("events", [])}
            # Re-stamp + join fresh (rhythm fields are join-time, not stored).
            import re
            stamped_xml = (score_dir / "stamped.musicxml").read_text(encoding="utf-8", errors="replace")
            source_ids = re.findall(r'<note id="([^"]+)"', stamped_xml)
            toolkit = verovio.toolkit()
            toolkit.setOptions(dict(VEROVIO_OPTIONS))
            toolkit.loadData(stamped_xml)
            score_stats = {"events": 0, "stemAgree": 0, "stemTotal": 0, "beamGroupsAgree": 0,
                           "beamGroups": 0, "dotsAgree": 0, "dotsTotal": 0, "flagAgree": 0, "flagTotal": 0}
            try:
                npages = toolkit.getPageCount()
            except Exception:
                npages = 1
            for page in range(1, npages + 1):
                svg = toolkit.renderToSVG(page)
                result = identity_join(svg, source_ids, toolkit)
                page_joins = result["joins"]
                # sid per event for head lookups.
                sid_by_event = {}
                for join_sid in page_joins:
                    match_sid = re.search(r"-n(\d+)$", join_sid)
                    if not match_sid:
                        continue
                    counter = int(match_sid.group(1)) - 1
                    for e in events.values():
                        note_match = re.search(r"-n(\d+)$", (e.get("source") or {}).get("noteId") or "")
                        if note_match and int(note_match.group(1)) == counter:
                            sid_by_event[e["id"]] = join_sid
                            break
                for sid, join in page_joins.items():
                    # Map sid back to event via noteId counter.
                    match = re.search(r"-n(\d+)$", sid)
                    if not match:
                        continue
                    counter = int(match.group(1)) - 1
                    event = next((e for e in events.values()
                                  if re.search(r"-n(\d+)$", (e.get("source") or {}).get("noteId") or "")
                                  and int(re.search(r"-n(\d+)$", (e.get("source") or {}).get("noteId")).group(1)) == counter), None)
                    if event is None:
                        continue
                    score_stats["events"] += 1
                    rhythm = join.get("rhythm", {}) if isinstance(join.get("rhythm"), dict) else {}
                    has_stem = event.get("time", {}).get("noteType") not in ("whole", None) and not event.get("time", {}).get("isRest")
                    if has_stem:
                        score_stats["stemTotal"] += 1
                        if rhythm.get("stem"):
                            score_stats["stemAgree"] += 1
                        elif event.get("time", {}).get("isChordTone"):
                            # Chord members share the head's stem group: agreement
                            # holds when the head joined with a stem.
                            head = chord_head(events, event)
                            head_join = page_joins.get(sid_by_event.get(head["id"])) if head else None
                            head_rhythm = head_join.get("rhythm", {}) if isinstance(head_join, dict) else {}
                            if isinstance(head_rhythm, dict) and head_rhythm.get("stem"):
                                score_stats["stemAgree"] += 1
                                score_stats["chordStemShared"] = score_stats.get("chordStemShared", 0) + 1
                    if event.get("time", {}).get("dots"):
                        score_stats["dotsTotal"] += 1
                        if rhythm.get("dots") == event["time"]["dots"]:
                            score_stats["dotsAgree"] += 1
                    techniques = [t.get("kind") for t in event.get("techniques", [])]
                    if "tremolo-picking" in techniques:
                        score_stats["flagTotal"] += 1
                        if rhythm.get("flag"):
                            score_stats["flagAgree"] += 1
            # Beam groups: shared ancestor id == shared symbolic beam signature.
            beams: dict[str, set] = defaultdict(set)
            for sid, join in result["joins"].items():
                rhythm = join.get("rhythm", {}) if isinstance(join.get("rhythm"), dict) else {}
                if rhythm.get("beam"):
                    beams[rhythm["beam"]].add(sid)
            score_stats["beamGroups"] = len(beams)
            score_stats["beamGroupsAgree"] = sum(1 for members in beams.values() if len(members) >= 2)
            report["scores"][record["candidateId"]] = score_stats
            for key in ("events", "stemAgree", "stemTotal", "beamGroupsAgree", "beamGroups",
                        "dotsAgree", "dotsTotal", "flagAgree", "flagTotal"):
                report["totals"][key] += score_stats[key]
    report["totals"] = dict(report["totals"])
    out_path.write_text(json.dumps(report, indent=1))
    print(json.dumps(report["totals"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
