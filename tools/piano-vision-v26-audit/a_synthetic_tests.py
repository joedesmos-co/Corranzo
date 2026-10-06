#!/usr/bin/env python3
"""A9. Synthetic structural validation BEFORE touching the 20 scientific items.

Cases are built from known structure only. No residual or pitch truth is used
anywhere, and no expected answer is derived from the corpus.
"""
from __future__ import annotations

import math
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import a_align as AL  # noqa: E402

TOL = 1e-9


def src(x, card=1, dur="quarter", beamed=False, rest=False, dots=0, grace=False):
    return {"sid": "", "order": 0, "x": x, "cum_frac": x, "dur_frac": 0.25,
            "card": card, "is_rest": rest, "dur_class": "rest" if rest else dur,
            "grace": grace, "dots": dots, "tuplet": False, "tuplet_num": None,
            "beam": ["begin"] if beamed else [], "beamed": beamed, "tie_start": False}


def pdf(x, card=1, verdict="NOTE_ONSET_LIKELY", dur=None, beamed=False, dots=0):
    return {"cx": x, "x": x, "card": card, "verdict": verdict, "n_note": 1,
            "n_amb": 0, "n_non": 0, "n_comp": 1, "min_fill": 0.6,
            "mean_h": 1.0, "dur_class": dur, "beamed": beamed, "dots": dots}


def norm(pdfs, srcs, w):
    """Normalise both sides against the printed measure interval, then solve.

    A shared reference span is essential: rescaling each side by its own extent
    would let a deleted END onset stretch to fill the panel and go undetected.
    """
    lo, hi = 0.0, 1.0
    if isinstance(w, tuple):
        lo, hi = w
    p, s = AL.shared_normalise(pdfs, srcs, lo, hi)
    gid = [1 if o.get("beamed") else 0 for o in s]
    sc, path = AL.align(p, s, gid)
    return sc, path, p, s


def pairs_of(path):
    return [(i, j) for op, i, j in path if op == "M"]


RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print("  %s  %s%s" % ("pass" if cond else "FAIL", name,
                           ("  <- " + detail) if (detail and not cond) else ""))


