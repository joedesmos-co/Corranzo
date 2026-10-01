"""Phase R - monotone pairing feasibility, reproducing the aligner's EXACT inputs.

The first attempt of this test sorted events by (onset, order) and therefore
measured a different ordering from the one `align_band` uses. The aligner sees

    events = [e for e in truth_measure.events if e.printed and e.band == band]
    pitched = [e for e in events if not e.is_rest]        # XML DOCUMENT order

and objects in canonical (printed) index order. Monotonicity only means anything
with respect to those exact sequences, so this version rebuilds them the same
way.

The test, per printed (measure, band):

  * `obj_seq`      - d0 of every labelled notehead, in printed index order
  * `assigned_seq` - true_d of every event the corpus actually paired to, in the
                     aligner's own document order

  The current pairing is monotone in both, so it achieves `correct` agreements.
  LCS(obj_seq, assigned_seq) >= correct by construction. Therefore:

    LCS == n        -> a zero-residual monotone pairing EXISTS and the aligner
                       picked a worse one                      ALIGNER BUG
    LCS == correct  -> the aligner is already OPTIMAL; no monotone pairing can
                       do better                              INHERENT
    LCS  > correct  -> the current pairing is not monotone at all
                       ORDERING BUG

Nothing here modifies a label.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402
import musicxml_truth as MT  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
LET = "CDEFGAB"


def pitch_name(d):
    return LET[d % 7] + str(d // 7)


def lcs_len(a, b):
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b):
            cur.append(prev[j] + 1 if x == y else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1]


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}

    truth_by_score = {}
    for sid, s in sm.items():
        mp = H.V26_ROOT / s["musicxml"]
        if not mp.is_file():
            continue
        rep = MT.score_report(str(mp))
        if "truth" in rep:
            truth_by_score[sid] = rep["truth"]

    groups = defaultdict(list)
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            path = H.REALPDF_ROOT / "shards" / sh
            if not path.is_file():
                continue
            with gzip.open(path, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None:
                            continue
                        val = fam.get("value") or {}
                        pos = val.get("staffPosition") or {}
                        wp = val.get("writtenPitch") or {}
                        if (pos.get("stepsFromBandCenter") is None
                                or wp.get("step") not in DIATONIC
                                or wp.get("octave") is None):
                            continue
                        role = val.get("staffRole")
                        if role not in MIDDLE:
                            continue
                        d0 = MIDDLE[role] + int(round(2 * float(pos["stepsFromBandCenter"])))
                        true_d = int(wp["octave"]) * 7 + DIATONIC[wp["step"]]
                        groups[(sc["score_id"], rec["exampleId"], role)].append(
                            {"oi": int(oi), "d0": d0, "true_d": true_d,
                             "event": (fam.get("semanticEventIds") or [""])[0]})

    verdicts = Counter()
    per_score = defaultdict(Counter)
    bad_by_verdict = Counter()
    rows_out = []
    total_bad = total_obj = 0

    for (score, example, band), rs in sorted(groups.items()):
        rs.sort(key=lambda r: r["oi"])                      # printed index order
        n = len(rs)
        obj_seq = [r["d0"] for r in rs]
        assigned_seq = [r["true_d"] for r in rs]
        correct = sum(1 for a, b in zip(obj_seq, assigned_seq) if a == b)
        bad = n - correct
        total_bad += bad
        total_obj += n

        # rebuild the aligner's own event order and re-index the assigned events
        note_ids = [int(r["event"].split("-n")[1]) for r in rs if "-n" in r["event"]]
        mnum = int(rs[0]["event"].split("-n")[0][1:]) if "-n" in rs[0]["event"] else None
        truth = truth_by_score.get(score)
        xml_seq = None
        if truth is not None and mnum is not None and 0 <= mnum - 1 < len(truth.measures):
            tm = truth.measures[mnum - 1]
            pitched = [e for e in tm.events if e.printed and e.band == band and not e.is_rest]
            xml_seq = [e.diatonic for e in pitched]
            pos = {e.xml_note_index: k for k, e in enumerate(pitched)}
            missing = [n_ for n_ in note_ids if n_ not in pos]
            if missing:
                xml_seq = None
            else:
                monotone = all(pos[note_ids[i]] < pos[note_ids[i + 1]]
                               for i in range(len(note_ids) - 1))

        if bad == 0:
            v = "already_exact"
        elif xml_seq is None:
            v = "event_order_unavailable"
        else:
            best = lcs_len(obj_seq, xml_seq)
            if best >= n:
                v = "PERFECT_PAIRING_EXISTS"
            elif best == correct:
                v = "ALIGNER_ALREADY_OPTIMAL"
            elif best > correct:
                v = "ORDERING_NOT_MONOTONE"
            else:
                v = "IMPOSSIBLE_UNDER_MONOTONE"

        verdicts[v] += 1
        per_score[score][v] += 1
        bad_by_verdict[v] += bad
        if bad and v != "ALIGNER_ALREADY_OPTIMAL":
            rows_out.append({"score": score, "example": example, "band": band,
                             "n": n, "bad": bad, "correct": correct, "verdict": v,
                             "obj_seq": [pitch_name(x) for x in obj_seq],
                             "assigned_seq": [pitch_name(x) for x in assigned_seq],
                             "xml_seq": None if xml_seq is None
                             else [pitch_name(x) for x in xml_seq]})

    tot = sum(verdicts.values())
    print("=== monotone pairing feasibility (aligner's exact event order) ===")
    print("  printed measure-bands: %d   objects %d   mismatched %d (%.4f)"
          % (tot, total_obj, total_bad, total_bad / max(1, total_obj)))
    for k, v in verdicts.most_common():
        print("    %-30s groups=%4d %6.4f   mismatched objects=%5d (%6.4f of mismatches)"
              % (k, v, v / tot, bad_by_verdict[k],
                 bad_by_verdict[k] / max(1, total_bad)))

    aligner_bad = bad_by_verdict["PERFECT_PAIRING_EXISTS"] + bad_by_verdict["ORDERING_NOT_MONOTONE"]
    print("\n  attributable to the aligner's choice : %d (%.4f)"
          % (aligner_bad, aligner_bad / max(1, total_bad)))
    print("  inherent to monotone pairing         : %d (%.4f)"
          % (bad_by_verdict["ALIGNER_ALREADY_OPTIMAL"],
             bad_by_verdict["ALIGNER_ALREADY_OPTIMAL"] / max(1, total_bad)))

    print("\n=== per-score (groups: exact / perfect / optimal / impossible) ===")
    for sc in sorted(per_score, key=lambda s: -sum(per_score[s].values())):
        c = per_score[sc]
        bad = sum(v for k, v in per_score[sc].items())
        print("  %-42s exact=%4d optimal=%4d non_monotone=%3d  (bad_obj=%4d)"
              % (sc, c["already_exact"], c["ALIGNER_ALREADY_OPTIMAL"],
                 c["ORDERING_NOT_MONOTONE"],
                 sum(g["bad"] for g in rows_out if g["score"] == sc)))

    out = {"groups": tot, "objects": total_obj, "mismatched": total_bad,
           "verdicts": {k: {"groups": v, "mismatched_objects": bad_by_verdict[k]}
                        for k, v in verdicts.items()},
           "aligner_attributable": aligner_bad,
           "by_score": {s: dict(c) for s, c in per_score.items()}}
    print("\nwrote", H.write_json("phase_r_feasibility.json", out))
    H.write_json("phase_r_feasibility_cases.json", rows_out)


if __name__ == "__main__":
    main()