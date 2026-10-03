"""M0-M7 - pitch-independent measure identity map: PDF printed interval <-> MusicXML measure.

The Stage C failure was measure IDENTITY, not note matching: intervals were paired
by normalised x inside the staff, so a wrong measure could masquerade as a complete
onset-count match. This stage replaces that with a document-order map whose
validity is fixed before any note y, delta_space, d0, true_d, residual or decoder
result is read.

  M0  MusicXML structural fingerprint sequence, document order, no pitch
  M1  PDF printed interval sequence in reading order, from the validated barline map
  M2  anchors derived independently from BOTH sources
  M3  segments between anchors, monotone alignment inside a segment
  M4  explicit insert/delete edits - never a silent shift of all later measures
  M5  structural confidence classes
  M6  anti-slide test: is the optimal alignment UNIQUE?
  M7  freeze + hash

Structural evidence allowed: order, interval count, engraving width, engraving
duration, barline type, notation-change fingerprints. Nothing vertical.
"""
from __future__ import annotations

import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402

OUT = Path(__file__).parent / "out"
EDIT_PEN = 1.0        # cost of one insert or delete
WIDTH_TOL = 0.34      # width-pattern agreement band, as a fraction of system width


# ===================================================================== M0
def xml_fingerprint(path):
    """Document-order measure fingerprints. Duration/onset counts, never pitch."""
    root = ET.parse(path).getroot()
    parts = root.findall("part")
    per_part = []
    for part in parts:
        divisions = None
        seq = []
        for mi, meas in enumerate(part.findall("measure")):
            attrs = meas.find("attributes")
            if attrs is not None:
                d = attrs.find("divisions")
                if d is not None and d.text:
                    divisions = int(d.text)
            dur = 0
            notes = rests = onsets = chords = 0
            for n in meas.findall("note"):
                if n.find("chord") is not None:
                    chords += 1
                    continue
                onsets += 1
                if n.find("rest") is not None:
                    rests += 1
                else:
                    notes += 1
                dd = n.find("duration")
                if dd is not None and dd.text:
                    dur += int(dd.text)
            left = meas.find("barline")
            lb = None
            if left is not None and left.get("location") in (None, "left"):
                st = left.find("bar-style")
                lb = {"repeat": left.get("repeat"),
                      "style": (st.text if st is not None else None)}
            rb = {"repeat": None, "style": None}
            for bl in meas.findall("barline"):
                if bl.get("location") == "right":
                    st = bl.find("bar-style")
                    rb = {"repeat": bl.get("repeat"),
                          "style": (st.text if st is not None else None)}
            key = tsc = clef = None
            if attrs is not None:
                k = attrs.find("key")
                if k is not None:
                    key = int(k.findtext("fifths", "0"))
                t = attrs.find("time")
                if t is not None:
                    tsc = "%s/%s" % (t.findtext("beats"), t.findtext("beat-type"))
                cl = attrs.find("clef")
                if cl is not None:
                    clef = "%s%s" % (cl.findtext("sign", ""), cl.findtext("line", ""))
            seq.append({
                "ord": mi, "number": meas.get("number"),
                "implicit": meas.get("implicit") == "yes",
                "width": float(meas.get("width")) if meas.get("width") else None,
                "dur": dur, "divisions": divisions,
                "notes": notes, "rests": rests, "onsets": onsets, "chords": chords,
                "left_barline": lb, "right_barline": rb,
                "key_change": key, "time_change": tsc, "clef_change": clef})
        per_part.append(seq)
    # merge parts by ordinal; both staves share the measure sequence
    merged = []
    n = max((len(s) for s in per_part), default=0)
    for mi in range(n):
        row = {"ord": mi, "parts": []}
        for s in per_part:
            row["parts"].append(s[mi] if mi < len(s) else None)
        any_p = next((p for p in row["parts"] if p), None)
        if any_p is None:
            continue
        row.update({k: any_p[k] for k in
                    ("number", "implicit", "width", "left_barline", "right_barline",
                     "key_change", "time_change", "clef_change")})
        row["dur"] = sum(p["dur"] for p in row["parts"] if p)
        row["onsets"] = sum(p["onsets"] for p in row["parts"] if p)
        row["notes"] = sum(p["notes"] for p in row["parts"] if p)
        row["rests"] = sum(p["rests"] for p in row["parts"] if p)
        row["divisions"] = next((p["divisions"] for p in row["parts"] if p), None)
        merged.append(row)
    return merged


