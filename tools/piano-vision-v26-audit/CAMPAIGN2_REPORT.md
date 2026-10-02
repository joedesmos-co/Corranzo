# Piano V2.6 — autonomous campaign, consolidated final report

**HARD GATE at Stage B. Stages C–H were not run, because measure correspondence
could not be established and running the note-level clean gate on an invalid
measure mapping would be circular. Nothing certified, refused or relabelled.
Corpus 2.1 untouched. No RTX, no model work.**

---

## 1. Sparse-system detection

Classified from **PDF ink only** — non-staff ink density and ink-run counts after
staff-line removal. No MusicXML measure count was used to classify.

| class | systems |
|---|---|
| NORMAL_TWO_STAFF | **154** |
| UPPER_ACTIVE / LOWER_SPARSE | 12 |
| LOWER_ACTIVE / UPPER_SPARSE | 2 |

A **third** case then turned out to matter more than either: **40 staff units on
8 pages have no sibling staff at all**, because the extractor's glyph-font bbox
never emitted a lower band there. Mazurka pages 2–3 are entirely upper-only.
Cross-staff consensus simply cannot apply to them.

## 2. Fallback method

Strict single-staff evidence on the active staff: near-full contiguous run
(coverage ≥ 0.90), endpoint agreement within 0.20 gaps, internal gap ≤ 0.20 gaps,
narrow persistent stroke, multi-stroke events clustered at 1.60 gaps, and — added
as an iteration — **the run must touch both outer staff lines inside the exact
validated span**, measured without a padded search window. Sibling ink is
reported but never required.

## 3. Fallback held-out result: **FAILED**

| | systems | mean events | mean intervals |
|---|---|---|---|
| dev (4 scores) | 7 | 9.86 | 8.86 |
| held-out (7) | 7 | 7.71 | 6.71 |

Stable, but **wrong in absolute terms**. Applied to corpus-wide it *regressed*
prelude (26 → 54 intervals) and etude-10-01 (31 → 77), and the solo route
inflated mazurka from 74 to 200.

### The two allowed fixes, both spent

**Fix 1 — cap coverage at 1.06.** Rationale: a bar spans the staff and nothing
more, so >1.0 means the run bridges to non-staff ink. **Wrong, and reverted.**
With a 0.30-gap search pad a genuine barline legitimately measures up to ~1.15,
so the cap deleted real boundaries and collapsed the fallback to 2 intervals
corpus-wide. Coverage above 1.0 is not a usable false-positive signal.

**Fix 2 — enforce `max_runs` inside `candidates()`.** This exposed a real
parameterisation bug: `max_runs` was read **only** by `strict_candidates`, never
by `candidates()` itself, so two-run artifacts were never filtered. Enforcing it
is correct and lives on, but it changes solo intervals only 314 → 294, so it is
not the dominant error.

## 4–5. Per-score PDF intervals vs Verovio measures

Three PDF routes: cross-staff consensus (validated), sparse-sibling fallback
(failed), no-sibling solo (failed).

| score | consensus IV | fallback IV | solo IV | total | Verovio | diff |
|---|---|---|---|---|---|---|
| bach-fugue | 25 | — | — | 25 | 27 | −2 |
| beethoven-sonata | 106 | — | — | 106 | 152 | −46 |
| chopin-etude-10-01 | 31 | 59 | 37 | 127 | 79 | **+48** |
| chopin-etude-10-12 | 37 | 6 | — | 35 | 84 | −49 |
| chopin-nocturne | 52 | — | — | 55 | 38 | +17 |
| mozart-k153 | 51 | 3 | 7 | 61 | 67 | −6 |
| dense-advanced | — | — | 12 | 12 | 8 | +4 |
| grand-voices | 11 | — | — | 14 | 8 | +6 |
| rhythm-tuplets | — | — | 9 | 9 | 8 | +1 |
| bach-prelude | 26 | 28 | — | 54 | 35 | **+19** |
| fur-elise | 97 | — | — | 88 | 105 | −17 |
| brahms-waltz | — | — | 18 | 18 | 33 | −15 |
| mazurka | 24 | — | 176 | 200 | 74 | **+126** |
| handel-gavotte | 19 | — | — | 19 | 20 | −1 |
| turkish-march | 109 | — | 7 | 116 | 128 | −12 |
| old-french-song | — | — | 37 | 37 | 33 | +4 |
| demo-minuet | 32 | — | — | 25 | 32 | −7 |
| **total** | 618 | 109 | 314 | **1001** | **931** | **+70** |

## 6. Reflow/partition classification: **D — unresolved, for every score**

Not A, B or C. The flattened totals disagree with Verovio by −49 to +126, and the
sign is inconsistent, so this is not a uniform convention offset and **no first
internal divergence can be located**, because the two sequences cannot be aligned
well enough to find one.

The consensus route alone is excellent on the scores where it applies
(minuet 25–32/32, handel 19/20, bach-fugue 25/27, fur-elise 88/105), and it is
the *unvalidated single-staff routes* that produce the large positive errors.
That distinction matters and is preserved below.

## 7. Structural mapping coverage

**Not established.** Coverage is good where consensus applies (160 of 168
systems, residual median 0.0000, p95 0.0000, max 1.0 staff gaps, held-out
consensus 0.9293) and **zero** where a sibling staff is missing. A global ordinal
mapping cannot be built from a mixture of validated and unvalidated sources.

## 8–11. Note matching and the clean gate: **NOT EVALUATED**

