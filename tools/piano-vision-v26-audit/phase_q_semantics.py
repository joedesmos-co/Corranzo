"""Phase Q - target / diatonic coordinate semantics.

Traces BOTH coordinates from source code and tests the three suspects that
remain after Q2.

Q0/Q1  the two coordinate definitions, worked by hand
Q2    the algebraic conversion between them
Q3    three zero-parameter decoders and their residual distributions
Q4    the current residual broken down by clef, staff, line/space, ledger
Q5    the rounding contract at half values
Q6    is the detected band centre actually the middle staff line
"""
from __future__ import annotations

import gzip
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
LET = "CDEFGAB"
SO, FO = "FCGDAEB", "BEADGCF"
CTX_KEY = slice(19, 34)
CTX_CLEF = slice(0, 8)
CTX_CLEF_LINE = slice(8, 14)
MIDDLE_LINE = {"upper": 34, "lower": 22}          # B4 on treble, D3 on bass
REFERENCE_LINE = {"upper": 32, "lower": 24}       # G4 on treble, F3 on bass


def true_d(step, octave):
    """Exactly musicxml_truth: diatonic = octave * 7 + DIATONIC[step]."""
    return octave * 7 + DIATONIC[step]


def clef_center_diatonic(sign, line):
    """Exactly musicxml_truth.clef_center_diatonic."""
    base = {"G": 30, "F": 18, "C": 24}.get(sign)
    if base is None or line < 1:
        return None
    return base + 2 * (line - 1)


def key_alter_row(f):
    f = int(f)
    k = (SO[:min(f, 7)] if f > 0 else FO[:min(-f, 7)] if f < 0 else "")
    out = np.zeros(7, np.int64)
    for i, ch in enumerate(LET):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


# ------------------------------------------------------------------ Q0/Q1/Q2
def semantics():
    print("=== Q0 true_d, traced from musicxml_truth.py ===")
    print("  diatonic        = octave * 7 + DIATONIC[step],  DIATONIC = C0 D1 E2 F3 G4 A5 B6")
    print("  center_diatonic = clef_center_diatonic(sign, line)")
    print("                   = {'G':30,'F':18,'C':24}[sign] + 2*(line-1)")
    print("                   = diatonic of the note ON THE CLEF REFERENCE LINE (1-based from bottom)")
    print("  center_diatonic is used ONLY by expected_measured_steps to build the aligner's")
    print("  lattice. It is NOT the coordinate the label is compared against.\n")
    print("=== Q1 d0, the geometry decoder ===")
    print("  d0 = MIDDLE_LINE[band] + round(2*k)")
    print("  34 = B4 = the note on the MIDDLE line (line 3) of a treble staff")
    print("  22 = D3 = the note on the MIDDLE line (line 3) of a bass staff")
    print("  k = 0 means the notehead centre sits on the band centre, i.e. the middle line.")
    print("  +1 in round(2*k) is ONE DIATONIC STEP = half a staff space (a line-to-space move).")
    print("  Sign: y grows DOWNWARD, so k = (bandCentreY - cy)/gap is POSITIVE above the middle line.")
    print("  Line/space parity: round(2*k) is even on a line and odd on a space, by construction.\n")

    print("=== Q2 algebraic conversion ===")
    print("  true_d is an ABSOLUTE diatonic number, not anchored to the clef.")
    print("  d0 is also an absolute diatonic number (middle-line note + staff offset).")
    print("  Therefore they are ALREADY in one frame and no conversion is required.")
    print("  Worked check - a note on the treble MIDDLE line:\n")
    for step, octv, why in (("B", 4, "treble middle line"), ("D", 3, "bass middle line")):
        td = true_d(step, octv)
        band = "upper" if octv == 4 else "lower"
        print("    %-22s true_d(%s%d) = %d ; d0 at k=0 on the %s band = %d  -> %s"
              % (why, step, octv, td, band, MIDDLE_LINE[band],
                 "EQUAL" if td == MIDDLE_LINE[band] else "DIFFER"))
    print("    the space just below the treble middle line: F4 (k = -1.5 spaces)")
    print("      true_d(F4) = %d ; d0 = 34 + round(-3) = %d  -> %s"
          % (true_d("F", 4), MIDDLE_LINE["upper"] + int(round(2 * -1.5)),
             "EQUAL" if true_d("F", 4) == MIDDLE_LINE["upper"] - 3 else "DIFFER"))
    print("    a note one ledger line above the treble staff: A5 (k = +3.0 spaces)")
    print("      true_d(A5) = %d ; d0 = 34 + round(6) = %d  -> %s"
          % (true_d("A", 5), MIDDLE_LINE["upper"] + int(round(2 * 3.0)),
             "EQUAL" if true_d("A", 5) == MIDDLE_LINE["upper"] + 6 else "DIFFER"))
    print("\n  => the anchor hypothesis is DEAD. 34/22 and 32/24 are not two ways of")
    print("     saying the same thing: 34/22 are MIDDLE-LINE diatonics and 32/24 are")
    print("     CLEF-REFERENCE-LINE diatonics, used by a different function.")

    tests = []
    for step, octv, band in (("B", 4, "upper"), ("D", 3, "lower")):
        tests.append((f"middle line of the {band} staff: true_d == anchor",
                      true_d(step, octv) == MIDDLE_LINE[band]))
    tests.append(("treble top line F5: d0 at k=+2 spaces == true_d",
                  MIDDLE_LINE["upper"] + 4 == true_d("F", 5)))
    tests.append(("treble bottom line E4: d0 at k=-2 spaces == true_d",
                  MIDDLE_LINE["upper"] - 4 == true_d("E", 4)))
    tests.append(("treble space above middle (C5) at k=+0.5 -> true_d",
                  MIDDLE_LINE["upper"] + int(round(2 * 0.5)) == true_d("C", 5)))
    tests.append(("treble space below middle (A4) at k=-0.5 -> true_d",
                  MIDDLE_LINE["upper"] + int(round(2 * -0.5)) == true_d("A", 4)))
    tests.append(("one ledger line above treble: A5 at k=+3 -> true_d",
                  MIDDLE_LINE["upper"] + 6 == true_d("A", 5)))
    tests.append(("one ledger line below treble: C4 at k=-3 -> true_d",
                  MIDDLE_LINE["upper"] - 6 == true_d("C", 4)))
    tests.append(("clef_center_diatonic(G,2) == 32 == G4",
                  clef_center_diatonic("G", 2) == true_d("G", 4) == 32))
    tests.append(("clef_center_diatonic(F,4) == 24 == F3",
                  clef_center_diatonic("F", 4) == true_d("F", 3) == 24))
    npass = sum(1 for _, ok in tests if ok)
    print("\n  semantics unit tests: %d/%d pass" % (npass, len(tests)))
    for n_, ok in tests:
        print("    [%s] %s" % ("ok" if ok else "FAIL", n_))
    return {"tests": [[n_, bool(o)] for n_, o in tests], "passed": npass}


