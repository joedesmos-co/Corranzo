#!/usr/bin/env python3
"""A4-A6. Monotonic global sequence alignment between PDF onsets and source onsets.

GLOBAL, NOT GREEDY (A5): the whole measure is solved jointly by dynamic programming
over an alignment lattice. False proposals sitting between real notes are handled by
SKIP operations, not by a nearest-x winner.

No pitch term exists in this file. There is no source-y or PDF-y input to compare.

Best-vs-second-best (A6): because the DP lattice can be enumerated with small
perturbations, we compute the best and the best alignment that differs in at least one
matched PAIR, so the margin reflects genuine alternative explanations rather than
tie-breaking noise.
"""
from __future__ import annotations

import itertools

# ---- frozen scoring weights (A10: hashed before any scientific join) -------------
W_X = 1.00          # normalized-x agreement
W_SPACE = 0.85     # local inter-onset spacing ratio agreement
W_CARD = 1.25      # cardinality agreement
W_BEAM = 0.45      # beam-group compatibility
W_DUR = 0.35       # duration class compatibility when independently visible
W_SEQ = 0.60       # neighbouring-sequence consistency
# A1: raster evidence says a proposal is not a note. Matching it must be clearly
# more expensive than skipping it, otherwise a false proposal sitting just left of a
# real onset scores almost the same as skipping it and destroys the margin. This is
# a structural penalty derived from the raster verdict, not a tuned constant.
P_MATCH_NONNOTE = -1.80
P_MATCH_AMBIG = -0.55
SKIP_P = 0.55      # A4: penalty for skipping a PDF candidate
SKIP_X = 1.30      # A4: penalty for skipping a source onset (rests/dots are cheap)
SKIP_X_RELAX = 0.0 # grace/dot onsets may be skipped for free once
UNMATCHED_CAP = 0.0

BEAM_COMPAT = {
    (0, 0): 1.0, (1, 1): 1.0,
    (0, 1): 0.0, (1, 0): 0.0,     # beamed vs unbeamed: real structural disagreement
}
DUR_COMPAT = {
    ("rest", "rest"): 1.0, ("whole", "whole"): 1.0, ("half", "half"): 1.0,
    ("quarter", "quarter"): 1.0, ("eighth", "eighth"): 1.0,
    ("short", "short"): 1.0,
    ("eighth", "short"): 0.8, ("short", "eighth"): 0.8, ("whole", "half"): 0.7,
    ("half", "quarter"): 0.7, ("quarter", "eighth"): 0.7,
    ("eighth", "quarter"): 0.6, ("quarter", "half"): 0.5, ("half", "whole"): 0.5,
    ("whole", "quarter"): 0.3,
}
DOT_TOL = 0.35      # |spacing log-ratio| beyond this kills the spacing term
CARD_TOL = 0        # exact agreement required


def _beam_group(o, gid):
    return gid if o.get("beamed") else 0


def pair_score(p, s, gid, p_prev=None, s_prev=None):
    """Structural score of matching PDF onset p to source onset s. Higher is better."""
    if p["x"] is None or s["x"] is None:
        return 0.0

    # 1. absolute normalized x agreement
    dx = abs(p["x"] - s["x"])
    sc_x = max(0.0, 1.0 - dx / 0.06)

    # 2. local spacing: compare the gap before this onset on each side
    sc_sp = 0.5
    gp = p["x"] - p_prev["x"] if p_prev and p_prev["x"] is not None else None
    gs = s["x"] - s_prev["x"] if s_prev and s_prev["x"] is not None else None
    if gp and gs and gp > 1e-6 and gs > 1e-6:
        import math
        lr = math.log(gp / gs)
        sc_sp = max(0.0, 1.0 - abs(lr) / 0.6)

    # 3. cardinality (structural, not pitch)
    if p.get("card") is None:
        sc_card = 0.35
    elif int(p["card"]) == int(s["card"]):
        sc_card = 1.0
    elif abs(int(p["card"]) - int(s["card"])) == 1:
        sc_card = 0.35      # a notehead can hide against a staff line
    else:
        sc_card = 0.0

    # 4. beam compatibility
    sc_beam = BEAM_COMPAT.get((1 if p.get("beamed") else 0, 1 if s.get("beamed") else 0), 0.35)

    # 5. duration class, only when the PDF side has an independent visual read
    sc_dur = 0.5
    if p.get("dur_class") is None:
        sc_dur = 0.5
    else:
        if s["is_rest"]:
            sc_dur = 1.0 if p["dur_class"] == "rest" else 0.15
        else:
            sc_dur = DUR_COMPAT.get((p["dur_class"], s["dur_class"]), 0.3)
        if s["dots"] and p.get("dots"):
            sc_dur = min(1.0, sc_dur + 0.15)

    total = (W_X * sc_x + W_SPACE * sc_sp + W_CARD * sc_card
             + W_BEAM * sc_beam + W_DUR * sc_dur)
    v = p.get("verdict")
    if v == "NON_NOTE_LIKELY":
        total += P_MATCH_NONNOTE
    elif v == "AMBIGUOUS":
        total += P_MATCH_AMBIG
    return total


