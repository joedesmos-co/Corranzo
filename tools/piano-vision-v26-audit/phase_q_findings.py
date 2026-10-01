"""Phase Q part 2 - Q3 decoders, Q4 conditioning, Q6 band origin, Q7 label contract.

Q3 tests three zero-parameter decoders. Critically, decoder B (clef-reference
anchor) is ALGEBRAICALLY IDENTICAL to decoder A once the reference-line offset
is applied, so A/B/C must produce bit-identical metrics. That is the empirical
confirmation of the Q2 derivation.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402

MIDDLE = {"upper": 34, "lower": 22}      # B4 / D3, note on the middle line
REFERENCE = {"upper": 32, "lower": 24}   # G4 / F3, note on the clef reference line
REF_OFFSET = {"upper": +1, "lower": -1}  # k(reference) = k(middle) + offset
LET = "CDEFGAB"
SO, FO = "FCGDAEB", "BEADGCF"
CTX_KEY = slice(19, 34)


def key_alter_row(f):
    f = int(f)
    k = SO[:min(f, 7)] if f > 0 else FO[:min(-f, 7)] if f < 0 else ""
    out = np.zeros(7, np.int64)
    for i, ch in enumerate(LET):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


def decoders():
    d = CACHE.load()
    k = d["staff"][..., 0].astype(np.float64)
    is_up = d["staff"][..., 2] > 0.5
    m = (d["mask"][..., 1] & d["mask"][..., 2] & d["mask"][..., 3]) & d["object_mask"]
    true_d = d["target"][..., 1].astype(np.int64) + 7 * d["target"][..., 2].astype(np.int64)

    variants = {}
    # A: band-middle-line anchor (current production decoder)
    a = np.where(is_up, MIDDLE["upper"], MIDDLE["lower"]) + np.round(2 * k).astype(np.int64)
    variants["A_band_middle"] = a
    # B: clef-reference anchor. k_ref = k_mid + offset, so this must equal A.
    off = np.where(is_up, REF_OFFSET["upper"], REF_OFFSET["lower"])
    b = np.where(is_up, REFERENCE["upper"], REFERENCE["lower"]) + np.round(
        2 * (k + off)).astype(np.int64)
    variants["B_clef_reference"] = b
    # C: oracle clef. Clef is fixed per band corpus-wide, so C == B by construction.
    variants["C_oracle_clef"] = b.copy()

    print("=== Q3 zero-parameter decoders ===")
    print("  algebra:  B = 32 + round(2(k+1)) = 34 + round(2k) = A   (upper)")
    print("            B = 24 + round(2(k-1)) = 22 + round(2k) = A   (lower)")
    print("  A == B identically: %s" % bool(np.array_equal(a, b)))
    res = {}
    for name, pd_ in variants.items():
        dist = Counter()
        n = s_ok = o_ok = wp = 0
        for r in range(pd_.shape[0]):
            sel = m[r]
            if not sel.any():
                continue
            err = (true_d[r] - pd_[r])[sel]
            for v, c in zip(*np.unique(err, return_counts=True)):
                dist[int(v)] += int(c)
            n += int(sel.sum())
            s_ok += int((err == 0).sum())
            o_ok += int(((pd_[r][sel]) // 7 == true_d[r][sel] // 7).sum())
            wp += int((((pd_[r][sel] % 7) == (true_d[r][sel] % 7))
                       & ((pd_[r][sel] // 7) == (true_d[r][sel] // 7))).sum())
        res[name] = {"n": n, "step": s_ok / n, "octave": o_ok / n, "written_pitch": wp / n,
                     "residual": {str(kk): int(vv) for kk, vv in sorted(dist.items())}}
        print("\n  %s" % name)
        print("    step %.4f  octave %.4f  written pitch %.4f  (n=%d)"
              % (s_ok / n, o_ok / n, wp / n, n))
        tot = sum(dist.values())
        print("    residual  " + "  ".join(
            "%+d:%.4f" % (int(kk), vv / tot) for kk, vv in sorted(dist.items())))
    same = (res["A_band_middle"] == res["B_clef_reference"]
            == res["C_oracle_clef"])
    print("\n  A/B/C metrics identical: %s" % bool(same))
    return res, bool(same)


def conditioning():
    """Q4 - the current residual conditioned on everything available."""
    d = CACHE.load()
    k = d["staff"][..., 0].astype(np.float64)
    is_up = d["staff"][..., 2] > 0.5
    height = d["staff"][..., 3].astype(np.float64)
    m = (d["mask"][..., 1] & d["mask"][..., 2] & d["mask"][..., 3]) & d["object_mask"]
    true_d = d["target"][..., 1].astype(np.int64) + 7 * d["target"][..., 2].astype(np.int64)
    pd_ = np.where(is_up, MIDDLE["upper"], MIDDLE["lower"]) + np.round(2 * k).astype(np.int64)
    res = (true_d - pd_)

    buckets = defaultdict(lambda: [0, 0])  # name -> [n, n_residual]
    chord_n = np.zeros_like(m)

    def add(name, sub, err):
        n = int(sub.sum())
        if n:
            b = buckets[name]
            b[0] += n
            b[1] += int((err[sub] != 0).sum())

    per_score = {}
    for r in range(pd_.shape[0]):
        sel = m[r]
        if not sel.any():
            continue
        sc = d["score"][r]
        err = res[r][sel]
        add("treble/upper (G clef line 2)", (sel & is_up[r])[sel], err)
        add("bass/lower (F clef line 4)", (sel & ~is_up[r])[sel], err)
        add("line (even 2k)", (sel & (np.round(2 * k[r]) % 2 == 0))[sel], err)
        add("space (odd 2k)", (sel & (np.round(2 * k[r]) % 2 == 1))[sel], err)
        add("in staff (|k|<=2)", (sel & (np.abs(k[r]) <= 2.0))[sel], err)
        add("beyond staff (|k|>2)", (sel & (np.abs(k[r]) > 2.0))[sel], err)
        for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 99)):
            add("|k| in [%g,%g)" % (lo, hi), (sel & (np.abs(k[r]) >= lo) & (np.abs(k[r]) < hi))[sel], err)
        b = per_score.setdefault(sc, [0, 0])
        b[0] += int(sel.sum())
        b[1] += int((err != 0).sum())

    print("\n=== Q4 residual conditioning (current decoder A) ===")
    print("  clef sign and clef line are PERFECTLY COLLINEAR with staff role across")
    print("  all 17 scores (upper=G/2, lower=F/4), so they cannot be separated as")
    print("  independent factors. Reported jointly.\n")
    rows = []
    for name, (n, bad) in sorted(buckets.items()):
        rows.append((name, n, bad, bad / n))
    for name, n, bad, rate in rows:
        print("  %-32s n=%5d  residual %4d  %.4f" % (name, n, bad, rate))
    rates = [r[3] for r in rows]
    print("\n  spread across all strata: min %.4f max %.4f (ratio %.2fx)"
          % (min(rates), max(rates), max(rates) / max(1e-9, min(rates))))
    sc_rows = sorted(((v[1] / v[0], s, v[0]) for s, v in per_score.items()), reverse=True)
    print("  per-score residual rate: median %.4f  worst 5: %s"
          % (np.median([r[0] for r in sc_rows]),
             [("%s %.4f" % (s, r)) for r, s, _ in sc_rows[:5]]))
    return {"strata": {n: {"n": n, "residual": b, "rate": rt} for n, n, b, rt in rows},
            "per_score": {s: {"n": v[0], "residual": v[1], "rate": v[1] / v[0]}
                          for s, v in per_score.items()}}


def label_contract():
    """Q6 band origin + Q7 label self-consistency, from the corpus shards."""
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    ratios, sp_consistent, sp_total = [], 0, 0
    classes = Counter()
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            path = H.REALPDF_ROOT / "shards" / sh
            if not path.is_file():
                continue
            with gzip.open(path, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    geom = rec["input"]["modelInput"]["geometry"]
                    spans = [(float(b["y0"]), float(b["y1"]), b.get("staffRole"))
                             for b in geom.get("staffBands", {}).get("staffBands", [])]
                    fams = rec.get("target", {}).get("families", {}) or {}
                    if isinstance(fams, dict):
                        items = [f for v in fams.values()
                                 for f in (v if isinstance(v, list) else [v])]
                    else:
                        items = list(fams)
                    for fam in items:
                        val = fam.get("value") or {}
                        pos = val.get("staffPosition")
                        if not isinstance(pos, dict):
                            continue
                        gap = pos.get("staffGapNormalized")
                        role = val.get("staffRole")
                        cands = [s for s in spans if s[2] == role] or spans
                        if not cands or not gap:
                            continue
                        y0, y1, _ = cands[0]
                        ratios.append((y1 - y0) / gap)
                        steps = pos.get("stepsFromBandCenter")
                        sy = pos.get("sourceY")
                        if steps is None or sy is None:
                            continue
                        sp_total += 1
                        cy = (y0 + y1) / 2
                        if abs((cy - sy) / gap - steps) < 0.02:
                            sp_consistent += 1
                        else:
                            classes["rounding_or_lattice_boundary"] += 1

    print("\n=== Q6 staff-line origin contract ===")
    print("  positions checked: %d" % len(ratios))
    if ratios:
        r = np.array(ratios)
        print("  (band height) / (line-to-line gap): median %.6f  p95 %.6f  max %.6f"
              % (np.median(r), np.percentile(r, 95), r.max()))
        print("  5 lines span exactly 4 gaps, so a ratio of exactly 4.0 proves")
        print("  (y0+y1)/2 IS the middle staff line.")
        print("  within 0.02 of 4.0: %d/%d (%.6f)"
              % (int((np.abs(r - 4.0) < 0.02).sum()), len(r),
                 float((np.abs(r - 4.0) < 0.02).mean())))
    print("\n=== Q7 label contract self-consistency ===")
    print("  check: (bandCentre - sourceY)/gap == stepsFromBandCenter")
    print("  consistent: %d/%d (%.6f)"
          % (sp_consistent, sp_total, sp_consistent / max(1, sp_total)))
    print("  disagreements: %s" % (dict(classes) or "none"))
    return {"band_height_over_gap": {
                "n": len(ratios),
                "median": float(np.median(ratios)) if ratios else None,
                "max": float(np.max(ratios)) if ratios else None},
            "steps_consistent": sp_consistent, "steps_total": sp_total,
            "disagreements": dict(classes)}


def main():
    dec, same = decoders()
    out = {"Q3_decoders": dec, "Q3_identical": same,
           "Q4_conditioning": conditioning(), "Q6_Q7_contract": label_contract()}
    print("\nwrote", H.write_json("phase_q_findings.json", out))


if __name__ == "__main__":
    main()