# ===================================================================== M1
def pdf_intervals(systems):
    """Reading-order printed intervals from the validated cross-staff barline map."""
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    out = []
    by_page = defaultdict(list)
    for sy in systems:
        by_page[(sy["score"], sy["page"])].append(sy)
    for (sid, pno) in sorted(by_page):
        im = img(sid, pno)
        if im is None:
            continue
        Hh = im.shape[0]
        W = im.shape[1]
        for sidx, sy in enumerate(sorted(by_page[(sid, pno)], key=lambda z: z["y0"])):
            st = {}
            for role in ("upper", "lower"):
                y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
                sr = A2.staff_rows(im, y0, y1)
                if len(sr) < 3:
                    st = None
                    break
                cd = A2.candidates(im, y0, y1, min(r[1] for r in sr),
                                   max(r[2] for r in sr), A2.CAND)
                if cd is None:
                    st = None
                    break
                cd["events"] = A2.cluster_events(cd["cands"], cd["gap"])
                cd["x0"] = min(r[1] for r in sr)
                cd["x1"] = max(r[2] for r in sr)
                st[role] = cd
            if not st:
                continue
            g = max(st["upper"]["gap"], st["lower"]["gap"])
            pr = A2.cross_staff(st["upper"]["events"], st["lower"]["events"],
                                A2.CONS_TOL_GAPS * g)
            pr = [(i, j, d) for i, j, d in pr if abs(d) <= A2.CONS_STRICT_GAPS * g]
            xs = [(0.5 * (st["upper"]["events"][i]["x"] + st["lower"]["events"][j]["x"]),
                   st["upper"]["events"][i], st["lower"]["events"][j])
                  for i, j, _ in pr]
            xs.sort(key=lambda z: z[0])
            # Intervals are bounded by INTERNAL paired boundaries only. The two
            # edge regions (staff edge -> first barline, last barline -> staff
            # edge) are not measures: they contain the clef and the system
            # terminator, and including them inflated the count from the
            # validated 774 to 1332.
            if len(xs) < 2:
                continue
            x0 = min(st["upper"]["x0"], st["lower"]["x0"])
            x1 = max(st["upper"]["x1"], st["lower"]["x1"])
            for k in range(len(xs) - 1):
                lo, hi = xs[k], xs[k + 1]
                out.append({
                    "score": sid, "page": pno, "system": sidx,
                    "interval": k, "n_intervals": len(xs) - 1,
                    "x_left": lo[0], "x_right": hi[0],
                    "x0": x0, "x1": x1, "gap": g,
                    "left_cov": max(lo[1]["min_cov"], lo[2]["min_cov"]),
                    "left_w": max(lo[1]["w"], lo[2]["w"]),
                    "right_cov": max(hi[1]["min_cov"], hi[2]["min_cov"]),
                    "right_w": max(hi[1]["w"], hi[2]["w"]),
                    "n_bars": len(xs)})
    for sid in {r["score"] for r in out}:
        rs = [r for r in out if r["score"] == sid]
        o = 0
        for pno in sorted({r["page"] for r in rs}):
            for sidx in sorted({r["system"] for r in rs if r["page"] == pno}):
                for r in sorted([r for r in rs if r["page"] == pno
                                 and r["system"] == sidx], key=lambda z: z["interval"]):
                    r["ord"] = o
                    o += 1
    return sorted(out, key=lambda r: (r["score"], r["ord"]))


