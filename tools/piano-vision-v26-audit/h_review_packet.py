"""H0-H12 - blinded human review packet for PDF <-> MusicXML structural correspondence.

This script BUILDS A PACKET. It performs no human judgement, derives no answer from
pitch, d0, true_d, residual or decoder output, and mutates nothing.

Blinding (H9). The human-facing manifest and packet contain ONLY structural
information: score, page, system, PDF measure ordinal, MusicXML measure ordinal,
mapping class, and neutral onset identifiers P1..Pn (PDF side) and X1..Xn (source
side). Corpus residual, d0, true_d, decoder prediction and any mismatch
classification are written to a SEPARATE internal lookup that is not part of the
packet.

No SVG rasteriser is available in this environment, so:
  * PNG contact sheets pair the original PDF raster crop against a dependency-free
    STRUCTURAL RENDER of the Verovio measure - staff lines, measure boundaries and
    notehead positions only. No glyphs, no note names, no stems, nothing derived
    from pitch.
  * the optional HTML tool embeds the REAL Verovio SVG for the mapped measure with
    note names disabled and measure-number text stripped, which a browser renders
    natively with no server and no extra dependency.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402

SVGNS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVGNS)
S = "{%s}" % SVGNS
OUT = Path(__file__).parent / "out"
PKT = Path(__file__).parent / "out/h_review"
PNG = PKT / "sheets"
ONSET_TOL_GAPS = 1.35
MARGIN_GAPS = 3.0
TARGET_NOTEHEADS = 180
MIN_SCORES = 6

# BLIND manifest is the ONLY thing the reviewer sees.
BLIND_FIELDS = ("score", "page", "system", "pdf_ord", "xml_ord", "mapping_class",
                "item_id")
FORBIDDEN = ("residual", "d0", "true_d", "midi", "decoder", "mismatch",
             "correct", "answer", "sign")


# --------------------------------------------------------------------- Verovio
def verovio_measures(mpath):
    """Document-order measure ordinal -> per-role geometry + source onset groups."""
    tk = verovio.toolkit()
    tk.setOptions({"adjustPageHeight": False})
    if not tk.loadFile(str(mpath)):
        return []
    seq = []
    for pg in range(1, tk.getPageCount() + 1):
        root = ET.fromstring(tk.renderToSVG(pg))
        for meas in root.iter(S + "g"):
            if meas.get("class") != "measure":
                continue
            mbars = []
            for bl in meas.iter(S + "g"):
                if bl.get("class") != "barLine":
                    continue
                for p_ in bl.findall(S + "path"):
                    dn = [float(z) for z in
                          re.findall(r"-?\d+(?:\.\d+)?", p_.get("d") or "")]
                    if len(dn) >= 4 and abs(dn[0] - dn[2]) < 1e-9:
                        mbars.append((dn[0] + dn[2]) / 2.0)
            roles = []
            for st in meas.iter(S + "g"):
                if st.get("class") != "staff":
                    continue
                lines, sx = [], []
                for p_ in st.findall(S + "path"):
                    dn = [float(z) for z in
                          re.findall(r"-?\d+(?:\.\d+)?", p_.get("d") or "")]
                    if len(dn) >= 4 and abs(dn[1] - dn[3]) < 1e-6 \
                            and abs(dn[0] - dn[2]) > 1e-6:
                        lines.append(float(dn[1]))
                        sx.extend([dn[0], dn[2]])
                if len(lines) < 5:
                    continue
                lines = sorted(lines)[:5]
                gap = float(np.median(np.diff(lines)))
                if gap <= 0:
                    continue
                mid = lines[2]
                notes = []
                for nt in st.iter(S + "g"):
                    if nt.get("class") != "note":
                        continue
                    for nh in nt.iter(S + "g"):
                        if nh.get("class") != "notehead":
                            continue
                        for use in nh.findall(S + "use"):
                            mm = re.search(r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                           use.get("transform") or "")
                            if mm:
                                notes.append((float(mm.group(1)),
                                              (mid - float(mm.group(2))) / gap))
                roles.append({"y_top": lines[0], "gap": gap,
                              "x0": min(sx) if sx else 0.0,
                              "x1": max(sx) if sx else 0.0, "notes": notes})
            if len(roles) >= 2:
                seq.append({"page": pg, "upper": roles[0], "lower": roles[1],
                            "right_bar": max(mbars) if mbars else None})
    for k, m in enumerate(seq):
        m["ord"] = k
    return seq


def source_onsets(staff):
    """Cluster source noteheads into onset groups by x. Structure only."""
    notes = sorted(staff["notes"], key=lambda z: z[0])
    if not notes:
        return []
    tol = ONSET_TOL_GAPS * staff["gap"]
    # non-chaining, same reason as the PDF side
    groups, cur = [], []
    for n in notes:
        if cur and n[0] - cur[0][0] <= tol:
            cur.append(n)
        else:
            if cur:
                groups.append(cur)
            cur = [n]
    if cur:
        groups.append(cur)
    out = []
    for gi, g in enumerate(groups):
        ys = sorted({round(n[1], 3) for n in g})
        card = 1
        for i in range(len(ys) - 1):
            if ys[i + 1] - ys[i] > 0.45 * staff["gap"]:
                card += 1
        out.append({"sid": "X%d" % (gi + 1), "x": float(np.mean([n[0] for n in g])),
                    "card": card, "n": len(g)})
    return out


# ----------------------------------------------------------------- PDF onsets
def pdf_onsets(im, y0, y1, x_lo, x_hi, staff_x0, gap):
    """Raster-only onset proposals. Machine proposals, deliberately labelled as such."""
    y0i, y1i = int(round(y0)), int(round(y1))
    if y1i - y0i < 6:
        return []
    band = im[y0i:y1i + 1, max(0, int(x_lo)):int(x_hi) + 1] < 140
    if band.size == 0:
        return []
    h, w = band.shape
    # Row indices must be BAND-RELATIVE. Using absolute raster rows here meant
    # staff-line suppression ran on the wrong rows, so noteheads stayed welded to
    # the staff lines and almost nothing passed the morphology test.
    rows = sorted({min(max(0, int(round(y0 + k * (y1 - y0) / 4.0)) - y0i), h - 1)
                   for k in range(5)})
    thr = 3.0 * gap
    clean = band.copy()
    for r in rows:
        for dr in (0, -1, 1):
            rr = r + dr
            if not (0 <= rr < h):
                continue
            idx = np.nonzero(clean[rr])[0]
            if not len(idx):
                continue
            for run in np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1):
                if len(run) > thr:
                    clean[rr, run[0]:run[-1] + 1] = False
    lab = np.zeros((h, w), np.int32)
    cur = 0
    for y in range(h):
        for x in np.nonzero(clean[y])[0]:
            if lab[y, x]:
                continue
            cur += 1
            st = [(y, x)]
            lab[y, x] = cur
            while st:
                cy, cx = st.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and clean[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        st.append((ny, nx))
    cands = []
    for k in range(1, cur + 1):
        ys, xs = np.nonzero(lab == k)
        if not len(ys):
            continue
        a, b_, c_, d_ = ys.min(), ys.max(), xs.min(), xs.max()
        bw, bh = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        fill = len(ys) / float(bw * bh)
        # PERMISSIVE proposal mode for the review packet only. The general raster
        # onset detector is a known failure (precision ~0.22), so this packet does
        # NOT try to be accurate: it proposes generously and the HUMAN filters.
        # Stricter morphology left only 14 proposals against 341 source noteheads,
        # which made the PDF side useless for correspondence judgement.
        if not (0.45 * gap <= bw <= 2.60 * gap and 0.38 * gap <= bh <= 2.00 * gap
                and fill >= 0.18):
            continue
        cx = max(0, int(x_lo)) + (c_ + xs.max()) / 2.0
        cy = y0i + (a + b_) / 2.0
        # NOTE: the system-start prelude exclusion is deliberately NOT applied here,
        # because the reviewer needs to see everything that is printed at a system
        # start in order to judge it.
        cands.append({"x": cx, "y": cy})
    cands.sort(key=lambda z: z["x"])
    tol = ONSET_TOL_GAPS * gap
    # NON-CHAINING clustering: a candidate joins the current group only if it is
    # within tol of the group's FIRST member. Comparing against the previous member
    # chains transitively, so in a dense run every candidate merged into one onset
    # group (17 components collapsed to 3 groups on the first item).
    groups, cur = [], []
    for c in cands:
        if cur and c["x"] - cur[0]["x"] <= tol:
            cur.append(c)
        else:
            if cur:
                groups.append(cur)
            cur = [c]
    if cur:
        groups.append(cur)
    out = []
    for gi, g in enumerate(groups):
        ys = sorted({round(c["y"], 1) for c in g})
        card = 1
        for i in range(len(ys) - 1):
            if ys[i + 1] - ys[i] > 0.45 * gap:
                card += 1
        out.append({"pid": "P%d" % (gi + 1), "x": float(np.mean([c["x"] for c in g])),
                    "card": card})
    return out


# ------------------------------------------------------------------- rendering
def render_source_structural(st, onsets, scale=1.0):
    """Dependency-free structural render of the source measure.

    Staff lines, measure boundaries and notehead outlines ONLY. No glyphs, no note
    names, no stems, nothing that could leak pitch.

    The panel is entirely self-consistent in SOURCE units. An earlier version mixed
    PDF raster pixels with SVG units when computing its x range, which threw every
    X marker into the wrong place and made the panel useless.
    """
    gap = st["gap"]
    xs = [n[0] for n in st["notes"]] + [o["x"] for o in onsets]
    if not xs:
        xs = [st["x0"], st["x1"]]
    ys = [n[1] for n in st["notes"]]
    x0, x1 = min(xs), max(xs)
    y0 = min([0.0] + ys) - 0.7
    y1 = max([4.0] + ys) + 0.7
    m = MARGIN_GAPS * gap
    x0 -= m
    x1 += m
    x0 -= (x1 - x0) * 0.02
    x1 += (x1 - x0) * 0.02
    W = max(4, int((x1 - x0) * scale) + 2)
    Ht = max(4, int((y1 - y0) * gap * scale) + 2)
    im = Image.new("L", (W, Ht), 255)
    d = ImageDraw.Draw(im)

    def px(x):
        return (x - x0) * scale

    def py(yv):
        return (yv - y0) * gap * scale

    for k in range(5):
        yy = py(float(k))
        d.line([(0, yy), (im.width, yy)], fill=110,
               width=max(1, int(round(0.07 * gap * scale))))
    rw = max(2.0, 0.60 * gap * scale)
    rh = max(1.5, 0.48 * gap * scale)
    for n in st["notes"]:
        cx, cy = px(n[0]), py(n[1])
        d.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=20)
    xs_all = [n[0] for n in st["notes"]] + [o["x"] for o in onsets]
    for o in onsets:
        xx = px(o["x"])
        d.line([(xx, py(-0.55)), (xx, py(4.55))], fill=170, width=1)
    return im, x0, x1


def label_panel(panel, marks, title, sub):
    """Composite: structural render + neutral onset labels."""
    w, h = panel.size
    top = 26
    out = Image.new("RGB", (w, h + top + 16), (255, 255, 255))
    out.paste(panel.convert("RGB"), (0, top))
    d = ImageDraw.Draw(out)
    d.text((4, 4), title, fill=(0, 0, 0))
    d.text((4, 13), sub, fill=(70, 70, 70))
    for (x, txt, col) in marks:
        d.line([(x, top), (x, top + h)], fill=col, width=1)
        d.text((x + 2, top + 1), txt, fill=col)
    return out


def compose_sheet(item, pdf_crop, src_panel, marks_p, marks_x):
    """LEFT = original PDF raster. RIGHT = source structural render."""
    pdf_big = pdf_crop
    left = label_panel(pdf_big, marks_p, "PDF raster  (left)",
                       "printed measure from the page image")
    src_big = src_panel
    right = label_panel(src_big, marks_x, "source structure  (right)",
                        "staff lines + notehead positions only, no pitch")
    W = left.width + right.width + 12
    Ht = max(left.height, right.height)
    sheet = Image.new("RGB", (W, Ht), (245, 245, 245))
    sheet.paste(left, (0, 0))
    sheet.paste(right, (left.width + 12, 0))
    d = ImageDraw.Draw(sheet)
    d.rectangle([left.width + 5, 0, left.width + 7, Ht], fill=(120, 120, 120))
    return sheet


# ----------------------------------------------------------------- SVG for HTML
def measure_svg(mpath, xml_ord, want_page_only=True):
    """Return (svg_string, x0, y0, w, h) for one measure ordinal, real notation."""
    tk = verovio.toolkit()
    tk.setOptions({"adjustPageHeight": False})
    if not tk.loadFile(str(mpath)):
        return None
    for pg in range(1, tk.getPageCount() + 1):
        raw = tk.renderToSVG(pg)
        root = ET.fromstring(raw)
        k = -1
        target = None
        for meas in root.iter(S + "g"):
            if meas.get("class") != "measure":
                continue
            k += 1
            if k == xml_ord:
                target = meas
                break
        if target is None:
            continue
        # strip measure-number text so the reviewer cannot read identity off the panel
        for el in list(target.iter()):
            if el.get("class") == "mNum" or (el.tag == S + "tspan"
                                              and el.get("class") == "text"):
                par = None
                for p_ in root.iter():
                    if el in list(p_):
                        par = p_
                        break
                if par is not None:
                    par.remove(el)
        xs, ys = [], []
        for el in target.iter():
            if el.tag == S + "path" and el.get("d"):
                dn = [float(z) for z in
                      re.findall(r"-?\d+(?:\.\d+)?", el.get("d"))]
                xs.extend(dn[0::2])
                ys.extend(dn[1::2])
        if not xs:
            continue
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        mg = 24
        vb = (x0 - mg, y0 - mg, (x1 - x0) + 2 * mg, (y1 - y0) + 2 * mg)
        svg = ET.Element(S + "svg")
        svg.set("viewBox", " ".join("%.2f" % z for z in vb))
        svg.set("width", "900")
        svg.set("preserveAspectRatio", "xMidYMid meet")
        defs = root.find(S + "defs")
        if defs is not None:
            svg.append(copy.deepcopy(defs))
        svg.append(copy.deepcopy(target))
        return ET.tostring(svg, encoding="unicode"), vb
    return None

# ------------------------------------------------------------------ selection
def select_items(usable, workorder):
    """H1/H2 priority: Category A / Tier-1, then EXACT_ANCHORED, then HIGH_CONFIDENCE,
    then Category B onset-uncertainty, then complex only for diversity.
    Selection never touches d0, true_d, residual or decoder output - the only
    quantities read are mapping class and the structural coverage audit."""
    wmap = {(w["score"], w["page"], w["system"], w["xml_ord"]): w
            for w in workorder}
    tier = json.load(open(OUT / "L3_tiers.json"))
    t12 = {(t["score"], t["page"], t["system"], t["xml_ord"])
           for t in tier["tier1"]} | {(t["score"], t["page"], t["system"], t["xml_ord"])
                                      for t in tier["tier2"]}
    cat = []
    for m in usable:
        w = wmap.get((m["score"], m["page"], m["system"], m["xml_ord"]))
        if not w:
            continue
        a = sum(v["missing"] for v in w["roles"].values())
        b = sum(v["ambiguous"] for v in w["roles"].values())
        key = (m["score"], m["page"], m["system"], m["xml_ord"])
        pr = 0 if key in t12 else (1 if a > 0 else
                                   (2 if m["mapping_class"] == "EXACT_ANCHORED" else
                                    (3 if b > 0 else 4)))
        cat.append((pr, m))
    cat.sort(key=lambda z: (z[0], z[1]["score"], z[1]["page"], z[1]["system"],
                            z[1]["xml_ord"]))
    # round-robin across scores inside each priority band for structural diversity
    picked, seen = [], defaultdict(int)
    for pr in sorted({c[0] for c in cat}):
        band = defaultdict(list)
        for p_, m in cat:
            if p_ == pr:
                band[m["score"]].append(m)
        order = sorted(band, key=lambda k: -len(band[k]))
        idx = {k: 0 for k in order}
        while True:
            moved = False
            for k in order:
                if idx[k] < len(band[k]):
                    picked.append(band[k][idx[k]])
                    idx[k] += 1
                    moved = True
            if not moved:
                break
    return picked


def main():
    PKT.mkdir(parents=True, exist_ok=True)
    PNG.mkdir(parents=True, exist_ok=True)
    systems = json.load(open(OUT / "F_systems.json"))
    bypage = defaultdict(list)
    for x in systems:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    man = json.load(open(OUT / "M7_measure_map.json"))
    US = ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
          "HIGH_CONFIDENCE_COUNT_ANCHORED")
    usable = [m for m in man if m["mapping_class"] in US and m["xml_ord"] is not None]
    workorder = json.load(open(OUT / "L2_measure_workorder.json"))
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}

    picked = select_items(usable, workorder)
    vcache = {}
    items, internal = [], []
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            if len(imgs) >= 2:
                imgs.clear()
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    for m in picked:
        sid, pno = m["score"], m["page"]
        r = iv.get((sid, m["pdf_ord"]))
        im = img(sid, pno)
        if r is None or im is None:
            continue
        if sid not in vcache:
            mp = H.V26_ROOT / sm[sid]["musicxml"]
            vcache[sid] = verovio_measures(mp) if mp.is_file() else []
        vx = vcache[sid]
        if m["xml_ord"] >= len(vx):
            continue
        vm = vx[m["xml_ord"]]
        Hh = im.shape[0]
        W = im.shape[1]
        sy = bypage[(sid, pno)][m["system"]]
        for role in ("upper", "lower"):
            y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
            gap = (y1 - y0) / 4.0
            sr = A2.staff_rows(im, y0, y1)
            if len(sr) < 3:
                continue
            staff_x0 = min(q[1] for q in sr)
            P = pdf_onsets(im, y0, y1, r["x_left"], r["x_right"], staff_x0, gap)
            vst = vm[role]
            X = source_onsets(vst)
            if not X:
                continue
            mg = MARGIN_GAPS * gap
            a = max(0, int(r["x_left"] - mg))
            b = min(W, int(r["x_right"] + mg))
            crop = im[max(0, int(y0 - mg)):min(im.shape[0], int(y1 + mg)), a:b]
            if crop.size == 0 or crop.shape[0] < 8:
                continue
            item_id = "R%03d" % (len(items) + 1)
            src, sx0, sx1 = render_source_structural(vst, X)
            mp_p = [((o["x"] - a) * (crop.shape[1] / float(b - a)), o["pid"])
                    for o in P]
            DISP = 780
            sc = max(0.05, DISP / float(crop.shape[1]))
            crop_pil = Image.fromarray(np.ascontiguousarray(crop))
            big = crop_pil.resize((max(2, int(crop.shape[1] * sc)),
                                   max(2, int(crop.shape[0] * sc))), Image.LANCZOS)
            marks_p = [((px) * sc, pid, (200, 0, 0)) for px, pid in mp_p]
            sc2 = DISP / float(src.width)
            sb = src.resize((max(2, int(src.width * sc2)),
                             max(2, int(src.height * sc2))), Image.NEAREST)
            span = max(1e-9, (sx1 - sx0))
            marks_x = [(((o["x"] - sx0) / span) * sb.width, o["sid"], (0, 90, 200))
                       for o in X]
            sheet = compose_sheet(None, big, sb, marks_p, marks_x)
            fn = PNG / ("%s_%s_%s_p%d_s%d_m%d.png" % (item_id, sid[:18], role,
                                                     pno, m["system"], m["xml_ord"]))
            sheet.save(fn)
            items.append({
                "item_id": item_id, "score": sid, "page": pno,
                "system": m["system"], "pdf_ord": m["pdf_ord"],
                "xml_ord": m["xml_ord"], "mapping_class": m["mapping_class"],
                "staff": role,
                "sheet": str(fn.relative_to(PKT.parent)),
                "pdf_onsets": [{"pid": o["pid"], "card": o["card"]} for o in P],
                "source_onsets": [{"sid": o["sid"], "card": o["card"]} for o in X],
                "questions": {
                    "A_same_printed_measure": ["YES", "NO", "UNSURE"],
                    "B_source_onset_presence": {o["sid"]: ["PRINTED_IN_PDF",
                                                           "NOT_PRINTED_IN_PDF",
                                                           "UNSURE"] for o in X},
                    "C_pdf_onset_match": {o["pid"]: ["MATCHES_X__", "NO_COUNTERPART",
                                                    "UNSURE"] for o in P},
                    "D_cardinality_agrees": ["YES", "NO", "UNSURE", "N_A"],
                    "E_confidence": ["HIGH", "MEDIUM", "LOW"]},
            })
            internal.append({"item_id": item_id, "score": sid, "page": pno,
                             "system": m["system"], "xml_ord": m["xml_ord"],
                             "pdf_ord": m["pdf_ord"], "staff": role,
                             "note": "INTERNAL ONLY - never shown to the reviewer",
                             "pdf_onset_x": [o["x"] for o in P],
                             "source_onset_x": [o["x"] for o in X],
                             "source_noteheads": vst["notes"]})
    # ---- H9 blinding assertion
    blob = json.dumps(items)
    for bad in FORBIDDEN:
        assert bad not in blob.lower(), "BLINDING LEAK: %s" % bad
    H.write_json("h_review_manifest.json", {
        "version": "H1", "blinded": True,
        "note": "Structural correspondence review. No pitch, no d0, no true_d, "
                "no residual, no decoder output, no expected answer.",
        "questions": ["A_same_printed_measure", "B_source_onset_presence",
                      "C_pdf_onset_match", "D_cardinality_agrees",
                      "E_confidence"],
        "items": items})
    H.write_json("h_review_lookup_INTERNAL.json", {
        "warning": "INTERNAL. Contains source geometry for auditing only. "
                   "Not part of the reviewer packet.",
        "items": internal})
    n_on = sum(len(i["pdf_onsets"]) + len(i["source_onsets"]) for i in items)
    print("H  review packet built")
    print("  review measures (staff regions): %d" % len(items))
    print("  onset groups labelled         : %d" % n_on)
    print("  distinct scores               : %d"
          % len({i["score"] for i in items}))
    print("  wrote out/h_review/h_review_manifest.json (+ INTERNAL lookup)")


if __name__ == "__main__":
    main()
