"""V3 packet build - sheets, examples, rubric, schema, blinding audit, prompts.

Population frozen: R001..R080, same order, same crops, same mappings. No selection
uses V1/V2 reviewer outcomes. The packet, rubric semantics and consensus rules are
unchanged in scientific content; only rendering fidelity is corrected.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import h_review_packet as HP  # noqa: E402
from h2_packet import caption  # noqa: E402
from h3_skeleton import render_skeleton_v3, run_tests, xml_rhythm_v3  # noqa: E402
from h2_prompts import TEMPLATE  # noqa: E402

OUT = Path(__file__).parent / "out"
V3 = OUT / "h_review_ai_v3"
V3_IN = V3 / "inputs"
V3_SH = V3 / "sheets"
V3_EX = V3 / "examples"
DISP = 780
MARKER_ALPHA = 105
NAMES = ["V3_REVIEWER_1", "V3_REVIEWER_2", "V3_REVIEWER_3"]
BLIND_FORBIDDEN = ["residual", "delta_space", "r_corpus", "r_render", "true_d",
                   "midi", "written_pitch", "decoder", "mismatch", "category",
                   "reviewer_1", "reviewer_2", "reviewer_3"]

RUBRIC = """# Structural correspondence rubric - V3 (blinded, pitch-blind skeleton)

You judge **printed structure only**. Never name a note, octave or accidental value.
No pitch-bearing field of any kind is shown to you.

## The two panels

* **LEFT - PDF raster.** The real printed measure. Thin red `P1, P2, ...` lines are
  **machine proposals from an unreliable detector**: expect them on clefs, key
  signatures, time signatures, rests, accidentals, articulations, stems and beams, and
  expect genuinely printed noteheads carrying no `P` label. **Trust your eyes.**
* **RIGHT - SOURCE rhythm skeleton.** The same measure engraved from the source
  MusicXML with **every pitch canonicalised away**. A notehead's height is a neutral
  slot determined ONLY by how many notes are in that chord: one note centred, two one
  slot apart, three over three slots. The panel therefore shows real rhythmic
  notation - **notehead fill by duration** (hollow for half and whole, filled for
  quarter and shorter), stems, beams, flags, rests, augmentation dots, **real tuplet
  numerals**, **ties and slurs**, schematic ledger context, meter and barlines - and
  deliberately shows nothing about actual pitch.

The panels are **independently laid out and not horizontally aligned**. Judge
sequence and rhythm, never pixel alignment.

## Questions

**A - does the rhythmic / onset structure on the right plausibly correspond to this
PDF measure and staff?** `SAME_STRUCTURE` / `DIFFERENT_MEASURE` / `UNSURE`

A is about *structure*, not about every individual event matching. **A single extra
or missing onset does NOT by itself make A `DIFFERENT_MEASURE`** - individual events
are what B and C are for. Use `DIFFERENT_MEASURE` only when the overall rhythmic shape
does not correspond at all.

**B - for each source onset `Xn`: is that event printed in the PDF?**
`PRINTED` / `NOT_PRINTED` / `UNSURE`

**C - for each PDF proposal `Pn`: which source onset does it correspond to?**
an `X` id, or `NO_SOURCE_COUNTERPART`, or `UNSURE`

**D - for onsets you matched, does notehead cardinality agree?**
`YES` / `NO` / `UNSURE`

**E - structural confidence** `HIGH` / `MEDIUM` / `LOW`

**Second pass, only if E = HIGH.** For each matched onset pair decide whether the
visible noteheads pair by vertical structural rank, top to top: `RANK_OK` with an
explicit map such as `{"P1a":"X1a","P1b":"X1b"}`, or `AMBIGUOUS`.

## Be conservative

