"""S0-S1 - raster-only complexity features and a frozen SIMPLE-measure rule.

S0: nothing structural is changed here. Staff geometry, the barline detector, the
frozen measure map, MusicXML fingerprints and Corpus 2.1 are all read-only.

S1: complexity is measured from the PDF raster and frozen structural geometry only.
Forbidden and not read: pitch, d0, true_d, residual, decoder correctness, or any
agreement between PDF and MusicXML.

The SIMPLE rule is frozen from UNSUPERVISED raster statistics - the corpus-wide
median of each feature - before any residual is inspected. No threshold is chosen to
make the PDF agree with the second source.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402
from o_onset_detector import strip_lines, components, line_rows  # noqa: E402

OUT = Path(__file__).parent / "out"
DARK = 140

# morphology window for a notehead-shaped component, in staff gaps
W_MIN, W_MAX = 0.50, 2.30
H_MIN, H_MAX = 0.42, 1.85
FILL_MIN = 0.30
BEAM_GAPS = 4.0        # a horizontal run this long (outside staff lines) is a beam
STEM_H_GAPS = 3.0      # a component this tall and this thin is a stem
TEXT_H_GAPS = 2.2      # a component this tall is clef / timesig / text scale
OVERLAP_GAPS = 0.30


def features(im, y0, y1, x_lo, x_hi):
    """Raster-only complexity features for one staff-band + measure window."""
    rows, gap = line_rows(im, y0, y1)
    if rows is None or gap < 3:
        return None
    W = im.shape[1]
    a = max(0, int(x_lo))
    b = min(W, int(x_hi) + 1)
    if b - a < 8:
        return None
    top = int(round(y0))
    band = im[top:int(round(y1)) + 1, a:b] < DARK
    if band.size == 0:
        return None
    h, w = band.shape
    lrows = sorted({min(max(0, r - top), h - 1) for r in rows})
    clean = strip_lines(band, lrows, gap)

    lab, n = components(clean)
    morph, boxes = [], []
    n_stem = n_text = 0
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if not len(ys):
            continue
        y0c, y1c, x0c, x1c = ys.min(), ys.max(), xs.min(), xs.max()
        bw, bh = x1c - x0c + 1, y1c - y0c + 1
        fill = len(ys) / float(bw * bh)
        if bh > TEXT_H_GAPS * gap:
            n_text += 1
        if bh > STEM_H_GAPS * gap and bw <= 2.5:
            n_stem += 1
        if W_MIN * gap <= bw <= W_MAX * gap and H_MIN * gap <= bh <= H_MAX * gap \
                and fill >= FILL_MIN:
            morph.append(k)
            boxes.append((int(x0c), int(x1c), int(y0c), int(y1c)))
    # beam-like horizontal runs, measured OUTSIDE staff-line rows
    nb = band.copy()
    for r in lrows:
        nb[r] = False
    beam = 0
    for r in range(nb.shape[0]):
        row = np.nonzero(nb[r])[0]
        if not len(row):
            continue
        runs = np.split(row, np.nonzero(np.diff(row) > 1)[0] + 1)
        beam += sum(1 for rr in runs if len(rr) >= BEAM_GAPS * gap)
    # max simultaneity: how many noteheads share an x neighbourhood
    maxov = 0
    for i, (xa, xb, _, _) in enumerate(boxes):
        c = 1
        for j, (xc, xd, _, _) in enumerate(boxes):
            if i != j and not (xd < xa - OVERLAP_GAPS * gap
                               or xc > xb + OVERLAP_GAPS * gap):
                c += 1
        maxov = max(maxov, c)
    return {
        "gap": gap,
        "ink_density": float(band.mean()),
        "n_morph": len(morph),
        "n_morph_per_gap": len(morph) / max(1e-9, w / gap),
        "beam_runs": int(beam),
        "n_stem": int(n_stem),
        "n_text": int(n_text),
        "max_x_overlap": int(maxov),
        "width_px": int(w),
        "boxes": boxes,
    }


def main():
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
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}

    imgs = {}

    def img(sid, pno):
        """One page at a time; drop the previous page to bound RAM."""
        k = (sid, pno)
        if k not in imgs:
            if len(imgs) >= 2:
                imgs.clear()
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    rows = []
    for m in usable:
        sid, pno = m["score"], m["page"]
        r = iv.get((sid, m["pdf_ord"]))
        im = img(sid, pno)
        if r is None or im is None:
            continue
        Hh = im.shape[0]
        sy = bypage[(sid, pno)][m["system"]][m["system"]] if False else \
            bypage[(sid, pno)][m["system"]]
        rec = {"key": "%s|p%d|s%d|m%d" % (sid, pno, m["system"], m["xml_ord"]),
               "score": sid, "page": pno, "system": m["system"],
               "xml_ord": m["xml_ord"], "pdf_ord": m["pdf_ord"],
               "mapping_class": m["mapping_class"], "roles": {}}
        for role in ("upper", "lower"):
            y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
            rec["roles"][role] = features(im, y0, y1, r["x_left"], r["x_right"])
        rows.append(rec)

    ok = [r for r in rows if all(r["roles"].values())]
    print("S1  raster-only complexity features")
    print("  frozen high-confidence mapped measures : %d" % len(rows))
    print("  measures with usable features          : %d" % len(ok))

    # unsupervised thresholds = corpus-wide median of each feature
    keys = ("ink_density", "n_morph_per_gap", "beam_runs", "n_stem",
            "n_text", "max_x_overlap")
    med = {}
    for k in keys:
        vals = [f[k] for r in ok for f in r["roles"].values()]
        med[k] = float(np.median(vals))
    print("\n  unsupervised medians (the ONLY thing the rule is built from):")
    for k in keys:
        print("    %-18s median=%8.3f  max=%8.3f"
              % (k, med[k], max(f[k] for r in ok for f in r["roles"].values())))

    # ---- FROZEN SIMPLE RULE (no residual, no second-source agreement)
    def simple(f):
        return (f["ink_density"] <= med["ink_density"]
                and f["n_morph_per_gap"] <= med["n_morph_per_gap"]
                and f["beam_runs"] <= max(0, int(np.floor(med["beam_runs"])))
                and f["n_text"] == 0
                and f["max_x_overlap"] <= max(2, int(np.floor(med["max_x_overlap"]))))

    rule = {"version": "S1-v1", "basis": "unsupervised corpus-wide medians",
            "medians": med,
            "conditions": {
                "ink_density": "<= median",
                "n_morph_per_gap": "<= median",
                "beam_runs": "<= floor(median)",
                "n_text": "== 0 (no clef/timesig/text-scale component in window)",
                "max_x_overlap": "<= max(2, floor(median))"},
            "notehead_morphology": {"w_gaps": [W_MIN, W_MAX], "h_gaps": [H_MIN, H_MAX],
                                    "fill_min": FILL_MIN},
            "forbidden_inputs": ["pitch", "d0", "true_d", "residual",
                                 "decoder_correctness", "pdf_vs_musicxml_agreement"]}
    H.write_json("S1_simple_rule.json", rule)

    for r in ok:
        for role, f in r["roles"].items():
            f["simple"] = bool(simple(f))
            f.pop("boxes", None)
    n_simple_roles = sum(1 for r in ok for f in r["roles"].values() if f["simple"])
    n_simple_meas = sum(1 for r in ok
                        if all(f["simple"] for f in r["roles"].values()))
    n_any = sum(1 for r in ok if any(f["simple"] for f in r["roles"].values()))
    print("\n  SIMPLE staff-regions (measure x staff) : %d / %d"
          % (n_simple_roles, 2 * len(ok)))
    print("  measures with BOTH staves SIMPLE       : %d" % n_simple_meas)
    print("  measures with >=1 SIMPLE staff          : %d" % n_any)
    n_notes = sum(f["n_morph"] for r in ok for f in r["roles"].values() if f["simple"])
    print("  notehead-shaped components inside them  : %d" % n_notes)
    print("\n  wrote out/S1_features.json, out/S1_simple_rule.json")
    H.write_json("S1_features.json", ok)


if __name__ == "__main__":
    main()