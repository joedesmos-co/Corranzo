#!/usr/bin/env python3
"""P1 duration root-cause audit (DEV only, read-only, no training).

Joins cached frozen-common predictions with truth note fields to separate
duration errors into: isolated value errors, beam-group effects, unbeamed
flag interpretation, dots (post-arbitration residual), tuplets, chord
membership, voice context, meter context, and onset-propagation reach
(measures downstream of the first lane error). TEST sealed.
Writes reports/audit_duration.json.
"""
from __future__ import annotations
import gzip
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
EVENTS = TRAIN / "data" / "events"
DECODED = TRAIN / "data" / "decoded"


def split_sym(s):
    if s and "d" in s:
        b, d = s.split("d")
        return b, int(d)
    return s, 0


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    tot = 0
    err = 0
    by = {k: Counter() for k in (
        "confusion", "err_by_beam", "err_by_tuplet", "err_by_chord",
        "err_by_voice", "err_by_meter", "err_by_dots", "err_by_beampos")}
    beam_group_members = 0
    beam_group_uniform_err = 0  # member wrong while group truth uniform
    lane_first_err_downstream_measures = Counter()
    measures_with_err = set()
    measures_total = set()
    err_notes_in_measures = Counter()
    # per-lane onset reach: lanes keyed (sid, measure?, staff, voice) — decoder
    # lanes are per (measure, staff, voice); error poisons downstream in lane
    for sid in splits["dev"]:
        ce = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        cache = json.load(open(DECODED / f"{sid}.preds.json"))
        pred = {int(k): v for k, v in cache["pred"].items()}
        truth = {e["id"]: e for e in ce if e.get("kind") == "note"}
        # chord dur inheritance (same rule as eval_reconstruction: MEI <chord>
        # dur/dots by xml:id for members without own dur)
        import xml.etree.ElementTree as _ET
        _NS = "{http://www.music-encoding.org/ns/mei}"
        _XID = "{http://www.w3.org/XML/1998/namespace}id"
        chord_of = {}
        try:
            _root = _ET.parse(PILOT / "data" / "render" / sid / "score.mei").getroot()
            for _el in _root.iter(_NS + "chord"):
                for _n in _el.iter(_NS + "note"):
                    if _n.get(_XID):
                        chord_of[_n.get(_XID)] = (
                            _el.get("dur"), int(_el.get("dots") or 0))
        except (OSError, _ET.ParseError):
            pass
        items = cache["items"]
        # truth beam groups for position labels
        bgroups = {}
        for e in ce:
            if e.get("kind") == "note" and e.get("beam_id"):
                bgroups.setdefault(e["beam_id"], []).append(e["id"])
        bpos = {}
        for b, ids in bgroups.items():
            ids.sort(key=lambda i: (truth[i].get("measure_index", 0),
                                    truth[i].get("source_order", 0)))
            for j, i in enumerate(ids):
                bpos[i] = ("first" if j == 0
                           else ("last" if j == len(ids) - 1 else "interior"))
        lanes = {}
        for i, it in enumerate(items):
            t = truth.get(it.get("mei_id"))
            if t is None:
                continue
            td, to = t.get("dur"), (t.get("dots") or 0)
            if td is None and t.get("id") in chord_of:
                td, to = chord_of[t["id"]]
            if td is None:
                continue
            tot += 1
            p = pred.get(i, {}) or {}
            pb, pd = split_sym(p.get("dur_sym"))
            # td/to already carry chord-inherited values from above; do NOT
            # re-read raw t['dur'] here (chord members have dur None).
            measures_total.add((sid, t.get("measure")))
            ok = (pb == td and pd == to)
            in_beam = bool(t.get("beam_id"))
            is_tup = bool(t.get("tuplet_id"))
            in_chord = t.get("chord_id") is not None
            meter = json.dumps(t.get("meter") or {})
            key = (t.get("measure_index"), str(t.get("staff")), str(t.get("voice")))
            lanes.setdefault(key, []).append(
                (t.get("source_order", 0), ok, t.get("measure")))
            if ok:
                continue
            err += 1
            by["confusion"][((td, to), (pb, pd))] += 1
            by["err_by_beam"]["beamed" if in_beam else "unbeamed"] += 1
            by["err_by_tuplet"]["tuplet" if is_tup else "plain"] += 1
            by["err_by_chord"]["chord" if in_chord else "single"] += 1
            by["err_by_voice"][str(t.get("voice"))] += 1
            by["err_by_meter"][meter] += 1
            by["err_by_dots"]["dots" if (to != pd) else "base"] += 1
            by["err_by_beampos"][bpos.get(t["id"], "unbeamed")] += 1
            measures_with_err.add((sid, t.get("measure")))
            err_notes_in_measures[(sid, t.get("measure"))] += 1
            if in_beam:
                beam_group_members += 1
                grp = bgroups[t["beam_id"]]
                tdurs = {(truth[g]["dur"], truth[g].get("dots") or 0)
                         for g in grp if g in truth}
                if len(tdurs) == 1:
                    beam_group_uniform_err += 1
        for key, lst in lanes.items():
            lst.sort()
            first = next((j for j, (_, ok, _) in enumerate(lst) if not ok), None)
            if first is not None:
                # lane clock wrong from here on: count lane positions affected
                lane_first_err_downstream_measures[(len(lst) - first)] += 1
    out = {
        "notes": tot, "dur_errors": err,
        "agree": round((tot - err) / max(1, tot), 4),
        "confusion_top15": [[list(k), v]
                            for k, v in by["confusion"].most_common(15)],
        "err_by_beam": dict(by["err_by_beam"]),
        "err_by_tuplet": dict(by["err_by_tuplet"]),
        "err_by_chord": dict(by["err_by_chord"]),
        "err_by_voice": dict(by["err_by_voice"]),
        "err_by_meter_top8": dict(by["err_by_meter"].most_common(8)),
        "err_by_dots": dict(by["err_by_dots"]),
        "err_by_beampos": dict(by["err_by_beampos"]),
        "beam_member_errors_in_uniform_truth_groups": beam_group_uniform_err,
        "beam_member_errors_total": beam_group_members,
        "measures_total": len(measures_total),
        "measures_with_dur_error": len(measures_with_err),
        "err_notes_per_affected_measure": round(
            sum(err_notes_in_measures.values()) / max(1, len(err_notes_in_measures)), 2),
        "lane_error_reach_dist": dict(sorted(lane_first_err_downstream_measures.items())),
    }
    (TRAIN / "reports" / "audit_duration.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1)[:3000])


if __name__ == "__main__":
    main()