| | |
|---|---|
| clean matched-note N | not evaluated |
| clean `<0.25` rate | not evaluated |
| clean `r_render=0` rate | not evaluated |
| **>98% gate** | **NOT EVALUATED** |

**N = 0 is reported as NOT EVALUATED, never PASS or FAIL.** Running the note-level
gate on a measure mapping that is wrong for 8 of 17 scores would produce a number
that looks authoritative and means nothing — the same failure mode that produced
the withdrawn Phase M and Phase N results.

## 12–18. Source truth, qualification, capability: **NOT RUN**

No displacement statistics, no contour agreement, no certification rate, no
mixed-group taxonomy, no Corpus 2.2 candidate, no non-circularity proof, **no
capability baseline**. The Stage G precondition ("if and only if Stage F
produces a valid non-circular qualification set") was never met, so the decoder
was not re-run. 2.1 figures remain historical reference only: step 0.8370, octave
0.9782, accidental 0.7990, written pitch 0.7342 weighted / 0.7006 macro — **still
not a capability measurement**.

## 19. Zero-parameter metrics: **none produced**

## 20. What is genuinely established this campaign

The **cross-staff consensus** result survived every test and is the real
achievement: 779 boundary pairs over 168 systems, x-residual median 0.0000 and
p95 0.0000 staff gaps, max 1.0, with 2,308 candidates discarded by consensus
alone, stable held-out at 0.9293 consensus on 9 scores never used for any
correction. On the scores it covers it reproduces the notated measure count
closely.

**What is not established:** any statement about the 8 scores where a staff is
missing, and therefore no global measure correspondence.

## 21. Exact remaining bottleneck

**A single-staff barline discriminator that does not rely on a sibling staff.**
This is now a precisely characterised gap rather than a vague one. The evidence
that the gap is real and specific:

- A mazurka solo system has **5 real measures** (event spacing 9.9–20.1 staff
  gaps) but the detector returns **11 events**, of which the last five are spaced
  2.2–5.5 gaps apart. Those are note-grouping artefacts, not barlines.
- Requiring `runs == 1` does not remove them, so the artefact is a genuinely
  continuous full-height run — most likely a **stem that happens to reach both
  outer staff lines**, or a beam edge coincident with the staff.
- Meanwhile a real barline can legitimately measure coverage up to ~1.15, so
  over-span cannot be used to discriminate.

So the geometric features available in a single staff — coverage, endpoint
contact, internal gaps, run count, width — **do not separate these two
populations.** Cross-staff agreement is not merely convenient here; it appears to
be doing irreducible work, because a stem on the upper staff has no
corresponding structure on the lower staff to refute it.

## 22. Exact next experiment

Not another threshold, and not more of the same detector. Three candidates, in
order of expected value:

1. **Recover the missing lower staff from the raster itself**, rather than
   requiring the extractor to have emitted one. Detect staff-line rows across the
   full page, group them into five-line staves, and rebuild the missing
   lower staff. This restores cross-staff consensus for all 40 systems and keeps
   the *validated* mechanism, instead of inventing an unvalidated one. This is
   the recommended next step.
2. If the missing staff genuinely does not exist in the raster, **restrict
   qualification to the 160 consensus-validated systems** and report the
   capability baseline on that subset, documenting the 8 scores as excluded for
   a stated structural reason rather than by decoder correctness. That would
   satisfy C8's non-circularity rule honestly.
3. Only if both fail, revisit the note-level correspondence using the
   **consensus-validated systems only**, accepting reduced coverage.

Option 1 is preferred because it strengthens a mechanism already shown to work
instead of replacing it with one shown not to.

## 23. Is RTX justified? **No.**

Nothing about the model, the representation or the readout was under test at any
point in this campaign. The decoder was shown exact in Phases Q–R; six error
mechanisms were positively excluded; the residual 16.30% is a label-provenance
question. The first independently-measured evidence about the source documents
was obtained with no GPU, and it shows the *corpus labelling pipeline* is where
the remaining uncertainty lives. RTX becomes justifiable only after a valid
independently-qualified truth baseline exists **and** demonstrates a
model/representation problem that training can address. Neither condition holds.

## 24. The methodological note

Three times in this campaign I treated a single-source measurement as structural
— the Phase M "partition difference", the Phase N "class C" result, and now the
first fallback pass. The correction each time was the same: demand an invariant
the document satisfies about *itself*. Cross-staff consensus is such an
invariant, and it is the only thing that has ever made the PDF boundary count
trustworthy.

The corollary is the campaign's clearest lesson: **when a single-source
discriminator cannot separate two populations, adding a second source is not
scope creep, it is the measurement.** Here that means recovering the missing
staff, not sharpening the single-staff thresholds further — and I have spent both
allowed fixes confirming the latter does not work.

---

## Scripts

- `stage_a2_consensus.py` — validated cross-staff consensus; also hosts
  `solo_staff_rows()` for no-sibling staff units and the `touch_both` criterion.
- `q1_sparse_fallback.py` — PDF-only sparsity classification and strict
  single-staff evidence.
- `q2_fallback.py` — fallback application, sibling-support reporting, dev/held-out.
- `q6_intervals.py` — three-route interval recomputation and Q7 classification.
- outputs: `out/stage_a2_systems.json`, `out/stage_a2_invariants.json`,
  `out/q1_system_classes.json`, `out/q2_fallback.json`, `out/q6_pdf_intervals.json`,
  `out/q7_classification.json`.
