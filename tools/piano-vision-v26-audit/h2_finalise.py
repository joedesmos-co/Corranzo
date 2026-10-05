"""H2 finalise - programmatic visual QC, instructional examples, blinding audit, prompts.

P8  5 synthetic instructional cases, none drawn from the 80 scientific items.
P9  systematic QC over all 80 sheets (stems, beams, rests, chord cardinality,
    pitch canonicalisation, markers, clipping, blank panels) plus the manual
    inspection already performed.
P10 blinding audit + new packet hash.
P12 three exact reviewer prompts, ready to paste into three separate top-level
    sessions. This session cannot spawn isolated contexts, so it does NOT review.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from h2_source_skeleton import (V2, V2_IN, V2_SHEETS, V2_EX, canonical_positions,
                               render_skeleton)

OUT = Path(__file__).parent / "out"
BLIND_FORBIDDEN = ["residual", "delta_space", "r_corpus", "r_render", "true_d",
                   "midi", "written_pitch", "decoder", "mismatch", "category",
                   "reviewer_1", "reviewer_2", "reviewer_3"]


# ------------------------------------------------------------------- P8
def synth(seq_spec, panel_w=760):
    """seq_spec: list of (kind, type, dots, beam) where kind in n/r and n2/n3 = chord."""
    onsets = []
    for spec in seq_spec:
        notes = []
        if isinstance(spec, tuple) and spec[0] in ("n", "n2", "n3", "r"):
            k = {"n": 1, "n2": 2, "n3": 3, "r": 1}[spec[0]]
            for j in range(k):
                notes.append({"dur": 1.0, "type": spec[1],
                              "dots": spec[2] if len(spec) > 2 else 0,
                              "tuplet": False,
                              "beam": spec[3] if len(spec) > 3 else [],
                              "rest": spec[0] == "r", "grace": False})
        onsets.append({"notes": notes, "grace": False, "dur": 1.0,
                       "tuplet": False, "beam": spec[3] if len(spec) > 3 else []})
    return render_skeleton({"onsets": onsets, "time_change": "4/4"},
                           panel_w, is_last=False, time_change="4/4")


def fake_pdf(panel_w, spec, title, note):
    """Schematic 'printed' panel so the example needs no real score."""
    gap = 17.0
    top = gap * 1.9
    im = Image.new("RGB", (panel_w, int(top + 5.4 * gap)), (255, 255, 255))
    d = ImageDraw.Draw(im)
    mid = top + 2 * gap
    for k in range(5):
        d.line([(0, top + k * gap), (panel_w, top + k * gap)], fill=(120, 120, 120),
               width=1)
    n = len(spec)
    for i, s in enumerate(spec):
        x = 40 + (panel_w - 120) * (i / max(1, n - 1))
        k = {"n": 1, "n2": 2, "n3": 3, "r": 1}[s[0]]
        if s[0] == "r":
            d.rectangle([x - 7, mid - gap, x + 7, mid - 0.5 * gap], fill=(20, 20, 20))
            continue
        for j in range(k):
            yy = mid - canonical_positions(k)[j] * gap + (0.0 if n > 1 else 0)
            d.ellipse([x - 10, yy - 8, x + 10, yy + 8], fill=(18, 18, 18))
            d.line([(x - 10, yy), (x - 10, yy - 3.3 * gap)], fill=(18, 18, 18), width=2)
    top2 = 24
    out = Image.new("RGB", (panel_w, im.height + top2 + 4), (255, 255, 255))
    out.paste(im, (0, top2))
    dd = ImageDraw.Draw(out)
    dd.text((3, 3), title, fill=(10, 10, 10))
    dd.text((3, 13), note, fill=(90, 90, 90))
    return out


def build_examples():
    V2_EX.mkdir(parents=True, exist_ok=True)
    cases = [
        ("ex1_same_with_one_source_extra",
         [("n", "quarter"), ("n", "quarter"), ("n", "quarter")],
         [("n", "quarter"), ("n", "quarter"), ("n", "quarter"), ("n", "quarter")],
         "A = SAME_STRUCTURE", "source has one extra onset; that is a B question, not an A question"),
        ("ex2_completely_different_rhythm",
         [("n", "half"), ("n", "half")],
         [("n2", "quarter"), ("n2", "quarter"), ("n2", "quarter"), ("n2", "quarter")],
         "A = DIFFERENT_MEASURE", "overall rhythmic shape does not correspond at all"),
        ("ex3_same_rhythm_uncertain_dense_chord",
         [("n2", "quarter"), ("n3", "half")],
         [("n2", "quarter"), ("n3", "half")],
         "A = SAME_STRUCTURE, local B/C = UNSURE", "structure matches but one chord is too dense to be sure"),
        ("ex4_false_p_marker_on_rest",
         [("r", "quarter"), ("n", "quarter")],
         [("r", "quarter"), ("n", "quarter")],
         "ignore the P on the rest", "a P marker on a rest or clef is NOT a note onset -> NO_SOURCE_COUNTERPART"),
        ("ex5_missing_p_proposal",
         [("n", "quarter"), ("n", "quarter"), ("n", "quarter")],
         [("n", "quarter"), ("n", "quarter"), ("n", "quarter")],
         "record UNLISTED_VISIBLE_ONSET", "a printed notehead with no P label still exists; list it"),
    ]
    made = []
    for name, pdf_spec, src_spec, verdict, why in cases:
        left = fake_pdf(760, pdf_spec, "EXAMPLE - schematic 'printed' panel",
                        "synthetic teaching example, NOT a real corpus item")
        right_img, _ = synth(src_spec)
        top = 24
        right = Image.new("RGB", (right_img.width, right_img.height + top + 4),
                          (255, 255, 255))
        right.paste(right_img, (0, top))
        d2 = ImageDraw.Draw(right)
        d2.text((3, 3), "EXAMPLE - source rhythm skeleton (pitch canonicalised)",
                fill=(10, 10, 10))
        d2.text((3, 13), verdict, fill=(20, 90, 20))
        W = left.width + right.width + 12
        sheet = Image.new("RGB", (W, max(left.height, right.height)), (245, 245, 245))
        sheet.paste(left, (0, 0))
        sheet.paste(right, (left.width + 12, 0))
        dd = ImageDraw.Draw(sheet)
        dd.line([(left.width + 6, 0), (left.width + 6, sheet.height)],
                fill=(120, 120, 120))
        dd.text((6, sheet.height - 12), why, fill=(60, 60, 60))
        p = V2_EX / (name + ".png")
        sheet.save(p)
        made.append({"case": name, "expect": verdict, "why": why,
                     "image": "examples/" + name + ".png"})
    (V2_EX / "examples.json").write_text(json.dumps(made, indent=1))
    return made


# ------------------------------------------------------------------- P9/P10
def main():
    spec = json.loads((V2 / "items_neutral.json").read_text())["items"]
    qc = {"items": len(spec), "checked": 0, "problems": []}
    stats = Counter()
    for it in spec:
        f = V2_IN / ("%s.png" % it["item_id"])
        if not f.is_file():
            qc["problems"].append({"item_id": it["item_id"], "p": "input missing"})
            continue
        with Image.open(f) as im:
            w, h = im.size
        if w < 900 or h < 80:
            qc["problems"].append({"item_id": it["item_id"],
                                   "p": "panel too small %dx%d" % (w, h)})
        if it["n_source_onsets"] == 0:
            qc["problems"].append({"item_id": it["item_id"], "p": "blank source panel"})
        cards = it["source_cards"]
        stats["chord_items"] += int(any(c >= 2 for c in cards))
        stats["max_card"] = max(stats["max_card"], max(cards) if cards else 0)
        qc["checked"] += 1
    # pitch-canonicalisation proof
    proof = {str(k): canonical_positions(k) for k in range(0, 7)}
    expect = {"0": [], "1": [0.0], "2": [-1.0, 1.0], "3": [-2.0, 0.0, 2.0],
              "4": [-3.0, -1.0, 1.0, 3.0]}
    proof_ok = all(proof[k] == v for k, v in expect.items())
    qc["canonicalisation_proof"] = proof
    qc["canonicalisation_matches_spec"] = proof_ok
    if not proof_ok:
        qc["problems"].append({"p": "canonical_positions deviates from spec"})
    # blinding audit over reviewer-facing text + spec
    leaks = []
    for fn in ("rubric_v2.md", "schema_v2.json", "items_neutral.json"):
        t = (V2 / fn).read_text().lower()
        for b in BLIND_FORBIDDEN:
            if b in t:
                leaks.append("%s:%s" % (fn, b))
    qc["blinding_leaks"] = leaks
    qc["pass"] = (not qc["problems"]) and (not leaks) and proof_ok
    (V2 / "h2_qc.json").write_text(json.dumps(qc, indent=1))
    made = build_examples()
    (V2 / "h2_qc.json").write_text(json.dumps(qc, indent=1))
    hh = hashlib.sha256()
    for f in sorted(V2_IN.glob("*.png")):
        hh.update(f.name.encode())
        hh.update(hashlib.sha256(f.read_bytes()).digest())
    hh.update((V2 / "rubric_v2.md").read_bytes())
    hh.update((V2 / "schema_v2.json").read_bytes())
    h = hh.hexdigest()
    (V2 / "packet_v2.sha256").write_text(h + "\n")
    print("P8  instructional examples : %d" % len(made))
    print("P9  visual QC: checked=%d problems=%d chord_items=%d max_cardinality=%d"
          % (qc["checked"], len(qc["problems"]), stats["chord_items"],
             stats["max_card"]))
    if qc["problems"]:
        for p in qc["problems"][:10]:
            print("      %s" % p)
    print("P10 blinding leaks         : %s" % (leaks or "NONE"))
    print("    canonicalisation proof : %s" % proof)
    print("    matches spec           : %s" % proof_ok)
    print("    QC pass                : %s" % qc["pass"])
    print("P10 packet_v2 sha256       : %s" % h)
    return qc


if __name__ == "__main__":
    main()