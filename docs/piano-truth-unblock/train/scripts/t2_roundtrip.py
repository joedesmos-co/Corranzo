#!/usr/bin/env python3
"""T2 — semantic round-trip: truth -> target encode -> decode -> truth.

Decodes every item in both npz files and compares against the source objects,
per tag and per class. Fails loudly on collisions, out-of-vocab leakage, or
mask errors. Report: manifests/roundtrip.json.
"""
from __future__ import annotations
import gzip
import json
from collections import Counter
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
STEP_BASE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
ACCID_ALTER = {"s": 1, "f": -1, "n": 0, "ss": 2, "x": 2, "ff": -2,
               "su": 0.5, "sd": -0.5, "fu": 0, "fd": 0}


def midi_of(pname, octv, acc):
    return 12 * (int(octv) + 1) + STEP_BASE[pname.lower()] + ACCID_ALTER.get((acc or "n").lower(), 0)


def main():
    man = json.loads((TRAIN / "manifests" / "items.json").read_text())
    voc = man["vocab"]
    fails = Counter()
    totals = Counter()
    checked = 0
    for subset in ("train100", "dev20"):
        d = np.load(TRAIN / "data" / f"crops_{subset}.npz")
        meta = json.load(open(TRAIN / "manifests" / f"items_{subset}_meta.json"))
        assert len(d["X"]) == len(meta)
        for j, mi in enumerate(meta):
            objs = json.load(gzip.open(
                TRAIN.parent / "pilot" / "data" / "objects" / f"{mi['sid']}.objects.json.gz", "rt"))
            o = objs[mi["obj_index"]]
            is_note = o["tag"] == "note"
            totals[o["tag"]] += 1
            ok = True
            ok &= (int(d["y_kind"][j]) == (1 if is_note else 0))
            if is_note:
                ok &= (int(d["y_pitch"][j]) == midi_of(o["pname"], o["oct"], o.get("accid_ges")))
                ok &= bool(int(d["m_pitch"][j]))
                dsym = str(o.get("dur")) + ("d%d" % int(o.get("dots") or 0)) if o.get("dur") is not None else None
                if dsym is None:
                    ok &= (int(d["y_dur"][j]) == -1 and int(d["m_dur"][j]) == 0)
                else:
                    ok &= (voc["dur"][int(d["y_dur"][j])] == dsym if int(d["y_dur"][j]) >= 0 else int(d["m_dur"][j]) == 0)
                ok &= (int(d["y_grace"][j]) == (1 if o.get("grace") else 0))
                ok &= (int(d["y_cue"][j]) == (1 if o.get("cue") else 0))
                ok &= (voc["acc"][int(d["y_acc"][j])] == str(o.get("accid_ges", "n")))
            else:
                ok &= (int(d["m_pitch"][j]) == 0 and int(d["m_acc"][j]) == 0
                       and int(d["m_grace"][j]) == 0 and int(d["m_cue"][j]) == 0)
                if o.get("dur") is not None:
                    dsym = str(o.get("dur")) + ("d%d" % int(o.get("dots") or 0))
                    ok &= (voc["dur"][int(d["y_dur"][j])] == dsym if int(d["y_dur"][j]) >= 0 else int(d["m_dur"][j]) == 0)
            ok &= (int(d["y_dots"][j]) == int(o.get("dots") or 0))
            ok &= (voc["staff"][int(d["y_staff"][j])] == str(o.get("staff")) if int(d["y_staff"][j]) >= 0 else int(d["m_staff"][j]) == 0)
            if o.get("voice") is not None and str(o.get("voice")) in voc["voice"]:
                ok &= (voc["voice"][int(d["y_voice"][j])] == str(o.get("voice")))
            checked += 1
            if not ok:
                fails[o["tag"]] += 1
    # vocab injectivity
    for k, v in voc.items():
        if len(set(map(str, v))) != len(v):
            fails[f"vocab-collision:{k}"] += 1
    out = {"checked": checked, "failures": dict(fails), "totals": dict(totals),
           "verdict": "PASS" if not fails else "FAIL"}
    (TRAIN / "manifests" / "roundtrip.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
