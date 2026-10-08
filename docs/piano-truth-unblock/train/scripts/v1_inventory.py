#!/usr/bin/env python3
"""V1 corpus inventory over frozen TRAIN/DEV only (TEST never touched).

Aggregates, per notation class:
  - TRAIN/DEV score counts, object counts (from pilot objects + metas)
  - MEI/source feature presence (tuplets nesting, navigation tokens, text)
  - mapping status from pilot per-score join reports

Output: manifests/v1_support.json
"""
from __future__ import annotations
import gzip
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"
MXL = PILOT / "data" / "mxl"

XML_TOKENS = {
    "repeat": r"<repeat[\s/>]", "segno": r"<segno[\s/>]", "coda": r"<coda[\s/>]",
    "ending": r"<ending[\s>]", "rehearsal": r"<rehearsal[\s>]", "metronome": r"<metronome[\s>]",
    "sound_tempo": r"<sound[^>]*tempo=", "wedge": r"<wedge[\s>]",
    "dynamics": r"<dynamics[\s>]", "pedal": r"<pedal[\s>]",
    "octave_shift": r"<octave-shift[\s>]", "glissando": r"<glissando[\s>]",
    "tremolo": r"<tremolo[\s>]", "arpeggiate": r"<arpeggiate[\s>]",
    "trill_mark": r"<trill-mark[\s/>]", "mordent": r"<mordent[\s/>]", "turn": r"<turn[\s/>]",
    "fingering": r"<fingering[\s>]", "tuplet": r"<tuplet[\s>]",
    "tied": r"<tied[\s>]", "slur": r"<slur[\s>]",
    "grace": r"<grace[\s>]", "cue": r"<cue[\s/>]",
    "fermata": r"<fermata[\s>]", "breath": r"<breath-mark[\s>]|<caesura[\s>]",
    "articulations": r"<articulations[\s>]", "wavy_line": r"<wavy-line[\s>]",
    "multiple_rest": r"<multiple-rest[\s>]",
}
TEXT_PATTERNS = {
    "dc": r"\bD\.?\s*C\.?", "ds": r"\bD\.?\s*S\.?", "fine": r"\bFine\b",
    "to_coda": r"\bTo Coda\b", "coda_word": r"\bCoda\b",
    "rit": r"\brit\.?(ardando)?\b", "accel": r"\baccel\.?(erando)?\b",
    "tempo_word": r"\b(Allegro|Andante|Adagio|Moderato|Presto|Largo|Vivace|Grave)\b",
}


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def mxl_text(sid):
    p = MXL / f"{sid}.mxl"
    if zipfile.is_zipfile(p):
        with zipfile.ZipFile(p) as z:
            names = [n for n in z.namelist()
                     if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF")]
            names.sort(key=lambda n: (0 if "score" in n.lower() else 1, len(n)))
            return z.read(names[0]).decode("utf-8", "replace")
    return p.read_text(encoding="utf-8", errors="replace")


def max_nesting(mei, tag):
    depth = mx = 0
    for m in re.finditer(rf"</?{tag}[\s>]", mei):
        if m.group(0)[1] == "/":
            depth -= 1
        else:
            depth += 1
            mx = max(mx, depth)
    return mx


def main():
    agg = {}
    for split in ("train", "dev"):
        sids = load_split(split)
        per = {"scores": len(sids), "objects": Counter(), "scores_with": Counter(),
               "note_attrs": Counter(), "staves": Counter(), "voices": Counter(),
               "xml_tokens": Counter(), "xml_token_scores": Counter(),
               "text_hits": Counter(), "text_hit_scores": Counter(),
               "mei_tuplet_maxdepth": 0, "mei_tags": Counter(),
               "mapping_missing": Counter(), "mapping_missing_scores": Counter(),
               "state_unresolved": 0, "state_mismatch": 0, "unrendered_mrest": 0,
               "identity_fail": 0}
        for k, sid in enumerate(sids):
            objs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
            tags = Counter(o["tag"] for o in objs)
            for t, n in tags.items():
                per["objects"][t] += n
                per["scores_with"][t] += 1
            for o in objs:
                if o["tag"] == "note":
                    for a in ("grace", "cue", "oct_ges", "accid_ges", "dots"):
                        if o.get(a):
                            per["note_attrs"][a] += 1
                    per["staves"][str(o.get("staff"))] += 1
                    per["voices"][str(o.get("voice"))] += 1
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            for t, n in (meta.get("id_join_missing_nonstate") or {}).items():
                per["mapping_missing"][t] += n
                per["mapping_missing_scores"][t] += 1
            per["state_unresolved"] += meta.get("state_unresolved", 0)
            per["state_mismatch"] += meta.get("state_mismatch", 0)
            per["unrendered_mrest"] += meta.get("unrendered_mrest", 0)
            if not (meta.get("identity") or {}).get("ok"):
                per["identity_fail"] += 1
            mei = (RENDER / sid / "score.mei").read_text()
            for t in ("tuplet", "beam", "slur", "tie", "octave", "pedal", "gliss",
                      "arpeg", "hairpin", "dynam", "tempo", "dir", "reh", "harm",
                      "ending", "mNum", "volta", "trill", "mordent", "turn",
                      "trem", "bTrem", "fTrem", "fing", "fermata", "breath",
                      "caesura", "artic", "dot", "segno", "coda"):
                n = len(re.findall(rf"<{t}[\s>]", mei))
                if n:
                    per["mei_tags"][t] += n
            per["mei_tuplet_maxdepth"] = max(per["mei_tuplet_maxdepth"], max_nesting(mei, "tuplet"))
            try:
                txt = mxl_text(sid)
            except Exception:
                continue
            for name, pat in XML_TOKENS.items():
                n = len(re.findall(pat, txt))
                if n:
                    per["xml_tokens"][name] += n
                    per["xml_token_scores"][name] += 1
            words = " ".join(re.findall(r"<words[^>]*>([^<]{0,60})</words>", txt))
            for name, pat in TEXT_PATTERNS.items():
                n = len(re.findall(pat, words))
                if n:
                    per["text_hits"][name] += n
                    per["text_hit_scores"][name] += 1
            if (k + 1) % 200 == 0:
                print(f"[inv] {split} {k+1}/{len(sids)}", file=sys.stderr, flush=True)
        for key in ("objects", "scores_with", "note_attrs", "staves", "voices",
                    "xml_tokens", "xml_token_scores", "text_hits", "text_hit_scores",
                    "mei_tags", "mapping_missing", "mapping_missing_scores"):
            per[key] = dict(sorted(per[key].items()))
        agg[split] = per
    out = TRAIN / "manifests" / "v1_support.json"
    out.write_text(json.dumps({"schema": "piano-v1-support/1", **agg}, indent=1))
    print(f"[inv] wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
