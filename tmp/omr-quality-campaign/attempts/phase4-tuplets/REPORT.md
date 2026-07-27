# Phase 4 — Tuplets: NO PRODUCTION CHANGE

Date: 2026-07-27
Decision: **No production change shipped.** The previous digit-gated 3:2
recovery remains intact (piano-rhythm-tuplets-vector still has 0
`tuplet-mismatch`). The ~12 residual aligned defects are a single Fantaisie
Impromptu measure encoded as 6:4 with no trustworthy tuplet-number evidence.

## Counts

| Scope | tuplet-mismatch |
| --- | --- |
| Aligned, Phase 1 candidate | **12** (all Fantaisie m4 → gen m4) |
| Unmatched (Campanella/Moonlight/Fantaisie/Hungarian) | 441 — measure-alignment noise |
| Baseline aligned | same 12 (Phase 1 beam work did not change tuplets) |
| piano-rhythm-tuplets-vector | **0** tuplet-mismatch (preserved) |

All 12 aligned messages: `Tuplet none (expected 6:4)`.

## Fantaisie m4 evidence

Truth: 12 bass notes, each `durationQuarters ≈ 1/3`, all stamped
`timeModification {actualNotes:6, normalNotes:4}` (one continuous 6:4 encoding
equivalent in ratio to 3:2).

Generated: 12 bass notes present with correct pitch inventory, but on a broken
16th-ish onset grid without `timeModification`.

PDF text-layer digits on page 1:

- Twin `6` glyphs at image `(567,96)` / `(576,96)` — horizontally over m4, but
  ~120px above noteheads and spaced as a metronome **66**, not a tuplet number.
- `3` glyphs sit at x≈342–464 — earlier measures, not m4 (notes at x≈504–660).

Existing `recoverDigitGatedTripletEvents` correctly returns
`insufficient-digits` for m4 (looks only for `3` in a band meanNoteY−90 …
meanNoteY−4). Widening that band to catch the y=96 sixes would also admit
metronome/measure-number digits.

## Attempted / rejected methods

1. **Emit 3:2 from column count alone** — fails Phase 4 “do not invent
   tuplets only to balance measures”; also would still mismatch evaluator
   exact key `6:4` vs `3:2` (evaluator is frozen; `tupletKey` does not
   normalize equivalent ratios).
2. **Treat digit `6` like digit `3` for 6:4 stamping** — the only nearby `6`s
   are metronome `66`, not tuplet numbers. Shipping this would invent 6:4 from
   tempo marks.
3. **Normalize 6:4 ↔ 3:2 in the evaluator** — frozen area; out of scope.

## Verdict

Leave `recoverDigitGatedTriplets.js` unchanged. Residual 12 are real edition
6:4 semantics without safe visual number evidence under current gates. Bracket /
beam-only 6:4 recovery and ratio-normalized evaluation are backlog.

## Backlog

1. Path/bracket detection for tuplet numbers drawn without text glyphs.
2. Safer digit-`6` gating that rejects metronome pairs / measure numbers.
3. Optional evaluator equivalence for `3:2` ↔ `6:4` (product decision; frozen now).
