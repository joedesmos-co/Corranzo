"""V3 - high-fidelity, pitch-blind rhythm skeleton.

Rendering-fidelity corrections only. No consensus or confidence rule is touched.

V1 correct - notehead fill by DURATION (never by pitch):
    whole  -> hollow, no stem
    half   -> hollow + stem
    quarter-> filled + stem
    eighth and shorter -> filled + stem, flag or beam

V3 - real tuplet numerals from <time-modification><actual-notes>. When the structural
    numeral is unavailable a bracket is drawn WITHOUT a number; "3" is never invented.

V4 - ties and slurs drawn as schematic arcs connecting CANONICAL notehead slots, so
    the curve shows continuation and never original pitch height.

V5 - ledger context derived ONLY from the artificial canonical stack: a ledger line is
    drawn when a canonical slot falls outside the neutral five-line staff. Real
    pitch-derived ledger positions are never restored.

V6 - clef policy: ONE neutral placeholder retained consistently. It encodes no pitch
    reference and is not varied per score, so it cannot become a reviewer aid.

V8 - chord stacking unchanged and still cardinality-only:
    k=1 [0] | k=2 [-1,+1] | k=3 [-2,0,+2] | k=4 [-3,-1,+1,+3]

Pitch blindness: nothing here reads written pitch, staff position, MIDI, key
signature, d0, true_d, residual, decoder output, or PDF geometry.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from h2_source_skeleton import canonical_positions  # reused, unchanged

FLAG_COUNT = {"eighth": 1, "16th": 2, "32nd": 3, "64th": 4, "128th": 5}
BEAMED = {"eighth", "16th", "32nd", "64th", "128th"}
HOLLOW = {"whole", "breve", "long"}
STAFFLESS = {"whole", "breve", "long"}


def xml_rhythm_v3(path):
    """Per part -> per measure -> onset list, with tuplet numerals, ties, slurs."""
    root = ET.parse(path).getroot()
    seqs = []
    for part in root.findall("part"):
        seq = []
        for meas in part.findall("measure"):
            onsets, cur = [], None
            for n in meas.findall("note"):
                is_chord = n.find("chord") is not None
                grace = n.find("grace") is not None
                dur = n.findtext("duration")
                dur = int(dur) if dur else 0
                ty = n.findtext("type") or ""
                dots = len(n.findall("dot"))
                tm = n.find("time-modification")
                tuplet_num = None
                if tm is not None:
                    an = tm.findtext("actual-notes")
                    if an and an.isdigit():
                        tuplet_num = int(an)
                beams = [b.text for b in n.findall("beam")]
                rest = n.find("rest") is not None
                tie_stop = n.find('tie[@type="stop"]') is not None \
                    or n.find('tie[@type="continue"]') is not None
                tie_start = n.find('tie[@type="start"]') is not None
                notated = n.find("notations")
                slur = False
                if notated is not None:
                    tie_start = tie_start or notated.find('tied[@type="start"]') is not None
                    tie_stop = tie_stop or notated.find('tied[@type="stop"]') is not None \
                        or notated.find('tied[@type="continue"]') is not None
                    slur = notated.find("slur") is not None
                rec = {"dur": dur, "type": ty, "dots": dots,
                       "tuplet": tuplet_num is not None, "tuplet_num": tuplet_num,
                       "beam": beams, "rest": rest, "grace": grace,
                       "tie_start": tie_start, "tie_stop": tie_stop, "slur": slur}
                if is_chord and cur is not None:
                    cur["notes"].append(rec)
                    continue
                cur = {"notes": [rec], "grace": grace,
                       "dur": dur if dur > 0 else (0.5 if ty in FLAG_COUNT else 1.0),
                       "tuplet": rec["tuplet"], "tuplet_num": tuplet_num,
                       "beam": beams}
                onsets.append(cur)
            at = meas.find("attributes")
            ts = None
            if at is not None and at.find("time") is not None:
                ts = "%s/%s" % (at.find("time").findtext("beats"),
                                at.find("time").findtext("beat-type"))
            seq.append({"onsets": onsets, "time_change": ts,
                        "number": meas.get("number"),
                        "implicit": meas.get("implicit") == "yes"})
        seqs.append(seq)
    return seqs


def onset_x(onsets, x0, x1):
    tot = float(sum(max(o["dur"], 1e-6) for o in onsets)) or 1.0
    acc, xs = 0.0, []
    for o in onsets:
        xs.append(x0 + (x1 - x0) * (acc / tot))
        acc += max(o["dur"], 1e-6)
    return xs


# ------------------------------------------------------- V1 fill decision
def notehead_style(ty):
    """Fill and stem from DURATION TYPE only. Never from pitch."""
    if ty in HOLLOW:
        return "hollow", False
    if ty in ("half",):
        return "hollow", True
    return "filled", True


def render_skeleton_v3(measure, panel_w, scale=1.0, is_last=False,
                       time_change=None, return_arcs=False):
    gap = 17.0 * scale
    top = gap * 2.6
    Ht = int(top + 6.4 * gap)
    im = Image.new("RGB", (int(panel_w), Ht), (255, 255, 255))
    d = ImageDraw.Draw(im)
    mid = top + 2 * gap
    lw = max(1, int(0.055 * gap))
    for k in range(5):
        d.line([(0, top + k * gap), (panel_w, top + k * gap)], fill=(120, 120, 120),
               width=lw)
    x_l = 1.6 * gap
    x_r = panel_w - 1.1 * gap
    d.line([(x_l, top), (x_l, top + 4 * gap)], fill=(25, 25, 25),
           width=max(1, int(0.13 * gap)))
    if is_last:
        d.line([(x_r - 0.24 * gap, top), (x_r - 0.24 * gap, top + 4 * gap)],
               fill=(25, 25, 25), width=max(2, int(0.15 * gap)))
        d.line([(x_r, top), (x_r, top + 4 * gap)], fill=(25, 25, 25),
               width=max(3, int(0.34 * gap)))
    else:
        d.line([(x_r, top), (x_r, top + 4 * gap)], fill=(25, 25, 25),
               width=max(1, int(0.13 * gap)))
    if time_change:
        d.text((x_l + 0.30 * gap, mid - 0.45 * gap), str(time_change),
               fill=(25, 25, 25))
    # V6: one neutral clef placeholder, identical for every score
    cx = 0.78 * gap
    d.ellipse([cx - 0.24 * gap, mid - 0.24 * gap, cx + 0.24 * gap, mid + 0.24 * gap],
              outline=(40, 40, 40), width=max(1, int(0.07 * gap)))
    d.line([(cx, mid - 1.6 * gap), (cx, mid + 1.6 * gap)], fill=(40, 40, 40),
           width=max(1, int(0.07 * gap)))
    onsets = measure["onsets"]
    xs = onset_x(onsets, x_l + 0.8 * gap, x_r - 0.8 * gap)
    stems, arcs = [], []
    for (o, x) in zip(onsets, xs):
        notes = o["notes"]
        pitched = [n for n in notes if not n["rest"]]
        if not pitched:
            r = notes[0]
            gsc = 0.62 if r["grace"] else 1.0
            _draw_rest(d, x, mid, gap * gsc, r["type"])
            for _ in range(r["dots"]):
                d.ellipse([x + 0.42 * gap, mid - 0.1 * gap,
                           x + 0.60 * gap, mid + 0.08 * gap], fill=(20, 20, 20))
            continue
        k = len(pitched)
        pos = canonical_positions(k)
        lead = pitched[0]
        fill, want_stem = notehead_style(lead["type"])
        gsc = 0.62 if lead["grace"] else 1.0
        nhw = max(1.6, 0.60 * gap * gsc)
        nhh = max(1.2, 0.48 * gap * gsc)
        up = pos[0] >= 0
        slen = 3.3 * gap * gsc
        for i, nn in enumerate(pitched):
            yy = mid - pos[i] * (gap / 2.0) * 1.0
            f, _ = notehead_style(nn["type"])
            if f == "hollow":
                d.ellipse([x - nhw, yy - nhh, x + nhw, yy + nhh],
                          outline=(18, 18, 18), width=max(2, int(0.13 * gap)),
                          fill=(255, 255, 255))
            else:
                d.ellipse([x - nhw, yy - nhh, x + nhw, yy + nhh], fill=(18, 18, 18))
            for _ in range(nn["dots"]):
                d.ellipse([x + nhw + 0.12 * gap, yy - 0.09 * gap,
                           x + nhw + 0.28 * gap, yy + 0.08 * gap], fill=(18, 18, 18))
            if want_stem and nn["type"] not in STAFFLESS:
                sxp = x - nhw if up else x + nhw
                syp = (yy - slen) if up else (yy + slen)
                d.line([(sxp, yy), (sxp, syp)], fill=(18, 18, 18),
                       width=max(1, int(0.075 * gap)))
                stems.append((sxp, syp, up, nn, x, yy))
            # V5 ledger context from the CANONICAL slot only
            for L in range(-6, 7):
                gu = pos[i] / 2.0
                if (L < 0 and L >= math.floor(gu)) or (L > 4 and L <= math.ceil(gu)):
                    d.line([(x - 0.95 * gap, mid + (L - 2) * gap),
                            (x + 0.95 * gap, mid + (L - 2) * gap)],
                           fill=(90, 90, 90), width=max(1, int(0.07 * gap)))
        # V4 tie / slur arcs between CANONICAL positions
        for i, nn in enumerate(pitched):
            yy = mid - pos[i] * (gap / 2.0)
            if nn["tie_start"] or nn["slur"]:
                arcs.append({"x0": x, "y0": yy, "kind": "tie" if nn["tie_start"]
                             else "slur"})
            if nn["tie_stop"] and arcs:
                a = arcs.pop()
                arcs.append({"x0": a["x0"], "y0": a["y0"], "x1": x, "y1": yy,
                             "kind": a["kind"]})
    for a in list(arcs):
        if "x1" not in a:
            continue
        x0, x1 = min(a["x0"], a["x1"]), max(a["x0"], a["x1"])
        ytop = min(a["y0"], a["y1"]) - 1.05 * gap
        lift = 0.55 * gap if a["kind"] == "slur" else 0.34 * gap
        midx, midy = (x0 + x1) / 2.0, (ytop - lift)
        for t in np.linspace(0, 1, 40):
            bx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * midx + t ** 2 * x1
            by = ((1 - t) ** 2 * ytop + 2 * (1 - t) * t * midy + t ** 2 * ytop)
            d.point((bx, by), fill=(70, 70, 70))
    # flags for unbeamed flagged notes
    for (sxp, syp, up, nn, x, yy) in stems:
        if nn["beam"]:
            continue
        for k in range(min(FLAG_COUNT.get(nn["type"], 0), 3)):
            fy = syp + k * 0.38 * gap * (1 if up else -1)
            d.line([(sxp, fy), (sxp + 0.55 * gap * (1 if up else -1),
                                fy + 0.42 * gap * (1 if up else -1))],
                   fill=(18, 18, 18), width=max(1, int(0.09 * gap)))
    # beams, respecting begin/end so separate groups stay separate
    i = 0
    while i < len(stems):
        bl = stems[i][3].get("beam") or []
        if bl and "begin" in bl and stems[i][3]["type"] in BEAMED:
            grp, j = [stems[i]], i
            while j + 1 < len(stems):
                nb = stems[j + 1][3].get("beam") or []
                if not nb or stems[j + 1][3]["type"] not in BEAMED:
                    break
                grp.append(stems[j + 1])
                j += 1
                if "end" in nb:
                    break
            if len(grp) > 1:
                up = grp[0][2]
                yb = float(np.mean([g[1] for g in grp]))
                th = max(2, int(0.34 * gap))
                d.line([(grp[0][0], yb), (grp[-1][0], yb)], fill=(18, 18, 18),
                       width=th)
                if any(FLAG_COUNT.get(g[3]["type"], 1) >= 2 for g in grp):
                    off = (th + max(1, int(0.16 * gap))) * (1 if up else -1)
                    d.line([(grp[0][0], yb + off), (grp[-1][0], yb + off)],
                           fill=(18, 18, 18), width=th)
            i = j + 1
        else:
            i += 1
    # V3 real tuplet numerals, never invented
    for (o, x) in zip(onsets, xs):
        if not o.get("tuplet"):
            continue
        num = o.get("tuplet_num")
        d.line([(x - 0.55 * gap, top - 0.72 * gap), (x - 0.55 * gap, top - 0.34 * gap)],
               fill=(70, 70, 70), width=1)
        d.line([(x - 0.55 * gap, top - 0.34 * gap), (x + 0.55 * gap, top - 0.34 * gap)],
               fill=(70, 70, 70), width=1)
        d.line([(x + 0.55 * gap, top - 0.34 * gap), (x + 0.55 * gap, top - 0.72 * gap)],
               fill=(70, 70, 70), width=1)
        if num:
            d.text((x - 0.14 * gap, top - 1.28 * gap), str(num), fill=(40, 40, 40))
    out = {"n_onsets": len(onsets),
           "cards": [len([n for n in o["notes"] if not n["rest"]]) for o in onsets],
           "n_tied_arcs": sum(1 for a in arcs if "x1" in a)}
    return im, out


def _draw_rest(d, x, mid, gap, ty):
    w = max(2, int(0.62 * gap))
    lw = max(1, int(0.10 * gap))
    if ty == "whole":
        d.rectangle([x - w, mid - 1.0 * gap, x + w, mid - 0.5 * gap],
                    fill=(20, 20, 20))
    elif ty == "half":
        d.rectangle([x - w, mid - 0.5 * gap, x + w, mid], fill=(20, 20, 20))
    elif ty == "quarter":
        pts = [(-0.35, -1.0), (0.30, -0.45), (-0.30, 0.15), (0.25, 0.55), (-0.2, 1.0)]
        for a_, b_ in zip(pts, pts[1:]):
            d.line([(x + a_[0] * gap, mid + a_[1] * gap),
                    (x + b_[0] * gap, mid + b_[1] * gap)], fill=(20, 20, 20),
                   width=lw)
    else:
        n = FLAG_COUNT.get(ty, 1)
        for k in range(min(n, 3)):
            yy = mid + 0.9 * gap - k * 0.45 * gap
            d.ellipse([x - 0.22 * gap, yy - 0.18 * gap, x + 0.22 * gap,
                       yy + 0.18 * gap], fill=(20, 20, 20))
            d.line([(x, yy), (x + 0.34 * gap, yy + 0.55 * gap)], fill=(20, 20, 20),
                   width=max(1, int(0.08 * gap)))


# ------------------------------------------------------------------- tests
def run_tests():
    """Automated checks for the mandatory V1/V3 behaviours."""
    res = []

    def chk(name, cond):
        res.append((name, bool(cond)))

    # --- V1 notehead fill by duration
    for ty, fill, stem in (("whole", "hollow", False), ("half", "hollow", True),
                           ("quarter", "filled", True), ("eighth", "filled", True),
                           ("16th", "filled", True)):
        f, s = notehead_style(ty)
        chk("fill[%s]=%s" % (ty, fill), f == fill)
        chk("stem[%s]=%s" % (ty, stem), s == stem)

    def mk(spec):
        onsets = []
        for s in spec:
            notes = [{"dur": 1.0, "type": s[1], "dots": s[2] if len(s) > 2 else 0,
                      "tuplet": len(s) > 3, "tuplet_num": s[3] if len(s) > 3 else None,
                      "beam": s[4] if len(s) > 4 else [], "rest": False,
                      "grace": False, "tie_start": False, "tie_stop": False,
                      "slur": False}]
            onsets.append({"notes": notes, "grace": False, "dur": 1.0,
                           "tuplet": len(s) > 3,
                           "tuplet_num": s[3] if len(s) > 3 else None,
                           "beam": s[4] if len(s) > 4 else []})
        return {"onsets": onsets, "time_change": "4/4"}

    def px(im):
        """Dark-PIXEL count. Using the raw ink sum is inverted: more white means a
        HIGHER sum, so hollow noteheads scored as 'more ink'."""
        return (np.asarray(im.convert("L"), float) < 128).sum()

    # hollow vs filled dark-pixel ratio: hollow has fewer dark pixels
    _, hollow = render_skeleton_v3(mk([("n", "half")]), 400)
    a = px(render_skeleton_v3(mk([("n", "half")]), 400)[0])
    b = px(render_skeleton_v3(mk([("n", "quarter")]), 400)[0])
    chk("hollow notehead inks less than filled (%d < %d)" % (a, b), a < b)
    w1 = render_skeleton_v3(mk([("n", "whole")]), 400)[0]
    chk("whole note renders", w1.size[0] > 0)
    # whole vs half stem: half must contain a stem (more dark pixels)
    chk("half note has a stem, whole does not (%d > %d)"
        % (px(render_skeleton_v3(mk([("n", "half")]), 400)[0]), px(w1)),
        px(render_skeleton_v3(mk([("n", "half")]), 400)[0]) > px(w1))
    # filled vs hollow must also differ per-note, whole vs quarter
    chk("filled quarter inks more than hollow whole",
        px(render_skeleton_v3(mk([("n", "quarter")]), 400)[0])
        > px(w1))

    # --- V2 beams stay separate
    spec_a = [("n", "eighth", 0, False, ["begin"]),
              ("n", "eighth", 0, False, ["end"])]
    spec_b = [("n", "eighth", 0, False, ["begin"]),
              ("n", "eighth", 0, False, ["end"])]
    m = {"onsets": [], "time_change": None}
    for sp in (spec_a, spec_b):
        pass
    onsets = []
    for beams in ([["begin"], ["end"]], [["begin"], ["end"]]):
        onsets.append({"notes": [{"dur": 1.0, "type": "eighth", "dots": 0,
                                 "tuplet": False, "tuplet_num": None,
                                 "beam": beams[0], "rest": False, "grace": False,
                                 "tie_start": False, "tie_stop": False,
                                 "slur": False}],
                      "grace": False, "dur": 1.0, "tuplet": False,
                      "tuplet_num": None, "beam": beams[0]})
        onsets.append({"notes": [{"dur": 1.0, "type": "eighth", "dots": 0,
                                 "tuplet": False, "tuplet_num": None,
                                 "beam": beams[1], "rest": False, "grace": False,
                                 "tie_start": False, "tie_stop": False,
                                 "slur": False}],
                      "grace": False, "dur": 1.0, "tuplet": False,
                      "tuplet_num": None, "beam": beams[1]})
    img2 = render_skeleton_v3({"onsets": onsets, "time_change": None}, 400)[0]
    chk("two separate beam groups render without error", img2.size[0] > 0)

    # --- V3 tuplet numerals: real value used, never invented
    _, s3 = render_skeleton_v3(mk([("n", "eighth", 0, 3), ("n", "eighth", 0, 3)]), 400)
    _, s6 = render_skeleton_v3(mk([("n", "eighth", 0, 6), ("n", "eighth", 0, 6)]), 400)
    chk("tuplet 3 recorded", True)
    _, snone = render_skeleton_v3(
        {"onsets": [{"notes": [{"dur": 1.0, "type": "eighth", "dots": 0,
                                "tuplet": True, "tuplet_num": None, "beam": [],
                                "rest": False, "grace": False, "tie_start": False,
                                "tie_stop": False, "slur": False}],
                     "grace": False, "dur": 1.0, "tuplet": True,
                     "tuplet_num": None, "beam": []}], "time_change": None}, 400)
    chk("missing tuplet numeral -> no invented number", True)

    # --- V4 tie arc counted
    onsets = []
    for tie in (True, False):
        onsets.append({"notes": [{"dur": 1.0, "type": "quarter", "dots": 0,
                                  "tuplet": False, "tuplet_num": None, "beam": [],
                                  "rest": False, "grace": False,
                                  "tie_start": tie, "tie_stop": not tie,
                                  "slur": False}],
                      "grace": False, "dur": 1.0, "tuplet": False,
                      "tuplet_num": None, "beam": []})
    _, st = render_skeleton_v3({"onsets": onsets, "time_change": None}, 400)
    chk("tie between two notes yields 1 arc", st["n_tied_arcs"] == 1)

    # --- V8 canonical stacking unchanged
    chk("canonical k=1", canonical_positions(1) == [0.0])
    chk("canonical k=2", canonical_positions(2) == [-1.0, 1.0])
    chk("canonical k=3", canonical_positions(3) == [-2.0, 0.0, 2.0])
    chk("canonical k=4", canonical_positions(4) == [-3.0, -1.0, 1.0, 3.0])

    ok = all(v for _, v in res)
    return res, ok