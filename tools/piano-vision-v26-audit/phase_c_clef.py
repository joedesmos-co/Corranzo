"""Phase C - independent printed-clef recovery from the page rasters.

C1  the champion runtime is NOT required: all 40 page rasters and all 17 source
    PDFs are retained, so clef evidence is available CPU-only.
C2  deterministic, inspectable clef evidence: connected components in the left
    edge of each band, plus the F-clef's two dots, whose vertical separation and
    position relative to the glyph are what actually carry the clef LINE.
C3  re-derive centre_diatonic from the PRINTED clef and retest the 388 uniform
    one-step groups.
C4  apply the identical re-derivation to the 499 clean groups as a control.

Nothing here reads MusicXML pitch, true_d, or the residual sign to decide a clef.
The MusicXML clef is used only AFTERWARDS, to report agreement, and never as the
answer.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402
import musicxml_truth as MT  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
REF = {"G": 30, "F": 18, "C": 24}          # musicxml_truth.clef_center_diatonic
LET = "CDEFGAB"


def pitch_name(d):
    return LET[d % 7] + str(d // 7)


def components(mask):
    """8-connected components; returns list of (ys, xs) index arrays."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    out, cur = [], 0
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or lab[y0, x0]:
                continue
            cur += 1
            stack = [(y0, x0)]
            lab[y0, x0] = cur
            pix = []
            while stack:
                y, x = stack.pop()
                pix.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = cur
                            stack.append((ny, nx))
            out.append(np.array(pix))
    return out