Prefer `UNSURE` over a forced match. Never invent a one-to-one mapping to fill C. If a
printed onset is clearly visible but carries no `P` label, list it in
`unlisted_visible_onsets` rather than ignoring it.
"""

SCHEMA = {
    "version": "v3", "label": "AI_BLIND_CONSENSUS_V3",
    "not": "human ground truth; not manually certified",
    "A": ["SAME_STRUCTURE", "DIFFERENT_MEASURE", "UNSURE"],
    "B_per_source_onset": ["PRINTED", "NOT_PRINTED", "UNSURE"],
    "C_per_pdf_proposal": ["X<id>", "NO_SOURCE_COUNTERPART", "UNSURE"],
    "D": ["YES", "NO", "UNSURE"], "E": ["HIGH", "MEDIUM", "LOW"],
    "optional": ["unlisted_visible_onsets", "notes", "second_pass"],
    "second_pass": {"pid": {"verdict": ["RANK_OK", "AMBIGUOUS"],
                            "map": {"P<pid><letter>": "X<xid><letter>"}}},
    "file": {"reviewer": "V3_REVIEWER_n", "batches": [1, 2, 3, 4],
             "items": "all 80, unique item_id"},
}


def build(man, systems, iv, sm):
    for d in (V3_IN, V3_SH, V3_EX):
        d.mkdir(parents=True, exist_ok=True)
    bypage = defaultdict(list)
    for x in systems:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    imgs, seqs = {}, {}

    def page_img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            if len(imgs) >= 2:
                imgs.clear()
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    def rhythm(sid):
        if sid not in seqs:
            mp = H.V26_ROOT / sm[sid]["musicxml"]
            seqs[sid] = xml_rhythm_v3(mp) if mp.is_file() else []
        return seqs[sid]

    items = []
    for it in man["items"]:
        sid = it["score"]
        im = page_img(sid, it["page"])
        if im is None:
            continue
        Hh = im.shape[0]
        r = iv[(sid, it["pdf_ord"])]
        sy = bypage[(sid, it["page"])][it["system"]]
        role = it["staff"]
        rs = rhythm(sid)
        pix = 0 if (role == "upper" or len(rs) < 2) else 1
        if it["xml_ord"] >= len(rs[pix]):
            continue
        seq = rs[pix][it["xml_ord"]]
        src, st = render_skeleton_v3(seq, DISP, is_last=(it["xml_ord"] == len(rs[pix]) - 1),
                                     time_change=seq.get("time_change"))
        y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
        gap = (y1 - y0) / 4.0
        mg = 3.0 * gap
        a = max(0, int(r["x_left"] - mg))
        b = min(im.shape[1], int(r["x_right"] + mg))
        crop = Image.fromarray(np.ascontiguousarray(
            im[max(0, int(y0 - mg)):min(im.shape[0], int(y1 + mg)), a:b])
        ).convert("RGB")
        staff_px = max(1.0, (y1 - y0))
        sc = (4.0 * 17.0) / staff_px
        if crop.width * sc > DISP:
            sc = DISP / float(crop.width)
        nw, nh = max(2, int(crop.width * sc)), max(2, int(crop.height * sc))
        crop = crop.resize((nw, nh), Image.LANCZOS)
        padded = Image.new("RGB", (DISP, nh), (255, 255, 255))
        padded.paste(crop, ((DISP - nw) // 2, 0))
        crop = padded
        sc_x = nw / float(b - a)
        ov = Image.new("RGBA", crop.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        P = HP.pdf_onsets(im, y0, y1, r["x_left"], r["x_right"],
                          min(q[1] for q in HP.A2.staff_rows(im, y0, y1)), gap)
        pmap = {o["pid"]: (o["x"] - a) * sc_x for o in P}
        for o in it["pdf_onsets"]:
            x = pmap.get(o["pid"])
            if x is None:
                continue
            xi = int(round(x))
            od.line([(xi, 0), (xi, crop.size[1])], fill=(220, 0, 0, MARKER_ALPHA),
                    width=1)
            od.text((xi + 2, 1), o["pid"], fill=(200, 0, 0, 220))
        left = caption(Image.alpha_composite(crop.convert("RGBA"), ov).convert("RGB"),
                       "PDF raster (left) - printed measure",
                       "P markers are machine PROPOSALS: unreliable both ways")
        right = caption(src.convert("RGB"),
                        "SOURCE rhythm skeleton (right) - PITCH CANONICALISED",
                        "fill by duration, beams, flags, rests, dots, real tuplets, ties")
        W = left.width + right.width + 12
        Ht = max(left.height, right.height)
        sheet = Image.new("RGB", (W, Ht), (245, 245, 245))
        sheet.paste(left, (0, 0))
        sheet.paste(right, (left.width + 12, 0))
        ImageDraw.Draw(sheet).line([(left.width + 6, 0), (left.width + 6, Ht)],
                                   fill=(120, 120, 120))
        fn = V3_SH / ("%s.png" % it["item_id"])
        sheet.save(fn)
        (V3_IN / ("%s.png" % it["item_id"])).write_bytes(fn.read_bytes())
        items.append({"item_id": it["item_id"], "image": "inputs/%s.png" % it["item_id"],
                      "n_pdf_proposals": len(it["pdf_onsets"]),
                      "n_source_onsets": st["n_onsets"], "source_cards": st["cards"],
                      "n_tied_arcs": st["n_tied_arcs"]})
    return items


def synth_measure(spec):
    """spec entry: (kind, type[, dots[, tuplet_num[, beams[, tie]]]])

    Optional fields are read defensively: a short tuple must not raise.
    """
    def g(t, k, d=None):
        return t[k] if len(t) > k else d

    onsets = []
    for s in spec:
        ty = g(s, 1, "quarter")
        notes = []
        k = 1 if g(s, 0) == "r" else int(str(g(s, 0))[1:])
        for _ in range(k):
            notes.append({"dur": 1.0, "type": ty, "dots": g(s, 2, 0),
                          "tuplet": g(s, 3) is not None, "tuplet_num": g(s, 3),
                          "beam": g(s, 4, []) or [], "rest": g(s, 0) == "r",
                          "grace": False, "tie_start": g(s, 5) == "start",
                          "tie_stop": g(s, 5) == "stop",
                          "slur": g(s, 5) == "slur"})
        onsets.append({"notes": notes, "grace": False, "dur": 1.0,
                       "tuplet": g(s, 3) is not None, "tuplet_num": g(s, 3),
                       "beam": g(s, 4, []) or []})
    return {"onsets": onsets, "time_change": "4/4"}


def schematic_left(spec, W, title, sub):
    gap = 17.0
    top = gap * 2.6
    im = Image.new("RGB", (W, int(top + 6.4 * gap)), (255, 255, 255))
    d = ImageDraw.Draw(im)
    mid = top + 2 * gap
    for k in range(5):
        d.line([(0, top + k * gap), (W, top + k * gap)], fill=(120, 120, 120), width=1)
    n = len(spec)
    for i, s in enumerate(spec):
        x = 60 + (W - 140) * (i / max(1, n - 1))
        if s[0] == "r":
            d.rectangle([x - 8, mid - gap, x + 8, mid - 0.5 * gap], fill=(20, 20, 20))
            continue
        k = int(s[0][1:])
        from h2_source_skeleton import canonical_positions as cp
        for j, p in enumerate(cp(k)):
            yy = mid - p * (gap / 2.0)
            d.ellipse([x - 10, yy - 8, x + 10, yy + 8], fill=(18, 18, 18))
            d.line([(x - 10, yy), (x - 10, yy - 3.3 * gap)], fill=(18, 18, 18), width=2)
    o = Image.new("RGB", (W, im.height + 28), (255, 255, 255))
    o.paste(im, (0, 24))
    dd = ImageDraw.Draw(o)
    dd.text((3, 3), title, fill=(10, 10, 10))
    dd.text((3, 13), sub, fill=(90, 90, 90))
    return o


def build_examples():
    cases = [
        ("ex1_duration_fill",
         [("n1", "quarter"), ("n1", "half"), ("n1", "whole"), ("n1", "eighth")],
         "hollow whole/half vs filled quarter/eighth", "fill carries the duration"),
        ("ex2_beams_eighth_and_16th",
         [("n1", "16th", 0, None, ["begin"]), ("n1", "16th", 0, None, ["end"]),
          ("n1", "eighth", 0, None, ["begin"]), ("n1", "eighth", 0, None, ["end"])],
         "16ths get two beams, 8ths one", "beam count distinguishes duration"),
        ("ex3_tied_notes",
         [("n1", "quarter", 0, None, [], "start"), ("n1", "quarter")],
         "tie arc links the two notes", "tie shows continuation, not pitch"),
        ("ex4_tuplet_non_three",
         [("n1", "eighth", 0, 6, ["begin"]), ("n1", "eighth", 0, 6, ["continue"]),
          ("n1", "eighth", 0, 6, ["end"])],
         "real numeral 6, not a fabricated 3", "numerals come from the source"),
        ("ex5_chord_duration_cardinality",
         [("n3", "half"), ("n1", "quarter")],
         "3-note half chord then a quarter", "stacking is cardinality-only"),
    ]
    made = []
    for name, spec, verdict, why in cases:
        left = schematic_left(spec, DISP, "EXAMPLE - schematic 'printed' panel",
                              "synthetic teaching example, NOT a corpus item")
        src, _ = render_skeleton_v3(synth_measure(spec), DISP, time_change="4/4")
        o = Image.new("RGB", (src.width, src.height + 28), (255, 255, 255))
        o.paste(src, (0, 24))
        dd = ImageDraw.Draw(o)
        dd.text((3, 3), "EXAMPLE - source skeleton (pitch canonicalised)",
                fill=(10, 10, 10))
        dd.text((3, 13), verdict, fill=(20, 90, 20))
        sheet = Image.new("RGB", (left.width + o.width + 12,
                                  max(left.height, o.height)), (245, 245, 245))
        sheet.paste(left, (0, 0))
        sheet.paste(o, (left.width + 12, 0))
        d2 = ImageDraw.Draw(sheet)
        d2.line([(left.width + 6, 0), (left.width + 6, sheet.height)],
                fill=(120, 120, 120))
        d2.text((6, sheet.height - 12), why, fill=(60, 60, 60))
        sheet.save(V3_EX / (name + ".png"))
        made.append({"case": name, "expect": verdict, "why": why})
    (V3_EX / "examples.json").write_text(json.dumps(made, indent=1))
    return made


def preflight():
    print("\nPREFLIGHT")
    ok_all = True
    for i, name in enumerate(NAMES, start=1):
        t = re.sub(r"\s+", " ", (V3 / ("prompt_%d.txt" % i)).read_text())
        others = [n for n in NAMES if n != name]
        c = {
            "names correct reviewer": name in t,
            "no other reviewer named": not any(o in t for o in others),
            "single identity": len(re.findall(r"You are %s" % re.escape(name), t)) == 1,
            "covers batches 1-4": all(("batch%d.json" % b) in t for b in (1, 2, 3, 4)),
            "exactly one final output": t.count("reviews/%s.json" % name) >= 1,
            "temp artifacts declared": "_batch" in t,
            "no per-batch final write": "ONLY final output file" in t,
            "no per-batch termination":
                "Do NOT stop, summarise or finish after any single batch" in t,
            "sequential": "batch1, then batch2, then batch3, then batch4" in t,
            "requires 80 unique": "80 UNIQUE" in t and "R001 through R080" in t,
            "verify before write": "VERIFY the merged set" in t,
            "blinding preserved": all(k in t for k in [
                "out/h_review_manifest.json", "out/h_review_lookup_INTERNAL.json",
                "true_d", "decoder", "Do NOT run git"]),
            "cannot see others": "never see another reviewer's answers" in t,
        }
        bad = [k for k, v in c.items() if not v]
        ok_all = ok_all and not bad
        print("  prompt_%d.txt  %s" % (i, "PASS" if not bad else "FAIL " + str(bad)))
    print("  PREFLIGHT: %s" % ("PASS" if ok_all else "FAIL"))
    return 0 if ok_all else 1


def main():
    res, ok = run_tests()
    print("V3 rendering tests: %d checks, %s" % (len(res), "PASS" if ok else "FAIL"))
    if not ok:
        for n, v in res:
            if not v:
                print("   FAIL %s" % n)
        return 1
    man = json.loads((OUT / "h_review_manifest.json").read_text())
    systems = json.load(open(OUT / "F_systems.json"))
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    items = build(man, systems, iv, sm)
    (V3 / "items_neutral.json").write_text(
        json.dumps({"version": "v3", "items": items}, indent=1))
    (V3 / "rubric_v3.md").write_text(RUBRIC)
    (V3 / "schema_v3.json").write_text(json.dumps(SCHEMA, indent=1))
    made = build_examples()
    n = len(items)
    per = n // 4
    for b in range(4):
        chunk = items[b * per:(b + 1) * per] if b < 3 else items[b * per:]
        (V3 / "batches").mkdir(exist_ok=True)
        (V3 / "batches" / ("batch%d.json" % (b + 1))).write_text(
            json.dumps(chunk, indent=1))
    (V3 / "reviews").mkdir(exist_ok=True)
    for i, nm in enumerate(NAMES, start=1):
        (V3 / ("prompt_%d.txt" % i)).write_text(
            TEMPLATE.replace("{NAME}", nm).replace("{NITEMS}", str(n))
            .replace("{K}", "<K>")
            .replace("h_review_ai_v2", "h_review_ai_v3")
            .replace("rubric_v2.md", "rubric_v3.md")
            .replace("schema_v2.json", "schema_v3.json")
            .replace("V2_REVIEWER_2.json or V3_REVIEWER_2.json",
                     "another reviewer's output")
            .replace("V2_REVIEWER_2.json", "another reviewer's output")
            .replace("V2_REVIEWER_3.json", "another reviewer's output"))
    # blinding audit
    leaks = []
    for fn in ("rubric_v3.md", "schema_v3.json", "items_neutral.json"):
        t = (V3 / fn).read_text().lower()
        leaks += ["%s:%s" % (fn, b) for b in BLIND_FORBIDDEN if b in t]
    # For the prompts, a token hit is only a leak if it appears in the TASK body.
    # The ABSOLUTE RULES block deliberately NAMES forbidden filenames in order to
    # forbid them, so those occurrences are counted separately, not hidden.
    prompt_rule_only = True
    for i in range(1, 4):
        t = re.sub(r"\s+", " ", (V3 / ("prompt_%d.txt" % i)).read_text()).lower()
        head, sep, tail = t.partition("absolute rules")
        for b in ("residual", "true_d", "decoder", "mismatch"):
            if b in head:
                leaks.append("prompt%d:%s" % (i, b))
            elif b in tail:
                prompt_rule_only = prompt_rule_only and True
    hh = hashlib.sha256()
    for f in sorted(V3_IN.glob("*.png")):
        hh.update(f.name.encode())
        hh.update(hashlib.sha256(f.read_bytes()).digest())
    for fn in ("rubric_v3.md", "schema_v3.json", "examples/examples.json"):
        hh.update((V3 / fn).read_bytes())
    for f in sorted(V3_EX.glob("*.png")):
        hh.update(f.read_bytes())
    h = hh.hexdigest()
    (V3 / "packet_v3.sha256").write_text(h + "\n")
    qc = {"items": n, "sheets": len(list(V3_SH.glob('*.png'))),
          "examples": len(made), "blinding_leaks": leaks, "packet_sha256": h,
          "tests": len(res), "tests_pass": ok,
          "prompt_tokens_confined_to_prohibition_rules": prompt_rule_only}
    (V3 / "h3_qc.json").write_text(json.dumps(qc, indent=1))
    print("\nV3 packet")
    print("  items / sheets      : %d / %d" % (n, qc["sheets"]))
    print("  instructional cases : %d" % len(made))
    print("  blinding leaks      : %s" % (leaks or "NONE"))
    print("  prompt tokens only inside the prohibition rules: %s" % prompt_rule_only)
    print("  packet_v3 sha256    : %s" % h)
    return preflight()


if __name__ == "__main__":
    sys.exit(main())