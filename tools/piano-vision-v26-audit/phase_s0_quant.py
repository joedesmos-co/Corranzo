"""Phase S0 (quantitative) - is there a printed accidental glyph in the render?

The previous report inferred "no <accidental> element" therefore "no glyph in
the pixels". That inference is wrong, and eyeballing contact sheets is not
evidence either. This decides it with a deterministic, label-free measurement.

A printed accidental is rendered immediately to the LEFT of the notehead, on the
staff, and is the only thing that puts ink there. So for each sampled note we
compare two equal windows on the same staff lines:

    LEFT  = the accidental slot, immediately left of the notehead
    RIGHT = a control of identical size, immediately right of the notehead

Staff-line ink is removed from both by masking the rows that carry the detected
staff lines, so only non-line ink (a glyph) is counted. A note with a printed
accidental has LEFT >> RIGHT; a note without one has LEFT ~ RIGHT.

Result is a per-alter-class count of notes with a visible glyph, no glyph, or
ambiguous. Nothing is relabelled.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

OUT = H.V26_ROOT / "out/s0_accidental_visibility"
OUT.mkdir(parents=True, exist_ok=True)
N_SAMPLES_PER_SCORE = 40
WINDOW_SPACES = 1.7          # width of each measurement window
INK_THRESH = 170
GLYPH_RATIO = 2.0           # LEFT/RIGHT ink above this counts as a glyph


def load_records(sid, index):
    entry = next((s for s in index["scores"] if s["score_id"] == sid), None)
    if entry is None or not entry.get("shards"):
        return []
    out = []
    for sh in entry["shards"]:
        p = H.REALPDF_ROOT / "shards" / sh
        if p.is_file():
            with gzip.open(p, "rt") as f:
                for line in f:
                    out.append(json.loads(line))
    return out


def measure(page, gap_px, cy_px, cx_px, box_w_px, box_h_px, staff_rows):
    """LEFT vs RIGHT non-staff-line ink around one notehead."""
    pw, ph = page.size
    gapw = max(2.0, gap_px)
    note_left = cx_px - box_w_px / 2.0
    note_right = cx_px + box_w_px / 2.0
    y0 = int(cy_px - gapw * 1.3)
    y1 = int(cy_px + gapw * 1.3)
    y0, y1 = max(0, y0), min(ph, y1)
    if y1 - y0 < 5:
        return None
    a = np.asarray(page, dtype=np.uint8)

    def ink(x0, x1):
        x0, x1 = int(max(0, x0)), int(min(pw, x1))
        if x1 - x0 < 2:
            return 0
        sub = a[y0:y1, x0:x1] < INK_THRESH
        # remove staff-line rows: any row whose ink is mostly the line itself
        for r in staff_rows:
            for rr in (int(r) - y0 - 1, int(r) - y0, int(r) - y0 + 1):
                if 0 <= rr < sub.shape[0]:
                    sub[rr] = False
        return int(sub.sum())

    left = ink(note_left - WINDOW_SPACES * gapw, note_left)
    right = ink(note_right, note_right + WINDOW_SPACES * gapw)
    return left, right


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    pages = {}
    rows = []
    for sc in index["scores"]:
        sid = sc["score_id"]
        recs = load_records(sid, index)
        taken = 0
        for rec in recs[:10]:
            if taken >= N_SAMPLES_PER_SCORE:
                break
            m = rec["input"]["modelInput"]
            bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
            if not bands:
                continue
            objs = m.get("physicalObjects", [])
            labs = {}
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                for ix in (lab.get("objectIndexes") or []):
                    labs[ix] = lab
            mtok = re.match(r"p(\d+)", rec["exampleId"].split(":")[-1])
            if not mtok:
                continue
            pp = H.REALPDF_ROOT / "pages" / sid / f"page-{int(mtok.group(1))}.png"
            if not pp.is_file():
                continue
            if pp not in pages:
                pages[pp] = Image.open(pp).convert("L")
            page = pages[pp]
            ph, pw = page.size
            for i, obj in enumerate(objs):
                if obj.get("kind") != "notehead" or i not in labs or taken >= N_SAMPLES_PER_SCORE:
                    continue
                wp = labs[i]["value"].get("writtenPitch") or {}
                if "step" not in wp:
                    continue
                alter = int(float(wp["alter"])) if wp.get("alter") is not None else 0
                cy = float(obj["center"]["y"])
                cx = float(obj["center"]["x"])
                band = min(bands, key=lambda b: abs(
                    cy - (float(b["y0"]) + float(b["y1"])) / 2))
                gap = (float(band["y1"]) - float(band["y0"])) / 4.0
                if gap <= 0:
                    continue
                gap_px = gap * ph
                b = obj["bounds"]
                bw = (float(b["x1"]) - float(b["x0"])) * pw
                bh = (float(b["y1"]) - float(b["y0"])) * ph
                # staff-line rows in page px, for ink removal
                srows = [float(v) * ph for v in (band.get("lineYs") or [])]
                res = measure(page, gap_px, cy * ph, cx * pw, bw, bh, srows)
                if res is None:
                    continue
                left, right = res
                rows.append({"score": sid, "alter": alter, "left": left,
                             "right": right, "staff": band.get("staffRole"),
                             "key": None})
                taken += 1
    a = np.array([r["left"] for r in rows], float)
    b = np.array([r["right"] for r in rows], float)
    ratio = (a + 1) / (b + 1)
    cls = np.array([r["alter"] for r in rows])
    print("=== S0 quantitative accidental visibility (n=%d) ===" % len(rows))
    print("  LEFT/RIGHT ink ratio: median %.3f  p90 %.3f" % (
        np.median(ratio), np.percentile(ratio, 90)))
    out = {"n": len(rows), "GLYPH_RATIO_threshold": GLYPH_RATIO,
           "left_right_ratio_median": round(float(np.median(ratio)), 4),
           "left_right_ratio_p90": round(float(np.percentile(ratio, 90)), 4),
           "by_alter": {}}
    for al in sorted(set(cls.tolist())):
        m = cls == al
        r = ratio[m]
        glyph = int((r > GLYPH_RATIO).sum())
        amb = int(((r > 1.3) & (r <= GLYPH_RATIO)).sum())
        none = int((r <= 1.3).sum())
        print("  alter %+d: n=%-5d  visible glyph %4d (%.1f%%)  ambiguous %4d  "
              "no glyph %4d (%.1f%%)" % (al, m.sum(), glyph, 100 * glyph / m.sum(),
                                         amb, none, 100 * none / m.sum()))
        out["by_alter"][str(al)] = {
            "n": int(m.sum()), "visible_glyph": glyph, "ambiguous": amb,
            "no_glyph": none, "median_ratio": round(float(np.median(r)), 4)}
    tot_g = int((ratio > GLYPH_RATIO).sum())
    print("  ANY visible glyph across all classes: %d of %d (%.1f%%)"
          % (tot_g, len(rows), 100 * tot_g / len(rows)))
    out["any_visible_glyph"] = tot_g
    p = H.write_json("phase_s0_visibility.json", out)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