def shared_normalise(pdfs, srcs, lo, hi):
    """Normalise BOTH sides by the SAME reference span.

    Normalising each side by its own data extent is wrong: a missing onset at the
    end of a run would be silently absorbed, because the remaining onsets stretch to
    fill the panel and the deletion becomes invisible. Both panels depict the same
    printed measure, so both are referred to that measure's own x interval.
    """
    w = float(hi - lo)
    if w <= 1e-9:
        w = 1.0

    def rs(v):
        return [dict(o, x=(o["x"] - lo) / w) for o in v]

    return rs(pdfs), rs(srcs)


def align(pdfs, srcs, gid):
    """Global DP. Returns (best_score, best_path) where path is a list of ops."""
    n, m = len(pdfs), len(srcs)
    NEG = float("-inf")
    # dp[i][j] = best score consuming first i pdf and first j src
    dp = [[NEG] * (m + 1) for _ in range(n + 1)]
    bk = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            cur = dp[i][j]
            if cur == NEG:
                continue
            # skip a PDF candidate
            if i < n:
                pen = SKIP_P if pdfs[i].get("verdict") != "NON_NOTE" else SKIP_P * 0.45
                v = cur - pen
                if v > dp[i + 1][j]:
                    dp[i + 1][j] = v
                    bk[i + 1][j] = ("skipP", i, j)
            # skip a source onset
            if j < m:
                s = srcs[j]
                pen = SKIP_X
                if s["is_rest"] or s["dots"] or s["grace"] or s["tuplet"]:
                    pen = SKIP_X_RELAX
                v = cur - pen
                if v > dp[i][j + 1]:
                    dp[i][j + 1] = v
                    bk[i][j + 1] = ("skipX", i, j)
            # match
            if i < n and j < m:
                pp = pdfs[i - 1] if i >= 1 else None
                ss = srcs[j - 1] if j >= 1 else None
                sc = pair_score(pdfs[i], srcs[j], gid, pp, ss)
                v = cur + sc
                if v > dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = v
                    bk[i + 1][j + 1] = ("match", i, j)
    # reconstruct
    return dp[n][m], _backtrack(bk, n, m)


def _backtrack(bk, n, m):
    """The backpointer stores the PREDECESSOR STATE, whose indices are exactly the
    consumed pdf/src indices for that op. Subtracting one here produced phantom
    (-1,-1) matches at the start of every path."""
    path = []
    i, j = n, m
    while (i, j) != (0, 0):
        step = bk[i][j]
        if step is None:
            break
        op, pi, pj = step
        if op == "match":
            path.append(("M", pi, pj))
        elif op == "skipP":
            path.append(("S_P", pi, None))
        else:
            path.append(("S_X", None, pj))
        i, j = pi, pj
    path.reverse()
    return path


def path_pairs(path):
    return {(i, j) for op, i, j in path if op == "M"}


def path_score(path, pdfs, srcs, gid):
    """Recompute a path's score from scratch (used for margin and perturbation)."""
    tot = 0.0
    matched = {}
    for op, i, j in path:
        if op == "M":
            matched[i] = j
    order = sorted(matched)
    for k, i in enumerate(order):
        j = matched[i]
        p_prev = pdfs[i - 1] if k > 0 and (i - 1) in matched else None
        s_prev = srcs[matched[i - 1]] if k > 0 and (i - 1) in matched else None
        if k > 0:
            p_prev = pdfs[order[k - 1]]
            s_prev = srcs[matched[order[k - 1]]]
        tot += pair_score(pdfs[i], srcs[j], gid, p_prev, s_prev)
    for op, i, j in path:
        if op == "S_P":
            tot -= SKIP_P if pdfs[i].get("verdict") != "NON_NOTE" else SKIP_P * 0.45
        elif op == "S_X":
            s = srcs[j]
            tot -= (SKIP_X if not (s["is_rest"] or s["dots"] or s["grace"] or s["tuplet"])
                    else SKIP_X_RELAX)
    return tot


