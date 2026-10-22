# Handoff: upstream timing issues found during score-follow acceptance

To: MusicXML parser / practice-engine owner.
From: score-follow precision track (`codex/score-follow-precision`, commit 8d1f7b3b3f+).
Status: **H1/H2 root-caused; 3 files repaired from the authoritative bundled
MIDI (2026-10-13); the remaining flagged files still need an authoritative
re-export.** The follow layer tracks the canonical clock exactly; the issues
below are in what the clock is computed FROM.

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

**RESOLVED 2026-10-13 for the three MIDI-consistent files.** Root cause is
upstream of the parser: the practice-library MusicXML files are music21
conversions OF THE BUNDLED MUTOPIA MIDI (`scripts/import-practice-library.mjs`),
and music21 flattens the two-voice texture into one sequential stream.
Repaired from that authoritative MIDI
(`scripts/repair-flattened-practice-musicxml.mjs`; pitches/written
durations preserved 1:1, onsets restored, provenance comment kept):
`piano-bach-prelude-bwv846` (34 measures), `guitar-aguado-a-minor-study`
(16), `guitar-bach-prelude-bwv999` (42). WFY cross-measure checkpoints for
those: 34/39/42 → 0; overflow flags → 0; BWV 846 cross-engraving onset error
0.623 → 0.0208 page. Every other overfull score is now flagged by the new
`timingValidation` and gets the honest per-written-measure WFY fallback
(impossible requirements removed), but its timeline stays exactly what the
file says until re-exported.

**Requested upstream work (still open for the 13 flagged files).** Re-export
the practice library from authoritative notation sources (Mutopia LilyPond
originals, not MIDI-derived conversions): 13 scores still carry overfull
measures (47 total; list in `docs/timing-integrity-investigation.md` §7),
including partially-flattened voice/backup files (Aguado op03-*, Chopin
mazurka, Tchaikovsky, Handel, Für Elise m26, fugue BWV 846). Voice-aware
timing for multi-voice parts without `<backup>` and/or a validation warning
when written content exceeds the nominal duration remain the right upstream
guard; the follow layer now implements the warning side itself
(`timingValidation.status === 'invalid'`).

Repro: `node scripts/measure-score-follow-precision.mjs` (overflow counts),
`node scripts/measure-timing-integrity.mjs --label before|after` (frozen-set
trace), `node scripts/repair-flattened-practice-musicxml.mjs --check-all`
(MIDI consistency audit).

## H2 — music21-processed library files carry voice-flattening artifacts

`piano-bach-prelude-bwv846.musicxml` and siblings (`rights: Public Domain —
Mutopia…`, `software: music21 v.10.1.0`) contain overlapping voices
flattened into single parts (durations 2.0 + 1.75 quarters, no voice tags).
These are FILE defects, not parser defects — but they flow into H1 drift.

**RESOLVED 2026-10-13 for the three MIDI-consistent files.** The bundled
`.mid` next to each file is the source music21 converted FROM (see
`scripts/import-practice-library.mjs`) and still holds the true onsets;
`piano-bach-prelude-bwv846`, `guitar-aguado-a-minor-study`, and
`guitar-bach-prelude-bwv999` were repaired from it with provenance preserved
and independently verified (offsets/durations match the MIDI note-for-note).
Recommendation for the remaining library pieces: re-export with voices
preserved from the notation source, or annotate affected pieces in the
manifest — the follow layer now flags them (`timingValidation`) and applies
the per-measure WFY fallback in the meantime.

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
