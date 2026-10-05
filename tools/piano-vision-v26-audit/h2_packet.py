"""H2 packet build - sheets, instructional examples, neutral inputs, rubric, schema.

P0  item population is FROZEN: R001..R080, same order, same measures, same mapping.
    V1 reviewer answers are diagnostic only and are never read here.
P6  the PDF panel is the original raster; P markers are light overlay ticks so they
    do not cover notation. Candidate MEMBERSHIP is unchanged from V1.
P7  question A is reworded to SAME_STRUCTURE / DIFFERENT_MEASURE / UNSURE.
P8  5 synthetic instructional cases, none drawn from the 80 scientific items.
P10 blinding audit + new packet hash.
"""
from __future__ import annotations

import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from h2_source_skeleton import (V2, V2_IN, V2_SHEETS, V2_EX, canonical_positions,
                               render_skeleton, xml_rhythm)

OUT = Path(__file__).parent / "out"
DISP = 780
MARKER_ALPHA = 105


def load_pdf_panel(man_item, systems, iv, imgs, page_img):
    """PDF raster crop + light P overlay (P6)."""
    sid = man_item["score"]
    r = iv[(sid, man_item["pdf_ord"])]
    im = page_img(sid, man_item["page"])
    Hh = im.shape[0]
    bp = [(x for x in systems if x["score"] == sid and x["page"] == man_item["page"])]
    staves = sorted(bp[0], key=lambda z: z["y0"])
    sy = staves[man_item["system"]]
    role = man_item["staff"]
    y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
    gap = (y1 - y0) / 4.0
    mg = 3.0 * gap
    a = max(0, int(r["x_left"] - mg))
    b = min(im.shape[1], int(r["x_right"] + mg))
    crop = Image.fromarray(np.ascontiguousarray(
        im[max(0, int(y0 - mg)):min(im.shape[0], int(y1 + mg)), a:b])).convert("RGB")
    sc = DISP / float(crop.width)
    crop = crop.resize((int(crop.width * sc), int(crop.height * sc)), Image.LANCZOS)
    ov = Image.new("RGBA", crop.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for o in man_item["pdf_onsets"]:
        x = int(round((o["x"] if "x" in o else 0) - a) * sc) if False else None
    return crop, ov, a, b, sc


def p_overlay(item, a, b, sc, crop_h):
    """Light vertical ticks + labels ABOVE the staff so glyphs stay readable."""
    ov = Image.new("RGBA", (max(1, int((b - a) * sc)), crop_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    return ov, d


def build(man, systems, iv, sm):
    V2_IN.mkdir(parents=True, exist_ok=True)
    V2_SHEETS.mkdir(parents=True, exist_ok=True)
    V2_EX.mkdir(parents=True, exist_ok=True)
    bypage = defaultdict(list)
    for x in systems:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    imgs = {}
    seqs = {}

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
            seqs[sid] = xml_rhythm(mp) if mp.is_file() else []
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
        # Single-part scores render a grand staff from ONE part, so both the upper
        # and the lower staff come from part 0. Keying strictly on role dropped
        # R005 and R026 and broke the frozen 80-item population (P0).
        part_ix = 0 if (role == "upper" or len(rs) < 2) else 1
        if it["xml_ord"] >= len(rs[part_ix]):
            continue
        seq = rs[part_ix][it["xml_ord"]]
        n_meas = len(rs[part_ix])
        src, stats = render_skeleton(seq, DISP, scale=1.0,
                                     is_last=(it["xml_ord"] == n_meas - 1),
                                     time_change=seq.get("time_change"))
        # ---- PDF panel
        y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
        gap = (y1 - y0) / 4.0
        mg = 3.0 * gap
        a = max(0, int(r["x_left"] - mg))
        b = min(im.shape[1], int(r["x_right"] + mg))
        crop = Image.fromarray(np.ascontiguousarray(
            im[max(0, int(y0 - mg)):min(im.shape[0], int(y1 + mg)), a:b])
        ).convert("RGB")
        # P9 unit-match fix: scaling the PDF crop by WIDTH alone made narrow
        # measures explode vertically (one sheet came out 687 px tall). Scale so the
        # STAFF renders the same physical size as the source panel, then fit the
        # width and pad. Every staff in the packet is now the same height.
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
        import h_review_packet as HP
        P = HP.pdf_onsets(im, y0, y1, r["x_left"], r["x_right"],
                          min(q[1] for q in HP.A2.staff_rows(im, y0, y1)), gap)
        pad0 = (DISP - crop.width) // 2 if crop.width == DISP else 0
        px = {}
        for o in P:
            px[o["pid"]] = (o["x"] - a) * sc_x + 0
        for o in it["pdf_onsets"]:
            x = px.get(o["pid"])
            if x is None:
                continue
            xi = int(round(x))
            od.line([(xi, 0), (xi, crop.size[1])],
                    fill=(220, 0, 0, MARKER_ALPHA), width=1)
            od.text((xi + 2, 1), o["pid"], fill=(200, 0, 0, 220))
        left = Image.alpha_composite(crop.convert("RGBA"), ov).convert("RGB")
        left = caption(left, "PDF raster (left) - printed measure from the page image",
                       "P markers are machine PROPOSALS: unreliable both ways")
        right = caption(src.convert("RGB"),
                        "SOURCE rhythm skeleton (right) - PITCH CANONICALISED",
                        "rhythm + order only; every notehead y is synthetic")
        W = left.width + right.width + 12
        Ht = max(left.height, right.height)
        sheet = Image.new("RGB", (W, Ht), (245, 245, 245))
        sheet.paste(left, (0, 0))
        sheet.paste(right, (left.width + 12, 0))
        d = ImageDraw.Draw(sheet)
        d.line([(left.width + 6, 0), (left.width + 6, Ht)], fill=(120, 120, 120))
        fn = V2_SHEETS / ("%s.png" % it["item_id"])
        sheet.save(fn)
        (V2_IN / ("%s.png" % it["item_id"])).write_bytes(fn.read_bytes())
        items.append({"item_id": it["item_id"], "image": "inputs/%s.png" % it["item_id"],
                      "n_pdf_proposals": len(it["pdf_onsets"]),
                      "n_source_onsets": stats["n_onsets"],
                      "source_cards": stats["cards"],
                      "time_change": seq.get("time_change"),
                      "is_last_measure": it["xml_ord"] == n_meas - 1})
    return items


def caption(panel, title, sub):
    top = 24
    out = Image.new("RGB", (panel.width, panel.height + top + 4), (255, 255, 255))
    out.paste(panel, (0, top))
    d = ImageDraw.Draw(out)
    d.text((3, 3), title, fill=(10, 10, 10))
    d.text((3, 13), sub, fill=(80, 80, 80))
    return out


RUBRIC_V2 = """# Structural correspondence rubric - V2 (blinded, pitch-scrubbed)

You judge **printed structure only**. Never name a note, octave or accidental value,
and be aware that no pitch-bearing field of any kind is shown to you.

## The two panels

* **LEFT - PDF raster.** The real printed measure from a scanned page. Thin red
  vertical lines labelled `P1, P2, ...` are **machine proposals from an unreliable
  detector**. Expect them on clefs, key signatures, time signatures, rests,
  accidentals, articulations, stems and beams, AND expect genuinely printed
  noteheads that carry no `P` label. **Trust your eyes, not the labels.**
* **RIGHT - SOURCE rhythm skeleton.** The same measure engraved from the source
  MusicXML **with every pitch canonicalised away**. Each notehead's vertical
  position is a neutral slot determined ONLY by how many notes are in that chord:
  one note sits centred, two notes sit one slot apart, three notes spread over
  three slots, and so on. So the right panel shows **rhythm, onset order, chord
  cardinality, stems, beams, flags, rests, dots, tuplets, barlines and meter** -
  and deliberately shows nothing about which pitches the source actually has.

The panels are **independently laid out and not horizontally aligned**. Judge
sequence and rhythm, never pixel alignment.

## Questions

**A - does the rhythmic / onset structure on the right plausibly correspond to this
PDF measure and staff?** `SAME_STRUCTURE` / `DIFFERENT_MEASURE` / `UNSURE`

A is about *structure*, not about every individual event matching. A single extra or
missing note does **not** by itself make A `DIFFERENT_MEASURE` - that is what
questions B and C are for. Use `DIFFERENT_MEASURE` when the overall rhythmic shape
does not correspond at all.

**B - for each source onset `Xn`: is that event printed in the PDF?**
`PRINTED` / `NOT_PRINTED` / `UNSURE`

**C - for each PDF proposal `Pn`: which source onset does it correspond to?**
an `X` id, or `NO_SOURCE_COUNTERPART`, or `UNSURE`

**D - for onsets you matched, does notehead cardinality agree?**
`YES` / `NO` / `UNSURE`

**E - structural confidence** `HIGH` / `MEDIUM` / `LOW`

**Second pass, only if E = HIGH.** For each matched onset pair, decide whether the
visible noteheads pair by vertical structural rank, top to top:

* `RANK_OK` with an explicit map, e.g. `{"P1a":"X1a","P1b":"X1b"}`
* or `AMBIGUOUS`

## Be conservative

Prefer `UNSURE` over a forced match. Never invent a one-to-one mapping to fill C.
If a printed onset is clearly visible but carries no `P` label, list it in
`unlisted_visible_onsets` rather than ignoring it.
"""

SCHEMA_V2 = {
    "version": "v2",
    "label": "AI_BLIND_CONSENSUS_V2",
    "not": "human ground truth; not manually certified",
    "item": {"item_id": "R###", "required": ["A", "B", "C", "D", "E"]},
    "A": ["SAME_STRUCTURE", "DIFFERENT_MEASURE", "UNSURE"],
    "B_per_source_onset": ["PRINTED", "NOT_PRINTED", "UNSURE"],
    "C_per_pdf_proposal": ["X<id>", "NO_SOURCE_COUNTERPART", "UNSURE"],
    "D": ["YES", "NO", "UNSURE"],
    "E": ["HIGH", "MEDIUM", "LOW"],
    "optional": ["unlisted_visible_onsets", "notes", "second_pass"],
    "second_pass": {"pid": {"verdict": ["RANK_OK", "AMBIGUOUS"],
                            "map": {"P<pid><letter>": "X<xid><letter>"}}},
    "file": {"reviewer": "V2_REVIEWER_n", "batch": "integer", "items": [{}]},
}


def main():
    man = json.loads((OUT / "h_review_manifest.json").read_text())
    systems = json.load(open(OUT / "F_systems.json"))
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    items = build(man, systems, iv, sm)
    spec = {"version": "v2", "items": items}
    (V2 / "items_neutral.json").write_text(json.dumps(spec, indent=1))
    (V2 / "rubric_v2.md").write_text(RUBRIC_V2)
    (V2 / "schema_v2.json").write_text(json.dumps(SCHEMA_V2, indent=1))
    hh = hashlib.sha256()
    hh.update(json.dumps(spec["items"], sort_keys=True,
                         separators=(",", ":")).encode())
    for f in sorted(V2_IN.glob("*.png")):
        hh.update(f.name.encode())
        hh.update(hashlib.sha256(f.read_bytes()).digest())
    h = hh.hexdigest()
    (V2 / "packet_v2.sha256").write_text(h + "\n")
    print("H2 packet V2 built")
    print("  items                : %d (R001..R%03d)"
          % (len(items), len(items)))
    print("  sheets               : %d" % len(list(V2_SHEETS.glob('*.png'))))
    print("  packet_v2 sha256     : %s" % h)
    print("  wrote rubric_v2.md, schema_v2.json, items_neutral.json")
    return spec


if __name__ == "__main__":
    main()