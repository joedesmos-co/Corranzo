"""U0-U4 - units, continuous/discrete reconciliation, and exact identity.

The previous SOURCETRUTH run had an internal contradiction: it classified a group
as uniform+1 only when every round(2*delta) was +1 (hence every delta_space >=
0.25), yet reported a mean offset of 0.1211 spaces. Those are incompatible. This
script does not classify by the corpus residual and then re-report the same
numbers; it keeps the two sides INDEPENDENT and cross-tabulates them.

UNITS (U0), fixed once and used everywhere below:
  pdf_y_staff  : STAFF SPACES (== line-to-line gap), measured UP from the band
                 middle line. 1.0 = one line gap.
  xml_y_staff  : STAFF SPACES, measured UP from the staff middle line of the
                 Verovio render.
  delta_space  = pdf_y_staff - xml_y_staff          [staff spaces]
  delta_diatonic = 2 * delta_space                  [diatonic steps]
                  because one line gap spans two diatonic steps.
  d0          = MIDDLE_LINE[band] + round(2 * pdf_y_staff)
  true_d      = octave*7 + DIATONIC[step], and in the XML render that note sits
                at xml_y_staff, so true_d - MIDDLE_LINE = 2 * xml_y_staff.

So the corpus residual is exactly
  r_corpus = 2*xml_y_staff - round(2*pdf_y_staff)
and r_render = round(2*(xml_y_staff - pdf_y_staff)) is its discretisation.
These agree ONLY if |delta_space| >= 0.25 (U2 boundary).

IDENTITY (U3): the Verovio notehead used here is indexed by the RANK of the
corpus-assigned MusicXML event within that measure/band's document-ordered pitched
event list - not by list position in the object list.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402
import musicxml_truth as MT  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SVGNS = "{http://www.w3.org/2000/svg}"


def svg_blocks(svg_text):
    """(measure, staff) -> (gap, [notehead y_staff in document order])."""
    root = ET.fromstring(svg_text)
    out = {}
    m_idx = 0
    for meas in root.iter(SVGNS + "g"):
        if meas.get("class") != "measure":
            continue
        s_idx = 0
        for st in meas.iter(SVGNS + "g"):
            if st.get("class") != "staff":
                continue
            lines = []
            for p in st.findall(SVGNS + "path"):
                mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                              (p.get("d") or "").strip())
                if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                    lines.append(float(mm.group(2)))
            if len(lines) >= 5:
                lines = sorted(lines)[:5]
                gap = float(np.median(np.diff(lines)))
                mid = lines[2]
                ys = []
                for nh in st.iter(SVGNS + "g"):
                    if nh.get("class") != "notehead":
                        continue
                    for use in nh.findall(SVGNS + "use"):
                        mm = re.search(r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                       use.get("transform") or "")
                        if mm:
                            ys.append((mid - float(mm.group(2))) / gap)
                out[(m_idx, s_idx)] = {"gap": gap, "y_staff": ys}
            s_idx += 1
        m_idx += 1
    return out


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}

    # ---- Verovio render + the MusicXML event order, per score
    rendered, truth = {}, {}
    for sc in index["scores"]:
        sid = sc["score_id"]
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        if not mp.is_file():
            continue
        rep = MT.score_report(str(mp))
        if "truth" not in rep:
            continue
        truth[sid] = rep["truth"]
        tk = verovio.toolkit()
        if not tk.loadFile(str(mp)):
            continue
        per, base = {}, 0
        for pg in range(1, tk.getPageCount() + 1):
            part = svg_blocks(tk.renderToSVG(pg))
            for k, v in part.items():
                per[(base + k[0], k[1])] = v
            base += len({mi for (mi, _) in part})
        rendered[sid] = per
    print("U1 setup: %d scores rendered, %d measure-staff blocks"
          % (len(rendered), sum(len(v) for v in rendered.values())))

    cache = CACHE.load()
    ex_index = {str(e): i for i, e in enumerate(cache["example"])}

    rows = []
    rejected = Counter()
    for sc in index["scores"]:
        sid = sc["score_id"]
        if sid not in rendered:
            continue
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    ex = rec["exampleId"]
                    geom = rec["input"]["modelInput"]["geometry"]
                    bands = {b.get("staffRole"): b
                             for b in geom.get("staffBands", {}).get("staffBands", [])}
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None:
                            continue
                        v = fam.get("value") or {}
                        pos = v.get("staffPosition") or {}
                        wp = v.get("writtenPitch") or {}
                        role = v.get("staffRole")
                        ev = (fam.get("semanticEventIds") or [""])[0]
                        if (role not in MIDDLE or wp.get("step") not in DIATONIC
                                or wp.get("octave") is None or pos.get("sourceY") is None
                                or "-n" not in ev):
                            rejected["malformed_family"] += 1
                            continue
                        b = bands.get(role)
                        if not b:
                            rejected["no_band"] += 1
                            continue
                        mnum = int(ev.split("-n")[0][1:])
                        note_id = int(ev.split("-n")[1])
                        tm = truth[sid].measures[mnum - 1]
                        pitched = [e for e in tm.events
                                   if e.printed and e.band == role and not e.is_rest]
                        rank = next((i for i, e in enumerate(pitched)
                                     if e.xml_note_index == note_id), None)
                        if rank is None:
                            rejected["event_not_in_pitched_list"] += 1
                            continue
                        sidx = 0 if role == "upper" else 1
                        blk = rendered[sid].get((mnum - 1, sidx))
                        if blk is None or rank >= len(blk["y_staff"]):
                            rejected["no_rendered_notehead_at_rank"] += 1
                            continue
                        gap = float(pos["staffGapNormalized"])
                        mid = (b["y0"] + b["y1"]) / 2
                        pdf_y = (mid - float(pos["sourceY"])) / gap
                        xml_y = blk["y_staff"][rank]
                        true_d = int(wp["octave"]) * 7 + DIATONIC[wp["step"]]
                        d0 = MIDDLE[role] + int(np.round(2 * pdf_y))
                        ci = ex_index.get(ex)
                        ck = None
                        if ci is not None and oi < cache["emb"].shape[1] and \
                                bool(cache["object_mask"][ci][oi]) and \
                                bool(cache["mask"][ci][oi][1]):
                            ck = float(cache["staff"][ci][oi][0])
                        rows.append({"score": sid, "example": ex, "band": role,
                                     "object_index": int(oi), "event": ev,
                                     "rank": rank, "pdf_y": pdf_y, "xml_y": xml_y,
                                     "r_corpus": int(true_d - d0), "d0": d0,
                                     "true_d": true_d, "cached_k": ck})
    print("U3 - end-to-end identity-proven notes: %d   rejected: %s"
          % (len(rows), dict(rejected)))

    # ---- U4 cached-k cross-check on exactly this population
    ck_ok = [r for r in rows if r["cached_k"] is not None]
    if ck_ok:
        d = np.array([r["pdf_y"] - r["cached_k"] for r in ck_ok])
        print("U4  cached k vs k_from_pdf_source on this population: n=%d  "
              "mean %+.6f  std %.6f  max|.| %.6f staff spaces"
              % (len(ck_ok), d.mean(), d.std(), np.abs(d).max()))
        bad = sum(1 for r in ck_ok if r["d0"] != MIDDLE[r["band"]] + int(np.round(2 * r["cached_k"])))
        print("    d0 != MIDDLE + round(2*cached_k) for %d / %d notes" % (bad, len(ck_ok)))
    else:
        print("U4  cached k unavailable on this population (object_index is a "
              "measure-local index, not a cache slot) - reported as such, not guessed.")

    # ---- U1 confusion matrix
    def rnd(x):
        return int(np.round(x))

    conf = defaultdict(Counter)
    for r in rows:
        r["delta_space"] = r["pdf_y"] - r["xml_y"]
        r["delta_diatonic"] = 2 * r["delta_space"]
        r["r_render"] = rnd(2 * (r["xml_y"] - r["pdf_y"]))
        conf[r["r_corpus"]][r["r_render"]] += 1
    print("\nU1 - confusion matrix  rows = r_corpus (true_d - d0), "
          "cols = r_render = round(2*(xml_y - pdf_y))")
    cols = sorted({c for v in conf.values() for c in v})
    print("      " + "".join("%8s" % ("r=%+d" % c) for c in cols) + "     total   agree")
    for rc in sorted(conf):
        tot = sum(conf[rc].values())
        agr = conf[rc].get(rc, 0)
        print("  r=%+d" % rc + "".join("%8d" % conf[rc].get(c, 0) for c in cols)
              + "   %6d   %.4f" % (tot, agr / tot))
    allt = sum(sum(v.values()) for v in conf.values())
    agree = sum(conf[rc].get(rc, 0) for rc in conf)
    print("  TOTAL n=%d   r_corpus == r_render on %d  = %.4f" % (allt, agree, agree / allt))

    # ---- U2 rounding boundary
    print("\nU2 - delta_space distribution by corpus residual (staff spaces)")
    print("  population      n    median      p10      p25      p75      p90   "
          "  >=0.25    >=0.375")
    for rc in sorted(conf):
        v = np.array([abs(r["delta_space"]) for r in rows if r["r_corpus"] == rc])
        if not len(v):
            continue
        print("  r=%+d        %5d  %7.4f %8.4f %8.4f %8.4f %8.4f  %7.4f  %7.4f"
              % (rc, len(v), np.median(v), np.percentile(v, 10), np.percentile(v, 25),
                 np.percentile(v, 75), np.percentile(v, 90),
                 (v >= 0.25).mean(), (v >= 0.375).mean()))

    H.write_json("phase_u_rows.json", rows)
    print("\nwrote", H.write_json("phase_u_summary.json", {
        "n_identity_proven": len(rows),
        "rejected": dict(rejected),
        "confusion": {str(k): dict(v) for k, v in conf.items()},
        "overall_agreement": agree / allt}))


if __name__ == "__main__":
    main()
