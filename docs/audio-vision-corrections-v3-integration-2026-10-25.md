# Audio Vision note corrections v3 — integration record (2026-10-25)

**Status: integrated and product-accessible.** The v3 correction record is no
longer just a data model. It is wired through the Audio Vision review UI, the
score rebuild, local persistence and saved-score metadata.

## What the musician can do now

In **Create from audio → Review notes**:

- select a note and change pitch by ±1 semitone or ±12 (octave);
- move onset by ±0.25 beats;
- change written length by ±0.25 beats;
- reset that note's edits;
- remove a note and Undo the removal;
- add a missing note by name (`C4`, `F#3`, `Bb5`) at a bar/beat with a length;
- remove an added note and Undo that removal;
- Undo the last correction group and Clear all corrections.

The original transcription remains immutable evidence in
`result.arrangementEvents`. The arrangement shown, its MusicXML, preview,
Play Along and Wait For You checkpoints are rebuilt from the correction record,
not by mutating the transcription.

## Data model

`src/features/audio-vision/noteCorrections.js`

- Version 3 record: `{ version, removed, notes, added }`.
- Pitches, onsets and durations are content-keyed deltas, so a note keeps its
  identity across a deterministic rebuild.
- A removal wins over every edit.
- An added note is rejected when it duplicates an existing pitch + onset; the
  skip is reported.
- A removed user-added note is tracked as `user:<id>` and is not reported stale.
- `setNoteEdit(..., null)` resets one note without touching its neighbours.
- v1/v2 records still load as removals-only.
- Absurd pitch/onset/duration edits are bounded.

`src/features/audio-vision/useAudioArrangement.js` exposes
`editNote`, `resetNoteEdits`, `addNote`, `removeNote`, `undoNoteRemoval`,
`undoLastNoteRemoval` and `clearNoteCorrections`. The score is rebuilt through
the same `buildArrangementMusicXml` path as the initial arrangement.

## Persistence

- `noteCorrectionStorage` no longer deletes a record just because `removed` is
  empty. Edit-only and added-only records persist.
- The correction record travels in saved score metadata under
  `omrMeta.arrangement.corrections`, with edited/added/removed counts.
- Reload restores the corrected MusicXML and the correction record; the
  browser flow opens the restored score in practice.

## Independent tests

- `tests/audioVisionNoteEditsV3.test.js`: **34 tests** — pitch, octave,
  onset, duration, combined edits, removals win, add, duplicate refusal,
  added-note removal, reset, stale edits, v1/v2 parsing, storage, deterministic
  rebuild, bounded edits.
- `tests/audioVisionNoteEditsProduct.test.js`: **12 tests** — pipeline events,
  counts, MusicXML, parsed pitch set, practice checkpoints, added-note removal,
  deterministic second rebuild.
- Existing Audio Vision suite: **176 passed** across 17 files.
- Real editor flow: **21 / 21 Chromium** and **21 / 21 WebKit** on the
  built `dist` bundle, including:
  - pitch/octave/onset/duration controls;
  - remove + undo of an edited note;
  - add + remove + undo of a missing note;
  - clear all;
  - corrections survive a tempo rebuild;
  - added C7 and the pitch-edited note are in the persisted MusicXML;
  - 9 practice checkpoints;
  - Preview, Play Along and Wait For You available; playback starts;
  - correction metadata saved with the score;
  - corrected score and record survive reload;
  - OSMD engraves the corrected score (svg, 22 stave-note/rest groups, 8
    measures).
- Full unit suite after integration: **4002 passed, 19 skipped, 0 failed**.
- Unified WebKit arrangement/cursor flow: **12 / 12**.
- Unified mic practice flow: **23 passed, 0 failed, 1 skipped**.
- `npm run build` succeeds (`index-ks2_w5OX.js`).

## Known limitations

- Editing an already user-added note is not exposed; it can be removed/undone.
- `undoLastNoteRemoval` walks categories (edits, then added, then removals), not
  a single global chronological stack. Per-note Reset edits and per-removal
  Undo are the precise paths.
- MusicXML is monophonic per voice; a duration increase is clipped at the next
  onset/barline by the existing engraver, as for any arrangement note.
- Local browser storage is the only score store; there is no cloud sync in this
  product version.

## Commits

- `f4fb61a2c7` — data model + storage + v3 tests.
- `c610ac7afd` — pipeline/hook/saved metadata + product tests.
- `870777bb91` — review editor UI + real-browser acceptance.
