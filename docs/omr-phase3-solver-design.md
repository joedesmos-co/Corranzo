# OMR Phase 3 — Joint Per-Measure Solver (design only)

Status: design/RFC. No runtime change. Nothing here is promoted. Everything runs
through the Phase-2 shadow harness and the existing evaluator/benchmark before any
per-measure promotion is even proposed.

## Preconditions (met)

- Phase 1: the ScoreGraph IR is a faithful observation layer. Runtime↔IR parity is
  exact (la Campanella proxy: 4089/4089 noteheads, 68/68 rests).
- Phase 2: the shadow emitter round-trips the IR to MusicXML with **Δ0 notes, Δ0
  measures, 100% shadow↔runtime agreement** (pitch/duration/onset/chord). So the
  IR → MusicXML path is lossless; any future divergence is a *solver* decision, not
  an emitter artifact. This is the property Phase 3 needs.

(Local confirmation on the real clean/dense fixtures via `npm run omr:scoregraph-shadow`
is still required — expected Δ0 / ~100% on both.)

## What Phase 3 targets

The dense benchmark is note-detection-solved (noteΔ ≈ −3, measureΔ 0). The residual
errors are **coupled rhythm/voice interpretation**: `wrongDuration ≈ 93`,
`wrongOnset ≈ 94`, `chordMismatch ≈ 175`, concentrated in measures like m61
(missing+extra+chord) and m97 (mixed onset/pitch). These are exactly the cases the
ordered heuristic pile cannot fix without global side effects — and the reason the
plateau exists.

The core structural fault: a measure is currently built by a **fixed-order sequence
of local mutations** on an event list. A single measure's onset, duration, chord,
and voice decisions are made in sequence, each committing before the constraint that
would correct it runs. Phase 3 replaces the per-measure interpretation with a
**joint solve** over the ScoreGraph.

## Why this succeeds where the reverted beam sims did not

The beam-ownership simulations (event splitting, voice serialization) already tried
to act on these measures and regressed duration slightly (`80.96% → 80.89%`) because
they applied a **fixed split rule greedily** — same-start splitting that
over-shortened beamed notes in measures where the existing duration was already the
better-matched written value. Two changes make Phase 3 different:

1. **Joint, not greedy.** The split/duration/voice decision is the *output of an
   optimization under the measure's duration budget*, not a rule applied to every
   mixed-ownership column. A beamed moving voice and a sustained voice are assigned
   durations that jointly tile their voices — the sustained note is not shortened
   unless the budget and the evidence both demand it.
2. **Promoted per measure by measured gain, not globally.** The sims replaced whole
   passages; Phase 3 promotes a measure only where it provably matches-or-beats
   runtime (see promotion rules), so a locally-worse solve can never ship.

## The solver

Per measure (a small problem: a handful of onset columns × ≤4 voices), frame
interpretation as MAP assignment over the MeasureGraph.

Variables: for each notehead node, `(voiceId, onsetDivision, durationDivisions)`.
Onsets are largely pinned by the detected onset columns; the hard part is voice
membership and per-voice durations.

Hard constraints (must hold — a candidate that violates them is discarded):
- Each voice's note+rest durations tile the measure to the time-signature budget.
- Chord tones (same voice, same onset) share onset and duration.
- Onsets strictly increase within a voice; ties link equal pitches across a barline.

Soft features (weighted; every proven heuristic becomes a weight, not a mutation):
- Beam/stem grouping from `beamStemGraph` edges (moving-voice cohesion).
- Gap-to-next-onset within a voice; quarter-floor; harmonic-half-span;
  per-clef continuity; register/stem-direction continuity; minimal voice count.

Algorithm: **bounded beam search over onset columns**, left→right, carrying the K
best partial voice assignments and each voice's running budget. Measure-sized state
→ cheap and fully in-browser (no ILP/CP-SAT runtime, no server). Emit the winning
assignment through the Phase-2 shadow path.

Each soft weight is a scalar tuned **against the benchmark** (coordinate/grid search
on the shadow harness), so the objective is calibrated, not hand-set — benchmark-
driven by construction.

## First candidate measure family

Start where the graph already tells us the heuristics are guessing and the budget is
violated:

> **Mixed-ownership onset columns** — measures the beam/stem graph flags via
> `summarizeBeamOwnershipGraph` as `mixedOwnership` / `splitCandidate` (the ~24 dense
> candidates from the beam-ownership work), **restricted** to measures whose runtime
> events over-fill or under-fill the time budget, or where a beamed subset shares an
> onset with a sustained note.

Rationale: these are the coupled onset/duration/chord failures (the bulk of
`chordMismatch` + `wrongDuration` + `wrongOnset`), they are already detected and
enumerable from the IR, and they are exactly what a joint budget-constrained solve
handles and a greedy rule does not. Everything outside this family stays on runtime
output, byte-identical — including all of the clean fixture.

## Evaluator-gated promotion rules

Two gates, at two times. This distinction is the crux of a sound design:

1. **Offline calibration gate (benchmark time, has truth).** Run the solver in
   shadow across the whole benchmark. Using the evaluator's existing per-measure
   scoring (`report.perMeasure` / `worstMeasures`), for each candidate-family measure
   compare solver-measure vs runtime-measure against truth. Derive a **confidence
   threshold** on the solver's own objective margin above which the solver reliably
   matches-or-beats runtime. Hard gate before anything ships: solver ≥ runtime on
   **every** benchmark metric (clean byte-identical; dense pitch/duration/onset/chord/
   F1/noteΔ/measureΔ all ≥), else stop.

2. **Runtime confidence gate (no truth available).** At runtime there is no truth, so
   promotion cannot be evaluator-gated directly. Instead apply the **offline-
   calibrated confidence threshold** plus hard-constraint satisfaction, reusing the
   existing `phantomColumnCorrection` idiom: simulate the solver measure; promote it
   over the runtime measure only if it is in the candidate family, passes the hard
   constraints, and clears the calibrated confidence margin; otherwise fall back to
   the runtime measure. If solver-measure == runtime-measure, it is a no-op.

3. **Corpus revert.** Even with per-measure promotion, re-run the full benchmark; if
   any axis regresses, the promotion (or the weight change) is reverted. "If metrics
   regress → revert," enforced at both measure and corpus granularity.

## Milestones (each reversible, no runtime change until its gate passes)

1. Solver in shadow only: `solveMeasure(measureGraph) → events`, emitted via the
   Phase-2 path; whole-benchmark shadow report. No promotion.
2. Calibrate weights + the confidence threshold on the candidate family; prove
   solver ≥ runtime on every benchmark axis in shadow.
3. Narrow per-measure promotion behind a default-off flag, candidate family only;
   verify clean stays byte-identical and dense improves with no regression.
4. Expand the family only as measured gains justify; delete superseded heuristics one
   at a time, each gated by "benchmark unchanged-or-better."

## Guardrails

- Clean fixture stays byte-identical (solver == runtime there; family excludes it).
- The measure grid remains an unchanged, first-class output (score-follow depends on
  it); the solver only re-interprets events within a measure, never its geometry.
- No rejection-threshold changes; no piece-specific logic; weights are global and
  benchmark-tuned.
- Prerequisite before promotion expands beyond the first family: a **held-out**
  dense/anime/classical corpus, so weight tuning cannot overfit the two benchmark
  pieces (the same caveat from the v2 note; it becomes load-bearing here).
