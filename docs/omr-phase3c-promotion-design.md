# OMR Phase 3C — Gated Runtime Promotion of Clip Decisions (design only)

Status: design/RFC. No runtime change in 3C. The promotion path ships **default
off**; the flag's default only flips after a benchmark gate passes, in a separate
later change.

## Preconditions

Phase 3B produced the clip decision in shadow. On the in-repo dense-like proxy it
changed 30/160 measures (53 same-voice-overlap clips), kept notesΔ/measuresΔ 0 and
pitch/onset/chord agreement with runtime at 100%, and improved the evaluator delta
vs truth: **duration +0.91%, onset +0.02%, pitch +0.05%, chord +0.11%, F1 −0.04%**.
3C is contingent on your local run showing the same on the real dense fixture and
**0 changed measures on clean** (clean has no hard-constraint violations, so the
clip never fires there).

## The one place runtime would change — and how it stays off

Runtime MusicXML is `buildOmrMusicXml({ measures: measureRhythms })`. The only
promotion point is: just before that call, optionally replace a measure's events
with the clipped ones. This reuses the existing `phantomColumnCorrection` idiom in
`runPdfOmrPipeline` (simulate → promote only if invariant-preserving →
`promotedToRuntime`).

- A new pipeline option `promoteScoreGraphClips` (default **false**). False ⇒ the
  pipeline is byte-identical to today. Only a dev/benchmark caller sets it true.

## Surgical promotion (do not swap in reconstructed events)

Critical design choice: promote by **applying each clip decision to the original
runtime event object**, not by replacing the measure's event array with
IR-reconstructed events. For each solver `decision` `{ voice, startDivision, after }`,
find the runtime note event in that voice at that onset and set only its
`durationDivisions` (and derived `durationType`/`dotted`). Everything else in the
measure — other notes, chords, ties, beams, dynamics, repeats — serializes exactly
as runtime. This guarantees the promoted measure differs from runtime **only in the
clipped note's written duration**, which is why pitch/chord/onset cannot move and
clean cannot change.

If a decision cannot be mapped to a unique runtime event (e.g. two note events
share the voice+onset), that decision is skipped and the measure falls back to
runtime.

## Which measures promote

A measure is promoted only when **all** hold:

- the solver `applied` a clip (so it is in the hard-constraint family), and
- `confidence >= threshold` (default high, e.g. 0.9 — only clean same-voice-overlap
  clips; `ambiguous-culprit` / `clip-unresolved` are never `applied`, so never
  promote), and
- the surgical application preserves invariants: **note count unchanged, measure
  count unchanged, and the measure's hard constraints now pass**.

Otherwise the runtime measure is kept (per-measure fallback). The confidence
threshold is calibrated offline against the benchmark using 3B's per-measure
confidence + evaluator delta, never hand-set.

## Invariants (enforced at promotion, asserted in tests)

- `noteΔ = 0`, `measureΔ = 0` — the clip only shortens a duration; it never adds or
  removes a note or a measure.
- **Clean unchanged** — clean has zero hard-constraint violations ⇒ zero clips ⇒
  zero promotions ⇒ byte-identical. This is structural, not tuned.
- **Onsets and the measure grid are untouched** — the clip changes a duration, not
  a `startDivision` and not measure geometry, so score-follow cursor alignment,
  the viewer, Practice, and Wait For You are unaffected.
- Playback of a promoted measure reflects the shorter (correct) duration — the
  intended improvement — but only when the flag is on.

## Benchmark gate before default-on (a separate later change)

1. Run the benchmark with `promoteScoreGraphClips: true` through the evaluator
   (clean + dense, ideally + a held-out corpus).
2. Require: clean byte-identical (0 promotions); dense `duration` and `onset`
   improve; **no regression** on pitch, chord, F1, noteΔ, measureΔ.
3. Only if that passes does the flag's default flip to on — reviewed and reversible.
   If any axis regresses, the default stays off; the diagnostics are kept.

## What 3C ships (all default-off)

1. `promoteScoreGraphClips` option threaded `runPdfOmrPipeline → (promotion step)`,
   default false; a `promoteClipDecisions(measureRhythms, solverMeasures, { threshold })`
   pure helper that returns new measure records + a `promotedMeasures` log.
2. Diagnostics: promoted measure numbers, per-measure before/after duration,
   confidence, and skip/fallback reasons.
3. Tests: with the flag off, runtime MusicXML is byte-identical; with the flag on,
   only high-confidence clip measures change and only their clipped note's duration
   differs; note/measure counts and onsets are invariant; a clean-style score
   (no violations) is byte-identical with the flag on.

Explicitly **not** in 3C: flipping the default, any change to `buildOmrMusicXml`
itself, mixed-beam-ownership handling, or heuristic deletion.

## Rollback

The flag defaults off, so shipping 3C changes nothing. Per-measure fallback means
even with the flag on, one bad clip cannot force-ship — only invariant- and
confidence-passing measures promote. Turning the default back off is a one-line
revert.
