#!/usr/bin/env python3
"""A3. Source-side structural sequence for one measure.

Built ONLY from the pitch-blind rhythm skeleton. Never reads written pitch, MIDI,
corpus pitch labels, residuals or decoder output. The `cy` of a PDF component is
never available here, so no vertical comparison is even expressible.
"""
from __future__ import annotations

DUR_CLASS = {
    "maxima": "long", "long": "long", "breve": "long",
    "whole": "whole", "w": "whole",
    "half": "half", "h": "half", "minim": "half",
    "quarter": "quarter", "q": "quarter", "crotchet": "quarter",
    "eighth": "eighth", "e": "eighth", "quaver": "eighth",
    "16th": "short", "32nd": "short", "64th": "short",
    "128th": "short",
}


def source_sequence(measure, x_fracs):
    """Ordered structural onsets. x_fracs are the renderer's own layout positions."""
    onsets = measure["onsets"]
    total = float(sum(max(o["dur"], 1e-6) for o in onsets)) or 1.0
    acc = 0.0
    out = []
    for i, o in enumerate(onsets):
        notes = o["notes"]
        pitched = [n for n in notes if not n["rest"]]
        rest = len(pitched) == 0
        types = [n["type"] for n in notes]
        cls = DUR_CLASS.get(types[0] if types else "quarter", "quarter")
        if any(DUR_CLASS.get(t, "quarter") == "short" for t in types) and cls != "short":
            cls = "short"
        beam = list(o.get("beam") or [])
        if not beam:
            for n in notes:
                if n.get("beam"):
                    beam = list(n["beam"])
                    break
        out.append({
            "sid": "X%d" % (i + 1),
            "order": i,
            "x": float(x_fracs[i]) if i < len(x_fracs) else None,
            "cum_frac": acc / total,           # cumulative duration position
            "dur_frac": max(o["dur"], 1e-6) / total,
            "card": len(pitched),              # notehead cardinality, 0 for a rest
            "is_rest": rest,
            "dur_class": "rest" if rest else cls,
            "grace": bool(o.get("grace")) or any(n.get("grace") for n in notes),
            "dots": int(sum(int(n.get("dots") or 0) for n in notes)),
            "tuplet": bool(o.get("tuplet")) or any(n.get("tuplet") for n in notes),
            "tuplet_num": next((n.get("tuplet_num") for n in notes
                                if n.get("tuplet_num")), None),
            "beam": beam,
            "beamed": bool(beam),
            "tie_start": any(n.get("tie_start") for n in notes),
        })
        acc += max(o["dur"], 1e-6)
    return out


def beam_group_ids(seq):
    """Contiguous beamed onsets share a group id. A2-visible structural context."""
    gid, cur, prev_beamed = [], 0, False
    for o in seq:
        if o["beamed"]:
            if not prev_beamed:
                cur += 1
            gid.append(cur)
            prev_beamed = True
        else:
            gid.append(0)
            prev_beamed = False
    return gid


def spacing_signature(seq):
    """Normalised inter-onset spacing, used only for shape comparison (A4)."""
    xs = [o["x"] for o in seq if o["x"] is not None]
    if len(xs) < 2:
        return []
    d = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    m = sum(d) / len(d)
    return [v / m for v in d] if m > 0 else []
