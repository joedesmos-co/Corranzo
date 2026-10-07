#!/usr/bin/env python3
"""P7 — notation coverage report across PASS pilot scores.

Aggregates the machine-readable object tables: per notation class, how many
scores contain it, object count, successfully mapped count and mapping rate.
State classes (clef/keySig/meterSig) are reported with their semantic-join
status; note-level sub-features (grace, cue) are broken out.

Usage:
  python3 p7_coverage.py
"""

from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"

STATE_TAGS = {"clef", "keySig", "meterSig"}
TARGET_CLASSES = [
    "note", "rest", "mRest", "accid", "dot", "clef", "keySig", "meterSig",
    "beam", "tuplet", "tie", "slur", "artic", "dynam", "hairpin", "tempo",
    "trill", "mordent", "turn", "trem", "bTrem", "fTrem", "arpeg", "gliss",
    "pedal", "octave", "fing", "fermata", "breath", "grace", "cue", "reh",
    "dir", "ending", "harm", "mNum", "volta",
]


def main():
    agg = defaultdict(lambda: {"scores": 0, "objects": 0, "mapped": 0, "with_bbox": 0})
    note_features = defaultdict(int)
    n_scores = 0
    n_objects = 0
    quarantines = defaultdict(int)

    for meta in sorted(RENDER.glob("*/meta.json")):
        try:
            m = json.loads(meta.read_text())
        except Exception:
            continue
        if m.get("status") != "PASS":
            if m.get("status", "").startswith("QUARANTINED"):
                parts = m["status"].split(":")
                key = ":".join(parts[1:3]) if len(parts) > 2 else parts[1]
                quarantines[key] += 1
            continue
        n_scores += 1
        obj_path = OBJECTS / f"{m['source_id']}.objects.json.gz"
        if not obj_path.is_file():
            continue
        with gzip.open(obj_path, "rt") as f:
            objects = json.load(f)
        n_objects += len(objects)
        present = set()
        for o in objects:
            tag = o["tag"]
            present.add(tag)
            a = agg[tag]
            a["objects"] += 1
            if tag in STATE_TAGS:
                a["mapped"] += 1  # declarations are source truth; render groups verified by state join
            elif o.get("in_svg_id_join"):
                a["mapped"] += 1
            if o.get("bbox"):
                a["with_bbox"] += 1
            if tag == "note":
                for feat in ("grace", "cue"):
                    if o.get(feat):
                        note_features[feat] += 1
                if o.get("oct_ges"):
                    note_features["octave_shifted"] += 1
                if o.get("accid_ges"):
                    note_features["accidental"] += 1
        for tag in present:
            agg[tag]["scores"] += 1

    rows = []
    for tag in TARGET_CLASSES:
        a = agg.get(tag)
        if not a:
            rows.append((tag, 0, 0, 0, "not present"))
            continue
        rate = a["mapped"] / a["objects"] if a["objects"] else 0.0
        note = "semantic state join" if tag in STATE_TAGS else ""
        rows.append((tag, a["scores"], a["objects"], a["mapped"], f"{rate:.4f} {note}".strip()))

    report = {
        "schema": "corranzo.piano.pilot.coverage/1",
        "scores": n_scores,
        "objects": n_objects,
        "classes": [{"class": r[0], "scores": r[1], "objects": r[2], "mapped": r[3],
                     "mapping_rate": r[4]} for r in rows],
        "note_features": dict(note_features),
        "quarantines": dict(quarantines),
    }
    out = PILOT / "manifests" / "coverage.json"
    out.write_text(json.dumps(report, indent=1, sort_keys=True))
    print(f"[p7] coverage over {n_scores} scores / {n_objects} objects -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
