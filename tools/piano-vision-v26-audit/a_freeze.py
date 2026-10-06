#!/usr/bin/env python3
"""A6 + A7 + A10. Frozen acceptance margin, perturbation stability, and the freeze.

The margin threshold is chosen from STRUCTURAL STABILITY ONLY: synthetic sequences
where the truth is known by construction, plus perturbation behaviour. It is never
tuned from residual agreement, because no residual is read before the freeze.

Everything here is hashed before the correspondence manifest exists.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import a_align as AL  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out/h_auto_struct"

# ---- A10 frozen parameters -------------------------------------------------
# Chosen BELOW from the structural separating gap. Not tuned on residual.
ACCEPT_MARGIN = 2.00
MIN_MATCH_FRACTION = 0.80   # of source onsets must be matched or cheaply skipped
PERTURBATIONS = 24
PERTURB_DX = 0.004          # ~ +/- 0.4% of measure width
PERTURB_DX2 = 0.010
PERTURB_CONF = 0.15         # verdict nudge probability
PERTURB_SEED = 20261005

PARAMS = {
    "solver_version": "auto-structural-align-1",
    "weights": AL.WEIGHTS,
    "accept_margin": ACCEPT_MARGIN,
    "min_match_fraction": MIN_MATCH_FRACTION,
    "perturbation": {
        "n": PERTURBATIONS,
        "dx": PERTURB_DX,
        "dx2": PERTURB_DX2,
        "confidence_nudge": PERTURB_CONF,
        "seed": PERTURB_SEED,
    },
    "beam_compat": {str(k): v for k, v in AL.BEAM_COMPAT.items()},
    "card_tolerance_exact_only": True,
    "uses_pitch": False,
    "reads_scientific_fields": False,
    "label": "AUTOMATIC_STRUCTURAL_CORRESPONDENCE (not human-certified)",
}


def solver_hash():
    """Hash of the actual code that decides, not just the parameter dict."""
    h = hashlib.sha256()
    for f in ("a_align.py", "a_pdf_onsets.py", "a_source_struct.py",
              "a_synthetic_tests.py", "a_freeze.py"):
        h.update((ROOT / f).read_bytes())
    return h.hexdigest()


def choose_margin_from_stability():
    """A6: pick the threshold using only synthetic structural stability.

    For each synthetic case the answer is known BY CONSTRUCTION, so no residual,
    pitch or corpus truth is involved. Two families matter:

      determined - the structure pins the mapping down (distinct cardinality,
                   beams, well-separated x). The margin must be LARGE.
      ambiguous  - two sources sit at nearly the same x, so one PDF onset can
                   claim either and the two explanations score almost the same.
                   The margin must be SMALL.

    The threshold must fall strictly between the two families. If they overlap, the
    scoring function cannot tell determined from ambiguous structure and no honest
    threshold exists: STOP rather than tune one.
    """
    sys.path.insert(0, str(ROOT))
    import a_synthetic_tests as T

    determined, ambiguous, cases = [], [], []

    def add(name, P, S, kind):
        p, s = AL.shared_normalise(P, S, 0.0, 1.0)
        gid = [1 if o.get("beamed") else 0 for o in s]
        best, path = AL.align(p, s, gid)
        alt, _ = AL.second_best(p, s, gid, best, path)
        margin = best - (alt if alt > float("-inf") else best)
        cases.append({"case": name, "margin": round(margin, 4),
                      "kind": kind, "n_pdf": len(p), "n_src": len(s)})
        (determined if kind == "determined" else ambiguous).append(margin)

    # --- determined by construction ---
    add("det_distinct_cardinality_and_beams",
        [T.pdf(0.05), T.pdf(0.11, card=2), T.pdf(0.30, dur="eighth", beamed=True),
         T.pdf(0.33, dur="eighth", beamed=True), T.pdf(0.34), T.pdf(0.62, dur="eighth"),
         T.pdf(0.80, dur="eighth", beamed=True)],
        [T.src(0.05), T.src(0.11, card=2), T.src(0.30, dur="eighth", beamed=True),
         T.src(0.33, dur="eighth", beamed=True), T.src(0.34), T.src(0.62, dur="eighth"),
         T.src(0.80, dur="eighth", beamed=True)], "determined")

    add("det_widely_separated",
        [T.pdf(0.10, card=3), T.pdf(0.24), T.pdf(0.52), T.pdf(0.74, card=2), T.pdf(0.90)],
        [T.src(0.10, card=3), T.src(0.24), T.src(0.52), T.src(0.74, card=2), T.src(0.90)],
        "determined")

    add("det_false_proposal_skipped",
        [T.pdf(0.05), T.pdf(0.20, verdict="NON_NOTE_LIKELY"), T.pdf(0.30),
         T.pdf(0.55), T.pdf(0.80)],
        [T.src(0.05), T.src(0.30), T.src(0.55), T.src(0.80)], "determined")

    add("det_chord_and_beam_signature",
        [T.pdf(0.05, card=3), T.pdf(0.25), T.pdf(0.50, dur="eighth", beamed=True),
         T.pdf(0.55, dur="eighth", beamed=True), T.pdf(0.80, card=2)],
        [T.src(0.05, card=3), T.src(0.25), T.src(0.50, dur="eighth", beamed=True),
         T.src(0.55, dur="eighth", beamed=True), T.src(0.80, card=2)], "determined")

    add("det_dense_twelve",
        [T.pdf(0.03 + 0.08 * i) for i in range(12)],
        [T.src(0.03 + 0.08 * i) for i in range(12)], "determined")

    # --- ambiguous by construction: source onsets inside ONE pdf onset's reach,
    # so a single PDF proposal can legitimately claim either ---
    add("amb_source_pair_inside_one_pdf",
        [T.pdf(0.10), T.pdf(0.505), T.pdf(0.90)],
        [T.src(0.10), T.src(0.500), T.src(0.510), T.src(0.90)], "ambiguous")

    add("amb_twin_plus_spare",
        [T.pdf(0.20), T.pdf(0.50), T.pdf(0.80)],
        [T.src(0.20), T.src(0.50), T.src(0.501), T.src(0.80)], "ambiguous")

    lo_amb = max(ambiguous) if ambiguous else 0.0
    hi_det = min(determined) if determined else float("inf")
    return cases, lo_amb, hi_det


def stability(pdfs, srcs, gid, lo, hi):
    """A7: accepted correspondence must survive the perturbation envelope."""
    rng = random.Random(PERTURB_SEED)
    base, base_path = AL.align(pdfs, srcs, gid)
    base_pairs = frozenset(AL.path_pairs(base_path))
    flips = 0
    for k in range(PERTURBATIONS):
        amp = PERTURB_DX if k % 2 == 0 else PERTURB_DX2
        p2 = []
        for o in pdfs:
            q = dict(o)
            q["x"] = min(1.0, max(0.0, o["x"] + rng.uniform(-amp, amp)))
            if rng.random() < PERTURB_CONF and o.get("verdict") == "AMBIGUOUS":
                q["verdict"] = "NOTE_ONSET_LIKELY"
            p2.append(q)
        s2 = []
        for o in srcs:
            q = dict(o)
            q["x"] = min(1.0, max(0.0, o["x"] + rng.uniform(-amp, amp)))
            s2.append(q)
        _, path2 = AL.align(p2, s2, gid)
        if frozenset(AL.path_pairs(path2)) != base_pairs:
            flips += 1
    return flips, PERTURBATIONS


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("A6/A10 acceptance-margin selection from structural stability only\n")
    cases, lo_amb, hi_det = choose_margin_from_stability()
    for c in cases:
        print("  %-26s margin %7.4f  (%s)" % (c["case"], c["margin"], c["kind"]))
    print("\n  max margin on an AMBIGUOUS case : %.4f" % lo_amb)
    print("  min margin on a DETERMINED case : %.4f" % hi_det)
    if lo_amb >= hi_det:
        print("\n  OVERLAP: the scoring function does not separate determined from")
        print("  ambiguous structure. No honest threshold exists. STOP.")
        return 1
    print("  separating gap: (%.4f, %.4f)" % (lo_amb, hi_det))
    print("  pre-registered ACCEPT_MARGIN   : %.2f" % ACCEPT_MARGIN)
    ok = lo_amb < ACCEPT_MARGIN < hi_det
    print("  threshold lies inside the gap  : %s" % ok)
    if not ok:
        print("\n  The frozen threshold does not sit in the separating gap. STOP.")
        return 1

    doc = dict(PARAMS)
    doc["margin_selection"] = {
        "method": "synthetic structural stability only; no residual, no pitch",
        "cases": cases,
        "max_ambiguous_margin": round(lo_amb, 4),
        "min_determined_margin": round(hi_det, 4),
        "separating": True,
    }
    doc["solver_code_sha256"] = solver_hash()
    (OUT / "solver_frozen.json").write_text(json.dumps(doc, indent=1) + "\n")
    sh = hashlib.sha256((OUT / "solver_frozen.json").read_bytes()).hexdigest()
    (OUT / "solver_frozen.sha256").write_text(sh + "\n")
    print("\nsolver frozen  : %s" % (OUT / "solver_frozen.json"))
    print("solver sha256  : %s" % sh)
    print("code sha256    : %s" % doc["solver_code_sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
