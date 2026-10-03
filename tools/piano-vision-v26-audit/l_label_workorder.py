"""L0-L11 - exact labelling work order. PLAN ONLY: mutates nothing.

Inputs are the FROZEN assets only:
  out/M7_measure_map.json + .sha256      structural measure map
  out/B5_detector_config.json            frozen detector
  out/F_systems.json                     canonical staff rectangles
  out/B0_truth_raw.json                  raster-only barline truth
  corpus 2.1 shard records               read-only
  MusicXML / Verovio                     structural representation only

Missing-label definition (L0). A notehead is a MISSING_LABEL candidate only when
  1. its PDF measure identity is HIGH_CONFIDENCE structurally mapped,
  2. the source structural event exists (the MusicXML measure renders a notehead),
  3. raster ink is physically present in the PDF at the predicted position, so
     presence is grounded in the PDF and not merely asserted by the second source,
  4. Corpus 2.1 carries no annotation for it,
  5. the onset correspondence is unambiguous WITHOUT using pitch agreement.

Everything else is UNRESOLVED (L7 category B), never a missing label.
No pitch, d0, true_d or residual is read anywhere in this file.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from l_note_correspondence import load_pdf_systems  # noqa: E402
from m_measure_map import pdf_intervals  # noqa: E402
from m_structural_subset import vx_measures  # noqa: E402

OUT = Path(__file__).parent / "out"
USABLE = ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
          "HIGH_CONFIDENCE_COUNT_ANCHORED")
ONSET_GAPS = 0.8
INK_TOL_X_GAPS = 1.2      # raster presence search half-width, in staff gaps
DARK = 140


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


def ink_present(im, x, ycen, gnorm, half_px):
    """Raster presence test, PDF only. No second-source geometry is trusted."""
    Hh, Ww = im.shape
    xi = int(round(x * Ww))
    a = max(0, xi - half_px)
    b = min(Ww, xi + half_px + 1)
    if b <= a:
        return False
    y0 = int(round((ycen - 0.75 * gnorm) * Hh))
    y1 = int(round((ycen + 0.75 * gnorm) * Hh))
    y0 = max(0, y0)
    y1 = min(Hh - 1, y1)
    if y1 <= y0:
        return False
    return bool((im[y0:y1 + 1, a:b] < DARK).any())


def main():
    man = json.load(open(OUT / "M7_measure_map.json"))
    want = (OUT / "M7_measure_map.sha256").read_text().strip()
    got = hashlib.sha256(json.dumps(man, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()
    print("L0/L1  labelling work order - PLAN ONLY, nothing is mutated\n")
    print("  frozen measure map entries : %d" % len(man))
    print("  map hash verified          : %s" % (got == want))
    if got != want:
        print("  ABORT: map does not match its freeze hash.")
        return

    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    systems = json.load(open(OUT / "F_systems.json"))
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    bypage = defaultdict(list)
    for x in systems:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    usable = [m for m in man if m["mapping_class"] in USABLE
              and m["xml_ord"] is not None]
    sids = sorted({m["score"] for m in usable})
    vcache, ccache = {}, {}
    for sid in sids:
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        vcache[sid] = vx_measures(mp) if mp.is_file() else []
        ccache[sid] = load_pdf_systems(sid)

    # ------------------------------------------------ per-measure audit (L0/L2)
    per_meas = []
    unresolved = Counter()
    for m in sorted(usable, key=lambda z: (z["score"], z["page"],
                                           z["system"], z["xml_ord"])):
        sid, pno = m["score"], m["page"]
        r = iv.get((sid, m["pdf_ord"]))
        im = img(sid, pno)
        if r is None or im is None:
            unresolved["no_geometry"] += 1
            continue
        if m["xml_ord"] >= len(vcache[sid]):
            unresolved["xml_ord_out_of_range"] += 1
            continue
        W = im.shape[1]
        pl, pr = r["x_left"] / W, r["x_right"] / W
        if pr <= pl:
            unresolved["degenerate_window"] += 1
            continue
        # corpus system bound by upper band y0
        match = None
        for (cp, cs), sd in ccache[sid].items():
            if cp != pno or not (sd["upper"] and sd["lower"]):
                continue
            for sy in bypage[(sid, pno)]:
                if abs(sy["upper"][0] - sd["upper"][0]) < 0.002:
                    match = sd
                    break
            if match:
                break
        vm = vcache[sid][m["xml_ord"]]
        rec = {"score": sid, "page": pno, "system": m["system"],
               "pdf_ord": m["pdf_ord"], "xml_ord": m["xml_ord"],
               "mapping_class": m["mapping_class"],
               "bound": match is not None,
               "visible": 0, "labelled": 0, "missing": 0, "ambiguous": 0,
               "onsets_missing": 0, "roles": {}}
        if match is None:
            # no corpus system at all: every rendered notehead is a missing label,
            # but presence must still be grounded in the raster
            unresolved["no_corpus_system"] += 1
            for role in ("upper", "lower"):
                vs = vm[role]
                sy = bypage[(sid, pno)][m["system"]]
                gnorm = (sy[role][1] - sy[role][0]) / 4.0
                ycen = (sy[role][0] + sy[role][1]) / 2.0
                vx0 = min(x for x, _ in vs["notes"]) if vs["notes"] else 0
                vx1 = max(x for x, _ in vs["notes"]) if vs["notes"] else 0
                if not vs["notes"] or vx1 <= vx0:
                    continue
                miss = 0
                for (x, y) in vs["notes"]:
                    xr = (x - vx0) / (vx1 - vx0)
                    xp = pl + xr * (pr - pl)
                    if ink_present(im, xp, ycen + y * gnorm, gnorm,
                                   int(round(INK_TOL_X_GAPS * gnorm * im.shape[0]))):
                        miss += 1
                rec["roles"][role] = {"visible": len(vs["notes"]), "labelled": 0,
                                      "missing": miss, "onsets_missing": 0,
                                      "ambiguous": 0, "state": "A_MISSING_ALL"}
            rec["visible"] = sum(v["visible"] for v in rec["roles"].values())
            rec["missing"] = sum(v["missing"] for v in rec["roles"].values())
            per_meas.append(rec)
            continue

        for role in ("upper", "lower"):
            vs = vm[role]
            sy = bypage[(sid, pno)][m["system"]]
            gnorm = (sy[role][1] - sy[role][0]) / 4.0
            ycen = (sy[role][0] + sy[role][1]) / 2.0
            vn = vs["notes"]
            cn = [n for n in match["notes"][role] if pl <= n["x"] < pr]
            if not vn:
                rec["roles"][role] = {"visible": 0, "labelled": 0, "missing": 0,
                                      "onsets_missing": 0, "ambiguous": 0,
                                      "state": "empty"}
                continue
            vx0 = min(x for x, _ in vn)
            vx1 = max(x for x, _ in vn)
            if vx1 <= vx0:
                rec["roles"][role] = {"visible": len(vn), "labelled": len(cn),
                                      "missing": 0, "onsets_missing": 0,
                                      "ambiguous": len(vn), "state": "B_AMBIGUOUS"}
                unresolved["degenerate_verovio_span"] += 1
                continue
            ptol = ONSET_GAPS * (r["gap"] / W) / (pr - pl)
            vtol = ONSET_GAPS * vs["gap"] / (vx1 - vx0)
            PG = cluster([(n["x"] - pl) / (pr - pl) for n in cn], ptol)
            VG = cluster([(x - vx0) / (vx1 - vx0) for x, _ in vn], vtol)
            vis = len(vn)
            lab = len(cn)
            amb = 0
            miss = 0
            onmiss = 0
            if len(PG) != len(VG):
                # onset structure disagrees: this is category B, not missing labels
                amb = vis
                unresolved["onset_group_count_differs"] += 1
                state = "B_ONSET_COUNT"
            else:
                state = "OK"
                for vg in VG:
                    need = len(vg)
                    # corpus notes in the same window as this onset group
                    near = 0
                    vx = float(np.mean([vn[k][0] for k in vg]))
                    xr = (vx - vx0) / (vx1 - vx0)
                    for pg in PG:
                        px = float(np.mean([cn[k]["x"] for k in pg]))
                        if abs((px - pl) / (pr - pl) - xr) <= 1.5 * max(ptol, vtol):
                            near = len(pg)
                            break
                    if need > near:
                        cand = need - near
                        ok = 0
                        for k in vg:
                            xr = (vn[k][0] - vx0) / (vx1 - vx0)
                            xp = pl + xr * (pr - pl)
                            if ink_present(im, xp, ycen + vn[k][1] * gnorm, gnorm,
                                           int(round(INK_TOL_X_GAPS * gnorm * im.shape[0]))):
                                ok += 1
                        miss += min(cand, ok)
                        if cand > 0:
                            onmiss += 1
                            state = "A_PARTIAL"
            rec["roles"][role] = {"visible": vis, "labelled": lab, "missing": miss,
                                  "onsets_missing": onmiss, "ambiguous": amb,
                                  "state": state}
        rec["visible"] = sum(v["visible"] for v in rec["roles"].values())
        rec["labelled"] = sum(v["labelled"] for v in rec["roles"].values())
        rec["missing"] = sum(v["missing"] for v in rec["roles"].values())
        rec["ambiguous"] = sum(v["ambiguous"] for v in rec["roles"].values())
        rec["onsets_missing"] = sum(v["onsets_missing"] for v in rec["roles"].values())
        per_meas.append(rec)

    # ------------------------------------------------------------ L1 rollup
    print("\nL1  per-score / system coverage audit\n")
    print("  %-40s %4s %6s %7s %7s %7s %7s %7s" %
          ("score", "sys", "mapped", "visible", "labelled", "missing", "ambig", "cov%"))
    score_roll = {}
    sys_roll = defaultdict(lambda: {"mapped": 0, "visible": 0, "labelled": 0,
                                    "missing": 0, "ambiguous": 0, "measures": 0})
    for rec in per_meas:
        k = (rec["score"], rec["page"], rec["system"])
        d = sys_roll[k]
        for f in ("visible", "labelled", "missing", "ambiguous"):
            d[f] += rec[f]
        d["mapped"] += 1
        d["measures"] += 1
        s = score_roll.setdefault(rec["score"], Counter())
        for f in ("visible", "labelled", "missing", "ambiguous"):
            s[f] += rec[f]
        s["mapped"] += 1
    for sid in sorted(score_roll):
        s = score_roll[sid]
        nsys = len({k for k in sys_roll if k[0] == sid})
        cov = 100.0 * s["labelled"] / s["visible"] if s["visible"] else 0.0
        print("  %-40s %4d %6d %7d %7d %7d %7d %6.1f%%"
              % (sid[:40], nsys, s["mapped"], s["visible"], s["labelled"],
                 s["missing"], s["ambiguous"], cov))
    tot = Counter()
    for s in score_roll.values():
        tot.update(s)
    print("  %-40s %4d %6d %7d %7d %7d %7d %6.1f%%"
          % ("TOTAL", len({k[0] for k in sys_roll}),
             sum(1 for _ in per_meas), tot["visible"], tot["labelled"],
             tot["missing"], tot["ambiguous"],
             100.0 * tot["labelled"] / max(1, tot["visible"])))

    full = [k for k, d in sys_roll.items()
            if d["visible"] and d["labelled"] >= d["visible"]]
    part = [k for k, d in sys_roll.items()
            if d["visible"] and 0 < d["labelled"] < d["visible"]]
    none = [k for k, d in sys_roll.items() if d["labelled"] == 0 and d["visible"]]
    print("\n  high-confidence mapped systems : %d" % len(sys_roll))
    print("    fully labelled               : %d" % len(full))
    print("    partially labelled           : %d" % len(part))
    print("    completely unlabelled        : %d" % len(none))

    # ------------------------------------------------------------- L3 tiers
    A, B = [], []
    for rec in per_meas:
        st = {v["state"] for v in rec["roles"].values()}
        if rec["ambiguous"]:
            B.append(rec)
        elif rec["missing"] > 0:
            A.append(rec)
        elif rec["visible"] and rec["labelled"] >= rec["visible"]:
            A.append(rec)
    tier1 = [r for r in A
             if r["mapping_class"] == "EXACT_ANCHORED"
             and len([1 for v in r["roles"].values() if v["visible"]]) == 2]
    tier2 = [r for r in A if r not in tier1]
    tier3 = B

    def agg(rs):
        return (len({(r["score"], r["page"], r["system"]) for r in rs}),
                len(rs), sum(r["missing"] for r in rs),
                sum(r["visible"] for r in rs))

    print("\nL3  priority tiers")
    for nm, rs in (("Tier 1 EXACT_ANCHORED, both staves, incomplete", tier1),
                   ("Tier 2 other high-confidence", tier2),
                   ("Tier 3 ambiguous / unresolved (do not label yet)", tier3)):
        s, m_, mi, v = agg(rs)
        print("  %-46s systems=%-3d measures=%-3d missing_notes=%-4d visible=%d"
              % (nm, s, m_, mi, v))

    # ------------------------------------------------------------ L4 targets
    print("\nL4/L5  minimum labelling campaign for a real clean gate")
    pool = [r for r in A if r["missing"] > 0 or r["visible"] > r["labelled"]]
    # projected matched notes a measure contributes once labelled
    def proj(r):
        return sum(v["visible"] for v in r["roles"].values())

    bysc = defaultdict(list)
    for r in pool:
        bysc[r["score"]].append(r)
    for v in bysc.values():
        v.sort(key=lambda z: (z["page"], z["system"], z["xml_ord"]))

    def round_robin(target):
        chosen, tot = [], 0
        ptr = {k: 0 for k in bysc}
        order = sorted(bysc, key=lambda k: -sum(proj(r) for r in bysc[k]))
        while tot < target:
            progressed = False
            for k in order:
                if ptr[k] < len(bysc[k]):
                    r = bysc[k][ptr[k]]
                    ptr[k] += 1
                    chosen.append(r)
                    tot += proj(r)
                    progressed = True
                    if tot >= target:
                        break
            if not progressed:
                break
        return chosen, tot

    targets = {}
    for T in (100, 250, 500):
        ch, tot = round_robin(T)
        sysn = {(r["score"], r["page"], r["system"]) for r in ch}
        anch = len({(r["score"], r["page"], r["system"]) for r in ch
                    if r["mapping_class"] == "EXACT_ANCHORED"})
        miss = sum(r["missing"] for r in ch)
        targets[T] = {"scores": sorted({r["score"] for r in ch}),
                      "n_scores": len({r["score"] for r in ch}),
                      "systems": len(sysn), "measures": len(ch),
                      "noteheads_to_label": miss,
                      "projected_matched_notes": tot,
                      "independently_anchored_systems": anch}
        print("  N~%-4d scores=%-2d systems=%-3d measures=%-4d noteheads=%-5d "
              "projected_matched=%-5d anchored_systems=%d"
              % (T, targets[T]["n_scores"], targets[T]["systems"],
                 targets[T]["measures"], miss, tot, anch))
        print("        %s" % ", ".join(s[:26] for s in targets[T]["scores"]))

    # ------------------------------------------------------------ L7 split
    nA = sum(r["missing"] for r in A)
    nB = sum(r["ambiguous"] for r in B)
    print("\nL7  category A (existing source event, annotation missing) vs B (ambiguous source)")
    print("  A  existing event, annotation missing : %d noteheads in %d measures"
          % (nA, len(A)))
    print("  B  source correspondence ambiguous    : %d noteheads in %d measures"
          % (nB, len(B)))
    print("  B causes: %s" % dict(unresolved.most_common()))
    print("  Only A is straightforward labelling work; B needs source adjudication.")

    H.write_json("L2_measure_workorder.json", per_meas)
    H.write_json("L3_tiers.json", {"tier1": tier1, "tier2": tier2,
                                  "tier3_count": len(tier3),
                                  "nA": nA, "nB": nB,
                                  "unresolved_causes": dict(unresolved)})
    H.write_json("L4_targets.json", targets)
    H.write_json("L1_system_coverage.json",
                 {"%s|%d|%d" % k: dict(v) for k, v in sys_roll.items()})
    print("\n  wrote out/L1_system_coverage.json, out/L2_measure_workorder.json,")
    print("        out/L3_tiers.json, out/L4_targets.json")


if __name__ == "__main__":
    main()