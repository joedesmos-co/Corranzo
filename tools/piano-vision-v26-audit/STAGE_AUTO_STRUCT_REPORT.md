# Stage A — automatic structural alignment solver: N = 12. ROUTE INSUFFICIENT. STOP.

**AUTOMATIC STRUCTURAL CORRESPONDENCE. NOT human-certified. NOT human gold truth.**
A15: this is a NEW exploratory validation route, not the previously preregistered
AI-consensus route. No equivalence with human gold truth is claimed. It remains
meaningful internal evidence only because the population was frozen before any
scientific reveal, the solver uses pitch-independent structure exclusively, and every
parameter was hashed before the correspondence was built.

No residual, delta_space, r_corpus, r_render, d0, true_d, written pitch, MIDI or decoder
output was read at any point. Corpus 2.1 immutable. No RTX, no training. The human
micro-review route is stopped and its partial answers are unused.

## A0-A3 representations

**PDF side** (`a_pdf_onsets.py`). Raster only. Staff lines suppressed (3 gaps), 4-connected
components, non-chaining x clustering at 0.9 gaps. Each group gets a morphology verdict:
`NOTE_ONSET_LIKELY`, `NON_NOTE_LIKELY`, `AMBIGUOUS`. Cardinality counts notehead-sized
blobs sharing an x. Vertical `y` is used only to count chord members; it is never emitted
as a comparable value and the source side has no y to compare against, so no vertical
pitch agreement is even expressible. Durations/beams/dots are left `None` on the PDF side,
because nothing on the printed raster supports an independent visual read of them.

**Source side** (`a_source_struct.py`). From the pitch-blind skeleton only: cumulative
duration fraction, duration class, notehead cardinality, beam group, rest adjacency,
grace/tuplet/dot context. No pitch field is read.

## A4-A5 objective

Global DP over the alignment lattice; operations MATCH, SKIP_P, SKIP_X. Monotonic. Frozen
weights: W_X 1.00, W_SPACE 0.85, W_CARD 1.25, W_BEAM 0.45, W_DUR 0.35.
**Skip penalties: SKIP_P 0.55** (0.25 when the raster says the proposal is not a note),
**SKIP_X 1.30**, relaxed to **0.0** for rests/dots/grace/tuplets.
Matching a proposal the raster judges `NON_NOTE_LIKELY` costs an extra **-1.80**, and
`AMBIGUOUS` **-0.55**, so junk is more expensive to match than to skip.
Both sides are normalised by the **same** printed-interval span. Normalising each side by
its own data extent is wrong: a deleted onset at the end of a run stretches to fill the
panel and vanishes.

## A6 margin definition and A10 freeze

`margin = best alignment score - best alignment score among alignments differing in at
least one matched pair`, computed exactly as `max over (i,j) not in best of
F[i][j] + score(i,j) + B[i+1][j+1]` using forward and backward DP tables.

The threshold was NOT tuned from residual agreement. It was chosen from structural
separation only, on synthetic cases whose answer is known by construction:

| determined by construction | margin |
|---|---|
| det_distinct_cardinality_and_beams | 7.1000 |
| det_widely_separated | 7.4250 |
| det_false_proposal_skipped | 2.6737 |
| det_chord_and_beam_signature | 7.4333 |
| det_dense_twelve | 6.5750 |
| **ambiguous by construction** | |
| amb_source_pair_inside_one_pdf | 0.8324 |
| amb_twin_plus_spare | 0.8667 |

Separating gap **(0.8667, 2.6737)**; frozen threshold **2.00**, inside the gap.

- solver sha256 `317ec4ca33795797d0909eae7e8665eea9a8029aed0a6e953d3acf8352a697c9`
- code sha256 `4c9c4d3956ffe91ec4f8ad858d00d94fc5836fe6dbbc64e75635294c2aefd9f2`

## A7 stability

24 perturbations (x jitter +-0.4% and +-1.0% of measure width, verdict nudges, fixed
seed 20261005). A measure is accepted only if the matched-pair set is **identical** across
the envelope. 8/20 measures were perturbation-stable; 12 flipped.

