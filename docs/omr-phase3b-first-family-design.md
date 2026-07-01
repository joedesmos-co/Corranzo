# OMR Phase 3B — First Solver Decision (design only)

Status: design/RFC. No runtime change, no promotion, no heuristic deletion. The
decision below is produced in **shadow only** and measured against the benchmark;
nothing ships until a later, separately-gated phase.

## Preconditions (met, pending your local run)

Phase 3A shipped the identity solver skeleton. On the in-repo vector proxy the
solver is exact — notesΔ 0, measuresΔ 0, pitch/duration/onset/chord agreement
100% — and candidate detection flags **80/160** measures (34 hard-constraint
violations, 64 mixed-beam-ownership). The real clean/dense confirmation is
`npm run omr:scoregraph-shadow` on your machine (expected: clean 0 candidates or
near it; dense a meaningful candidate list; both notesΔ/measuresΔ 0, 100% agree).

## First candidate family: hard-constraint **overlap / overflow** measures

Of the two candidate reasons, start with `hard-constraint-violation` — narrower
still, the two unambiguous sub-cases from `validateHardConstraints`:

- **same-voice overlap**: within one voice, event A's span `[start, start+dur)`
  overlaps the next event B in that voice (`A.end > B.start`).
- **overflow**: an event runs past the barline (`start + dur > totalDivisions`).

Why this family first:

- It is **provably wrong without any reference to truth**. A single voice cannot
  sound two overlapping written durations, and a measure cannot exceed its budget.
  The error is defined by the notation grammar, not by a soft preference — so the
  first solver decision needs no weight tuning to justify.
- It is a **known residual source**: over-extended durations are exactly the
  `wrongDuration` / `wrongOnset` failures, and they are the reason the earlier
  event-level beam caps were even attempted.
- It is the smallest possible joint decision: one voice, one measure, one duration.

## The solver decision that differs from runtime

Runtime currently emits the overlapping/overflowing events as-is; `buildOmrMusicXml`
serializes the overlap with `backup`/`forward`, so the written durations stay too
long and the evaluator scores them as wrong.

The Phase-3B solver decision, for a flagged voice in a candidate measure:

> **Clip the over-extended note's written duration to the gap to the next onset in
> its own voice** (`A.dur := B.start − A.start`); for a final over-flowing note,
> clip to the measure budget (`A.dur := totalDivisions − A.start`). Snap the
> resulting divisions to the nearest note value. Leave onsets, pitches, chord
> membership, and every other voice untouched.

This is forced by the hard constraint (make the voice tile), it is minimal (only
the offending note shortens), and it is **voice-scoped** — it trusts the detected
onset (reliable) and corrects the inferred duration (unreliable). That is the
single decision where the budget constraint alone tells the solver something
runtime got wrong.

## Why this is not the reverted "beam cap"

The event-level beam caps regressed (`duration 80.96% → 80.11%`, wrong durations
`223 → 244`) because they capped durations **wherever beam evidence existed**,
globally and greedily — shortening notes whose long duration was already the
better-matched written value. Phase 3B differs on three axes:

1. **Trigger**: only where a *hard constraint is violated* (the voice literally
   overlaps itself / overflows the bar), never on beam evidence alone.
2. **Scope**: the specific offending voice in the specific measure, not a global
   pass over beamed events.
3. **Gate**: shadow-only and evaluator-measured before any promotion (below); the
   beam-cap experiments were closer to direct edits.

## Confidence model (drives later promotion, not runtime yet)

`solveMeasureGraph` already returns `confidence` / `margin`. For a clip decision:

- **High** when the violation has a single unambiguous culprit — one note whose
  end crosses exactly one later same-voice onset, and clipping resolves the only
  violation in that voice.
- **Lower** when several notes could be the over-long one, when clipping would
  create a gap larger than a beat, or when the clip target is not a clean note
  value. Low-confidence measures fall back to runtime (`fallbackReason`).

The confidence threshold is **calibrated offline against the benchmark**, never
hand-set — consistent with the evaluator-gated promotion rules from the Phase-3
design note.

## What ships in 3B (shadow only)

1. `solveMeasureGraph` gains one real branch: for measures flagged
   `same-voice overlap` / `overflow`, apply the clip to the offending voice and
   record the decision (before/after durations, confidence, reason). All other
   measures remain identity.
2. The three-way shadow report gains a per-measure decision log and, where a truth
   file is available, the evaluator delta (shadow-solver vs runtime, vs truth) on
   exactly the changed measures.
3. Tests: clip is applied only to flagged measures; unflagged measures stay
   byte-identical to runtime; a synthetic overlap measure clips to the next onset;
   a synthetic overflow measure clips to budget; the ScoreGraph is not mutated.

Explicitly **not** in 3B: any runtime promotion, any change to `buildOmrMusicXml`
output, any heuristic deletion, mixed-beam-ownership handling (that is a later,
harder family needing the soft objective).

## Validation & promotion gate (for the phase after 3B)

- Run the shadow solver across the benchmark. Require: **clean unchanged**; dense
  `duration` and `onset` improve-or-hold; **no regression** on pitch, chord, F1,
  noteΔ, measureΔ. If any axis regresses, the clip rule or its confidence
  threshold is reverted — measured, not argued.
- Only after that passes does a *separate* phase wire per-measure promotion behind
  a default-off flag, reusing the `phantomColumnCorrection` simulate-then-promote
  idiom, restricted to high-confidence clip measures.

## Guardrails

- Clean fixture stays byte-identical (it has no/near-zero candidates; clip never
  fires there).
- Measure grid unchanged (the clip re-interprets a duration within a measure,
  never geometry); score-follow, Practice, Wait For You, viewer untouched.
- No rejection-threshold changes, no piece-specific logic; the clip rule is global
  and derives only from the time-signature budget and detected onsets.
