# Handoff: upstream timing issues found during score-follow acceptance

To: MusicXML parser / practice-engine owner.
From: score-follow precision track (`codex/score-follow-precision`, commit 8d1f7b3b3f+).
Status: **Documented, not fixed** — these live outside the follow layer.
The follow layer tracks the canonical clock exactly; the issues below are
in what the clock is computed FROM.

## H1 — Overfull measures drift the canonical timeline (affects WFY grouping)

**Evidence.** `piano-bach-prelude-bwv846`: measure 1 holds 7.5 quarters of
sequential content in a 4/4 window (part "up:" m1: half, quarter, half,
quarter; no `<voice>`, no `<backup>`, no `<chord>`). The parser sequences
them faithfully, so measure N's notes sound during window N+1/N+2
(cumulative drift; m2 notes at t≈9.75 inside m3's window). Same class in
`guitar-aguado-a-minor-study` (~96/196 checkpoints pair notes from adjacent
measures) and La Campanella m87 (tremolo overflow across a system break).

**Consequences.**
- `buildNoteCheckpoints` (1 ms grouping) merges simultaneous notes from
  two measures into one checkpoint → WFY requires both to advance.
- Highlight (written-measure geometry) and cursor (performed-window
  position) legitimately disagree; flagged `measureMismatch`, never averaged.

**Follow-layer handling (done).** Orphan adoption (`onsetOwnedByWindow`),
cross-measure marker rule, overflow flagging, approximate labels.

**Requested upstream work.** Voice-aware timing for multi-voice parts
without `<backup>` (overlap same-measure voices instead of sequencing),
and/or a validation warning when a measure's written content exceeds its
nominal duration by more than a threshold.

Repro: `node scripts/measure-score-follow-precision.mjs` (overflow counts),
`DEBUG_MEASURE=87 node scripts/debug-cross.mjs` (removed; see git history).

## H2 — music21-processed library files carry voice-flattening artifacts

`piano-bach-prelude-bwv846.musicxml` and siblings (`rights: Public Domain —
Mutopia…`, `software: music21 v.10.1.0`) contain overlapping voices
flattened into single parts (durations 2.0 + 1.75 quarters, no voice tags).
These are FILE defects, not parser defects — but they flow into H1 drift.
Recommend re-exporting practice-library MusicXML with voices preserved, or
annotating affected pieces in the manifest.

## H3 — No gradual-tempo support (documented limitation, not a bug)

The parser implements discrete tempo events only (`<sound tempo>`,
metronome marks → `tempoChanges`). Words like rit./accel./rall./a-tempo
are ignored (`parseMusicXml.js` has no rit/accel handling). Scores with
written gradual tempo play at the last discrete marking. The cursor still
tracks the performed timeline exactly — it just never hears the rit.
If gradual support is added later, the follow layer needs no changes
(it consumes performed seconds).

## H4 — Hardware output latency is uncompensated (accepted)

`getCurrentScoreTime` is wall-clock exact; Tone `lookAhead` is tuned to
0.05 s (`playbackAudioConfig.js`) without changing score math. Device
output latency (typically 10–50 ms) shifts heard sound uniformly vs the
bar. No per-song offsets exist anywhere (verified: only generic
tolerances — 20 ms anchor bracket, 5 ms event index, 10 ms phrase
boundary, all documented in code). No action requested.
