# Stage C — structurally complete subset (C0–C8)

Corpus 2.1 unchanged. No manual labels created. No RTX, no training, no model work.
Qualification (C9) and the zero-parameter baseline (C10) were **not** run: the
clean gate failed on the frozen subset, so the protocol stops there.

## What was built

| Stage | File | Result |
|---|---|---|
| C0 freeze structural measure mapping | `c_structural_subset.py` | 509 measures mapped |
| C1 onset clustering by normalised x | same | 1546 onset groups seen |
| C2 structural completeness (non-circular) | same | 106 structurally complete |
| C3 vertical-rank pairing | same | 689 frozen note pairs |
| C4 freeze + hash | same | `3e47677a39dfd21e36b623c359cc3cf2eb81093bb7320761dfff24807eae086a` |
| C5 post-hoc clean control | `c_clean_gate.py` | **FAIL** 0.3646 vs >0.98 |

C0 aligns *boundaries*, not measure counts: PDF barlines come from the unchanged
validated cross-staff matcher, Verovio barlines from the SVG DOM (`barLine` is a
child of `measure`, not `staff`). A measure is mapped only when **both** of its
boundaries match within 12% of staff width; measures beside an unmatched
boundary are rejected, never guessed. No pitch, `d0`, `true_d`, residual or
decoder result enters any of this.

C2 deliberately cannot see note `y`. C3 pairs by vertical **rank** only and
rejects unison / displaced-second / indistinguishable-geometry groups outright.

## Result

```
clean control N                : 543
median delta_space             : +0.0491      <- geometry is sound
p10 / p90 delta_space          : -2.9421 / +2.0933
|delta_space| < 0.25           : 0.3646   (need > 0.98)
r_render == 0                  : 0.3646   (need > 0.98)
GATE                           : FAIL
```

## Why it fails — two independent blockers

**1. Source coverage (quantified, so new labels are genuinely required).**
Of 1546 onset groups seen, only 106 are structurally complete. The dominant
cause is `onset_group_count_differs` in **1324 measures** — the corpus labels
fewer onset groups than Verovio renders. This is the same population-identity
problem Stage L found, now measured on the frozen subset.

**2. Measure-map reliability (the blocker that matters most).**
Residuals are per-staff *constants*, not noise. `bc-bach-fugue-bwv846` p1 upper
matches almost exactly (median delta +0.041), while
`bc-beethoven-sonata-op2-m1` p2 upper has median −1.439 and an in-band rate of
0.00 — and its Verovio notes span −2..+5.5 where the PDF spans −5.07..+4.44, i.e.
a *different measure* was mapped. Onset-count completeness **cannot** detect this,
because a wrong measure can coincidentally have the same number of onsets.

Per-stave in-band rates: `[0.0 ×10, 0.03, 0.05, 0.06, 0.1, 0.12, 0.25, 0.3, 0.33,
0.54, 0.54, 0.67, 0.71, 0.76, 0.92, 1.0, 1.0]`.

**Diagnostic only (never used for membership — that would select on the
residual):** the 3 staves with rate ≥0.90 pool to 0.9487 (N=39) and the 2 staves
with rate ≥0.99 pool to **1.0000** (N=15). The method is exact where the measure
map is right. The blocker is map reliability, not the geometry.

## Consequence

No source-mismatch certification is legitimate yet, even though 14 proven
mismatches and 198 agreements were observed, because the subset they were
measured on is contaminated. Nothing was relabelled: 14 proven mismatches are
**REFUSED**. Corpus 2.1 is untouched and Corpus 2.2 was not built.

The structural mapping must not be tightened now that the residual has been seen
— that would be selecting on agreement. It has to be re-derived under a criterion
fixed in advance.
