# Guren Playback Cursor Timing Sync

**Date:** 2026-06-22
**Symptom:** Guren's scorebar (cursor) did not stay in sync with playback,
worst in the fast section; Gymnopédie followed perfectly.

## Root cause (proven, not assumed)

Guren is played with **MIDI backing mapped onto the MusicXML score clock**. The
cursor follows the MusicXML timeline; the audio follows the mapped MIDI. They
must share the same score-time for a note, or the bar drifts from the sound.

The measure-aligned mapper (`mapMidiEventsMeasureAligned`) sliced the MIDI into
`midiDuration / measureCount` **equal** time slices — one per written measure —
assuming every measure is the same length. Guren changes tempo at m8
(90→180 BPM), so measures after the change are **half as long** (2.667s → 1.333s),
plus a 2/4 bar near the end. Equal slices therefore mapped notes to the wrong
measures and wrong score-times.

Trace on the real uploaded files (`scripts/debug-guren-timing.mjs`):

- No repeats in Guren (`usesPerformedTimeline: false`) — so this was **not** a
  repeat/volta bug.
- Tempo change at quarter 28 = m8, exactly where measures halve.
- Alignment assessment = **likely-match** → the app used measure-aligned mapping.
- Equal-slice misassigned **1323 / 1335 notes**, with mapped audio time differing
  from the true MIDI time by **mean 4.49s, max 8.49s**. Example: a note truly in
  m7 (18.0s) was scheduled at 25.9s (m13). That gap is the desync.

## Fix (surgical — mapping only)

MIDI files carry their own bar grid (tempo + time-signature aware). We now read
each note's real bar position via `header.ticksToMeasures(note.ticks)` and map it
onto the matching **performed-timeline entry** instead of an equal slice:

- `scorePlaybackSchedule.js` — attach `measurePosition` to each MIDI note from the
  MIDI's own tempo/time-signature map.
- `midiToPerformedMapping.js` — when `measurePosition` is present, place the note
  in `entries[floor(pos)]` at fraction `pos − floor(pos)` of that entry's
  performed window. The equal-slice path remains only as a fallback when no bar
  grid is available.

Result on real Guren: mapped audio time vs true MIDI time is now **max 0.000s,
mean 0.000s** — audio and cursor agree.

Nothing else changed: PDF staff/system detection, measure-local x geometry, the
sampled-piano sound, mic detection, the cursor resolver math, and basic cursor
rendering are all untouched. Because the mapping reuses **performed-timeline
entries**, repeats/voltas map to the correct written measure too.

## Why Gymnopédie was unaffected

Gymnopédie is constant-tempo with equal-length measures, where equal slices and
the real bar grid coincide. A regression test asserts the two mappings are
identical for equal-duration measures, so the fix is a no-op there.

## Tests (`tests/midiCursorSync.test.js`, 11 tests)

- Notes placed by bar position honor each measure's real duration (tempo-change
  fixture); the old equal-slice path is shown to mis-time the same note.
- Audio score-time and cursor measure agree for every note.
- Fast-note (16th-grid) positions inside one measure are monotonic, in-window,
  and on the correct beats.
- Repeats: a note in the 2nd pass maps to the correct **written** measure and
  performed time; every played bar maps to its performed entry.
- Constant-tempo (Gymnopédie-style): bar-grid and equal-slice agree exactly.

## Validation

- `npm test` → 266 passed, 8 skipped (the skipped are canvas-gated real-PDF tests).
- `npm run test:scripts` → all pass.
- `npm run build` → builds cleanly.
- `npm run lint` → 69 problems (62 errors, 7 warnings); no new problems
  introduced (the only error in the touched files pre-existed in
  `buildMetronomeSchedule`).