def _tables(pdfs, srcs, gid):
    """Forward and backward DP tables.

    F[i][j] = best score of an alignment consuming exactly the first i pdf and first
    j src. B[i][j] = best score of an alignment consuming exactly the rest.
    """
    n, m = len(pdfs), len(srcs)
    NEG = float("-inf")
    F = [[NEG] * (m + 1) for _ in range(n + 1)]
    F[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            c = F[i][j]
            if c == NEG:
                continue
            if i < n:
                v = c - _skip_p(pdfs[i])
                if v > F[i + 1][j]:
                    F[i + 1][j] = v
            if j < m:
                v = c - _skip_x(srcs[j])
                if v > F[i][j + 1]:
                    F[i][j + 1] = v
            if i < n and j < m:
                v = c + pair_score(pdfs[i], srcs[j], gid,
                                   pdfs[i - 1] if i else None,
                                   srcs[j - 1] if j else None)
                if v > F[i + 1][j + 1]:
                    F[i + 1][j + 1] = v
    # Backward: B[i][j] = best score of an alignment consuming ALL of pdf[i:] and
    # src[j:]. It must be COMPUTED from the successors, not relaxed into them. The
    # first version reused the forward relaxation, which left every cell except
    # B[n][m] at -inf and silently reduced the second-best margin to infinity.
    B = [[NEG] * (m + 1) for _ in range(n + 1)]
    for i in range(n, -1, -1):
        for j in range(m, -1, -1):
            if i == n and j == m:
                B[i][j] = 0.0
                continue
            best = NEG
            if i < n and B[i + 1][j] > NEG:
                best = max(best, -_skip_p(pdfs[i]) + B[i + 1][j])
            if j < m and B[i][j + 1] > NEG:
                best = max(best, -_skip_x(srcs[j]) + B[i][j + 1])
            if i < n and j < m and B[i + 1][j + 1] > NEG:
                best = max(best, pair_score(pdfs[i], srcs[j], gid,
                                            pdfs[i - 1] if i else None,
                                            srcs[j - 1] if j else None) + B[i + 1][j + 1])
            B[i][j] = best
    return F, B


def align_ban(pdfs, srcs, gid, banned):
    """Best alignment avoiding a set of (pdf_index, src_index) matches."""
    n, m = len(pdfs), len(srcs)
    NEG = float("-inf")
    dp = [[NEG] * (m + 1) for _ in range(n + 1)]
    bk = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            c = dp[i][j]
            if c == NEG:
                continue
            if i < n:
                v = c - _skip_p(pdfs[i])
                if v > dp[i + 1][j]:
                    dp[i + 1][j] = v
                    bk[i + 1][j] = ("skipP", i, j)
            if j < m:
                v = c - _skip_x(srcs[j])
                if v > dp[i][j + 1]:
                    dp[i][j + 1] = v
                    bk[i][j + 1] = ("skipX", i, j)
            if i < n and j < m and (i, j) not in banned:
                v = c + pair_score(pdfs[i], srcs[j], gid,
                                   pdfs[i - 1] if i else None,
                                   srcs[j - 1] if j else None)
                if v > dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = v
                    bk[i + 1][j + 1] = ("match", i, j)
    return dp[n][m], _backtrack(bk, n, m)


def _skip_p(o):
    return SKIP_P if o.get("verdict") != "NON_NOTE" else SKIP_P * 0.45


def _skip_x(s):
    return SKIP_X if not (s["is_rest"] or s["dots"] or s["grace"]
                          or s["tuplet"]) else SKIP_X_RELAX


def second_best(pdfs, srcs, gid, best_score, best_path):
    """A6, computed exactly.

    Any alignment distinct from the best must contain at least one matched pair that
    the best does not. Constraining the alignment to use pair (i,j) is exactly the
    constraint "the path passes through cell (i+1, j+1)", which decomposes as
    F[i][j] + score(i,j) + B[i+1][j+1]. So the second-best distinct alignment is

        max over (i,j) NOT in best  of  F[i][j] + score(i,j) + B[i+1][j+1]

    The earlier implementation banned single pairs one at a time, which never
    produces a transposition: banning one pair of a uniform run still lets the rest
    stay optimal, so an alignment that was genuinely indistinguishable from the best
    was reported as being 5.15 away. That over-stated the margin and would have
    manufactured false confidence.
    """
    n, m = len(pdfs), len(srcs)
    base = path_pairs(best_path)
    if not base or n == 0 or m == 0:
        return float("-inf"), None
    F, B = _tables(pdfs, srcs, gid)
    best_alt = float("-inf")
    for i in range(n):
        for j in range(m):
            if (i, j) in base:
                continue
            if F[i][j] == float("-inf") or B[i + 1][j + 1] == float("-inf"):
                continue
            v = F[i][j] + pair_score(pdfs[i], srcs[j], gid,
                                     pdfs[i - 1] if i else None,
                                     srcs[j - 1] if j else None) + B[i + 1][j + 1]
            if v > best_alt:
                best_alt = v
    return best_alt, None


WEIGHTS = {
    "W_X": W_X, "W_SPACE": W_SPACE, "W_CARD": W_CARD, "W_BEAM": W_BEAM,
    "W_DUR": W_DUR, "W_SEQ": W_SEQ, "SKIP_P": SKIP_P, "SKIP_X": SKIP_X,
    "SKIP_X_RELAX": SKIP_X_RELAX, "DOT_TOL": DOT_TOL,
    "P_MATCH_NONNOTE": P_MATCH_NONNOTE, "P_MATCH_AMBIG": P_MATCH_AMBIG,
}
