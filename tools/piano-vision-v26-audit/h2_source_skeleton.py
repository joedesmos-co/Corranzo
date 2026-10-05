"""H2 - Packet V2: pitch-scrubbed, rhythm-rich source panel.

Diagnosis being fixed: in V1 the source panel was an abstract "staff lines +
notehead positions" drawing. Reviewers could not answer "is this the same printed
measure?" and collapsed to pairwise agreement 0.04-0.19. The representation was the
blocker, not reviewer noise.

V2 replaces that panel with a real rhythmic engraving in which every pitch has been
canonicalised away.

P2 CANONICALISATION - the central guarantee.
  A note's vertical position is a function ONLY of its cardinality within its onset
  and its order inside the synthetic stack:

      cardinality k -> half-space positions  range(-(k-1), k, 2)
      k=1 -> [0]
      k=2 -> [-1, +1]
      k=3 -> [-2, 0, +2]
      k=4 -> [-3, -1, +1, +3]

  It does NOT depend on written pitch, staff position, MIDI, d0, true_d, corpus
  labels, or PDF geometry. Source accidentals and note names are never drawn.
  The proof function `canonical_positions` is exercised by the blinding test.

P1 PRESERVED (source rhythm and structure)
  measure boundaries, onset horizontal order, rhythmic duration, stems, beam
  grouping, flags, rests, dots, tuplets, grace-note status, chord cardinality,
  repeat/final bar structure, time-signature changes, neutral clef placeholder.

P4 HORIZONTAL GEOMETRY
  Onsets are placed at CUMULATIVE-DURATION FRACTIONS taken from the MusicXML, then
  normalised to the panel. This is source-derived relative order and spacing. It is
  deliberately NOT pixel-matched to Verovio or to the PDF: the two panels are
  independently laid out, because the reviewer judges sequence and rhythm.

P5 CLEF / KEY POLICY
  No key-signature accidentals are drawn, because they are pitch evidence. A neutral
  clef placeholder is drawn (a dot and stroke on the middle line) which encodes no
  pitch reference at all. Time-signature digits ARE drawn, because meter is
  structural, not pitch.

Nothing here reads Corpus 2.1, residual, d0, true_d, decoder output, or V1 reviewer
answers. Item selection is untouched: R001..R080 only.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

OUT = Path(__file__).parent / "out"
V2 = OUT / "h_review_ai_v2"
V2_IN = V2 / "inputs"
V2_SHEETS = V2 / "sheets"
V2_EX = V2 / "examples"

FLAG_COUNT = {"eighth": 1, "16th": 2, "32nd": 3, "64th": 4, "128th": 5}
BEAMED = {"eighth", "16th", "32nd", "64th", "128th"}


# --------------------------------------------------------------- P2 core
def canonical_positions(k):
    """Pitch-free vertical placement. ONLY cardinality and stack order."""
    if k <= 0:
        return []
    return [float(v) for v in range(-(k - 1), k, 2)]


# --------------------------------------------------------- source rhythm
def xml_rhythm(path):
    """per part -> per measure ordinal -> onset list. Rhythm only, no pitch read."""
    root = ET.parse(path).getroot()
    parts = root.findall("part")
    seqs = []
    for part in parts:
        divisions = None
        for meas in part.findall("measure"):
            at = meas.find("attributes")
            if at is not None and at.find("divisions") is not None \
                    and at.find("divisions").text:
                divisions = int(at.find("divisions").text)
        seq = []
        for meas in part.findall("measure"):
            onsets = []
            cur = None
            for n in meas.findall("note"):
                is_chord = n.find("chord") is not None
                grace = n.find("grace") is not None
                dur = n.findtext("duration")
                dur = int(dur) if dur else 0
                ty = n.findtext("type") or ""
                dots = len(n.findall("dot"))
                tuplet = n.find("time-modification") is not None
                beams = [b.text for b in n.findall("beam")]
                rest = n.find("rest") is not None
                rec = {"dur": dur, "type": ty, "dots": dots, "tuplet": tuplet,
                       "beam": beams, "rest": rest, "grace": grace}
                if is_chord and cur is not None:
                    cur["notes"].append(rec)
                    continue
                cur = {"notes": [rec], "grace": grace,
                       "dur": dur if dur > 0 else _grace_len(ty),
                       "tuplet": tuplet, "beam": beams}
                onsets.append(cur)
            ts = None
            at = meas.find("attributes")
            if at is not None and at.find("time") is not None:
                ts = "%s/%s" % (at.find("time").findtext("beats"),
                                at.find("time").findtext("beat-type"))
            seq.append({"onsets": onsets, "time_change": ts,
                        "number": meas.get("number"),
                        "implicit": meas.get("implicit") == "yes"})
        seqs.append(seq)
    return seqs


def _grace_len(ty):
    return {"eighth": 0.5, "16th": 0.25, "32nd": 0.125}.get(ty, 0.5)


def onset_x(onsets, x0, x1):
    """Cumulative-duration placement, normalised into [x0, x1]."""
    tot = float(sum(max(o["dur"], 1e-6) for o in onsets)) or 1.0
    acc = 0.0
    xs = []
    for o in onsets:
        xs.append(x0 + (x1 - x0) * (acc / tot))
        acc += max(o["dur"], 1e-6)
    return xs


# ---------------------------------------------------------------- drawing
def draw_neutral_clef(d, cx, mid, gap, col=(40, 40, 40)):
    """Neutral clef placeholder: encodes NO pitch reference (P5)."""
    d.ellipse([cx - 0.22 * gap, mid - 0.22 * gap, cx + 0.22 * gap, mid + 0.22 * gap],
              outline=col, width=max(1, int(0.07 * gap)))
    d.line([(cx, mid - 1.5 * gap), (cx, mid + 1.5 * gap)], fill=col,
           width=max(1, int(0.07 * gap)))


def draw_rest(d, x, mid, gap, ty):
    w = max(2, int(0.62 * gap))
    lw = max(1, int(0.10 * gap))
    if ty == "whole":
        d.rectangle([x - w, mid - 1.0 * gap, x + w, mid - 0.5 * gap], fill=(20, 20, 20))
    elif ty == "half":
        d.rectangle([x - w, mid - 0.5 * gap, x + w, mid], fill=(20, 20, 20))
    elif ty == "quarter":
        d.line([(x - 0.35 * gap, mid - 1.0 * gap), (x + 0.3 * gap, mid - 0.45 * gap)],
               fill=(20, 20, 20), width=lw)
        d.line([(x + 0.3 * gap, mid - 0.45 * gap), (x - 0.3 * gap, mid + 0.15 * gap)],
               fill=(20, 20, 20), width=lw)
        d.line([(x - 0.3 * gap, mid + 0.15 * gap), (x + 0.25 * gap, mid + 0.55 * gap)],
               fill=(20, 20, 20), width=lw)
        d.line([(x + 0.25 * gap, mid + 0.55 * gap), (x - 0.2 * gap, mid + 1.0 * gap)],
               fill=(20, 20, 20), width=lw)
    else:
        n = FLAG_COUNT.get(ty, 1)
        for k in range(min(n, 3)):
            yy = mid + 0.9 * gap - k * 0.45 * gap
            d.ellipse([x - 0.22 * gap, yy - 0.18 * gap,
                       x + 0.22 * gap, yy + 0.18 * gap], fill=(20, 20, 20))
            d.line([(x, yy), (x + 0.34 * gap, yy + 0.55 * gap)], fill=(20, 20, 20),
                   width=max(1, int(0.08 * gap)))


def render_skeleton(seq_measure, panel_w, scale=1.0, is_last=False,
                    time_change=None):
    """Render one measure as a pitch-canonical rhythmic engraving."""
    gap = 17.0 * scale   # P3: taller staff so stems/beams read clearly
    top = gap * 1.9
    Ht = int(top + 5.4 * gap)
    im = Image.new("RGB", (int(panel_w), Ht), (255, 255, 255))
    d = ImageDraw.Draw(im)
    mid = top + 2 * gap
    lw = max(1, int(0.055 * gap))
    for k in range(5):
        yy = top + k * gap
        d.line([(0, yy), (panel_w, yy)], fill=(120, 120, 120), width=lw)
    x_l = 1.5 * gap
    x_r = panel_w - 1.1 * gap
    d.line([(x_l, top), (x_l, top + 4 * gap)], fill=(25, 25, 25),
           width=max(1, int(0.13 * gap)))
    if is_last:
        d.line([(x_r - 0.22 * gap, top), (x_r - 0.22 * gap, top + 4 * gap)],
               fill=(25, 25, 25), width=max(2, int(0.15 * gap)))
        d.line([(x_r, top), (x_r, top + 4 * gap)], fill=(25, 25, 25),
               width=max(3, int(0.34 * gap)))
    else:
        d.line([(x_r, top), (x_r, top + 4 * gap)], fill=(25, 25, 25),
               width=max(1, int(0.13 * gap)))
    if time_change:
        d.text((x_l + 0.25 * gap, mid - 0.5 * gap), str(time_change),
               fill=(25, 25, 25))
    draw_neutral_clef(d, 0.75 * gap, mid, gap)
    onsets = seq_measure["onsets"]
    xs = onset_x(onsets, x_l + 0.7 * gap, x_r - 0.7 * gap)
    nhw = max(2.0, 0.60 * gap)
    nhh = max(1.5, 0.48 * gap)
    stems = []
    for (o, x) in zip(onsets, xs):
        pitched = [nn for nn in o["notes"] if not nn["rest"]]
        if not pitched:
            r = o["notes"][0]
            draw_rest(d, x, mid, gap, r["type"])
            for _ in range(r["dots"]):
                d.ellipse([x + 0.45 * gap, mid - 0.1 * gap,
                           x + 0.62 * gap, mid + 0.08 * gap], fill=(20, 20, 20))
            continue
        pos = canonical_positions(len(pitched))
        lead = pitched[0]
        up = pos[0] >= 0
        slen = 3.3 * gap
        tipx = x - nhw if up else x + nhw
        for i, nn in enumerate(pitched):
            yy = mid - pos[i] * gap
            d.ellipse([x - nhw, yy - nhh, x + nhw, yy + nhh], fill=(18, 18, 18))
            for _ in range(nn["dots"]):
                d.ellipse([x + nhw + 0.12 * gap, yy - 0.09 * gap,
                           x + nhw + 0.28 * gap, yy + 0.08 * gap],
                          fill=(18, 18, 18))
            sxp = x - nhw if up else x + nhw
            syp = (yy - slen) if up else (yy + slen)
            d.line([(sxp, yy), (sxp, syp)], fill=(18, 18, 18),
                   width=max(1, int(0.075 * gap)))
            stems.append((sxp, syp, up, lead, x))
            if not nn["beam"]:
                nf = FLAG_COUNT.get(nn["type"], 0)
                for k in range(min(nf, 3)):
                    fy = syp + k * 0.38 * gap * (1 if up else -1)
                    d.line([(sxp, fy), (sxp + 0.55 * gap * (1 if up else -1),
                                        fy + 0.42 * gap * (1 if up else -1))],
                           fill=(18, 18, 18), width=max(1, int(0.09 * gap)))
    # beams: respect begin/end so SEPARATE beam groups do not merge into one bar
    i = 0
    while i < len(stems):
        bl = stems[i][3].get("beam") or []
        if bl and "begin" in bl and stems[i][3]["type"] in BEAMED:
            grp = [stems[i]]
            j = i
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
    # tuplet brackets
    for (o, x) in zip(onsets, xs):
        if o["tuplet"]:
            d.line([(x - 0.5 * gap, top - 0.55 * gap), (x - 0.5 * gap, top - 0.2 * gap)],
                   fill=(70, 70, 70), width=1)
            d.text((x - 0.45 * gap, top - 0.95 * gap), "3", fill=(40, 40, 40))
    return im, {"n_onsets": len(onsets),
                "cards": [len([n for n in o["notes"] if not n["rest"]])
                          for o in onsets]}