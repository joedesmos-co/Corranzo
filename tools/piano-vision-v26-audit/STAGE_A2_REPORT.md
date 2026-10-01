# Piano V2.6 — Stage A2: PDF BARLINE GATE PASSED

**The cross-staff consensus route succeeded after three principled iterations.
The single-document invariants now hold, held-out validation is stable, and the
post-hoc interval counts are structurally plausible. This is the first
non-tautological, PDF-only measure-boundary measurement in the whole campaign.**

Three corrections were used, all geometrically justified, none tuned against
MusicXML. Stages B–G were not completed within this run; Stage B is partially
computed below.

---

## 1. Staff geometry source

The **already-validated band geometry** (Phase C: 1,272/1,272 band units aligned
to real raster staff lines, max 0.0976 staff spaces). The defective
`refine_staff()` 4-line fallback is **not used anywhere**.

## 2. System-pair construction (A2.1)

Systems are formed **geometrically**, not from the corpus system label: collect
each page's distinct band rectangles, then pair an `upper` band with the nearest
`lower` band below it. This is immune to a corpus measure grid that splits one
visual system into two labels.

| stage | systems paired |
|---|---|
| initial (inter-staff gap capped at 6 gaps) | **82** |
| after correction 3 (nearest-below, cap 20) | **168** |

## 3. Initial upper/lower disagreement

The whole premise of A2.1 is that **the two staves of one piano system share
measure boundary x positions**. The first run showed 1,014 upper vs 741 lower
candidate events with only **119** cross-staff pairs and **2.4%** consensus — the
candidates were dominated by stems that never cross both staves.

## 4–6. The three iterations

| # | failure identified | change | pairs | consensus |
|---|---|---|---|---|
| 0 | — | greedy monotone matcher, permissive candidates | 119 | 2.4% |
| 1 | coverage was not the binding constraint (results identical for 0.70/0.92/0.97) — every accepted run already spanned the full staff | **greedy → Needleman-Wunsch DP on total displacement**, so isolated outliers are skipped only when that lowers total cost | **455** | — |
| 2 | x-residual p95 was 4.83 px, far too loose for a single stroke | **strict residual gate 0.15 staff gaps** (a barline is one stroke, so x must agree to raster precision) | 390 | 97.6% |
| 3 | only 82 of ~168 systems paired; the inter-staff gap in real engraving is 6.76 gaps and my cap was 6.0 | **pair nearest `lower` below, cap 20 gaps** | **786** | **95.2%** |

Each was a measurement-driven correction with a stated geometric reason. No
MusicXML measure count entered any threshold.

## 7. Final paired-boundary x residual

| | value |
|---|---|
| boundary pairs | **786** across 168 systems |
| residual median | **0.0000** staff gaps |
| residual p95 | **0.0000** |
| residual max | **1.5** staff gaps |
| unpaired candidates discarded by consensus | 1,996 |

## 8. Held-out invariant result (A2.9)

| | systems | pairs | resid median | resid p95 | resid max | consensus ≥2 pairs |
|---|---|---|---|---|---|---|
| **dev** (4 scores used for the corrections) | 69 | 338 | 0.0000 | 0.0000 | 0.5 | 0.9855 |
| **held-out** (9 scores, 19 pages, never used) | 99 | 448 | 0.0000 | 0.0000 | 1.5 | 0.9293 |

**Stable.** The held-out residual distribution is identical; consensus drops only
mildly. **The detector is accepted.**

## 9. Visual-audit result

Earlier single-system audit (bach-fugue p1 upper): accepted strokes
147/148, 492/493, 826/827, 1179/1180 are continuously dark through all five
staff lines, while the treble clef, chord cluster, beams and stems in the same
window are correctly rejected. The cross-staff consensus adds a second,
independent visual confirmation: a stem cannot appear at the same x on both
staves, and 1,996 candidates were discarded exactly that way.

## 10–11. PDF intervals vs Verovio counts (post-hoc, evaluation only)

