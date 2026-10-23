# Audio Vision — per-note corrections

The review panel used to be read-only: if the transcription heard a note that
is not in the music, the musician had no way to remove it before practicing.
This is the architecture that lets them, without mixing the machine's
evidence with their edits.

## Three layers, kept apart

```
transcription      what the model heard            (immutable evidence)
corrections        what the musician removed       (a separate record)
arrangement        what is written to the score    (derived from both)
```

* `src/features/audio-vision/noteCorrections.js` — the correction record.
  Pure functions, no React, no audio, no score knowledge.
* `src/features/audio-vision/audioArrangementPipeline.js` — accepts
  `options.corrections`, applies them to the arrangement **before** the
  MusicXML is written, and returns both the uncorrected arrangement events
  (`arrangementEvents`, so an edit can be undone) and the corrected events
  (what the score contains).
* `src/features/audio-vision/useAudioArrangement.js` — `removeNote`,
  `undoNoteRemoval`, `clearNoteCorrections`: rebuild the score from the
  stored events + the correction record.
* `src/components/audio-vision/CreateFromAudio.jsx` — the review panel lists
  the notes (pitch, bar, beat, hand, role) and a Remove action per note.

## Why the identity is a content key, not an index

A correction is stored as `pitch@time` (10 ms precision), e.g. `76@1.50`.

An array index would point at a different note the moment the transcription
is regenerated — a new model run, a different difficulty, a corrected tempo.
A content key still names the same musical event, and if that event is no
longer there the correction is **inert** rather than harmful:

```js
resolveCorrections(events, corrections, { timeOf })
// -> { applied: ['76@1.50'], stale: [] }
```

A stale key can never begin deleting something else — there is a test for
exactly that.

## What the musician gets

1. Open the arrangement review.
2. "Review notes" lists every note with its pitch, bar, beat, hand and role.
3. Remove a wrong note → the score, the preview and the practice checkpoints
   rebuild without it. The rest of the arrangement is untouched.
4. "Undo all" restores the machine's version exactly (the arrangement events
   were never mutated).
5. The correction record is returned with the result and is stored beside the
   take, so re-running the arrangement keeps the edit.

## Verified

* `tests/audioVisionNoteCorrections.test.js` — 21 tests: the key is content
  based and stable across a regeneration; the correction set is immutable;
  applying removes exactly the corrected note and nothing else; the events
  given are never mutated; a no-op with no corrections; a stale correction is
  reported and not applied; the written MusicXML loses the corrected note and
  keeps every other one; and the real pipeline honours
  `options.corrections` end to end (one note fewer, the rest present, a valid
  score).
* `scripts/browser-audio-vision-note-corrections.mjs` — 10 checks in a real
  browser: the list matches the arrangement, one removal removes exactly one
  note and its row, the counter appears, undo restores everything, no console
  errors.

## Limits (honest)

* One operation so far: remove. Pitch correction and insertion are the next
  steps; the record is versioned (`version: 1`) so they can be added without
  invalidating stored edits.
* The key uses the arrangement's time on the detected grid, so a re-run with a
  very different tempo estimate can make an old correction stale (it is then
  inert, not wrong). The review shows the count of applied corrections.
* The corrections live with the arrangement in this branch; wiring them into
  the library's persisted take record is a product-branch change.
