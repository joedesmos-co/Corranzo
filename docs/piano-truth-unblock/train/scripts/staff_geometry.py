#!/usr/bin/env python3
"""Oracle staff/note/clef structure from page SVGs (positions only, labels free).

Exact span tracking of <g> groups gives membership with zero geometric
guessing (SVG nests measure -> staff -> layer -> note):
- note SVG id -> (measure SVG id, staff rank within measure)
- staff rank -> 5 staff-line y positions (ledger-extrapolated steps)
- clef SVG id -> (measure SVG id, staff rank, glyph, bbox)
- measure SVG id -> canonical measure id via contained note ids
  (SVG note ids share the MEI id space; boxes carry no labels).

Deterministic; zero tuned parameters or thresholds.
"""
from __future__ import annotations
import re
from pathlib import Path

MARGIN = re.compile(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')
G_OPEN = re.compile(r'<g id="([^"]+)" class="([a-zA-Z -]+)"[^>]*>')
G_ANY = re.compile(r'<g(?:\s[^>]*)?>|</g>')
PATH_D = re.compile(r'<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"')
RECT_AT = re.compile(r'<rect x="([\d.]+)" y="([\d.]+)" height="([\d.]+)" width="([\d.]+)"')
NOTEHEAD_USE = re.compile(
    r'<use[^>]*transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')
CLEF_USE = re.compile(r'<use xlink:href="#([A-Za-z0-9]+)-')
GLYPH_SHAPE = {"E050": "G", "E05C": "C", "E062": "F"}


def _spans(svg_text, want):
    """Yield (kind, gid, start, end) for groups whose first class token is
    in `want`, with exact open/close matching. Bounding-box helper groups
    and self-closing groups are ignored (they carry no notation)."""
    out = []
    stack = []
    for m in G_ANY.finditer(svg_text):
        tok = m.group(0)
        if tok == "</g>":
            if stack:
                kind, gid, start = stack.pop()
                if kind in want:
                    out.append((kind, gid, start, m.start()))
            continue
        if tok.endswith("/>"):
            continue
        mo = G_OPEN.match(tok)
        if mo:
            raw_cls = mo.group(2)
            if "bounding-box" in raw_cls:
                stack.append(("other", None, m.start()))
            else:
                stack.append((raw_cls.split()[0], mo.group(1), m.start()))
        else:
            stack.append(("other", None, m.start()))
    return out


def parse_page(svg_text):
    """Returns measures: [{svg_id, staves: [{lines, bbox, rank}],
    notes: {svg_id: {'pos': (x, y), 'rank': staff_rank}},
    clefs: [{svg_id, rank, bbox, glyph}]}]. Ranks = document order = top-down.
    """
    spans = _spans(svg_text, {"measure", "staff", "note", "clef"})
    by_kind = {}
    for kind, gid, a, b in spans:
        by_kind.setdefault(kind, []).append((gid, a, b))
    measures = []
    for mgid, ma, mb in by_kind.get("measure", []):
        m = {"svg_id": mgid, "staves": [], "notes": {}, "clefs": []}
        inner_staff = sorted([(g, a, b) for g, a, b in by_kind.get("staff", [])
                              if ma <= a and b <= mb], key=lambda t: t[1])
        # rank only real staves (exactly 5 long horizontal lines); Verovio
        # emits occasional empty staff groups that must not consume ranks
        ranked = []
        for (sgid, sa, sb) in inner_staff:
            body = svg_text[sa:sb]
            r = RECT_AT.search(body)
            # staff lines are the longest horizontal paths in the group
            # (ledger lines, tie slivers are far shorter); scale-free rule
            hors = [(float(x1), float(y1), float(x2), float(y2))
                    for x1, y1, x2, y2 in PATH_D.findall(body) if y1 == y2]
            longest = max([abs(x2 - x1) for x1, _, x2, _ in hors] or [0.0])
            ys = sorted({round(y1, 1) for x1, y1, x2, y2 in hors
                         if abs(x2 - x1) >= 0.5 * longest})
            if len(ys) != 5:
                continue
            ranked.append((sgid, sa, sb, ys, r))
        for rank, (sgid, sa, sb, ys, r) in enumerate(ranked):
            lines = ys[:5] if len(ys) >= 5 else ys
            m["staves"].append({
                "svg_gid": sgid, "rank": rank,
                "lines": lines,
                "bbox": {"x": float(r.group(1)), "y": float(r.group(2)),
                         "h": float(r.group(3)), "w": float(r.group(4))} if r else None})
        for ngid, na, nb in by_kind.get("note", []):
            if ma <= na and nb <= mb:
                body = svg_text[na:nb]
                u = NOTEHEAD_USE.search(body)
                pos = (float(u.group(1)), float(u.group(2))) if u else None
                m["notes"][ngid] = {"pos": pos, "rank": None, "span": (na, nb)}
        # assign note ranks via enclosing staff spans
        staff_spans = []
        for s in m["staves"]:
            hit = next(((a, b) for g, a, b in by_kind.get("staff", [])
                        if g == s["svg_gid"]), None)
            if hit:
                staff_spans.append((s["rank"], hit[0], hit[1]))
        # real frames with line geometry, in rank order
        ranked_frames = []
        for s in m["staves"]:
            if len(s["lines"]) == 5:
                g = s["lines"]
                ranked_frames.append((s["rank"], g[0], g[-1],
                                      (g[-1] - g[0]) / 4 if len(g) > 1 else 180.0))
        for ngid, nd in m["notes"].items():
            na, nb = nd.pop("span")
            enc = [rk for rk, a, b in staff_spans if a <= na and nb <= b]
            if enc:
                nd["rank"] = enc[0]
                continue
            # fallback: note sits in a dropped empty staff wrapper; use the
            # nearest real staff frame by notehead height (same measure)
            nd["rank"] = None
            if nd["pos"] is not None and ranked_frames:
                cy = nd["pos"][1]
                best, bd = None, 1e18
                for rk, lo, hi, _gp in ranked_frames:
                    d = 0.0 if lo <= cy <= hi else min(abs(cy - lo), abs(cy - hi))
                    if d < bd:
                        bd, best = d, rk
                nd["rank"] = best
                if best is not None:
                    nd["rank_fallback"] = True
        for cgid, ca, cb in by_kind.get("clef", []):
            if ma <= ca and cb <= mb:
                body = svg_text[ca:cb]
                b = RECT_AT.search(body)
                u = CLEF_USE.search(body)
                enc = [rk for rk, a, b in staff_spans if a <= ca and cb <= b]
                m["clefs"].append({
                    "svg_id": cgid, "rank": enc[0] if enc else None,
                    "bbox": {"x": float(b.group(1)), "y": float(b.group(2)),
                             "h": float(b.group(3)), "w": float(b.group(4))} if b else None,
                    "glyph": u.group(1) if u else None})
        measures.append(m)
    return measures


def page_frames(svg_text):
    """Legacy helper: (tx, ty, flat staff-frame list) for callers that only
    need line geometry. Prefer parse_page for membership."""
    m = MARGIN.search(svg_text)
    tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
    staves = []
    for meas in parse_page(svg_text):
        for s in meas["staves"]:
            if len(s["lines"]) == 5:
                gaps = [b - a for a, b in zip(s["lines"], s["lines"][1:])]
                staves.append({"lines": s["lines"], "bbox": s["bbox"],
                               "gap": sum(gaps) / len(gaps),
                               "index": len(staves)})
    staves.sort(key=lambda s: s["lines"][0])
    for k, s in enumerate(staves):
        s["index"] = k
    return tx, ty, staves


def notehead_map(svg_text):
    """SVG note-group id -> exact notehead center (x, y) in SVG frame."""
    out = {}
    for kind, gid, a, b in _spans(svg_text, {"note"}):
        u = NOTEHEAD_USE.search(svg_text[a:b])
        if u:
            out[gid] = (float(u.group(1)), float(u.group(2)))
    return out


def steps_in_frame(notehead_cy, lines, gap):
    """Diatonic steps above the frame's bottom line (ledger-extrapolated)."""
    return round(2 * (lines[-1] - notehead_cy) / gap)
