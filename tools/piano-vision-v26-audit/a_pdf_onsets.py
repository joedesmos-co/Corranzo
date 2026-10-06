#!/usr/bin/env python3
"""A1-A2. PDF-side onset representation from RASTER EVIDENCE ONLY.

Never reads source pitch, MIDI, corpus pitch labels, residuals or decoder output.
Source-side information is NOT consulted here: classification of a proposal uses
only what is visible in the raster.

Vertical position is used for exactly one thing: counting how many distinct notehead
blobs share an x, i.e. chord cardinality, which A0 lists as a permitted structural
feature. The y VALUE is never emitted as a comparable quantity and never compared
against a source y.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

NOTE_LIKELY = "NOTE_ONSET_LIKELY"
NON_NOTE = "NON_NOTE_LIKELY"
AMBIGUOUS = "AMBIGUOUS"
UNLISTED = "UNLISTED_PDF_ONSET"


def _components(clean):
    """4-connected labelling. Returns (labels, count)."""
    h, w = clean.shape
    lab = np.zeros((h, w), np.int32)
    ys, xs = np.nonzero(clean)
    if not len(ys):
        return lab, 0
    cur = 0
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for y, x in zip(ys, xs):
        nb = []
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and lab[ny, nx]:
                nb.append(lab[ny, nx])
        if not nb:
            cur += 1
            lab[y, x] = cur
            parent[cur] = cur
        else:
            m = min(nb)
            lab[y, x] = m
            for o in nb:
                union(m, o)
    remap = {}
    for k in range(1, cur + 1):
        remap.setdefault(find(k), len(remap) + 1)
    out = np.zeros_like(lab)
    for k in range(1, cur + 1):
        m = remap[find(k)]
        out[lab == k] = m
    return out, len(remap)


def suppress_staff(band, rows, gap):
    """Remove long horizontal staff-line runs (and one pixel above/below)."""
    out = band.copy()
    thr = 3.0 * gap
    for r in rows:
        for dr in (0, -1, 1):
            rr = int(r) + dr
            if not (0 <= rr < out.shape[0]):
                continue
            idx = np.nonzero(out[rr])[0]
            if not len(idx):
                continue
            for run in np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1):
                if len(run) > thr:
                    out[rr, run[0]:run[-1] + 1] = False
    return out


def classify(w, h, fill, span_gap, gap):
    """Raster morphology -> NOTE / NON-NOTE / AMBIGUOUS. No pitch, no source.

    Every threshold is expressed in STAFF GAPS, not absolute pixels. An earlier
    version hardcoded a 4-pixel gap; the real staff gap here is 10.5 px, so every
    notehead was judged against thresholds nearly 3x too small and almost nothing
    could ever be called a note.
    """
    gap = float(gap)
    if gap <= 0:
        return AMBIGUOUS
    wg, hg = w / gap, h / gap
    # Too small or too sparse: stem slivers, beam edges, hairline debris.
    if wg < 0.55 or hg < 0.50 or fill < 0.20:
        return NON_NOTE
    # Spans more than ~2.2 gaps vertically: clef fragments, time signature digits,
    # accidentals, rests, braces, arpeggio signs.
    if span_gap > 2.2:
        return NON_NOTE
    # Very tall and narrow: stem / beam fragment.
    if hg > 2.0 and wg < 0.70:
        return NON_NOTE
    # Notehead-like blob: roughly square-to-round, well filled, about one gap.
    ar = wg / max(hg, 1e-6)
    if 0.55 <= ar <= 2.2 and fill >= 0.28 and 0.55 <= wg <= 1.9:
        return NOTE_LIKELY
    # In between: could be a heavily beamed notehead or a printed glyph fragment.
    return AMBIGUOUS


def pdf_onset_features(im, y0, y1, x_lo, x_hi, staff_rows, gap, tol_gaps=0.9):
    """Ordered raster onset representation for one printed measure.

    Returns a list of dicts with only structural keys. No y value is exposed.
    """
    y0i, y1i = int(round(y0)), int(round(y1))
    if y1i - y0i < 6:
        return []
    xa, xb = max(0, int(x_lo)), int(x_hi)
    band = im[y0i:y1i + 1, xa:xb] < 140
    if band.size == 0:
        return []
    h, w = band.shape
    rows = [min(max(0, int(round(y0 + k * (y1 - y0) / 4.0)) - y0i), h - 1) for k in range(5)]
    rows = sorted(set(rows))
    clean = suppress_staff(band, rows, gap)
    lab, n = _components(clean)
    if not n:
        return []

    line_set = set(rows)
    comps = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if not len(ys):
            continue
        y_a, y_b = int(ys.min()), int(ys.max())
        x_a, x_b = int(xs.min()), int(xs.max())
        bw, bh = x_b - x_a + 1, y_b - y_a + 1
        fill = len(ys) / float(bw * bh)
        comps.append({"x_a": x_a, "x_b": x_b, "cx": (x_a + x_b) / 2.0,
                      "cy": (y_a + y_b) / 2.0, "w": bw, "h": bh, "fill": fill,
                      "span_gap": bh / gap,
                      "on_line": any(abs((y_a + y_b) / 2.0 - r) < 0.22 * gap
                                     for r in rows)})

    # Group into onsets by x, NON-CHAINING (a candidate joins only if it is within
    # tol of the group's FIRST member; comparing to the previous member chains
    # transitively and collapses dense runs).
    comps.sort(key=lambda c: c["cx"])
    tol = tol_gaps * gap
    groups, cur = [], []
    for c in comps:
        if cur and c["cx"] - cur[0]["cx"] <= tol:
            cur.append(c)
        else:
            if cur:
                groups.append(cur)
            cur = [c]
    if cur:
        groups.append(cur)

    out = []
    for g in groups:
        parts = [classify(c["w"], c["h"], c["fill"], c["span_gap"], gap) for c in g]
        n_note = sum(1 for p in parts if p == NOTE_LIKELY)
        n_amb = sum(1 for p in parts if p == AMBIGUOUS)
        n_non = sum(1 for p in parts if p == NON_NOTE)
        # Chord cardinality = distinct notehead-like blobs sharing this x.
        card = n_note + n_amb if (n_note + n_amb) > 0 else 1
        # A notehead ALWAYS has a stem or beam attached in printed piano music, and
        # staff-line suppression slices the blob it is welded to. So a group that is
        # ONE solid notehead plus a few stem slivers is still a confident note. Only
        # call a group ambiguous when there is a genuine second notehead-sized blob
        # whose width/height ratio is notehead-like, i.e. when the CHORD SIZE is
        # itself uncertain. Judging the group as ambiguous merely because stems are
        # present made every printed onset ambiguous.
        # A staff line runs through a notehead and the suppression step removes the
        # run, slicing the blob. The remainder is NARROW (0.25-0.55 gaps) but keeps
        # the full notehead height. A genuine second notehead in a chord is notehead
        # WIDE (>= 0.55 gaps). So narrow-but-tall residue is a severed notehead, not a
        # second note, and must not be counted as a chord member or as ambiguity.
        # Residue from staff-line suppression and from stems must not be counted as a
        # second chord member. A genuine extra notehead is notehead-SIZED in BOTH
        # dimensions: roughly 0.55-1.9 gaps wide and 0.50-1.3 gaps tall, matching the
        # blobs already classified NOTE_ONSET_LIKELY. Anything markedly smaller in
        # either dimension is a severed fragment, a stem sliver or an accent, and the
        # group's own notehead count is unaffected by it.
        NOTE_W, NOTE_H = (0.55, 1.9), (0.50, 1.3)
        slivers = 0
        for c, pv in zip(g, parts):
            if pv == NOTE_LIKELY:
                continue
            wg, hg = c["w"] / gap, c["h"] / gap
            note_sized = NOTE_W[0] <= wg <= NOTE_W[1] and NOTE_H[0] <= hg <= NOTE_H[1]
            if not note_sized:
                slivers += 1
        noteish = n_note + n_amb
        if n_note and n_amb == 0 and n_non == slivers:
            verdict = NOTE_LIKELY
        elif not noteish and n_non:
            verdict = NON_NOTE
        else:
            verdict = AMBIGUOUS
        out.append({
            "cx": xa + float(np.mean([c["cx"] for c in g])),   # absolute page x
            "card": int(card),
            "verdict": verdict,
            "n_note": n_note, "n_amb": n_amb, "n_non": n_non,
            "n_comp": len(g),
            "min_fill": float(min(c["fill"] for c in g)),
            "mean_h": float(np.mean([c["h"] for c in g])) / gap,
        })
    return out


def classify_proposals(pdf_feats, proposals, tol_px, prop_x=None):
    """Attach each existing P proposal to a raster onset feature group (A1).

    A proposal is judged on raster evidence alone. It is never told what the source
    says about it.
    """
    res = []
    for pr in proposals:
        px = (prop_x or {}).get(pr["pid"], pr.get("x"))
        if px is None:
            res.append({"pid": pr["pid"], "x": None, "verdict": NON_NOTE,
                        "card": None, "raster_support": False,
                        "dist_px": float("inf"), "n_note": 0, "n_amb": 0, "n_non": 1})
            continue
        best, bd = None, 1e9
        for f in pdf_feats:
            d = abs(f["cx"] - px)
            if d < bd:
                bd, best = d, f
        if best is not None and bd <= tol_px:
            res.append({"pid": pr["pid"], "x": px, "verdict": best["verdict"],
                        "card": best["card"], "raster_support": True,
                        "dist_px": float(bd),
                        "n_note": best["n_note"], "n_amb": best["n_amb"],
                        "n_non": best["n_non"]})
        else:
            res.append({"pid": pr["pid"], "x": px, "verdict": NON_NOTE,
                        "card": None, "raster_support": False,
                        "dist_px": float(bd if best else 1e9),
                        "n_note": 0, "n_amb": 0, "n_non": 1})
    return res


def find_unlisted(pdf_feats, proposals, tol_px, prop_x=None):
    """A1: raster notehead-like group with no nearby P proposal -> unlisted onset."""
    used = set()
    for pr in proposals:
        px = (prop_x or {}).get(pr["pid"], pr.get("x"))
        if px is None:
            continue
        for j, f in enumerate(pdf_feats):
            if j in used:
                continue
            if abs(f["cx"] - px) <= tol_px:
                used.add(j)
                break
    out = []
    for j, f in enumerate(pdf_feats):
        if j in used:
            continue
        if f["verdict"] in (NOTE_LIKELY, AMBIGUOUS):
            out.append({"x": float(f["cx"]), "card": int(f["card"]),
                        "verdict": f["verdict"], "reason": "raster onset with no P proposal"})
    return out
