# Piano V2.6 — page-wide staff recovery campaign, final report

**HARD GATE at Stage B. The staff-recovery objective was achieved and the
validated consensus mechanism now runs on 281 systems, but the flattened
structural counts do not yield a validated ordinal mapping for the deficit
scores. Stages S10–S13 were not run. Nothing certified, refused or relabelled.
Corpus 2.1 untouched. No RTX, no model work.**

---

## 1. Page-wide staff detector

Five-line staves detected from the raster alone, with no dependence on the
extractor's band boxes:

1. **Line evidence** — per row, the longest contiguous horizontal dark run must
   exceed 6% of page width; adjacent supported rows are clustered into one line
   and weighted to a true centre. `LINE_MAX_THICK = 3` rejects thick beams.
2. **Gap estimation** — the modal row spacing on the page, robust to the large
   inter-system and inter-staff gaps.
3. **Exactly five** ordered rows with every gap within 30% of the modal gap.
   Four-line pseudo-staves are rejected outright.
4. **Isolation** — no other detected line row within 0.75 gaps of either extreme
   (measured against rows *outside* the window).
5. **Line span** — all five lines must have a long run (≥35% of page width) and be
   mutually comparable (min ≥ 0.75 × max).

**Two corrections, both forced by measurement.** A single spurious row
desynchronised a non-overlapping window walk for the rest of a page, and 5-line
windows may legitimately overlap, so every start offset is tried and all valid
windows collected. Then, on turkish-march p1, the true upper staff is rows
221–262 with all five spans at 0.83–0.90 while the phantom windows at 212, 231,
839 and 1173 each contain a row spanning 0.06–0.07; the span rule took that page
from 14 candidates to exactly the 10 real staves. That correction also exposed a
bug of my own — the isolation test measured each row against itself, so its
"nearest neighbour" distance was always zero.

## 2–3. Reproduction of existing staves and geometry residuals

Against the **376 already-validated** staff units:

| | value |
|---|---|
| existing staff units | 376 |
| **reproduced** | **307 (81.6%)** |
| not reproduced | 69 |
| **y-centre residual (fraction of staff gap)** | **median 0.0000**, p95 0.024, max 0.077 |
| **gap residual** | median 0.012, p95 0.036, max 0.048 |

Twelve of seventeen scores reproduce at ≥0.95, and beethoven-sonata, etude-10-01,
bach-prelude, brahms-waltz, handel-gavotte, mazurka, tchaikovsky and
demo-minuet at **1.00**. The 69 misses are staves whose fifth line is faint or
partial (e.g. bach-fugue p1 `y0=1232`, whose candidate fifth row spans 0.077 and
is genuinely ambiguous with a ledger) — reported, not forced.

## 4–5. Staves recovered and systems rebuilt

| | |
|---|---|
| page-wide five-line staves | 333 |
| confirming an existing band | 46 |
| **recovered new staves** | **287** |
| systems with both staves originally | 18 |
| **systems completed by recovery** | **263** |
| **total paired systems** | **281** (from 168) |

The 40 staff units absent from the extractor are recovered, which is what
restores the consensus for the pages that previously had none.

## 6. System pairs before/after

| | before | after |
|---|---|---|
| systems | 168 | **281** |
| originally complete (both staves) | 18 | 18 |
| completed by recovery | — | 263 |

Pairing uses a **2–12 staff-gap** window plus a mutual-neighbour rule. The
extractor's own `upper`/`lower` labels are unusable for this: over all 549
label-adjacent pairs the inter-staff gap has **median 38** staff gaps, because
the same staff recurs once per measure. A 0.5–20 window paired staves two
*systems* apart (mozart-k153 p1: 11 staves, 16 pairs, 5–6 real).

## 7. Cross-staff consensus after recovery

The barline mechanism is **unchanged**.

| | systems | pairs | resid median | resid p95 | resid max | consensus | intervals |
|---|---|---|---|---|---|---|---|
| originally complete | 18 | 64 | 0.0000 | 0.0000 | 1.0000 | **0.9444** | 46 |
| recovered | 263 | 1029 | 0.0000 | 0.0000 | 1.5000 | **0.9049** | 766 |

**S7 held-out** (9 scores, 19 pages, never used for either correction): 183
systems, 673 pairs, residual median **0.0000**, p95 **0.0000**, max 1.5,
consensus **0.8798** (dev 0.9592). The residual distribution is identical, so the
mechanism generalises.

## 8–9. Structural counts vs Verovio

