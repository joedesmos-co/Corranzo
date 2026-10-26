#!/usr/bin/env python3
"""Audit the effect of the accidental vertical-tolerance change on dense OMR."""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def truth_events(path):
    import xml.etree.ElementTree as ET
    root = ET.parse(path).getroot()
    div = 1
    out = defaultdict(list)
    for meas in root.iter("measure"):
        for att in meas.findall("attributes"):
            d = att.findtext("divisions")
            if d:
                div = max(1, int(d))
        for note in meas.iter("note"):
            if note.find("grace") is not None:
                continue
            dur = note.findtext("duration")
            if not dur:
                continue
            q = round(int(dur) / div, 3)
            dots = len(note.findall("dot"))
            if note.find("rest") is not None:
                out[meas.get("number")].append(("rest", q, dots))
                continue
            p = note.find("pitch")
            midi = 12 * (int(p.findtext("octave") or 4) + 1) + STEP[p.findtext("step")] + int(p.findtext("alter") or 0)
            out[meas.get("number")].append(("note", midi, q, dots))
    return out


def ir_events(ir):
    out = defaultdict(list)
    for n in ir["notes"]:
        out[str(n["measure"] + 1)].append(n)
    return out


def match_measure(truth_list, pred_list):
    truth_counter = Counter((m, q, d) for (_, m, q, d) in [(e[0], e[1], e[2], e[3]) for e in truth_list if e[0] == "note"])
    # truth_list entries are tuples
    tc = Counter((e[1], e[2], e[3]) for e in truth_list if e[0] == "note")
    pc = Counter((n["midi"], round(float(n["dur_q"]), 3), n["dots"]) for n in pred_list)
    matched = 0
    for k in set(tc) & set(pc):
        matched += min(tc[k], pc[k])
    return matched, tc, pc


def main():
    truth_path = Path(sys.argv[1])
    before_path = Path(sys.argv[2])
    after_path = Path(sys.argv[3])
    out_path = Path(sys.argv[4]) if len(sys.argv) > 4 else None

    truth = truth_events(truth_path)
    before_ir = json.loads(before_path.read_text())
    after_ir = json.loads(after_path.read_text())
    before = ir_events(before_ir)
    after = ir_events(after_ir)

    recovered = []
    changed_pitch = []
    new_notes = 0
    for m in sorted(truth, key=lambda x: int(x)):
        tlist = truth[m]
        before_list = before.get(m, [])
        after_list = after.get(m, [])
        before_tc = Counter((e[1], e[2], e[3]) for e in tlist if e[0] == "note")
        before_pc = Counter((n["midi"], round(float(n["dur_q"]), 3), n["dots"]) for n in before_list)
        after_pc = Counter((n["midi"], round(float(n["dur_q"]), 3), n["dots"]) for n in after_list)
        # newly matched events in this measure
        before_matched_keys = set(before_pc) & set(before_tc)
        after_tc = before_tc
        after_matched_keys = set(after_pc) & set(after_tc)
        # keys that became matched
        newly_matched = after_matched_keys - before_matched_keys
        # approximate recovered count
        for key in newly_matched:
            cnt = min(after_pc[key], after_tc[key]) - min(before_pc.get(key, 0), before_tc.get(key, 0))
            for _ in range(max(0, cnt)):
                # find an after note with this key
                cand = [n for n in after_list if (n["midi"], round(float(n["dur_q"]), 3), n["dots"]) == key]
                if cand:
                    n = cand[0]
                    recovered.append({
                        "measure": int(m),
                        "midi": n["midi"],
                        "dur_q": n["dur_q"],
                        "x": n["x"],
                        "accidental": n.get("accidental", 0),
                        "stem_x": n.get("stem_x"),
                        "stemOwnership": n.get("stemOwnership"),
                        "beam_count": n.get("beam_count"),
                        "key": key,
                    })
        # pitch changes at same x
        before_by_x = {(round(n["x"], 1), n["staff"]): n for n in before_list}
        for n in after_list:
            keyx = (round(n["x"], 1), n["staff"])
            if keyx in before_by_x:
                bn = before_by_x[keyx]
                if bn["midi"] != n["midi"]:
                    changed_pitch.append({
                        "measure": int(m),
                        "x": n["x"],
                        "before_midi": bn["midi"],
                        "after_midi": n["midi"],
                        "before_acc": bn.get("accidental", 0),
                        "after_acc": n.get("accidental", 0),
                    })
        new_notes += len(after_list) - len(before_list)

    report = {
        "before_notes": sum(len(v) for v in before.values()),
        "after_notes": sum(len(v) for v in after.values()),
        "new_note_count": new_notes,
        "recovered_events": len(recovered),
        "recovered": recovered,
        "pitch_changed_at_same_x": len(changed_pitch),
        "changed_pitch_examples": changed_pitch[:25],
    }
    text = json.dumps(report, indent=2)
    if out_path:
        out_path.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
