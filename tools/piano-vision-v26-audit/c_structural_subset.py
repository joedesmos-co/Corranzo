"""C0-C4 - build and FREEZE a structurally complete subset, before any pitch is read.

Stages
  C0  freeze the structural measure mapping: PDF measure interval <-> Verovio
      measure, using barline order and interval order only. The PDF barlines come
      from the UNCHANGED validated cross-staff matcher; the Verovio barlines come
      from the SVG DOM. Measures pair by order and only when the counts agree, so
      an unresolved interval is rejected rather than guessed.
  C1  cluster labelled noteheads into onset groups inside each matched measure,
      each side by its own normalised x, with a geometry-derived tolerance.
  C2  structural completeness, judged WITHOUT any vertical or pitch information.
  C3  inside a complete group, pair notes by vertical rank only; reject groups
      where rank is ambiguous.
  C4  write the manifest and its sha256. Nothing here reads note y, pitch, d0,
      true_d or any residual - the frozen manifest is exactly the structural
      evidence, and C5 joins the corpus residuals only afterwards.
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
from PIL import Image
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
OUT = Path(__file__).parent / "out"
# A notehead is about one staff space wide, so two notes belong to one onset when
# their x differs by less than this many staff gaps. Read off the notation, not
# fitted to any gate.
ONSET_GAPS = 0.8
# Two onset groups further apart than this (in x_rel) are certainly different
# onsets; used only to flag a correspondence as ambiguous, never to accept one.
ONSET_FAR = 0.5
# Vertical positions closer than this (in staff gaps) cannot be ranked reliably.
RANK_AMBIG_GAPS = 0.25
# Two boundaries belong to each other when their positions inside their own
# staff agree this closely, as a fraction of staff width. It is a fraction, not
# a pixel tolerance, so it is invariant to the two renderers' scales.
BOUND_TOL = 0.12


# --------------------------------------------------------------------- PDF
def pdf_staff(im, band, Hh):
    """Validated barline map for one staff: extent, gap, and paired bar x."""
    y0, y1 = band[0] * Hh, band[1] * Hh
    sr = A2.staff_rows(im, y0, y1)
    if len(sr) < 3:
        return None
    x0, x1 = min(r[1] for r in sr), max(r[2] for r in sr)
    cd = A2.candidates(im, y0, y1, x0, x1, A2.CAND)
    if cd is None:
        return None
    cd["events"] = A2.cluster_events(cd["cands"], cd["gap"])
    return {"x0": x0, "x1": x1, "gap": cd["gap"], "events": cd["events"],
            "cands": cd["cands"]}


# ----------------------------------------------------------------- Verovio
def vx_page(mpath):
    """page -> [system], system = {role: {x0,x1,gap,bars,notes(x, y_staff)}}."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return {}
    out = {}
    for pg in range(1, tk.getPageCount() + 1):
        root = ET.fromstring(tk.renderToSVG(pg))
        staves = []
        for meas in root.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            # barLine is a child of MEASURE, not of staff, and carries one
            # vertical path per staff. Both staves share the barline x, so the
            # distinct x set is the measure boundary for either staff.
            mbars = []
            for bl in meas.iter(SVGNS + "g"):
                if bl.get("class") != "barLine":
                    continue
                for p_ in bl.findall(SVGNS + "path"):
                    dn = [float(z) for z in
                          re.findall(r"-?\d+(?:\.\d+)?", p_.get("d") or "")]
                    if len(dn) >= 4 and abs(dn[0] - dn[2]) < 1e-9:
                        mbars.append((dn[0] + dn[2]) / 2.0)
            mbars = sorted(set(round(z, 2) for z in mbars))
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                lines, bars = [], []
                for p in st.findall(SVGNS + "path"):
                    dnum = [float(z) for z in
                            re.findall(r"-?\d+(?:\.\d+)?", p.get("d") or "")]
                    if len(dnum) >= 4 and abs(dnum[1] - dnum[3]) < 1e-6 \
                            and abs(dnum[0] - dnum[2]) > 1e-6:
                        lines.append((dnum[1], min(dnum[0], dnum[2]),
                                      max(dnum[0], dnum[2])))
                if len(lines) < 5:
                    continue
                lines = sorted(lines)[:5]
                gap = float(np.median(np.diff([z[0] for z in lines])))
                mid = lines[2][0]
                if gap <= 0:
                    continue
                xs = [z[1] for z in lines] + [z[2] for z in lines]
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
                staves.append({"y_top": lines[0][0], "gap": gap,
                               "x0": min(xs), "x1": max(xs),
                               "bars": list(mbars), "notes": notes})
        merged = []
        for s in sorted(staves, key=lambda z: z["y_top"]):
            if merged and abs(s["y_top"] - merged[-1]["y_top"]) < 0.5 * s["gap"]:
                mg = merged[-1]
                mg["notes"].extend(s["notes"])
                mg["bars"] = sorted(set(mg["bars"]) | set(s["bars"]))
                mg["x0"] = min(mg["x0"], s["x0"])
                mg["x1"] = max(mg["x1"], s["x1"])
            else:
                merged.append(dict(s, notes=list(s["notes"]), bars=list(s["bars"])))
        systems = []
        i = 0
        while i < len(merged):
            for j in range(i + 1, len(merged)):
                gg = (merged[j]["y_top"] - (merged[i]["y_top"] + 4 * merged[i]["gap"])) \
                    / merged[i]["gap"]
                if 2.0 <= gg <= 14.0 and \
                        min(merged[i]["x1"], merged[j]["x1"]) > max(merged[i]["x0"], merged[j]["x0"]):
                    systems.append({"upper": merged[i], "lower": merged[j],
                                    "y": merged[i]["y_top"], "gap": merged[i]["gap"]})
                    i = j + 1
                    break
            else:
                i += 1
        out[pg] = sorted(systems, key=lambda z: z["y"])
    return out


