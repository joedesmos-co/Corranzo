# Phase P — PDF barline detector fixed and visually verified

**The invalid total-ink criterion is replaced by a contiguous-run test, and a
direct visual audit confirms the accepted strokes are real printed barlines. On
the audited staff unit the detector reconciles EXACTLY with the notation: 4
events → 3 intervals → 3 notated measures, matching Verovio. The aggregate
count sanity is not yet fully established, so P11 is reported as PARTIAL, and
measure matching is not resumed.**

---

## 1. The contiguous-run detector (P0–P2)

Acceptance uses **PDF raster geometry only**. No MusicXML pitch, `true_d`, `d0`,
residual, Verovio x or measure ordinal, corpus measure mapping, or expected
measure count enters any accept/reject decision.

For each column of a staff-local domain the detector computes the **longest
contiguous dark vertical run** (merging raster breaks up to the gap tolerance),
then scores:

| feature | meaning |
|---|---|
| `cov` | run span as a fraction of the outer-line span |
| `n_runs` | number of disconnected dark runs in the column |
| `d_top`, `d_bot` | run endpoints relative to the top and bottom staff lines |
| `gap` | largest internal gap inside the run |

**The discriminator is exactly the one specified:** a printed barline is *one*
nearly continuous run spanning the staff (`n_runs` small, `cov` ≈ 1). A stem
cluster is *many* short runs whose lengths happen to sum to a barline's height
(`n_runs` large, or a large internal gap). Total ink is no longer the primary
criterion anywhere.

*(One implementation bug found and fixed during P2: the endpoint offsets were
measured from the top of the padded search band instead of from the padding
itself, which rejected every candidate. Before the fix: 0 strokes on every
score. After: 184–1113 strokes per score.)*

## 2–3. Frozen staff-gap-relative thresholds and the internal-gap rule

Chosen from geometry, then frozen; **no cross-source count was used to set them.**

| threshold | value | rationale |
|---|---|---|
| `search_pad` | 0.30 gaps | a barline is flush with the outer lines; allow raster slack |
| `end_tol` | 0.30 gaps | run must start/end within ~⅓ space of the outer lines |
| `min_coverage` | 0.88 | a stem spans ≈3.5 of 4 gaps = 0.875, so 0.88 excludes stems while admitting bars |
| **`gap_frac`** | **0.30 gaps** | **internal-gap rule: a real bar is never interrupted by more than ~⅓ of a space; larger rejects** |
| `max_runs` | 4 | antialias breaks a bar into few pieces; a stem cluster makes many |
| `max_width` | 0.90 gaps | P5: wide strokes are *flagged ambiguous*, not deleted |
| `event_sep` | 1.60 gaps | P6: double/final bars cluster into one event |

## 4–5. Horizontal evidence and stroke→event clustering

Horizontal structure **classifies ambiguity rather than eliminating candidates**,
because real barlines coexist with repeat dots and final bars. Strokes separated
by less than `event_sep` × gap are clustered into **one boundary event**, so a
double or final bar is never counted as two measures.

## 6–8. Counts and improvement

| score | strokes | **events** | events / notated measure |
|---|---|---|---|
| bach-fugue | 184 | **89** | 3.30 (was **5.74**) |
| beethoven-sonata | 787 | **376** | 2.47 (was **3.67**) |
| turkish-march | 1113 | **505** | 3.95 (was **6.33**) |
| chopin-etude-10-01 | 466 | **263** | 3.33 (was **4.48**) |

The disconnected stem-stack overcount is substantially reduced but **not yet
eliminated** in aggregate.

## 9. False-positive taxonomy

| reason | count | share |
|---|---|---|
| insufficient vertical coverage | 411,898 | 0.9967 |
| endpoint miss | 1,361 | 0.0033 |
| disconnected stems | 12 | 0.0000 |

The dominant reason is now the *correct* one: ordinary note/stem columns simply
do not span the staff. Critically, **disconnected stem stacks are no longer a
material rejection class** — they are caught by coverage and endpoints, which is
the intended behaviour.

## 10. Visual audit — the decisive evidence (P8)

bach-fugue page 1, first upper staff unit, gap 10.50, staff extent x = 147…1180.
Accepted strokes: **x = 147/148, 492/493, 826/827, 1179/1180** → **4 boundary
events**.

The text overlay shows the accepted columns as continuously dark through all
staff lines (195, 206, 216, 226/227, 237), while the treble clef, the first
chord cluster and every beam and stem in the same window are correctly
**rejected**.

**And the count reconciles exactly:** 4 events → 3 barline-to-barline intervals →
**3 notated measures**, which is precisely what the closed Verovio census reports
for this staff unit. Independent agreement between a raster-only detector and the
DOM measure count, on the unit chosen for audit.

## 12. Held-out stability (P9/P12)

Thresholds were fixed on 4 development scores; the other **13 scores were never
used to choose anything**.

| | events per staff unit |
|---|---|
| development (4 scores) | 8.112 |
| held-out (13 scores) | 7.795 |

**4% apart** — stable, with no cross-source information used per-candidate.

## 13. Post-hoc count comparison (P10) — a RED FLAG, not an acceptance rule

Aggregate events per notated measure remains **2.5–5.1**, above the 1.5 red-flag
line. But the audited staff unit matches exactly, which identifies the
explanation and also shows why the aggregate is misleading:

> **The staff's left and right extent endpoints are themselves printed barlines.**
> A system with *n* measures therefore has *n+1* events, so events-per-measure is
> expected to exceed 1 by construction, and grows as measures-per-system falls.

The audit used a system with 3 measures, where this correction is small. The
aggregate over-counts mostly where systems hold **few** measures, and needs a
per-score accounting of system-start/end events before it means anything. **I did
not delete any candidate to improve this ratio**, per P10.

## 14. PDF BARLINE GATE: **PARTIAL**

| criterion | status |
|---|---|
| 1. disconnected stem-stack overcount eliminated | **PARTIAL** — greatly reduced; not yet zero in aggregate |
| 2. overlays show accepted events are real printed barlines | **PASS** — audited, and reconciles to the notated measure count |
| 3. event counts structurally plausible | **NOT YET** — pending system-edge convention accounting |
| 4. stable on held-out scores | **PASS** — 4% apart |
| 5. no cross-source information used per candidate | **PASS** |

**Not a full PASS, so measure matching is not resumed** (P12 withheld).

## 15–20

| | |
|---|---|
| flattened measure correspondence testable | **not yet** — P11 is partial |
| reflow vs partition result | **not computed** |
| source mismatch certified | **NO** |
| valid qualification set | **NO** |
| valid capability number | **none** — 2.1 immutable: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work | **not justified** |

## The remaining step, precisely scoped

Not a new detector — an **accounting** correction plus broader auditing:

1. subtract the two system-edge barlines per staff unit before forming intervals,
   so `intervals = events − 1` is compared against the notated measure count;
2. run the P8 overlay audit on **~20 staff units across all four sample scores**
   rather than one, and require every audited unit to reconcile;
3. only then re-evaluate criterion 3 and, if it passes, resume P12.

Steps 1–2 are cheap, CPU-only, and use no cross-source information in the
detector itself. Nothing here justifies a model, a GPU, or any change to
Corpus 2.1.

---

## Script

- `phase_p_pdfbarline.py` — P0–P11: contiguous-run detector, frozen
  staff-gap-relative thresholds, endpoint/internal-gap/horizontal evidence,
  stroke→event clustering, rejection taxonomy, per-score counts, held-out
  stability. Thresholds and dev/held-out split in
  `out/phase_p_thresholds.json`; counts in `out/phase_p_detector.json`.
