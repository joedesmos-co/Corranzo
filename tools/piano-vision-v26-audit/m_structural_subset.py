"""M9-M10 - structurally complete subset on the FROZEN measure map, then the clean gate.

The map from m_measure_map.py is read-only here and its hash is verified first.
Because a mapped measure now carries a MusicXML ordinal, the Verovio side is
reached by MEASURE ORDINAL in document order - no staff-system alignment, no
pagination, no x-fraction matching. That removes the mechanism that produced the
Stage C contamination.

Membership uses structure only: equal onset-group count, equal per-onset
cardinality, unambiguous monotone order, unambiguous vertical rank. Note y is read
solely to rank and to detect unison/displaced-second ambiguity, both structural.
No pitch, d0, true_d, residual or decoder result enters membership.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from l_note_correspondence import load_pdf_systems  # noqa: E402
from m_measure_map import pdf_intervals  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
OUT = Path(__file__).parent / "out"
ONSET_GAPS = 0.8     # a notehead is ~1 staff space wide
ONSET_FAR = 0.5      # beyond this the onset correspondence is ambiguous
RANK_AMBIG_GAPS = 0.25
USABLE = ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
          "HIGH_CONFIDENCE_COUNT_ANCHORED")


def vx_measures(mpath):
    """Measure ordinal in document order -> per-role notes and barline bounds."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return []
    seq = []
    for pg in range(1, tk.getPageCount() + 1):
        root = ET.fromstring(tk.renderToSVG(pg))
        for meas in root.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            mbars = []
            for bl in meas.iter(SVGNS + "g"):
                if bl.get("class") != "barLine":
                    continue
                for p_ in bl.findall(SVGNS + "path"):
                    dn = [float(z) for z in
                          re.findall(r"-?\d+(?:\.\d+)?", p_.get("d") or "")]
                    if len(dn) >= 4 and abs(dn[0] - dn[2]) < 1e-9:
                        mbars.append((dn[0] + dn[2]) / 2.0)
            roles = []
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                lines = []
                for p_ in st.findall(SVGNS + "path"):
                    dn = [float(z) for z in
                          re.findall(r"-?\d+(?:\.\d+)?", p_.get("d") or "")]
                    if len(dn) >= 4 and abs(dn[1] - dn[3]) < 1e-6 \
                            and abs(dn[0] - dn[2]) > 1e-6:
                        lines.append(float(dn[1]))
                if len(lines) < 5:
                    continue
                lines = sorted(lines)[:5]
                gap = float(np.median(np.diff(lines)))
                if gap <= 0:
                    continue
                mid = lines[2]
                notes = []
                for nt in st.iter(SVGNS + "g"):
                    if nt.get("class") != "note":
                        continue
                    for nh in nt.iter(SVGNS + "g"):
                        if nh.get("class") != "notehead":
                            continue
                        for use in nh.findall(SVGNS + "use"):
                            mm = re.search(r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                           use.get("transform") or "")
                            if mm:
                                notes.append((float(mm.group(1)),
                                              (mid - float(mm.group(2))) / gap))
                roles.append({"gap": gap, "notes": notes})
            if len(roles) >= 2:
                seq.append({"page": pg, "upper": roles[0], "lower": roles[1],
                            "right_bar": max(mbars) if mbars else None})
    for k, m in enumerate(seq):
        m["ord"] = k
    return seq


def cluster(vals, tol):
    if not vals:
        return []
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    gs, cur = [], [order[0]]
    for k in order[1:]:
        if vals[k] - vals[cur[-1]] <= tol:
            cur.append(k)
        else:
            gs.append(cur)
            cur = [k]
    gs.append(cur)
    return gs