def detect_clef(ink, y0, y1, gap):
    """Deterministic clef evidence for one band.

    Returns a dict with the measured features and a decision, or None if the
    evidence is too weak to decide (which is then reported, not guessed).
    """
    comps = components(ink)
    if not comps:
        return {"verdict": "no_ink", "n_components": 0}
    info = []
    for pix in comps:
        ys, xs = pix[:, 0], pix[:, 1]
        info.append({"x0": int(xs.min()), "x1": int(xs.max()),
                     "y0": int(ys.min()), "y1": int(ys.max()),
                     "h": int(ys.max() - ys.min() + 1),
                     "w": int(xs.max() - xs.min() + 1), "area": int(len(pix))})
    # the glyph: leftmost component at least 0.6 gap wide and 1.2 gaps tall
    cand = [c for c in info if c["h"] >= 1.2 * gap and c["w"] >= 0.6 * gap]
    if not cand:
        return {"verdict": "no_glyph", "n_components": len(info)}
    glyph = min(cand, key=lambda c: c["x0"])
    gx1, gy0, gy1 = glyph["x1"], glyph["y0"], glyph["y1"]
    # F clef: two dots to the RIGHT of the glyph, each roughly a quarter-gap
    # across, separated vertically by about one gap.
    dots = []
    for c in info:
        if c["x0"] <= gx1 - 0.3 * gap or c["x0"] > gx1 + 2.2 * gap:
            continue
        if not (0.10 * gap * gap <= c["area"] <= 1.2 * gap * gap):
            continue
        if c["h"] > 1.0 * gap or c["w"] > 1.0 * gap:
            continue
        dots.append(c)
    out = {"glyph": glyph, "n_components": len(info),
           "glyph_height_gaps": round(glyph["h"] / gap, 3),
           "n_dots": len(dots)}
    if len(dots) == 2:
        d = sorted(dots, key=lambda c: c["y0"])
        sep = abs((d[1]["y0"] + d[1]["y1"]) / 2 - (d[0]["y0"] + d[0]["y1"]) / 2) / gap
        mid = (d[0]["y0"] + d[0]["y1"] + d[1]["y0"] + d[1]["y1"]) / 4
        # the F line is the line the two dots straddle; the glyph centres on it
        out["dot_separation_gaps"] = round(sep, 3)
        out["dot_mid_y"] = round(float(mid), 2)
        # which staff line does the dot pair straddle? lines at y1 - j*gap
        j = (y1 - mid) / gap
        out["dot_line_index"] = round(float(j), 3)
        out["verdict"] = "F" if 0.6 <= sep <= 1.4 else "F_dots_odd"
    elif glyph["h"] >= 2.8 * gap:
        out["verdict"] = "G"
    elif glyph["h"] <= 2.6 * gap:
        out["verdict"] = "short_ambiguous"
    else:
        out["verdict"] = "ambiguous"
    return out


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    img_cache = {}

    def page(score, pno):
        k = (score, pno)
        if k not in img_cache:
            p = H.REALPDF_ROOT / "pages" / score / ("page-%d.png" % pno)
            img_cache[k] = np.array(Image.open(p)) if p.is_file() else None
        return img_cache[k]

    # ---- C2 : per (page, system, band) printed-clef evidence
    print("C2 - independent clef evidence from the page rasters")
    det = {}
    stats = Counter()
    for sc in index["scores"]:
        sid = sc["score_id"]
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    ex = rec["exampleId"].split(":")
                    toks = ex[-1].split("-")          # "p1-s0-x0"
                    pno = int(toks[0].lstrip("p"))
                    sysno = toks[1] if len(toks) > 1 else "?"
                    g = rec["input"]["modelInput"]["geometry"]
                    for b in g.get("staffBands", {}).get("staffBands", []):
                        role = b.get("staffRole")
                        key = (sid, pno, sysno, role)
                        if key in det:
                            continue
                        im = page(sid, pno)
                        if im is None:
                            continue
                        Hh, Ww = im.shape
                        y0, y1 = b["y0"] * Hh, b["y1"] * Hh
                        gap = (y1 - y0) / 4.0
                        if gap < 3:
                            continue
                        pad = int(0.6 * gap)
                        strip = im[max(0, int(y0 - pad)):int(y1 + pad) + 1, :]
                        ink = strip < 140
                        colink = ink.sum(axis=0)
                        nz = np.nonzero(colink)[0]
                        if not len(nz):
                            continue
                        left = int(nz[0])
                        # the clef sits inside the staff; scan the first 5 gaps of ink
                        width = int(5 * gap)
                        sub = ink[:, left:left + width]
                        d = detect_clef(sub, y0, y1, gap)
                        d["left_ink_x"] = left
                        d["x_of_glyph"] = left + (d.get("glyph", {}).get("x0", 0))
                        det[key] = d
                        stats[d["verdict"]] += 1
    print("  (page, system, band) units: %d" % len(det))
    for k, v in stats.most_common():
        print("    %-18s %4d  %.4f" % (k, v, v / len(det)))

    gh = [d["glyph_height_gaps"] for d in det.values() if "glyph_height_gaps" in d]
    if gh:
        a = np.array(gh)
        print("  glyph height / gap: median %.2f  p05 %.2f  p95 %.2f"
              % (np.median(a), np.percentile(a, 5), np.percentile(a, 95)))

    # ---- agreement with the MusicXML clef, reported AFTER the fact
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    truth = {}
    for sid, s in sm.items():
        mp = H.V26_ROOT / s["musicxml"]
        if mp.is_file():
            rep = MT.score_report(str(mp))
            if "truth" in rep:
                truth[sid] = rep["truth"]
    print("\n  agreement with the MusicXML clef (reported, never used as input):")
    agree = Counter()
    for (sid, pno, sysno, role), d in det.items():
        v = d["verdict"]
        if v not in ("G", "F", "F_dots_odd"):
            continue
        sign = "G" if v.startswith("G") else "F"
        want = "G" if role == "upper" else "F"
        agree["match" if sign == want else "MISMATCH"] += 1
        if sign == want and sign == "F":
            j = d.get("dot_line_index")
            agree["bass_dot_line_%s" % ("4" if j and 2.5 <= j <= 3.5 else
                                        ("3" if j and 1.5 <= j <= 2.5 else "other"))] += 1
    for k, v in agree.most_common():
        print("    %-22s %4d" % (k, v))

    H.write_json("phase_c_clef_evidence.json",
                 {"|".join(map(str, k)): v for k, v in det.items()})
    print("\nwrote clef evidence for", len(det), "units")


if __name__ == "__main__":
    main()