# ===================================================================== M2
def anchors_for(pdf_rows, xml_rows):
    """Anchors derivable from BOTH sources.

    A_START  the first printed interval is the first MusicXML measure.
    A_END    the last printed interval is closed by a barline markedly wider than
             the median barline of that score. A normal printed barline is a thin
             stroke (median 2 px here); a double or final barline is two strokes
             and measures 11-19 px. That width ratio is read off the raster on the
             PDF side and is the printed-score counterpart of the MusicXML
             right-barline bar-style, so both sides are derived independently.
    """
    out = []
    n_p, n_x = len(pdf_rows), len(xml_rows)
    if not pdf_rows or not xml_rows:
        return out
    out.append({"type": "A_START", "pdf_ord": 0, "xml_ord": 0, "both_sides": True,
                "reason": "first printed interval / first MusicXML measure"})
    ws = [r["right_w"] for r in pdf_rows if r["right_w"]]
    if ws:
        med = float(np.median(ws))
        lastw = pdf_rows[-1]["right_w"] or 0.0
        if med > 0 and lastw >= 4.0 * med:
            out.append({"type": "A_END_FINAL_BAR", "pdf_ord": n_p - 1,
                        "xml_ord": n_x - 1, "both_sides": True,
                        "reason": "last printed interval closed by a barline %.0f px "
                                  "wide vs median %.0f px (double/final bar)"
                                  % (lastw, med)})
    return out


