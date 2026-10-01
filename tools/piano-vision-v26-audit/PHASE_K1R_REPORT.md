# Phase K1R — Verovio structure fixed; structural gate PASSES, clean gate NOT EVALUATED

**Both K1R bugs are fixed and covered by permanent regression tests. The K2R
structural gate passes. K3R–K5R still produce zero note rows, so the K6R clean
gate was NOT evaluated and K14 is NOT triggered. Nothing certified, refused or
relabelled. No model or RTX work.**

---

## 1–3. Verovio DOM structure, and the corrected definitions

**DOM ancestry (as emitted by Verovio).** Structure is
`svg > page-margin > system > measure > staff`, with notes at
`staff > layer > note > notehead > use`, and barlines at **`measure > barLine`
— a sibling of `staff`, not a child**. Each `barLine` holds one vertical
`<path d="M{x} y0 L{x} y1">` **per staff**, so a grand-staff barline yields two
paths. This is exactly why the failed run's x-based assignment could never work.

**K1R-A — corrected STAFF UNIT definition.** A staff unit is **one five-line
staff, keyed by `(page, y_top)`**, recorded with `y_top`, `y_bot`, `y_mid`,
`gap` and `x` extent. The second bug was subtler than bad keying: *every measure
in a system row carries its own `<g class="staff">` at the same `y_top`*, so a
naive per-measure key is not unique. A staff unit is therefore the **merge of
all per-measure staff groups sharing `(page, y_top)`**. The regression test now
asserts key uniqueness. Terminology kept explicit: STAFF UNIT = one staff;
SYSTEM = one row of staff units, built only from shared barline x and vertical
adjacency.

**K1R-B — corrected barline assignment.** Every `barLine` path is parsed as
`(x, y0, y1)` and assigned to **every staff unit whose vertical span
`[y_top, y_bot]` intersects `[y0, y1]`** within `0.6 × staff_gap`. No x
proximity is used. A grand-staff barline legitimately lands on both staves.
**Regression test: 72 barline segments parsed, 30 staff units, all barlines
assigned — PASS.**

## 4–6. PDF vs Verovio counts on the three named scores

| score | PDF units | PDF bars/unit | V units | V bars/unit | raw barline paths | assigned |
|---|---|---|---|---|---|---|
| bach-fugue | 20 | 7.65 | **20** | 2.80 | 56 | **56 (100%)** |
| beethoven-sonata | 40 | 13.50 | **68** | 4.50 | 306 | **306 (100%)** |
| chopin-etude-10-01 | 35 | 7.91 | **56** | 2.86 | 160 | **160 (100%)** |

**System counts are now plausible**, e.g. PDF 10 rows / Verovio 8 systems
(bach-fugue), 20 / 34 (beethoven), 21 / 24 (chopin-etude). Compare the failed
run: 20 PDF units vs 125 "Verovio units".

## 7. Structural gate: **PASS**

| check | result |
|---|---|
| max Verovio/PDF staff-unit ratio | **1.70** (order-of-magnitude would be ≥5) |
| zero-Verovio-staff-unit scores | none |
| staff units present but zero barline paths | none |
| barline paths parsed to zero | none |
| **hard assertions** | **all pass** |

## 8–10. Matching stages

| stage | result |
|---|---|
| K3R staff units aligned in order | **109 accepted** (172 rejected `weak_unit_match`, 17 `empty_side`) |
| K3R barline-interval alignment | **0 intervals** — all 109 units rejected `no_bar_interval` |
| K5R onset groups matched | 0 |
| note rows produced | **0** |

## 11–14. Clean gate: **NOT EVALUATED (denominator = 0)**

| | |
|---|---|
| clean matched N | **0** |
| clean `<0.25` rate | not evaluated |
| clean `r_render = 0` rate | not evaluated |
| **VALID PASS/FAIL of >98% gate** | **NOT EVALUATED** |

The script prints `NOT EVALUATED` rather than a PASS/FAIL, and **K14 is
explicitly not triggered** — a valid gate measurement still does not exist.

## 15–18

| | |
|---|---|
| mismatch-population results (K7R) | not reported — no valid gate |
| **K14 legitimately triggered** | **NO** |
| capability number | **none** — 2.1 immutable: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work | **not justified** |

---

## The blocker, now precisely located

K3R aligns staff units successfully (109 accepted). It is **K3R's barline
intervals** that produce nothing, and the diagnostic shows why — **the two
barline extractors disagree materially in count**:

- **Verovio: 2–3 barlines per staff unit**, for system rows holding 31–54
  noteheads (i.e. roughly 5–7 measures, which should carry 5–7 barlines).
- **PDF raster: 4–12 per staff unit**, varying widely between staves of the same
  system (`p2 s1 lower` = 12, `p2 s2 upper` = 5).

Neither is trustworthy at present. Verovio emits far fewer `barLine` paths than a
5–7 measure system should have — most likely my path regex is missing barline
forms it emits in other shapes, or Verovio draws only a subset. The raster
detector's spread of 4–12 for comparable systems suggests false positives, since
a fixed 0.85-band-height ink-fraction test with a 7 px width cap can still admit
thick vertical strokes at note clusters.

With barline counts this inconsistent, `bar_align` cannot form reliable
intervals, so `x_rel` never becomes well-defined and no note is ever matched.
**This is a barline-extraction fidelity problem on both sides, not a matching
problem** — and it is exactly the diagnostic K9 exists to surface.

## What is now settled, and what is not

**Settled this phase (real progress, all verified by hard assertions):**
1. Verovio's DOM structure is understood: barlines are `measure`-level siblings
   of `staff`, one path per staff.
2. The correct staff-unit key is `(page, y_top)` **with per-measure merging**;
   keys are now unique and the 125-unit fragmentation is gone (ratio 1.70).
3. Barline-by-vertical-overlap assignment works: **100% of barline paths are
   assigned**, on all three named scores and across the corpus.
4. The "denominator = 0 ⇒ no PASS/FAIL, no K14" rule is now enforced in code.

**Not settled:** the clean gate, and therefore every downstream conclusion.

## The next step, stated but not taken

Make both barline extractors *count-correct* before any matching is attempted,
and assert on the count:

- **Verovio:** enumerate every `barLine` child element and its full subtree,
  logging any path that does not match the `M x y L x y` form, until the
  per-staff-unit count is consistent with the measure count for that system.
- **PDF raster:** tighten the vertical-structure test (require a *contiguous*
  run spanning the band, and require the column group to be isolated from note
  ink within ±1 staff gap) and re-measure the spread.
- **Add a hard assertion** that a staff unit with ≥8 measures yields ≥7 barlines
  on both sides.

A structural gate on *barline count consistency* should precede the staff-unit
gate, because the latter now passes while the barline layer beneath it does not.
That is the honest ordering, and I would rather record it than ship another
round of zero-denominator results.

---

## Script

- `phase_k1r_structure.py` — K1R-A/B/C structure extraction, K2R structural gate
  with hard assertions, K3R–K5R matching, K6R guarded gate, plus
  `_tests()` regression tests for BUG1 (barline assignment) and BUG2 (staff-unit
  keying) that run on every invocation.
