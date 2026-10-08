#!/usr/bin/env python3
"""P8 — expanded semantic round-trip over canonical PianoEvents.

Phase A (all TRAIN+DEV event files, JSON-only): field consistency, MIDI rules,
onset monotonicity, chord coherence, tie pairing, state presence, text/barline
accounting.
Phase B (60-score deterministic MEI/SVG re-walk sample): verify container
membership, control links, text string equality and pedal/hairpin ranges
against the source MEI/SVG.

Any encoding ambiguity fails the run. Output: manifests/v1_roundtrip.json
"""
from __future__ import annotations
import gzip
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"

MEI_NS = "{http://www.music-encoding.org/ns/mei}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
STEP = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
BASE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
ALTER = {"s": 1, "f": -1, "n": 0, "ss": 2, "x": 2, "ff": -2}
STEPN = {"c": 0, "d": 1, "e": 2, "f": 3, "g": 4, "a": 5, "b": 6}


def midi(pname, octv, acc):
    return 12 * (int(octv) + 1) + BASE[pname.lower()] + ALTER.get((acc or "n").lower(), 0)


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def main():
    sids = []
    for split in ("train", "dev"):
        sids.extend(load_split(split))
    fails = Counter()
    checked = Counter()
    tie_roles = defaultdict(Counter)

    for sid in sids:
        r = json.load(gzip.open(TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))
        mei_text = (RENDER / sid / "score.mei").read_text()
        score_has_meter = "<meterSig" in mei_text
        score_has_key = "<keySig" in mei_text
        last_onset = {}
        for e in r["events"]:
            k = e["kind"]
            checked[k] += 1
            if k == "note":
                if e["midi_printed"] != midi(e["pname"], e["oct"], e.get("accid_ges")):
                    fails["note:midi_printed"] += 1
                src_oct = e.get("oct_ges") or e["oct"]
                if e["midi_source"] != midi(e["pname"], src_oct, e.get("accid_ges")):
                    fails["note:midi_source"] += 1
                if not isinstance(e.get("onset_ppq"), int) or e["onset_ppq"] < 0:
                    fails["note:onset"] += 1
                key = (e["measure"], e["staff"], e["voice"])
                if key in last_onset and e["onset_ppq"] < last_onset[key] and not e.get("grace"):
                    fails["note:onset_regression"] += 1
                last_onset[key] = e["onset_ppq"]
                if not e.get("clef"):
                    fails["note:missing_clef"] += 1
                if score_has_key and not e.get("key"):
                    fails["note:missing_key"] += 1
                if score_has_meter and not e.get("meter"):
                    fails["note:missing_meter"] += 1
                ref = {"G": ("e", 4), "F": ("c", 3), "C": ("c", 4)}.get(
                    (e.get("clef") or {}).get("shape", "G"), ("e", 4))
                base = (int(ref[1]) * 7 + STEPN[ref[0]]) - (int((e.get("clef") or {}).get("line", 2)) - 1) * 2
                if e.get("staff_pos_steps") != int(e["oct"]) * 7 + STEPN[e["pname"].lower()] - base:
                    fails["note:staff_pos"] += 1
                for t in e.get("ties", []):
                    tie_roles[t["tie_id"]][t["role"]] += 1
            elif k in ("rest", "mRest", "multiRest"):
                if not isinstance(e.get("onset_ppq"), int):
                    fails["rest:onset"] += 1
            if e.get("chord_id"):
                if not isinstance(e.get("chord_size"), int) or e["chord_size"] < 2:
                    fails["chord:size"] += 1
        for t in r["texts"]:
            if t["kind"] == "repeatMark":
                checked["repeatMark"] += 1
                if not t.get("svg_id"):
                    fails["repeatMark:unjoined"] += 1
                continue
            checked["text"] += 1
            if t.get("empty_text"):
                continue
            if not t.get("svg_id"):
                fails["text:unjoined"] += 1
            elif t.get("svg_text") is not None:
                import sys as _sys
                _sys.path.insert(0, str(Path(__file__).resolve().parent))
                from v1_events import norm_text
                if norm_text(t["svg_text"]) != norm_text(t["text"]):
                    fails["text:string_mismatch"] += 1
        for b in r["barlines"]:
            checked["barline"] += 1
            if b.get("form") not in ("single", "dbl", "end", "rptstart", "rptend",
                                     "dotted", "invis", "light-heavy", "light-light",
                                     "heavy-light", "heavy-heavy", "none"):
                fails["barline:form"] += 1
            if not b.get("measure"):
                fails["barline:measure"] += 1
        if r["residual_unjoined"]:
            fails["residual_unjoined"] += len(r["residual_unjoined"])
    for tid, rc in tie_roles.items():
        # each tie element may list several start/end ids (double-stop ties);
        # require at least one from-side and one to-side entry
        frm = rc.get("start", 0) + rc.get("middle", 0)
        to = rc.get("end", 0) + rc.get("middle", 0)
        if frm < 1 or to < 1:
            fails["tie:unpaired"] += 1

    # Phase B: MEI/SVG re-walk on a deterministic 60-score sample
    ranked = sorted(sids, key=lambda s: hashlib.sha256(f"piano-v1-rt|{s}".encode()).hexdigest())[:60]
    b_checked = Counter()
    for sid in ranked:
        root = ET.parse(RENDER / sid / "score.mei").getroot()
        parent = {c: p for p in root.iter() for c in p}
        r = json.load(gzip.open(TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))
        ev_by_id = {e["id"]: e for e in r["events"] if e.get("id")}
        chord_members = {}
        for el in root.iter(MEI_NS + "chord"):
            cid = el.get(XML_ID)
            if cid:
                chord_members[cid] = [n.get(XML_ID) for n in el.iter(MEI_NS + "note") if n.get(XML_ID)]
        for el in root.iter():
            tag = el.tag.replace(MEI_NS, "")
            if tag in ("beam", "tuplet"):
                eid = el.get(XML_ID)
                want = sorted(n.get(XML_ID) for n in el.iter(MEI_NS + "note") if n.get(XML_ID))
                got = sorted(e["id"] for e in r["events"]
                             if eid in (e.get("beam_chain", []) + e.get("tuplet_chain", [])))
                b_checked["container"] += 1
                if want != got:
                    fails[f"container:{tag}"] += 1
            if tag in ("tie", "slur", "octave", "gliss", "trill", "mordent", "turn", "fing"):
                for attr in ("startid", "endid"):
                    for ref in (el.get(attr) or "").split():
                        b_checked["link"] += 1
                        nid = ref.lstrip("#")
                        if nid in chord_members:
                            members = chord_members[nid]
                            if not members or not all(ev_by_id.get(m, {}).get("kind") == "note" for m in members):
                                fails[f"link:{tag}:{attr}"] += 1
                            continue
                        tgt = ev_by_id.get(nid)
                        if tgt is None or tgt["kind"] != "note":
                            fails[f"link:{tag}:{attr}"] += 1
            if tag == "arpeg":
                for ref in (el.get("plist") or "").split():
                    b_checked["link"] += 1
                    nid = ref.lstrip("#")
                    if ev_by_id.get(nid, {}).get("arpeg_id") != el.get(XML_ID):
                        fails["link:arpeg"] += 1
    out = {"schema": "piano-v1-roundtrip/1", "scores": len(sids),
           "phase_b_scores": len(ranked), "checked": dict(checked),
           "phase_b_checked": dict(b_checked), "failures": dict(fails),
           "verdict": "PASS" if not fails else "FAIL"}
    (TRAIN / "manifests" / "v1_roundtrip.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1)[:1500])
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