# ============================================================== M3/M4/M6
def align_segment(P, X):
    """Needleman-Wunsch with explicit indels.

    Returns (ops, cost, n_optimal). n_optimal is the number of distinct optimal
    alignments, which is the M6 anti-slide test: if more than one alignment of
    equal structural cost exists then the region can slide, and every measure in
    it must be reported AMBIGUOUS rather than chosen arbitrarily.
    """
    n, m = len(P), len(X)
    if n == 0 or m == 0:
        return [], EDIT_PEN * (n + m), 1
    BIG = np.inf
    D = np.full((n + 1, m + 1), BIG)
    Cn = np.zeros((n + 1, m + 1), np.int64)
    Bk = np.zeros((n + 1, m + 1), np.int8)
    D[0, 0] = 0.0
    Cn[0, 0] = 1
    for i in range(1, n + 1):
        D[i, 0] = D[i - 1, 0] + EDIT_PEN
        Cn[i, 0] = Cn[i - 1, 0]
        Bk[i, 0] = 1
    for j in range(1, m + 1):
        D[0, j] = D[0, j - 1] + EDIT_PEN
        Cn[0, j] = Cn[0, j - 1]
        Bk[0, j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            mc = 0.0 if width_ok(P[i - 1], X[j - 1]) else 0.25
            cands = ((D[i - 1, j - 1] + mc, 0, i - 1, j - 1),
                     (D[i - 1, j] + EDIT_PEN, 1, i - 1, j),
                     (D[i, j - 1] + EDIT_PEN, 2, i, j - 1))
            best = min(c[0] for c in cands)
            if best == BIG:
                continue
            win = [c for c in cands if c[0] == best]
            D[i, j] = best
            Bk[i, j] = win[0][1]
            # only uniqueness matters (M6), so saturate at 2: C(300,150) overflows
            tot = 0
            for _, _, pi_, pj_ in win:
                tot += int(Cn[pi_, pj_])
            Cn[i, j] = 2 if tot > 1 else 1
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i == 0:
            ops.append(("insert_xml", None, j - 1)); j -= 1; continue
        if j == 0:
            ops.append(("delete_pdf", i - 1, None)); i -= 1; continue
        a = Bk[i, j]
        if a == 0:
            ops.append(("match", i - 1, j - 1)); i -= 1; j -= 1
        elif a == 1:
            ops.append(("delete_pdf", i - 1, None)); i -= 1
        else:
            ops.append(("insert_xml", None, j - 1)); j -= 1
    ops.reverse()
    return ops, float(D[n, m]), int(Cn[n, m])


def width_ok(p, x):
    """Interval width agreement, normalised inside its own system."""
    if p["width_norm"] is None or x["width"] is None or not p["widths"]:
        return True
    return abs(p["width_norm"] - x["width_norm"]) <= WIDTH_TOL


def main():
    systems = json.load(open(OUT / "F_systems.json"))
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    idx = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    scores = sorted({s["score_id"] for s in idx["scores"]})

    print("M0  MusicXML structural fingerprints")
    xmls = {}
    for sid in scores:
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        xmls[sid] = xml_fingerprint(mp) if mp.is_file() else []
    print("  scores with MusicXML: %d / %d" % (sum(1 for v in xmls.values() if v), len(scores)))

    print("\nM1  PDF printed intervals from the validated barline map")
    pdfs = pdf_intervals(systems)
    for sid in scores:
        rs = [r for r in pdfs if r["score"] == sid]
        if not rs:
            continue
        for r in rs:
            w = r["x_right"] - r["x_left"]
            tot = r["x1"] - r["x0"]
            r["width_norm"] = (w / tot) if tot > 0 else None
            r["widths"] = None
        byst = defaultdict(list)
        for r in rs:
            byst[(r["page"], r["system"])].append(r)
        for v in byst.values():
            ws = [q["width_norm"] for q in v]
            for q in v:
                q["widths"] = ws
    tot_pdf = sum(1 for r in pdfs)
    tot_xml = sum(len(v) for v in xmls.values())
    print("  PDF printed intervals : %d" % tot_pdf)
    print("  MusicXML measures     : %d" % tot_xml)

    # normalised width per XML measure, inside its own part
    for sid, rows in xmls.items():
        ws = [r["width"] for r in rows]
        good = [w for w in ws if w]
        if good:
            lo, hi = min(good), max(good)
            for r in rows:
                r["width_norm"] = ((r["width"] - lo) / (hi - lo)
                                   if r["width"] and hi > lo else None)
        else:
            for r in rows:
                r["width_norm"] = None

    print("\nM2  anchors (derived from both sources)")
    manifest = []
    stats = Counter()
    stats["nonunique_regions_list"] = []
    per_score = {}
    for sid in scores:
        P = sorted([r for r in pdfs if r["score"] == sid], key=lambda z: z["ord"])
        X = xmls[sid]
        if not P or not X:
            stats["no_data"] += 1
            continue
        A = anchors_for(P, X)
        types = [a["type"] for a in A]
        # segments between consecutive anchors
        seg_bounds = [(a_["pdf_ord"], a_["xml_ord"], a_["type"]) for a_ in A]
        mapped = {}
        edits = []
        conf = {}
        regions = []
        if len(seg_bounds) >= 2:
            regions.append((0, seg_bounds[0][0], 0, seg_bounds[0][1], "PRE_ANCHOR"))
            for k in range(len(seg_bounds) - 1):
                regions.append((seg_bounds[k][0] + 1, seg_bounds[k + 1][0],
                                seg_bounds[k][1] + 1, seg_bounds[k + 1][1],
                                "ANCHORED_%s|%s" % (seg_bounds[k][2],
                                                    seg_bounds[k + 1][2])))
            regions.append((seg_bounds[-1][0] + 1, len(P) - 1,
                            seg_bounds[-1][1] + 1, len(X) - 1, "POST_ANCHOR"))
        else:
            regions.append((1, len(P) - 1, 1, len(X) - 1, "START_ANCHORED_TAIL"))
        for (p_lo, p_hi, x_lo, x_hi, tag) in regions:
            if p_lo > p_hi:
                continue
            Ps = P[p_lo:p_hi + 1]
            Xs = X[x_lo:x_hi + 1] if x_hi >= x_lo else []
            ops, cost, nopt = align_segment(Ps, Xs)
            # HIGH_CONFIDENCE_INTERIOR requires strong anchors on BOTH sides and a
            # unique optimal alignment (M5/M6). A start-anchored tail has no
            # closing anchor, so a shift inside it can never be excluded.
            both = tag.startswith("ANCHORED_")
            for op, pi, xi in ops:
                if op == "match":
                    # ops carry REGION-LOCAL indices; key by the global PDF ordinal
                    gpo = int(Ps[pi]["ord"])
                    gxo = int(Xs[xi]["ord"])
                    mapped[gpo] = gxo
                    if conf.get(gpo) != "HIGH_CONFIDENCE_INTERIOR":
                        conf[gpo] = ("HIGH_CONFIDENCE_INTERIOR"
                                     if (both and nopt == 1) else "AMBIGUOUS")
                else:
                    edits.append({"region": tag, "op": op,
                                  "pdf_ord": (int(Ps[pi]["ord"]) if pi is not None else None),
                                  "xml_ord": (int(Xs[xi]["ord"]) if xi is not None else None),
                                  "reason": "printed-interval count disagrees with "
                                            "MusicXML measure count in an anchored region"})
            stats["regions"] += 1
            stats["segments_anchored_both"] += int(both)
            stats["n_pdf_in_regions"] += len(Ps)
            stats["n_xml_in_regions"] += len(Xs)
            if nopt > 1:
                stats["ambiguous_regions"] += 1
                stats["nonunique_regions_list"].append((sid, tag, nopt))
        for a in A:
            mapped[a["pdf_ord"]] = a["xml_ord"]
            conf[a["pdf_ord"]] = "EXACT_ANCHORED"
        # A_COUNT: printed interval count == MusicXML measure count, with A_START
        # pinning ordinal 0, forces the identity. Only monotone bijection between
        # two equal-length sequences starting at 0. Order + interval count are both
        # explicitly allowed evidence, so this cannot slide and needs no 2nd anchor.
        if len(P) == len(X):
            for i_ in range(len(P)):
                if conf.get(i_) != "EXACT_ANCHORED":
                    conf[i_] = "HIGH_CONFIDENCE_COUNT_ANCHORED"
                    mapped[i_] = i_
        for r in P:
            r["xml_ord"] = mapped.get(r["ord"])
            r["conf"] = conf.get(r["ord"], "UNMAPPED")
            r["score"] = sid
        nxl = len(X)
        npl = len(P)
        per_score[sid] = {"anchors": A, "edits": edits,
                          "count_agrees": (npl == nxl),
                          "pdf_minus_xml": npl - nxl,
                          "n_pdf": len(P), "n_xml": len(X),
                          "n_mapped": sum(1 for r in P if r["xml_ord"] is not None)}
        for r in P:
            manifest.append({"score": r["score"], "page": r["page"],
                             "system": r["system"], "interval": r["interval"],
                             "pdf_ord": r["ord"], "xml_ord": r["xml_ord"],
                             "mapping_class": r["conf"],
                             "anchors_used": [a["type"] for a in A],
                             "structural_cost": None})
    print("  scores attempted            : %d" % len(per_score))
    print("  scores with >=1 anchor      : %d"
          % sum(1 for v in per_score.values() if v["anchors"]))
    for sid in scores:
        v = per_score.get(sid)
        if not v:
            continue
        print("    %-42s pdf=%-4d xml=%-4d mapped=%-4d anchors=%s edits=%d"
              % (sid[:42], v["n_pdf"], v["n_xml"], v["n_mapped"],
                 ",".join(a["type"].replace("SCORE_", "") for a in v["anchors"]) or "-",
                 len(v["edits"])))
    cls = Counter(m["mapping_class"] for m in manifest)
    print("\nM5  mapping classes: %s" % dict(cls))
    print("    insertions/deletions recorded: %d" % len(edits))

    # ---------------------------------------------------------------- M8
    print("\nM8  MAP-ONLY SANITY CHECKS (no note correspondence inspected)")
    anch = json.load(open(OUT / "M7_anchors.json"))
    print("  %-42s %5s %5s %6s %7s %6s %6s %8s"
          % ("score", "pdfIv", "xmlM", "d", "anchors", "countOK", "mapped", "usable"))
    tu = 0
    for sid in scores:
        v = per_score.get(sid)
        if not v:
            continue
        rows = [m for m in manifest if m["score"] == sid]
        usable = [m for m in rows if m["mapping_class"] in
                  ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
                   "HIGH_CONFIDENCE_COUNT_ANCHORED")]
        tu += len(usable)
        print("  %-42s %5d %5d %6d %7d %6s %6d %8d"
              % (sid[:42], v["n_pdf"], v["n_xml"], v["pdf_minus_xml"],
                 len(v["anchors"]), v["count_agrees"], v["n_mapped"], len(usable)))
    print("  TOTAL usable (anchored or high-confidence) measures: %d / %d"
          % (tu, len(manifest)))
    print("\n  per-score count agreement (printed intervals vs MusicXML measures):")
    for sid in scores:
        v = per_score.get(sid)
        if v:
            print("    %-42s d=%+d %s" % (sid[:42], v["pdf_minus_xml"],
                                         "AGREES" if v["count_agrees"] else ""))

    H.write_json("M7_measure_map.json", manifest)
    H.write_json("M7_anchors.json", per_score)
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    hsh = hashlib.sha256(payload.encode()).hexdigest()
    with open(OUT / "M7_measure_map.sha256", "w") as f:
        f.write(hsh + "\n")
    print("\nM7  FROZEN MEASURE MAP")
    print("  entries : %d" % len(manifest))
    print("  sha256  : %s" % hsh)


if __name__ == "__main__":
    main()