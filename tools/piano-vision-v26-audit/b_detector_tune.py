"""B4 - DEV sweep for up to three principled corrections, then freeze (B5).

Corrections must be justified by a MEASURED raster failure mode and chosen on
DETECTOR_DEV only. MusicXML / Verovio measure counts are never read here; the only
reference is the raster-only truth from b_barline_truth.py.

Measured failure modes that drive the candidates:
  FN  89/89 DEV misses are "an event exists on BOTH staves but consensus rejected
      it". |x_up - x_lo| over truth barlines is exactly 0.000 gaps for 84.8% of
      them, p90 = 0.370, max 0.916, so the 0.15-gap strict gate discards a real
      localisation tail. -> correction 1: widen the strict cross-staff gate.
  FP  46/53 DEV spurious events are coincident stems / beamed blocks that span
      only part of the staff. Production requires longest-run coverage >= 0.70,
      which a stem-plus-beam block can satisfy. -> correction 2: require higher
      row coverage of the staff span.
  FP  5/53 are wide events and 2/53 sit at the system edge. The width veto already
      handles the wide ones; -> correction 3: an explicit system-edge policy.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402

OUT = Path(__file__).parent / "out"
MATCH_GAPS = 0.45
DEV_SCORES = {"bc-chopin-etude-op10-12", "bc-mozart-k153",
              "omf-piano-grand-voices-vector", "pl-chopin-mazurka-op6-1"}
HELD_SCORES = {"bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
               "pl-mozart-turkish-march", "pl-bach-prelude-bwv846",
               "bc-chopin-nocturne-op9-n2", "std-demo-minuet-in-g"}


def prod_events(im, sy, Hh, cfg):
    T = dict(A2.CAND)
    T["min_coverage"] = cfg["min_coverage"]
    T["touch_both"] = cfg["touch_both"]
    st = {}
    for role in ("upper", "lower"):
        y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
        sr = A2.staff_rows(im, y0, y1)
        if len(sr) < 3:
            return None, None
        cd = A2.candidates(im, y0, y1, min(r[1] for r in sr), max(r[2] for r in sr), T)
        if cd is None:
            return None, None
        cd["events"] = A2.cluster_events(cd["cands"], cd["gap"], cfg["sep_gaps"])
        cd["x0"] = min(r[1] for r in sr)
        cd["x1"] = max(r[2] for r in sr)
        st[role] = cd
    g = max(st["upper"]["gap"], st["lower"]["gap"])
    pr = A2.cross_staff(st["upper"]["events"], st["lower"]["events"],
                        cfg["cons_tol"] * g, width_gaps=cfg["width_gaps"])
    pr = [(i, j, d) for i, j, d in pr if abs(d) <= cfg["strict"] * g]
    ev = [{"x": 0.5 * (st["upper"]["events"][i]["x"] + st["lower"]["events"][j]["x"]),
           "w": max(st["upper"]["events"][i]["w"], st["lower"]["events"][j]["w"]),
           "gap": g} for i, j, _ in pr]
    # correction 3: explicit system-edge policy - drop a boundary event that sits
    # inside the edge margin, because that region holds the clef/bracket, not a
    # printed barline, and the truth set is annotated on interior boundaries.
    if cfg["edge_gaps"] is not None:
        x0 = min(st["upper"]["x0"], st["lower"]["x0"])
        x1 = max(st["upper"]["x1"], st["lower"]["x1"])
        eg = cfg["edge_gaps"] * g
        ev = [e for e in ev if e["x"] > x0 + eg and e["x"] < x1 - eg]
    return ev, st


def match(prod, truth, gap):
    tp, ut, up_ = 0, set(), set()
    for pi, e in enumerate(prod):
        best, bt = None, None
        for ti, t in enumerate(truth):
            if ti in ut:
                continue
            dd = abs(e["x"] - t["x"])
            if dd <= MATCH_GAPS * gap and (best is None or dd < best):
                best, bt = dd, ti
        if bt is not None:
            tp += 1
            ut.add(bt)
            up_.add(pi)
    return tp, up_, ut


def load_ctx():
    truth = json.load(open(OUT / "B0_truth_raw.json"))
    fs = json.load(open(OUT / "F_systems.json"))
    bp = defaultdict(list)
    for x in fs:
        bp.setdefault((x["score"], x["page"]), []).append(x)
    for v in bp.values():
        v.sort(key=lambda z: z["y0"])
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]
    ctx = []
    for key, t in sorted(truth.items()):
        if not t["usable"]:
            continue
        im = img(t["score"], t["page"])
        if im is None:
            continue
        sy = bp[(t["score"], t["page"])][t["system"]]
        ctx.append((key, t, im, sy, im.shape[0]))
    return ctx


def score(ctx, cfg, which):
    sel = {"DEV": DEV_SCORES, "HELDOUT": HELD_SCORES}[which]
    P = T = TP = 0
    for key, t, im, sy, Hh in ctx:
        if t["score"] not in sel:
            continue
        ev, st = prod_events(im, sy, Hh, cfg)
        if ev is None:
            continue
        gap = max(st["upper"]["gap"], st["lower"]["gap"])
        tp, _, _ = match(ev, t["agree"], gap)
        P += len(ev)
        T += len(t["agree"])
        TP += tp
    prec = TP / P if P else 0.0
    rec = TP / T if T else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return prec, rec, f1, P, T, TP


def main():
    ctx = load_ctx()
    base = {"min_coverage": A2.CAND["min_coverage"],
            "touch_both": A2.CAND["touch_both"],
            "cons_tol": A2.CONS_TOL_GAPS,
            "strict": A2.CONS_STRICT_GAPS,
            "width_gaps": A2.CONS_WIDTH_GAPS,
            "sep_gaps": A2.EVENT_SEP_GAPS,
            "edge_gaps": None}
    print("B4  DEV sweep (raster-only truth; MusicXML/Verovio never read)\n")
    p, r, f, P, T, TP = score(ctx, base, "DEV")
    print("  baseline            prec=%.4f rec=%.4f f1=%.4f  (prod=%d truth=%d tp=%d)"
          % (p, r, f, P, T, TP))
    best = dict(base)
    bp_, br_, bf_ = p, r, f
    print("\n  correction 1: strict cross-staff gate (FN mode: consensus rejected"
          " real barlines)")
    for s in (0.15, 0.25, 0.30, 0.40, 0.50):
        c = dict(best); c["strict"] = s
        p, r, f, _, _, _ = score(ctx, c, "DEV")
        star = ""
        if f > bf_:
            best, bf_ = c, f
            bp_, br_ = p, r
            star = "  <- keep"
        print("    strict=%.2f  prec=%.4f rec=%.4f f1=%.4f%s" % (s, p, r, f, star))
    print("\n  correction 2: min row coverage (FP mode: stems/beams spanning part"
          " of the staff)")
    for mc in (0.70, 0.78, 0.82, 0.86, 0.90):
        c = dict(best); c["min_coverage"] = mc
        p, r, f, _, _, _ = score(ctx, c, "DEV")
        star = ""
        if f > bf_:
            best, bf_ = c, f
            bp_, br_ = p, r
            star = "  <- keep"
        print("    min_coverage=%.2f  prec=%.4f rec=%.4f f1=%.4f%s" % (mc, p, r, f, star))
    print("\n  correction 3: system-edge policy (FP mode at staff edges)")
    for eg in (None, 0.6, 1.0, 1.5, 2.0):
        c = dict(best); c["edge_gaps"] = eg
        p, r, f, _, _, _ = score(ctx, c, "DEV")
        star = ""
        if f > bf_:
            best, bf_ = c, f
            bp_, br_ = p, r
            star = "  <- keep"
        print("    edge_gaps=%-5s prec=%.4f rec=%.4f f1=%.4f%s" % (eg, p, r, f, star))

    print("\nB5  FREEZE")
    print("  chosen config: %s" % json.dumps(best, sort_keys=True))
    hp, hr, hf, HP, HT, HTP = score(ctx, best, "HELDOUT")
    print("  HELD-OUT (measured once, no tuning after this):")
    print("    prod=%d truth=%d tp=%d" % (HP, HT, HTP))
    print("    precision=%.4f  recall=%.4f  f1=%.4f" % (hp, hr, hf))
    payload = json.dumps(best, sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256(payload.encode()).hexdigest()
    H.write_json("B5_detector_config.json", best)
    with open(OUT / "B5_detector_config.sha256", "w") as f:
        f.write(h + "\n")
    print("  config sha256: %s" % h)


if __name__ == "__main__":
    main()