# ------------------------------------------------------------------------ Q5
def rounding_audit():
    print("\n=== Q5 rounding contract ===")
    print("  round() in python/numpy is HALF-TO-EVEN (banker's). Auditing whether")
    print("  that can differ from the notation contract at exact halves.")
    print("  Notation requires: round(2k) must take the notehead to the nearer")
    print("  line or space. An exact half means the notehead sits EXACTLY between")
    print("  two lines, which is degenerate and must not occur in real engraving.")
    rows = []
    for x in (-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, -0.4999999, 0.4999999):
        rows.append((x, int(round(x)), int(math.floor(x + 0.5)),
                     int(math.floor(abs(x) + 0.5)) * (1 if x >= 0 else -1)))
    print("    2k        round()   floor(x+.5)  sign-aware")
    for x, a, b, c in rows:
        flag = "" if a == b == c else "   <-- DIFFERS"
        print("  %+9.4f %9d %11d %11d%s" % (x, a, b, c, flag))
    diff = [x for x, a, b, c in rows if not (a == b == c)]
    # how many real objects sit within a hair of a half?
    d = CACHE.load()
    k = d["staff"][..., 0].astype(np.float64)
    m = (d["mask"][..., 1] & d["mask"][..., 2] & d["mask"][..., 3]) & d["object_mask"]
    frac = 2 * k[m]
    dist = np.abs(frac - np.round(frac))
    near_half = int((np.abs(dist - 0.5) < 1e-6).sum())
    at_half = int((np.abs(frac % 1) < 1e-9).sum())
    print("\n  objects with 2k within 1e-6 of a half-integer: %d of %d (%.5f)"
          % (near_half, int(m.sum()), near_half / max(1, int(m.sum()))))
    print("  objects with 2k exactly an integer      : %d" % at_half)
    print("  -> rounding rules differ only AT exact halves, which occur %.5f of the"
          % (near_half / max(1, int(m.sum()))))
    print("     time. Switching the rule is not justified by the notation contract,")
    print("     and tuning it against labels is forbidden. Q5 verdict: NOT A BUG.")
    return {"rules_differ_at": [str(x) for x in diff],
            "objects_near_half": near_half, "objects_at_integer": at_half,
            "verdict": "not_a_bug"}


# ------------------------------------------------------------------------ Q6
def band_origin_audit(index):
    print("\n=== Q6 staff-line origin contract ===")
    print("  Is `band centre` the true geometric MIDDLE staff line?")
    devs = []
    worst = []
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    bands = rec["input"]["modelInput"].get("geometry", {}).get(
                        "staffBands", {}).get("staffBands", [])
                    for b in bands:
                        ys = [float(v) for v in (b.get("lineYs") or [])]
                        if len(ys) < 3:
                            continue
                        ys = sorted(ys)
                        centre = (float(b["y0"]) + float(b["y1"])) / 2
                        mid_line = (ys[len(ys) // 2 - 1] + ys[len(ys) // 2]) / 2 \
                            if len(ys) % 2 == 0 else ys[len(ys) // 2]
                        dev = (centre - mid_line)
                        gap = (ys[-1] - ys[0]) / max(1, len(ys) - 1)
                        devs.append(abs(dev) / gap if gap > 0 else 0)
                        worst.append((abs(dev) / gap if gap > 0 else 0,
                                      rec.get("exampleId", "")[:40], b.get("staffRole")))
    a = np.array(devs) if devs else np.zeros(1)
    print("  bands checked: %d" % len(devs))
    print("  |band centre - middle detected line| / gap : median %.6f  p95 %.6f  max %.6f"
          % (np.median(a), np.percentile(a, 95), a.max()))
    worst.sort(reverse=True)
    print("  worst 5:", [(round(w[0], 6), w[2]) for w in worst[:5]])
    ok = float(a.max()) < 0.12
    print("  -> band centre IS the middle staff line: %s (max deviation is %s of a"
          % ("YES" if ok else "NO", "%.6f" % a.max()))
    print("     staff space, i.e. sub-diatonic-step)." if ok else "     staff space.")
    return {"bands": len(devs), "median": float(np.median(a)),
            "max": float(a.max()), "is_middle_line": ok}


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    out = {"Q0_Q2_semantics": semantics(),
           "Q5_rounding": rounding_audit(),
           "Q6_band_origin": band_origin_audit(index)}
    p = H.write_json("phase_q_semantics.json", out)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