def main():
    man = json.load(open(OUT / "M7_measure_map.json"))
    want = (OUT / "M7_measure_map.sha256").read_text().strip()
    got = hashlib.sha256(json.dumps(man, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()
    print("M9  structural subset on the FROZEN measure map\n")
    print("  map entries : %d" % len(man))
    print("  sha256 match: %s" % (got == want))
    if got != want:
        print("  ABORT: measure map does not match its freeze hash.")
        return
    usable = [m for m in man if m["mapping_class"] in USABLE]
    print("  usable (anchored / high-confidence) measures : %d" % len(usable))
    print("  by class: %s" % dict(Counter(m["mapping_class"] for m in usable)))

    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    systems = json.load(open(OUT / "F_systems.json"))
    iv = pdf_intervals(systems)
    ivkey = {(r["score"], r["ord"]): r for r in iv}

    idx = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sids = sorted({m["score"] for m in usable})
    vcache = {}
    ccache = {}
    imgs = {}

    def wh(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            if p.is_file():
                a = np.array(__import__("PIL.Image", fromlist=["Image"]).open(p))
                imgs[k] = a.shape[1], a.shape[0]
            else:
                imgs[k] = None
        return imgs[k]

    # corpus system (page,sidx) -> canonical raster system, by upper band y0
    canon = defaultdict(list)
    for sy in systems:
        canon[(sy["score"], sy["page"])].append(sy)
    rej = Counter()
    ngrp = [0, 0]
    rows = []
    for sid in sids:
        if sid not in vcache:
            mp = H.V26_ROOT / sm[sid]["musicxml"]
            vcache[sid] = vx_measures(mp) if mp.is_file() else []
        vx = vcache[sid]
        if sid not in ccache:
            ccache[sid] = load_pdf_systems(sid)
        cp = ccache[sid]
        for m in [z for z in usable if z["score"] == sid]:
            r = ivkey.get((sid, m["pdf_ord"]))
            if r is None or m["xml_ord"] is None:
                rej["no_interval_geometry"] += 1
                continue
            if m["xml_ord"] >= len(vx):
                rej["xml_ord_out_of_range"] += 1
                continue
            dim = wh(sid, m["page"])
            if dim is None:
                rej["no_raster"] += 1
                continue
            W = dim[0]
            pl, pr = r["x_left"] / W, r["x_right"] / W
            # bind the corpus notes for this page+system
            cands = [(k, sd) for k, sd in cp.items()
                     if k[0] == m["page"] and sd["upper"] and sd["lower"]]
            match = None
            for (pno, sidx), sd in cands:
                for sy in canon[(sid, m["page"])]:
                    if abs(sy["upper"][0] - sd["upper"][0]) < 0.002:
                        match = sd
                        break
                if match:
                    break
            if match is None:
                rej["corpus_system_unbound"] += 1
                continue
            vm = vx[m["xml_ord"]]
            for role in ("upper", "lower"):
                vs = vm[role]
                vnotes = vs["notes"]
                pnotes = [n for n in match["notes"][role] if pl <= n["x"] < pr]
                if not vnotes or not pnotes:
                    rej["empty_side"] += 1
                    continue
                # measure spans from each side's own barlines
                vspan = (min(x for x, _ in vnotes), max(x for x, _ in vnotes))
                vw = vspan[1] - vspan[0]
                pw = pr - pl
                if vw <= 0 or pw <= 0:
                    rej["degenerate_span"] += 1
                    continue
                ptol = ONSET_GAPS * (r["gap"] / W) / pw
                vtol = ONSET_GAPS * vs["gap"] / vw
                PG = cluster([(n["x"] - pl) / pw for n in pnotes], ptol)
                VG = cluster([(x - vspan[0]) / vw for x, _ in vnotes], vtol)
                if not PG or not VG:
                    rej["empty_onsets"] += 1
                    continue
                ngrp[0] += 1
                if len(PG) != len(VG):
                    rej["onset_group_count_differs"] += 1
                    continue
                bad = None
                for gi, (pg, vg) in enumerate(zip(PG, VG)):
                    if len(pg) != len(vg):
                        bad = "onset_cardinality_differs"
                        break
                    px = float(np.mean([(pnotes[k]["x"] - pl) / pw for k in pg]))
                    vx_ = float(np.mean([(vnotes[k][0] - vspan[0]) / vw for k in vg]))
                    if abs(px - vx_) > ONSET_FAR:
                        bad = "onset_correspondence_ambiguous"
                        break
                if bad:
                    rej[bad] += 1
                    continue
                pairs = []
                ok = True
                for gi, (pg, vg) in enumerate(zip(PG, VG)):
                    a_ = sorted(((pnotes[k]["y"], pnotes[k]["oi"],
                                  pnotes[k]["d0"], pnotes[k]["true_d"]) for k in pg),
                                key=lambda z: -z[0])
                    b_ = sorted((vnotes[k][1] for k in vg), reverse=True)
                    if any(abs(a_[t][0] - a_[t + 1][0]) < RANK_AMBIG_GAPS
                           for t in range(len(a_) - 1)) or \
                       any(abs(b_[t] - b_[t + 1]) < RANK_AMBIG_GAPS
                           for t in range(len(b_) - 1)):
                        ok = False
                        rej["rank_ambiguous"] += 1
                        break
                    for t in range(len(a_)):
                        pairs.append({"score": sid, "page": m["page"], "role": role,
                                      "xml_ord": m["xml_ord"], "pdf_ord": m["pdf_ord"],
                                      "mapping_class": m["mapping_class"],
                                      "onset_group": gi, "rank": t,
                                      "oi": int(a_[t][1]), "pdf_y": float(a_[t][0]),
                                      "xml_y": float(b_[t]),
                                      "d0": int(a_[t][2]),
                                      "true_d": (int(a_[t][3])
                                                 if a_[t][3] is not None else None)})
                if ok:
                    ngrp[1] += 1
                    rows.extend(pairs)

    print("\n  onset groups seen / structurally complete : %d / %d" % (ngrp[0], ngrp[1]))
    print("  frozen note pairs : %d" % len(rows))
    print("  rejection reasons: %s" % dict(rej.most_common()))
    rows.sort(key=lambda r: (r["score"], r["xml_ord"], r["role"],
                             r["onset_group"], r["rank"]))
    H.write_json("M9_subset.json", rows)
    hsh = hashlib.sha256(json.dumps(rows, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()
    with open(OUT / "M9_subset.sha256", "w") as f:
        f.write(hsh + "\n")
    print("\nM9  FROZEN STRUCTURAL SUBSET")
    print("  entries : %d" % len(rows))
    print("  sha256  : %s" % hsh)
    print("  scores  : %s" % dict(Counter(r["score"] for r in rows)))

    # ---------------------------------------------------------------- M10
    for r in rows:
        r["delta_space"] = r["xml_y"] - r["pdf_y"]
        r["r_render"] = int(np.round(2 * r["delta_space"]))
        r["r_corpus"] = (r["true_d"] - r["d0"]) if r["true_d"] is not None else None
    clean = [r for r in rows if r["r_corpus"] == 0]
    print("\nM10  CLEAN CONTROL on the frozen subset (r_corpus = 0)")
    print("  N                    : %d" % len(clean))
    if not clean:
        print("  |delta_space|<0.25   : NOT EVALUATED (N = 0)")
        print("  r_render == 0        : NOT EVALUATED (N = 0)")
        print("  GATE: NOT EVALUATED - N=0 is never PASS or FAIL")
    else:
        v = np.array([r["delta_space"] for r in clean])
        inb = float((np.abs(v) < 0.25).mean())
        r0 = float(np.mean([r["r_render"] == 0 for r in clean]))
        print("  median delta_space   : %+.5f" % np.median(v))
        print("  p10 / p90            : %+.4f / %+.4f"
              % (np.percentile(v, 10), np.percentile(v, 90)))
        print("  |delta_space|<0.25   : %.4f  (need > 0.98)" % inb)
        print("  r_render == 0        : %.4f  (need > 0.98)" % r0)
        print("  GATE: %s" % ("PASS" if (inb > 0.98 and r0 > 0.98) else "FAIL"))
        byc = defaultdict(list)
        for r in clean:
            byc[r["mapping_class"]].append(r)
        print("  clean rate by mapping class:")
        for k, rs in sorted(byc.items()):
            vv = np.array([x["delta_space"] for x in rs])
            print("    %-32s N=%-4d |d|<0.25 %.4f  median %+.4f"
                  % (k, len(rs), float((np.abs(vv) < 0.25).mean()), np.median(vv)))
    # ------------------------------------------------- M11 / M13 forensics
    print("\nM11  forensics on PRE-FROZEN map metadata (no tuning from residuals)")
    allrows = rows
    print("  onset groups seen=%d complete=%d  pairs=%d"
          % (ngrp[0], ngrp[1], len(allrows)))
    print("  mapping class of every frozen pair: %s"
          % dict(Counter(r["mapping_class"] for r in allrows)))
    print("  incomplete causes: %s" % dict(rej.most_common()))
    print("\nM13  label shortfall on the usable measures (the actionable number)")
    need = Counter()
    for sid in sids:
        vm = vcache[sid]
        cp = ccache[sid]
        for m in [z for z in usable if z["score"] == sid]:
            xo = m["xml_ord"]
            if xo is None or xo >= len(vm):
                need[(sid, "xml_ord_out_of_range")] += 1
                continue
            cands = [(k, sd) for k, sd in cp.items()
                     if k[0] == m["page"] and sd["upper"] and sd["lower"]]
            match = None
            for (pno, sidx), sd in cands:
                for sy in canon[(sid, m["page"])]:
                    if abs(sy["upper"][0] - sd["upper"][0]) < 0.002:
                        match = sd
                        break
                if match:
                    break
            if match is None:
                need[(sid, "no_corpus_system_for_this_staff")] += 1
                continue
            for role in ("upper", "lower"):
                vn = len(vm[xo][role]["notes"])
                pn = len(match["notes"][role])
                if vn == 0:
                    continue
                if pn == 0:
                    need[(sid, "role_no_corpus_labels")] += 1
                elif pn < vn:
                    need[(sid, "corpus_labels_fewer_than_rendered")] += (vn - pn)
    for (sid, why), n in sorted(need.items(), key=lambda z: (-z[1], z[0])):
        print("    %-42s %-38s %d" % (sid[:42], why, n))
    H.write_json("M10_clean_rows.json", rows)


if __name__ == "__main__":
    main()