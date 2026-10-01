"""Phase R - distinguish aligner bug from source mismatch.

R0 freeze the disagreement set + a matched control sample.
R1 trace the exact MusicXML event that generated each true_d.
R2 classify whether the PDF geometry (d0) is explained by the assigned event or
   by a neighbouring / chord / other-voice event.

R4 stratum by chord size and voice count, R5 measure-level morphology.

Nothing here modifies a label. It only reads the corpus and the paired
MusicXML.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402
import musicxml_truth as MT  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
LET = "CDEFGAB"


def pitch_name(d):
    return LET[d % 7] + str(d // 7)


def collect():
    """One pass over every shard: mismatches, controls, and per-measure context."""
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    rows = []
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            path = H.REALPDF_ROOT / "shards" / sh
            if not path.is_file():
                continue
            with gzip.open(path, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    ex = rec["exampleId"].split(":")
                    mi = rec["input"]["modelInput"]
                    objects = mi.get("physicalObjects", [])
                    fams = rec.get("target", {}).get("families", {}) or {}

                    def flat(name):
                        v = fams.get(name) or []
                        if isinstance(v, dict):
                            v = [v]
                        return v

                    # chord membership + same-onset grouping
                    chord_of, chord_size = {}, {}
                    for ch in flat("CHORD"):
                        mem = sorted(ch.get("objectIndexes") or [])
                        for o in mem:
                            chord_of[int(o)] = len(mem)
                            chord_size[int(o)] = len(mem)
                    onset_of = {}
                    for ch in flat("ATTACK"):
                        for o in (ch.get("objectIndexes") or []):
                            onset_of[int(o)] = ch.get("value", {}).get("onset")

                    for fam in flat("PITCH_STAFF"):
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None:
                            continue
                        oi = int(oi)
                        val = fam.get("value") or {}
                        pos = val.get("staffPosition") or {}
                        wp = val.get("writtenPitch") or {}
                        steps = pos.get("stepsFromBandCenter")
                        step, octv = wp.get("step"), wp.get("octave")
                        if steps is None or step not in DIATONIC or octv is None:
                            continue
                        role = val.get("staffRole")
                        if role not in MIDDLE:
                            continue
                        d0 = MIDDLE[role] + int(np.round(2 * float(steps)))
                        true_d = int(octv) * 7 + DIATONIC[step]
                        ev = (fam.get("semanticEventIds") or [""])[0]
                        obj = objects[oi] if oi < len(objects) else {}
                        ctr = obj.get("center", {}) or {}
                        rows.append({
                            "score": sc["score_id"],
                            "example": rec["exampleId"],
                            "page": ex[1] if len(ex) > 1 else None,
                            "system": ex[2] if len(ex) > 2 else None,
                            "measure_token": ex[3] if len(ex) > 3 else None,
                            "object_index": oi,
                            "label_id": fam.get("labelId"),
                            "event_id": ev,
                            "staff": val.get("staff"),
                            "staff_role": role,
                            "clef_sign": ((val.get("clefContext") or {}).get("value") or {}).get("sign"),
                            "clef_line": ((val.get("clefContext") or {}).get("value") or {}).get("line"),
                            "x": ctr.get("x"), "y": ctr.get("y"),
                            "k_spaces": float(steps),
                            "d0": int(d0),
                            "true_d": int(true_d),
                            "residual": int(true_d) - int(d0),
                            "xml_step": step, "xml_octave": int(octv),
                            "xml_alter": wp.get("alter"),
                            "chord_size": chord_size.get(oi, 1),
                            "onset": onset_of.get(oi),
                        })
    return rows


def xml_context():
    """Per score: measure -> band -> ordered printed events, with full identity."""
    sm = json.loads((H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())
    out = {}
    for s in sm["scores"]:
        mp = H.V26_ROOT / s["musicxml"]
        if not mp.is_file():
            continue
        rep = MT.score_report(str(mp))
        if "truth" not in rep:
            continue          # already refused by the builder (band collision)
        truth = rep["truth"]
        per = {}
        for m in truth.measures:
            mn = m.index + 1
            for band in ("upper", "lower"):
                evs = [e for e in m.events
                       if e.band == band and e.printed and not e.is_rest]
                evs.sort(key=lambda e: (e.onset, e.order))
                if evs:
                    per[(mn, band)] = evs
        out[s["id"]] = per
    return out


def classify(rows, ctx):
    """R2: explain the observed d0 with the assigned event or a neighbour."""
    tally = Counter()
    detail = []
    for r in rows:
        if r["residual"] == 0:
            continue
        m = int(r["event_id"].split("-n")[0][1:]) if "-n" in r["event_id"] else None
        n = int(r["event_id"].split("-n")[1]) if "-n" in r["event_id"] else None
        evs = ctx.get(r["score"], {}).get((m, r["staff_role"]), [])
        assigned = next((e for e in evs if e.xml_note_index == n), None)
        d0 = r["d0"]
        expl = "no_nearby_xml_event"
        alt = None
        if evs:
            idx = evs.index(assigned) if assigned in evs else None
            if assigned is not None and assigned.diatonic == d0:
                expl = "assigned_xml_note"
            else:
                sibs = [e for e in evs if abs(e.onset - assigned.onset) < 1e-9
                        and e.xml_note_index != n] if assigned else []
                if any(e.diatonic == d0 for e in sibs):
                    expl, alt = "another_note_in_same_chord", \
                        next(e for e in sibs if e.diatonic == d0)
                elif idx is not None and idx > 0 and evs[idx - 1].diatonic == d0:
                    expl, alt = "previous_event", evs[idx - 1]
                elif idx is not None and idx + 1 < len(evs) and evs[idx + 1].diatonic == d0:
                    expl, alt = "next_event", evs[idx + 1]
                elif any(e.diatonic == d0 for e in evs):
                    expl, alt = "some_other_event_in_measure", \
                        next(e for e in evs if e.diatonic == d0)
                elif assigned is not None and assigned.voice:
                    same_voice = [e for e in evs if e.voice == assigned.voice]
                    si = next((i for i, e in enumerate(same_voice)
                               if e.xml_note_index == n), None)
                    if si is not None and any(e.diatonic == d0 for e in same_voice):
                        expl, alt = "another_voice_or_voice_event", \
                            next(e for e in same_voice if e.diatonic == d0)
                    elif si is not None:
                        expl = "same_voice_neighbours_differ"
                    else:
                        expl = "assigned_event_not_found"
                else:
                    expl = "assigned_event_not_found"
        tally[expl] += 1
        detail.append({**r, "explanation": expl,
                       "alt_event": None if alt is None else
                       f"m{m}-n{alt.xml_note_index}:{pitch_name(alt.diatonic)}"})
    return tally, detail


def stratify(rows):
    """R4 + R6: rates by chord size, score, measure morphology."""
    def rate(sel_rows):
        n = len(sel_rows)
        bad = sum(1 for r in sel_rows if r["residual"] != 0)
        return n, bad, (bad / n if n else 0.0)

    out = {"by_chord_size": {}, "by_score": {}}
    for cs in sorted({r["chord_size"] for r in rows}):
        out["by_chord_size"][str(cs)] = rate([r for r in rows if r["chord_size"] == cs])
    for sc in sorted({r["score"] for r in rows}):
        out["by_score"][sc] = rate([r for r in rows if r["score"] == sc])

    # R5 measure-level morphology
    morph = Counter()
    meas = defaultdict(list)
    for r in rows:
        meas[(r["score"], r["example"], r["staff_role"])].append(r)
    for key, rs in meas.items():
        rs.sort(key=lambda r: (r["x"] if r["x"] is not None else 0))
        bad = [i for i, r in enumerate(rs) if r["residual"] != 0]
        n, nbad = len(rs), len(bad)
        if nbad == 0:
            morph["clean"] += 1
            continue
        if nbad == n:
            morph["whole_measure_all_bad"] += 1
        elif nbad == 1:
            morph["isolated_single_note"] += 1
        elif set(bad) == set(range(min(bad), max(bad) + 1)) and nbad == max(bad) - min(bad) + 1:
            morph["contiguous_block"] += 1
        elif all(rs[i]["residual"] == rs[j]["residual"] for i, j in zip(bad, bad[1:])):
            morph["uniform_sign_contiguous"] += 1
        else:
            morph["scattered"] += 1
    out["measure_morphology"] = dict(morph)
    out["measures_total"] = len(meas)
    return out


def main():
    print("R0 - collecting every PITCH_STAFF object from every shard ...")
    rows = collect()
    bad = [r for r in rows if r["residual"] != 0]
    good = [r for r in rows if r["residual"] == 0]
    print("  mismatch objects : %d" % len(bad))
    print("  exact-match      : %d" % len(good))

    print("R1/R2 - tracing the MusicXML events ...")
    ctx = xml_context()
    tally, detail = classify(bad, ctx)
    tot = sum(tally.values())
    print("  explanation of the observed PDF geometry d0:")
    for k, v in tally.most_common():
        print("    %-34s %5d  %6.4f" % (k, v, v / tot))

    strat = stratify(rows)
    print("\nR4 - mismatch rate by chord size:")
    for cs, (n, b, rt) in sorted(strat["by_chord_size"].items(), key=lambda x: int(x[0])):
        print("    chord size %-3s n=%5d bad=%4d %.4f" % (cs, n, b, rt))
    print("\nR5 - measure-level morphology (%d measure-bands):" % strat["measures_total"])
    for k, v in sorted(strat["measure_morphology"].items(), key=lambda x: -x[1]):
        print("    %-26s %4d  %6.4f" % (k, v, v / strat["measures_total"]))
    print("\nR6 - mismatch rate by score:")
    for sc, (n, b, rt) in sorted(strat["by_score"].items(), key=lambda x: -x[2]):
        print("    %-42s n=%5d bad=%4d %.4f" % (sc, n, b, rt))

    out = {"mismatch": len(bad), "exact": len(good),
           "explanations": {k: {"n": v, "share": v / tot} for k, v in tally.items()},
           "strata": {k: v for k, v in strat.items() if k != "by_score"},
           "by_score": strat["by_score"]}
    p = H.write_json("phase_r_alignment.json", out)
    H.write_json("phase_r_mismatch_rows.json", detail)
    H.write_json("phase_r_control_rows.json", good[:1500])
    print("\nwrote", p)
    print("wrote", H.OUT / "phase_r_mismatch_rows.json")


if __name__ == "__main__":
    main()