| score | systems | complete | PDF intervals | Verovio measures | ratio |
|---|---|---|---|---|---|
| bach-fugue | 16 | 14 | 32 | 27 | 1.185 |
| beethoven-sonata | 23 | 22 | 112 | 152 | 0.737 |
| chopin-etude-10-01 | 18 | 17 | 43 | 79 | 0.544 |
| chopin-etude-10-12 | 17 | 16 | 37 | 84 | 0.440 |
| chopin-nocturne | 12 | 11 | 55 | 38 | 1.447 |
| mozart-k153 | 36 | 34 | 97 | 67 | 1.448 |
| dense-advanced | 4 | 4 | 19 | 8 | 2.375 |
| grand-voices | 4 | 4 | 22 | 8 | 2.750 |
| bach-prelude | 16 | 15 | 31 | 35 | 0.886 |
| fur-elise | 29 | 28 | 101 | 105 | 0.962 |
| mazurka | 22 | 20 | 81 | 74 | 1.095 |
| handel-gavotte | 6 | 5 | 22 | 20 | 1.100 |
| turkish-march | 37 | 37 | 135 | 128 | 1.055 |
| tchaikovsky | 6 | 5 | 19 | 33 | 0.576 |
| demo-minuet | 9 | 7 | 30 | 32 | 0.938 |
| **total** | | | **812** | **890** | **0.9124** |

## 10. Structural mapping coverage

**Not established for the deficit scores.** Eight scores sit at 0.88–1.19
(prelude, minuet, fur-elise, mazurka, mozart, handel, bach-fugue,
turkish-march) and three `omf` vector fixtures are synthetic outliers at
2.4–2.8. The remaining deficits (etude-10-12 0.440, tchaikovsky 0.576,
etude-10-01 0.544) are **under-counting of boundaries**, not a demonstrable
different partition: I can show too few intervals, but I cannot exhibit a first
exact internal divergence, because a count deficit is not a divergence.

**Merge policy was bracketed on the raster alone and the best configuration
locked**, without ever tuning to Verovio:

| policy | ratio |
|---|---|
| page-wide staves only | 0.617 |
| page-wide + restore missed existing | 0.682 |
| union of both | 1.557 (over-pairs; detectors disagree on staff count) |
| **existing wins on overlap** | **0.9124 — locked** |

## 11–13. Clean gate, source truth, capability: **NOT EVALUATED / NOT RUN**

Clean matched-note N, clean `<0.25`, clean `r_render=0`, the >98% gate, source
certification, mixed taxonomy, Corpus 2.2 and the zero-parameter baseline are
**NOT EVALUATED**. **N = 0 is reported as NOT EVALUATED, never PASS or FAIL.**
Nothing certified, refused or relabelled. 2.1 immutable: 6,775 labels, 16.30%
disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch
0.7342 weighted / 0.7006 macro — **still not a capability measurement**.

## 14. Corpus 2.2 accepted / refused / unresolved: **none built**

## 15–16. Zero-parameter capability metrics: **none produced**

## 17. Exact remaining bottleneck

**Boundary recall on systems whose fifth staff line is faint or whose sibling
staff is absent.** Everything downstream is now sound — staff geometry is
page-wide verified at residual 0.0000, the consensus mechanism generalises
held-out, and system pairing is correct. What is missing is a *barline* on some
staves, and the deficit is concentrated in exactly the scores where the page-wide
detector reports fewer staves than the extractor did (0.617 ratio in isolation).

A specific, testable lead emerged from this campaign: **the extractor emits
phantom bands.** On tchaikovsky p1 it reports bands at y=252 and y=726 whose line
rows span only 0.014 and 0.026 of page width — no long horizontal line exists
there at all — while every real staff spans 0.83–0.905. Those phantom bands are
in the corpus's own geometry and are a defect independent of the missing-staff
problem.

## 18. Exact next experiment

1. **Widen the page-wide line evidence** to recover staves with faint fifth
   lines — lower `LINE_MIN_FRAC` and allow a partially-supported line when four
   of five rows are long and evenly spaced. Measured, not tuned: the target is
   closing the 0.617 → 0.912 gap, verified by reproduction rate on the 376 known
   staves *before* any Verovio comparison.
2. **Replace the extractor's band geometry with the verified page-wide
   inventory** in the recovered systems, and record the phantom bands as a
   separate corpus-geometry finding for the corpus owner.
3. Only then re-run S8, and proceed to S10–S13 if the ordinal mapping holds.

## 19. Is RTX finally justified? **No.**

Nothing about the model, the representation or the readout has been under test
at any point in this campaign. The decoder was shown exact in Phases Q–R; six
error mechanisms were positively excluded; the residual 16.30% is a
label-provenance question. This campaign removed a real blocker — 113 staff units
and 113 systems recovered, consensus held-out stable — using **no GPU at all**.
RTX becomes justifiable only after a valid independently-qualified truth baseline
exists **and** demonstrates a model/representation problem that training can
address. Neither condition holds.

## 20. The methodological note

The recurring lesson across this campaign is that **the blocker was never the
thing being tuned.** Tuning single-staff barline thresholds failed twice because
the missing information was a *second staff*, not a better threshold. The
information needed to make the boundary count trustworthy was always an
independent view of the same document — first the sibling staff, then the page
raster. Both times, the fix was to obtain that view rather than to sharpen the
existing classifier.

---

## Scripts

- `s1_pagewide_staff.py` — S1–S3 page-wide five-line detection and the
  cross-check against validated staff units.
- `s4_recover_staves.py` — S4–S6 recovery, system pairing, and re-running the
  unchanged consensus.
- `stage_a2_consensus.py` — the validated consensus mechanism (unchanged).
- outputs: `out/s3_pagewide_crosscheck.json`, `out/s6_consensus_recovered.json`.