## A9 synthetic validation: 19/19 PASS

Perfect 1:1; false PDF proposal skipped; missing interior onset; missing FINAL onset
detected rather than absorbed; shared-span check; extra source rest; cardinality mismatch
still aligns by order; exact cardinality scores strictly higher than wrong; wrong-cardinality
run still aligns; uniform run aligns 1:1; uniform run is NOT ambiguous (x separates
neighbours); whole-run shift penalised; near-coincident source pair gives a near-zero
margin; determinate measure gives a large margin; dense 28-onset run; unequal spacing;
dropping a true pairing costs score.

Five real defects were found and fixed by these tests:
- the DP backtrack emitted phantom `(-1,-1)` matches at the head of every path
- the backward table was relaxed forward instead of computed from successors, leaving it
  all `-inf` and silently making every margin infinite
- the second-best search banned single pairs one at a time, which cannot produce a
  transposition; an alignment genuinely indistinguishable from the best was reported as
  5.15 away, manufacturing false confidence
- morphology thresholds were hardcoded to a 4-pixel gap when the real staff gap is 10.5 px,
  so no notehead could ever be called a note
- one "ambiguous" test was vacuous: it banned a transposition, which simply returned the
  identity path, so its zero delta proved nothing

## A11 coverage, reported BEFORE any scientific field

| quantity | value |
|---|---|
| measures attempted | 20 |
| AUTO_HIGH_CONFIDENCE | **3** (R056, R070, R072) |
| AUTO_UNRESOLVED | **17** |
| accepted onset mappings | 12 |
| **accepted matched noteheads N** | **12** |
| skipped false P proposals | 0 |
| inferred unlisted PDF onsets | 0 |
| median best-vs-second-best margin | 0.3213 |
| perturbation-stable fraction | 8/20 |

Proposal classification across all 20 items: 91 `NOTE_ONSET_LIKELY`, 23 `AMBIGUOUS`,
2 `NON_NOTE_LIKELY`.

Blocking reasons: margin below threshold on 16, match fraction below 0.80 on 16,
perturbation flip on 12.

- correspondence manifest sha256
  `f193b86446fee90d221f6f8ae112db0e701fa17ea6b1457a10f6e341acc1a4af`

## A12 clean gate

**NOT_EVALUATED.** N = 12 < 50, so membership does not qualify and **no residual was
joined**. Not evaluated means neither PASS nor FAIL.

## A13/A14 — STOP

N = 12 < 50. Per A14:
- **STOP.** No further packet iteration.
- The user is NOT asked to adjudicate all 20 measures.
- **Automatic source-truth certification remains insufficient.**
- `+1/-1/mixed` analysis, source agreement/mismatch, Corpus 2.2 and the frozen
  zero-parameter baseline were NOT run. No provenance label was applied because no
  qualified correspondence exists.

## Honest reading of why N is small

The ceiling if every measure had passed was 122, so the population is not the limit; the
*solver* is. Two structural facts dominate:

1. **The margin collapses because a wrong-but-plausible alignment is nearly free.** In
   these measures the source onsets are evenly spaced and the printed proposals are
   dense, so substituting one proposal for a neighbour barely changes the score. Median
   margin 0.32 against a determined-case margin of 7.4 means the discrimination the
   threshold relies on is largely absent in real data, even though it is present in the
   synthetic cases.

2. **PDF cardinality is unreliable enough to veto most measures.** A confirmed notehead
   mapping requires the raster to affirm the proposal is a note; 23 of 116 proposals are
   still `AMBIGUOUS`, and any measure touching one is excluded by rule rather than by
   judgement.

Both are limits of pitch-blind raster structure, not of effort or tuning. Making the
threshold looser to admit more measures would be choosing the answer after seeing the
result, which is exactly what the pre-registration forbids.

## A8 AI veto — SKIPPED

No fresh independent visual context was available in this session, so the optional
`NO_OBVIOUS_CONTRADICTION` veto was **not** run and is reported as skipped. It could only
ever remove mappings, never add any, so it cannot change N from 12 upward.