# ------------------------------------------------------------------- onsets
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
    systems = json.load(open(OUT / "F_systems.json"))
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    imgs = {}

    def page_img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    vcache = {}
    # ---- C0 : per-system validated barline map on both sides
    sysrows = []
    for sy in systems:
        sid, pno = sy["score"], sy["page"]
        im = page_img(sid, pno)
        if im is None:
            continue
        Hh = im.shape[0]
        ps = {r: pdf_staff(im, sy[r], Hh) for r in ("upper", "lower")}
        if not ps["upper"] or not ps["lower"]:
            continue
        g = max(ps["upper"]["gap"], ps["lower"]["gap"])
        pr = A2.cross_staff(ps["upper"]["events"], ps["lower"]["events"],
                            A2.CONS_TOL_GAPS * g)
        pr = [(i, j, d) for i, j, d in pr if abs(d) <= A2.CONS_STRICT_GAPS * g]
        if len(pr) < 2:
            continue
        bars = [0.5 * (ps["upper"]["events"][i]["x"] + ps["lower"]["events"][j]["x"])
                for i, j, _ in pr]
        sysrows.append({"score": sid, "page": pno, "y0": sy["y0"], "kind": sy["kind"],
                        "bars": sorted(bars),
                        "staff": {r: {"x0": ps[r]["x0"], "x1": ps[r]["x1"],
                                      "gap": ps[r]["gap"]} for r in ps}})
    print("C0  validated structural barline map")
    print("  PDF systems with a paired barline map : %d" % len(sysrows))

    # align each PDF system to a Verovio system by vertical position on the page
    by_page = defaultdict(list)
    for r in sysrows:
        by_page[(r["score"], r["page"])].append(r)
    c0 = []
    rej = Counter()
    for (sid, pno), rows in sorted(by_page.items()):
        if sid not in vcache:
            mp = H.V26_ROOT / sm[sid]["musicxml"]
            vcache[sid] = vx_page(mp) if mp.is_file() else {}
        vs = vcache[sid].get(pno, [])
        if not vs:
            rej["no_verovio_page"] += 1
            continue
        pys = [r["y0"] for r in rows]
        vys = [v["y"] for v in vs]
        pmin, pmax = min(pys), max(pys)
        vmin, vmax = min(vys), max(vys)
        if pmax <= pmin or vmax <= vmin:
            rej["degenerate_page"] += 1
            continue
        pool = list(vs)
        for r in sorted(rows, key=lambda z: z["y0"]):
            if not pool:
                rej["verovio_pool_exhausted"] += 1
                break
            pf = (r["y0"] - pmin) / (pmax - pmin)
            k = min(range(len(pool)), key=lambda z: abs((pool[z]["y"] - vmin)
                                                        / (vmax - vmin) - pf))
            v = pool.pop(k)
            dpos = abs((v["y"] - vmin) / (vmax - vmin) - pf)
            if dpos > 0.34:
                rej["system_position_far"] += 1
                continue
            for role in ("upper", "lower"):
                pst, vst = r["staff"][role], v[role]
                # Align BOUNDARIES, not measure counts. The two renderings need
                # not break a system into the same number of measures - the
                # deltas are symmetric around zero (+1 and -1 equally common) -
                # so requiring equal counts would throw away almost everything.
                # Instead match barline boundaries monotonically by position
                # within the system, then call a measure mapped only when BOTH of
                # its boundaries are matched. Measures beside an unmatched
                # boundary are rejected, not guessed.
                pw = pst["x1"] - pst["x0"]
                vw = vst["x1"] - vst["x0"]
                if pw <= 0 or vw <= 0:
                    rej["degenerate_staff_width"] += 1
                    continue

                def dedup(bx, x0, x1, gap):
                    out_ = [x0]
                    for b in bx:
                        if b > out_[-1] + 0.5 * gap and b < x1 - 0.5 * gap:
                            out_.append(b)
                    out_.append(x1)
                    return out_

                PB = dedup(r["bars"], pst["x0"], pst["x1"], pst["gap"])
                VB = dedup(vst["bars"], vst["x0"], vst["x1"], vst["gap"])
                pf = [(x - pst["x0"]) / pw for x in PB]
                vf = [(x - vst["x0"]) / vw for x in VB]

                # monotone alignment of the two boundary lists
                n, m = len(pf), len(vf)
                Dp = np.full((n + 1, m + 1), np.inf)
                Bk = np.zeros((n + 1, m + 1), np.int8)
                Dp[0, 0] = 0.0
                GAPP = 1.0
                for i in range(1, n + 1):
                    Dp[i, 0] = Dp[i - 1, 0] + GAPP
                    Bk[i, 0] = 1
                for j in range(1, m + 1):
                    Dp[0, j] = Dp[0, j - 1] + GAPP
                    Bk[0, j] = 2
                for i in range(1, n + 1):
                    for j in range(1, m + 1):
                        cst = abs(pf[i - 1] - vf[j - 1]) / BOUND_TOL
                        best, arg = Dp[i - 1, j - 1] + cst, 0
                        if Dp[i - 1, j] + GAPP < best:
                            best, arg = Dp[i - 1, j] + GAPP, 1
                        if Dp[i, j - 1] + GAPP < best:
                            best, arg = Dp[i, j - 1] + GAPP, 2
                        Dp[i, j], Bk[i, j] = best, arg
                aligned = []
                i, j = n, m
                while i > 0 and j > 0:
                    a_ = Bk[i, j]
                    if a_ == 0:
                        aligned.append((i - 1, j - 1))
                        i, j = i - 1, j - 1
                    elif a_ == 1:
                        i -= 1
                    else:
                        j -= 1
                aligned = sorted(aligned)
                matched = [(i_, j_) for i_, j_ in aligned
                           if abs(pf[i_] - vf[j_]) <= BOUND_TOL]
                nmapped = 0
                for t in range(len(matched) - 1):
                    (i1, j1), (i2, j2) = matched[t], matched[t + 1]
                    if i2 != i1 + 1 or j2 != j1 + 1:
                        rej["measure_spans_unmatched_boundary"] += 1
                        continue
                    nmapped += 1
                    c0.append({"score": sid, "page": pno, "role": role,
                               "status": "MAPPED", "measure_index": t,
                               "p_left": PB[i1], "p_right": PB[i2],
                               "v_left": VB[j1], "v_right": VB[j2],
                               "p_staff": [pst["x0"], pst["x1"]],
                               "v_staff": [vst["x0"], vst["x1"]],
                               "p_gap": pst["gap"], "v_gap": vst["gap"],
                               "align_frac": [abs(pf[i1] - vf[j1]),
                                              abs(pf[i2] - vf[j2])],
                               "v_notes": vst["notes"]})
                if nmapped == 0:
                    rej["no_contiguous_measure_span"] += 1

    mapped = [c for c in c0 if c["status"] == "MAPPED"]
    print("  measure maps MAPPED (both bounds) : %d" % len(mapped))
    print("  structurally mapped measures      : %d" % len(mapped))
    print("  rejection reasons: %s" % dict(rej.most_common()))
    H.write_json("C0_measure_map.json",
                 [{k: v for k, v in c.items() if k != "v_notes"} for c in c0])
    json.dump(c0, open(OUT / "C0_measure_map_full.json", "w"))

    # ------------------------------------------------------------------ C1-C4
    from l_note_correspondence import load_pdf_systems
    corpus = {}
    for sc_ in json.loads((H.REALPDF_ROOT / "index.json").read_text())["scores"]:
        if sc_["score_id"] in corpus:
            continue
        corpus[sc_["score_id"]] = load_pdf_systems(sc_["score_id"])

    def raster_wh(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        if imgs[k] is None:
            return None
        return imgs[k].shape[1], imgs[k].shape[0]

    # canonical raster systems, keyed by (score, page) and upper-band y0
    canon = defaultdict(list)
    for sy in systems:
        canon[(sy["score"], sy["page"])].append(sy)

    # ---- C0b bind each corpus system to its validated raster measure map
    meas = defaultdict(list)
    for c in c0:
        if c["status"] == "MAPPED":
            meas[(c["score"], c["page"], c["role"])].append(c)

    groups = []
    incomplete = Counter()
    ngroups = [0, 0]
    for sid, sysd in corpus.items():
        for (pno, sidx), sd in sorted(sysd.items()):
            if not (sd["upper"] and sd["lower"]):
                continue
            wh = raster_wh(sid, pno)
            if wh is None:
                continue
            W, Hh = wh
            match = None
            for sy in canon.get((sid, pno), []):
                if abs(sy["upper"][0] - sd["upper"][0]) < 0.002:
                    match = sy
                    break
            if match is None:
                incomplete["system_not_in_validated_raster_map"] += 1
                continue
            for role in ("upper", "lower"):
                ms = meas.get((sid, pno, role), [])
                if not ms:
                    incomplete["no_mapped_measure"] += 1
                    continue
                notes = sd["notes"][role]
                if not notes:
                    incomplete["no_corpus_notes"] += 1
                    continue
                pgap_n = match[role] and None
                for mc in ms:
                    pl, pr = mc["p_left"] / W, mc["p_right"] / W
                    if pr <= pl:
                        continue
                    pset = [n for n in notes if pl <= n["x"] < pr]
                    vnotes = [(x, y) for x, y in mc["v_notes"] if
                              mc["v_left"] <= x < mc["v_right"]]
                    # ---- C1 onset clusters, x_rel inside the measure only
                    pgap_x = (mc["p_right"] - mc["p_left"]) / W
                    vgap_x = mc["v_right"] - mc["v_left"]
                    ptol = ONSET_GAPS * (mc["p_gap"] / W) / max(1e-9, pgap_x)
                    vtol = ONSET_GAPS * mc["v_gap"] / max(1e-9, vgap_x)
                    PG = cluster([(n["x"] - pl) / (pr - pl) for n in pset], ptol)
                    VG = cluster([(x - mc["v_left"]) / vgap_x for x, _ in vnotes], vtol)
                    if not PG or not VG:
                        incomplete["empty_measure"] += 1
                        continue
                    ngroups[0] += 1
                    # ---- C2 structural completeness, no y and no pitch
                    if len(PG) != len(VG):
                        incomplete["onset_group_count_differs"] += 1
                        continue
                    bad = None
                    for gi, (pg, vg) in enumerate(zip(PG, VG)):
                        if len(pg) != len(vg):
                            bad = "onset_cardinality_differs"
                            break
                        px = float(np.mean([(pset[k]["x"] - pl) / (pr - pl)
                                            for k in pg]))
                        vx = float(np.mean([(vnotes[k][0] - mc["v_left"]) / vgap_x
                                            for k in vg]))
                        if abs(px - vx) > ONSET_FAR:
                            bad = "onset_correspondence_ambiguous"
                            break
                    if bad:
                        incomplete[bad] += 1
                        continue
                    ngroups[1] += 1
                    # ---- C3 pair by vertical rank, reject ambiguity, no y-min
                    used = 0
                    pairs = []
                    ok = True
                    for gi, (pg, vg) in enumerate(zip(PG, VG)):
                        a_ = sorted(((pset[k]["y"], pset[k]["oi"],
                                      pset[k]["d0"], pset[k]["true_d"]) for k in pg),
                                    key=lambda z: -z[0])
                        b_ = sorted((vnotes[k][1] for k in vg), reverse=True)
                        if any(abs(a_[t][0] - a_[t + 1][0]) < RANK_AMBIG_GAPS
                               for t in range(len(a_) - 1)):
                            ok = False
                            incomplete["pdf_rank_ambiguous"] += 1
                            break
                        if any(abs(b_[t] - b_[t + 1]) < RANK_AMBIG_GAPS
                               for t in range(len(b_) - 1)):
                            ok = False
                            incomplete["verovio_rank_ambiguous"] += 1
                            break
                        for t in range(len(a_)):
                            pairs.append({"score": sid, "page": pno, "role": role,
                                          "measure_index": mc["measure_index"],
                                          "onset_group": gi, "rank": t,
                                          "corpus_oi": int(a_[t][1]),
                                          "corpus_obj_key": "%s:%d" % (sid, a_[t][1]),
                                          "verovio_id": "%s:p%d:sys%d:%s:m%d:g%d:r%d"
                                          % (sid, pno, sidx, role, mc["measure_index"],
                                             gi, t),
                                          "pdf_y": float(a_[t][0]),
                                          "xml_y": float(b_[t]),
                                          "reason": "aligned_both_boundaries;"
                                                    "equal_onsets;equal_cardinality;"
                                                    "rank_pair"})
                        used += len(a_)
                    if ok:
                        groups.extend(pairs)

    print("\nC1-C3  onset clustering, completeness and rank pairing")
    print("  frozen note pairs (structurally justified) : %d" % len(groups))
    print("  onset groups seen / structurally complete : %d / %d"
          % (ngroups[0], ngroups[1]))
    print("  incomplete regions by cause: %s" % dict(incomplete.most_common()))
    H.write_json("C2_completeness.json",
                 {"onset_groups_seen": ngroups[0],
                  "onset_groups_structurally_complete": ngroups[1],
                  "incomplete_by_cause": dict(incomplete),
                  "measures_mapped": len(mapped),
                  "systems_with_validated_barline_map": len(sysrows)})
    # ---- C4 FREEZE: structural fields only, then hash
    manifest = []
    for g in sorted(groups, key=lambda z: (z["score"], z["page"], z["role"],
                                           z["measure_index"], z["onset_group"],
                                           z["rank"])):
        manifest.append({k: g[k] for k in
                         ("score", "page", "role", "measure_index", "onset_group",
                          "rank", "corpus_oi", "corpus_obj_key", "verovio_id",
                          "pdf_y", "xml_y", "reason")})
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    hsh = hashlib.sha256(payload.encode()).hexdigest()
    H.write_json("C4_frozen_manifest.json", manifest)
    with open(OUT / "C4_frozen_manifest.sha256", "w") as f:
        f.write(hsh + "\n")
    print("\nC4  FROZEN MANIFEST")
    print("  entries : %d" % len(manifest))
    print("  sha256  : %s" % hsh)
    print("  scores  : %d" % len({m['score'] for m in manifest}))
    sys.stdout.flush()
    return manifest, hsh, incomplete


if __name__ == "__main__":
    main()