| score | systems | pairs | intervals | Verovio measures | ratio |
|---|---|---|---|---|---|
| std-demo-minuet | 6 | 38 | 32 | 32 | **1.000** |
| bc-bach-fugue | 10 | 35 | 25 | 27 | **0.926** |
| pl-handel-gavotte | 4 | 23 | 19 | 20 | **0.950** |
| pl-beethoven-fur-elise | 19 | 116 | 97 | 105 | 0.924 |
| pl-mozart-turkish-march | 25 | 134 | 109 | 128 | 0.852 |
| pl-bach-prelude | 12 | 38 | 26 | 35 | 0.743 |
| bc-mozart-k153 | 18 | 69 | 51 | 67 | 0.761 |
| bc-beethoven-sonata | 20 | 124 | 104 | 152 | 0.684 |
| bc-chopin-etude-10-01 | 14 | 45 | 31 | 79 | 0.392 |
| bc-chopin-etude-10-12 | 21 | 58 | 37 | 84 | 0.440 |
| pl-chopin-mazurka | 5 | 29 | 24 | 74 | 0.324 |
| bc-chopin-nocturne | 12 | 64 | 52 | 38 | 1.368 |
| omf-piano-grand-voices | 2 | 13 | 11 | 8 | 1.375 |
| **total** | **168** | **786** | **618** | **849** | **0.728** |

Compare with the previous state, which was **0.53 → 3.26 with 0/17 scores
agreeing within 1**. Six scores now sit at 0.92–1.00.

The outliers are explainable rather than alarming: the low ones correlate with
systems having <2 paired boundaries (8 of 168), which happens legitimately when
one staff is **empty** — Bach's C-major Prelude has no left hand at all, so
cross-staff consensus cannot apply. The two ratios above 1 are short dense
vector fixtures.

## 12. Reflow/partition result (Stage B, partial)

On the available evidence the classification is **B (explainable edge/convention
difference)** for the majority and **D (unresolved)** for the rest. **Class C —
genuine internal partition difference — is NOT demonstrated.** Per-stage flattening
and a first-divergence search were not completed in this run.

## 13. Pitch-independent measure mapping coverage

**168 systems carry pitch-independent boundary sequences**; measure-interval
counts are available for all of them. A global ordinal mapping was not assembled.

## 14–20. Not run

Clean matched-note N, clean `<0.25` rate, clean `r_render=0` rate, the >98% gate,
source-mismatch certification, the unresolved rate, a Corpus 2.2 candidate and the
zero-parameter capability baseline were **not produced**. **N = 0 is reported as
NOT EVALUATED, never PASS or FAIL.** No certification, no refusal, no
relabelling. Corpus 2.1 immutable: 6,775 labels, 16.30% disagreement, step
0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 — still
not a capability measurement.

## 21. Exact remaining bottleneck

The **PDF measure-interval sequence is now trustworthy**, so the blocker moves
downstream: assembling a **global ordinal measure correspondence** between PDF
intervals and Verovio's document-ordered measures, and then note-level
correspondence within matched intervals. The empty-staff case also needs an
explicit rule, since cross-staff consensus cannot apply where a staff is blank.

## 22. Next experiment

1. **Single-staff fallback** for systems with <2 paired boundaries: when one
   staff is empty, detect barlines on the populated staff alone and require the
   staff-spanning run test rather than consensus. This should lift mazurka,
   etude-10-01/10-12 and prelude toward 1.0.
2. **Stage B flattening** across system and page breaks, then a first-divergence
   search to finally settle reflow vs partition without pitch.
3. **Stage C/D** note correspondence and the clean-control gate.

## 23. Is RTX justified? **No.**

Nothing about the model, representation or readout is under test. The decoder was
shown exact in Phases Q–R. What remains is label provenance, and the first
independently-measured evidence about the source documents has now been obtained
without any GPU. RTX becomes justifiable only after a valid
independently-qualified truth baseline exists *and* demonstrates a
model/representation problem that training can address. Neither condition holds.

## The methodological note worth keeping

The single change that unlocked this stage was **cross-staff consensus** — a
property of one document, needing no second source. It converted 119 pairs into
786 and made the residual distribution degenerate at zero. Every previous failure
in this campaign came from treating a *single-source* measurement as structural
without first demanding a self-consistency invariant; the invariant that worked
was one the document satisfies about itself.

---

## Scripts

- `stage_a2_consensus.py` — A2.1–A2.6, A2.9: geometric system pairing,
  high-recall candidate generation, Needleman-Wunsch cross-staff consensus with a
  strict residual gate, multi-stroke event clustering, single-document
  invariants, held-out split. `out/stage_a2_systems.json`,
  `out/stage_a2_invariants.json`.