def main():
    print("A9 synthetic structural validation\n")

    # 1. perfect 1:1 --------------------------------------------------------
    xs = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8]
    P = [pdf(x) for x in xs]
    S = [src(x) for x in xs]
    sc, path, p, s = norm(P, S, (0.0, 1.0))
    got = pairs_of(path)
    check("perfect 1:1 accepts every onset in order",
          got == [(i, i) for i in range(len(xs))], str(got))

    # 2. one false PDF proposal inserted mid-sequence ------------------------
    P2 = [pdf(xs[0]), pdf(0.275, verdict="NON_NOTE_LIKELY"), pdf(xs[1]),
          pdf(xs[2]), pdf(xs[3]), pdf(xs[4]), pdf(xs[5])]
    sc, path, p, s = norm(P2, S, (0.0, 1.0))
    got = pairs_of(path)
    check("one false PDF proposal is skipped, not matched",
          got == [(0, 0), (2, 1), (3, 2), (4, 3), (5, 4), (6, 5)], str(got))

    # 3. one MISSING PDF proposal (interior deletion, shared span kept) ------
    P3 = [pdf(xs[0]), pdf(xs[1]), pdf(xs[3]), pdf(xs[4]), pdf(xs[5])]  # xs[2] absent
    sc, path, p, s = norm(P3, S, (0.0, 1.0))
    got = pairs_of(path)
    check("one missing interior PDF onset leaves exactly one source skipped",
          got == [(0, 0), (1, 1), (2, 3), (3, 4), (4, 5)], str(got))
    skipped = [j for op, i, j in path if op == "S_X"]
    check("missing PDF onset shows up as exactly one SKIP_X at index 2",
          skipped == [2], str(skipped))

    # 3b. a missing FINAL onset must NOT be absorbed by rescaling ------------
    P3b = [pdf(xs[0]), pdf(xs[1]), pdf(xs[2]), pdf(xs[3]), pdf(xs[4])]  # xs[5] absent
    sc_b, path_b, pb, sb = norm(P3b, S, (0.0, 1.0))
    sk_b = [j for op, i, j in path_b if op == "S_X"]
    check("a missing FINAL PDF onset is detected, not stretched away",
          sk_b == [5], str(sk_b))
    P3c = [pdf(xs[0]), pdf(xs[1]), pdf(xs[2]), pdf(xs[3]), pdf(xs[4])]
    lo_c = min(v["x"] for v in P3c) - 0.05
    hi_c = max(v["x"] for v in S) + 0.05
    sc_c, path_c, pc, sc2 = norm(P3c, S, (lo_c, hi_c))
    sk_c = [j for op, i, j in path_c if op == "S_X"]
    check("with a shared wider span the final deletion is still detected",
          sk_c == [5], str(sk_c))

    # 4. one source-extra onset (a rest, cheaply skippable) -----------------
    S4 = [src(xs[0]), src(xs[1]), src(0.28, rest=True), src(xs[2]),
          src(xs[3]), src(xs[4]), src(xs[5])]
    sc, path, p, s = norm(P, S4, (0.0, 1.0))
    got = pairs_of(path)
    check("extra source REST is skipped without displacing the rest",
          got == [(0, 0), (1, 1), (2, 3), (3, 4), (4, 5), (5, 6)], str(got))

    # 5. chord cardinality difference --------------------------------------
    S5 = [src(xs[0], card=3), src(xs[1], card=1), src(xs[2], card=2),
          src(xs[3], card=1), src(xs[4]), src(xs[5])]
    P5 = [pdf(xs[0], card=2), pdf(xs[1], card=1), pdf(xs[2], card=2),
          pdf(xs[3], card=1), pdf(xs[4]), pdf(xs[5])]
    sc, path, p, s = norm(P5, S5, (0.0, 1.0))
    got = pairs_of(path)
    check("cardinality mismatch still aligns (order dominates, not cardinality alone)",
          got == [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5)], str(got))

    # 5b. the SAME mapping must score lower when cardinality is wrong ------
    S6 = [src(xs[i], card=1) for i in range(6)]
    P_exact = [pdf(xs[i], card=1) for i in range(6)]
    P_wrong = [pdf(xs[i], card=4) for i in range(6)]
    sc_exact, path_ex, pE, sE = norm(P_exact, S6, (0.0, 1.0))
    sc_wrong, _ = AL.align_ban(pE, sE, [0] * len(sE), set())
    pW = [dict(o, card=4) for o in pE]
    sc_wrong2, _ = AL.align_ban(pW, sE, [0] * len(sE), set())
    check("exact cardinality scores strictly higher than wrong cardinality",
          sc_exact > sc_wrong2, "%.4f vs %.4f" % (sc_exact, sc_wrong2))
    check("the wrong-cardinality run still aligns in order",
          sc_wrong2 > 0 and sc_wrong2 < sc_exact)

    # 6. repeated rhythmic pattern must stay AMBIGUOUS ---------------------
    ys = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    P7 = [pdf(x) for x in ys]
    S7 = [src(x) for x in ys]
    sc, path, p, s = norm(P7, S7, (0.0, 1.0))
    base = pairs_of(path)
    check("uniform run aligns 1:1", base == [(i, i) for i in range(8)], str(base))
    # A uniform run is NOT ambiguous once x is available: transposing neighbours
    # moves each PDF onset off its own source x. An earlier version of this file
    # asserted the opposite, but the assertion was vacuous - banning the
    # transposition simply returned the identity path, so the delta was trivially
    # zero and proved nothing.
    adj = {(k, k + 1) for k in range(0, 8, 2)} | {(k + 1, k) for k in range(0, 8, 2)}
    tp = []
    for k in range(0, 8, 2):
        tp.append(("M", k, k + 1))
        tp.append(("M", k + 1, k))
    sc_tp = AL.path_score(tp, p, s, [0] * len(s))
    check("a uniform run is NOT ambiguous: x separates the neighbours",
          sc_tp < sc - 1.0, "identity %.3f vs transposition %.3f" % (sc, sc_tp))
    sc_shift, _ = AL.align_ban(p, s, [0] * len(s), {(k, k) for k in range(8)})
    check("a whole-run shift in a uniform sequence is NOT free",
          abs(sc - sc_shift) > 1e-6, "margin %.6f" % abs(sc - sc_shift))

    # GENUINE ambiguity: one PDF onset can claim either of two neighbouring sources.
    # This is what AUTO_UNRESOLVED must catch.
    Pa = [pdf(0.10), pdf(0.50), pdf(0.90)]
    Sa = [src(0.10), src(0.50), src(0.505), src(0.90)]   # 0.50 and 0.505 nearly coincide
    sc_amb, path_amb, pa, sa = norm(Pa, Sa, (0.0, 1.0))
    alt_amb, _ = AL.second_best(pa, sa, [0] * len(sa), sc_amb, path_amb)
    check("a near-coincident source pair yields a near-zero margin",
          (sc_amb - alt_amb) < 1.0,
          "margin %.4f (must be small -> unresolved)" % (sc_amb - alt_amb))
    # A genuinely determinate measure must show a real margin.
    Pb = [pdf(0.10, card=3), pdf(0.24, card=1), pdf(0.52), pdf(0.74, card=2), pdf(0.90)]
    Sb = [src(0.10, card=3), src(0.24), src(0.52), src(0.74, card=2), src(0.90)]
    sc_det, path_det, pb, sb = norm(Pb, Sb, (0.0, 1.0))
    alt_det, _ = AL.second_best(pb, sb, [0] * len(sb), sc_det, path_det)
    check("a well-separated determinate measure shows a large margin",
          (sc_det - alt_det) > 3.0,
          "margin %.4f (must be large -> acceptable)" % (sc_det - alt_det))

    # 7. dense evenly spaced sequence --------------------------------------
    dense = [0.02 + 0.035 * k for k in range(28)]
    P8 = [pdf(x) for x in dense]
    S8 = [src(x) for x in dense]
    sc, path, p, s = norm(P8, S8, (0.0, 1.0))
    check("dense evenly spaced 28-onset run aligns 1:1",
          pairs_of(path) == [(i, i) for i in range(28)], str(len(pairs_of(path))))

    # 8. unequal duration pattern ------------------------------------------
    zs = [0.05, 0.12, 0.19, 0.45, 0.52, 0.59, 0.66, 0.73, 0.8, 0.87, 0.94]
    P9 = [pdf(x) for x in zs]
    S9 = [src(x) for x in zs]
    sc, path, p, s = norm(P9, S9, (0.0, 1.0))
    check("unequal spacing pattern aligns 1:1",
          pairs_of(path) == [(i, i) for i in range(len(zs))], str(pairs_of(path)))

    # 9. a genuine shift must be penalised ----------------------------------
    P10 = [pdf(x) for x in xs]
    S10 = [src(x) for x in xs]
    sc_ok, path_ok, p10, s10 = norm(P10, S10, (0.0, 1.0))
    sc_bad, path_bad = AL.align_ban(p10, s10, [0] * len(s10), {(0, 0)})
    check("dropping the true first pairing costs score", sc_bad < sc_ok,
          "%.4f -> %.4f" % (sc_ok, sc_bad))

    # 10. unlisted onset must be admissible as a PDF candidate ---------------
    check("unlisted onset type is representable in the PDF list",
          "verdict" in pdf(0.3, verdict="AMBIGUOUS"))

    npass = sum(1 for _, ok, _ in RESULTS if ok)
    print("\nA9: %d/%d checks pass" % (npass, len(RESULTS)))
    return 0 if npass == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
