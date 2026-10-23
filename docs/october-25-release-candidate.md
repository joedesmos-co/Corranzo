# October 25 release candidate — Mic rescue + Audio Vision note corrections

**Prepared:** 2026-10-23
**Production base:** `main` @ `57e04123a8`
**Candidate branch:** `release/oct25-candidate`
**Research commits reviewed:** `3e653f05e9` (Mic Engine), `47c4af767e` (Audio Vision)

This document records what was integrated, how it was measured, and what is
still unresolved. It does not claim that all four recognition engines are
complete: Guitar Vision and Piano Vision remain excluded, and the neural mic
model remains experimental and off.

---

## 1. Integration decisions

| research work | decision | why |
|---|---|---|
| Mic false-award rescue (`3e653f05e9`) | **integrated** | reproduced on the production browser path: true completions preserved, false octave awards reduced |
| Audio Vision per-note corrections (`47c4af767e`) | **integrated, re-built on current main** | the branch carries unrelated unmerged Audio Vision work; only the correction record/pipeline/UI/storage design was brought across |
| Guitar Vision `6f897300ed` | **not merged** | incomplete; string/fret accuracy and rhythm are unverified |
| Piano Vision / OMR research | **not merged** | scan path and licensing constraints are unresolved |
| Neural mic model | **left OFF** | measured at 584 ms/window against a 250 ms hop; not viable for real-time practice |

The Audio Vision work was not cherry-picked as a branch merge. Current main
lacks the research branch's note-cleanup modules, and merging the branch would
have imported unverified surrounding changes. The correction capability was
re-implemented against the current pipeline.

### Files changed

**Mic Engine**

* `src/features/microphone-input/v3/pianoRecognition.js` — two measured
  constants and the single-note octave-ghost guard.
* `tests/micPianoRecognition.test.js` — four regression tests.
* `scripts/benchmark-production-corpus.mjs` — production-path corpus harness
  from the research commit (new).
* `scripts/lib/micFalseAwardScenarios.mjs` — shared wrong-expectation matrix
  required by that harness (new; the helper existed only on the research
  branch).
* `docs/MIC_REALTIME_ACCURACY_RESCUE.md` — the research measurement record.

**Audio Vision**

* `src/features/audio-vision/noteCorrections.js` (new) — the correction
  record and content keys, with duplicate/repeat handling.
* `src/features/audio-vision/noteCorrectionStorage.js` (new) — per-recording,
  per-arrangement persistence.
* `src/features/audio-vision/audioArrangementPipeline.js` — keeps the
  uncorrected arrangement as evidence and derives the score from it.
* `src/features/audio-vision/useAudioArrangement.js` — Remove, per-note Undo,
  Undo last, Clear all, and score rebuilds.
* `src/components/audio-vision/CreateFromAudio.jsx` — the review UI.
* `src/components/library/ImportScoreView.jsx` — reopening shows the saved
  removal count.
* `src/App.jsx` — persists the correction record in the arrangement metadata.
* `tests/audioVisionNoteCorrections.test.js` (new).
* `scripts/browser-audio-vision-note-corrections.mjs` (new).

---

## 2. Mic Engine — measured before / after

### 2.1 Production accuracy corpus

Same six real single-note recordings, same 24 wrong-expectation scenarios,
same real Chromium production hook (V3 performance expectation + V2 fallback),
injected at the MediaStream boundary. This is not an offline module replay.

| metric | current main | integrated candidate |
|---|---|---|
| true completions | **6 / 6** | **6 / 6** |
| false completions | **12 / 24** | **2 / 24** |
| onset→advance p50 | 62 ms | 59 ms |
| onset→advance range | 31–100 ms | 32–102 ms |

Per clip after integration:

| clip | true | remaining false expectations |
|---|---|---|
| real-piano-c4 | yes (44 ms) | none |
| real-piano-e4 | yes (32 ms) | none |
| real-guitar-g3 | yes (54 ms) | octave-up-of-55, wrong-single-plus-2 |
| uiowa-piano-mf-c4 | yes (99 ms) | none |
| uiowa-piano-pp-c4 | yes (102 ms) | none |
| uiowa-guitar-mf-g3 | yes (59 ms) | none |

The two remaining false awards are both on one guitar recording and are the
documented guitar-harmonic limitation below.

### 2.2 Targeted release matrix

A second, independently run matrix covered single notes, chords, repeated
notes, guitar partials, silence and wrong-note rejection in the same production
harness (23 scenarios: 7 legitimate, 16 wrong/silence):

| metric | current main | integrated candidate |
|---|---|---|
| legitimate completions | 6 / 7 | **6 / 7** |
| false completions | 6 / 16 | **4 / 16** |
| wrong-note reports | 1 | 26 |

The legitimate miss is `uiowa-guitar-mf-open-em-strum` **on both revisions**:
a six-note open-string strum does not complete in the production expectation
path. It is a pre-existing limitation, not a regression.

What improved:

* piano single note vs its octave — no longer falsely completes;
* repeated piano C4 vs D4 and vs C5 — no longer falsely completes;
* repeated piano / guitar octave ghosts on the accuracy corpus — removed.

What remains:

* guitar single note vs its 2nd partial (octave) still falsely completes
  (measured 2/2 runs on `real-guitar-g3`; the research commit documented this);
* a full guitar strum vs an octave-transposed chord still falsely completes;
* one adjacent-semitone guitar scenario was intermittent in both revisions
  (baseline 1/8 runs, candidate 3/8 runs). The two added code paths can only
  add rejections, not acceptances, so this is detector/attack-timing variance,
  not a causal regression; it is nevertheless left visible in the test data.

### 2.3 Why the change works, and what it does not fix

The false awards came from a played note's harmonic satisfying the
score-informed evidence for an octave-away expectation. The change:

1. lowers the dominant-disagreement clarity gate from `0.5` to `0.35`
   (measured true accepts had clarity 0.57–0.91; the ghost accepts 0.28–0.46);
2. for a **single** expected note, refuses to let a low-confidence expectation
   override a dominant pitch that is an octave or a whole tone away.

Chords are untouched: their completion belongs to the V3 chord path and the V2
fallback fixed on main. The guitar 2nd partial is strong enough to read inside
the true-confidence range, so a confidence-only rule cannot remove it. That is
the honest remaining gap.

### 2.4 Neural model

The neural path was not enabled and its code was not changed. The research
measurement (584 ms per window against a 250 ms hop, 75% of windows dropped,
1.79 s sound-to-feedback) still applies. No physical microphone was available:
every number above comes from real recordings injected at the MediaStream
boundary. Physical-device acceptance remains an attended step.

---

## 3. Audio Vision — per-note corrections

### 3.1 Three layers, never mixed

* **transcription evidence** — every note the model heard, retained in
  `result.arrangementEvents` / `result.transcriptionEvidence` and never mutated;
* **corrections** — a versioned record of removed note keys, stored separately;
* **arrangement** — the MusicXML, preview schedule and practice targets,
  always derived as *evidence minus corrections*.

A correction is a content key:

```
pitch@written-beat#occurrence
```

The written beat (not wall-clock seconds) keeps the key stable across a tempo
rebuild. The occurrence suffix is required: two simultaneous unisons or
duplicate detections would otherwise share `pitch@time`, and removing one would
delete both. `annotateNoteKeys` assigns occurrence deterministically from each
note's own duration/hand/role/string/fret/voice, so re-annotating the same set
produces the same key even if the array order changes. A stale key is inert;
the pipeline reports it instead of deleting something else.

### 3.2 What the product does

The review panel lists every note with bar/beat and a **Remove** action. Removed
notes move to a "Removed by you" list with:

* per-note **Undo**;
* **Undo last**;
* **Clear all**.

Each action rebuilds the MusicXML, the model events and the complexity from the
uncorrected evidence. The review count, the saved score, the playback source and
the practice checkpoints all read the same corrected result.

### 3.3 Persistence

Corrections are persisted twice, in separate places:

1. **with the arrangement identity** in localStorage
   (`corranzo-audio-vision-corrections-v1`) keyed by recording fingerprint
   (`name::size::lastModified`) + target + difficulty + excerpt. Re-arranging
   the same recording with the same settings re-applies the edits. Switching
   target, difficulty, excerpt or recording does not inherit them.
2. **with the saved score** in `omrMeta.arrangement.corrections`, alongside
   `originalNoteCount`, `removedNoteCount` and stale counts. The MusicXML bytes
   are already corrected; the metadata says what the musician changed. Session
   restore reads the same `omrMeta`, so reopening the saved score keeps the
   corrected bytes.

No IndexedDB schema change was needed, and no user data is rewritten except the
score the musician is editing.

### 3.4 Verification

Unit/integration tests (`tests/audioVisionNoteCorrections.test.js`, 31 tests):

* content keys survive regeneration; repeated notes at different beats differ;
  simultaneous duplicates get distinct keys and removing one removes exactly
  one;
* duplicate keys remain stable when the event array is reordered;
* correction application never mutates the evidence;
* a stale key is reported and is a no-op;
* corrected MusicXML loses exactly one pitch and preserves the others;
* the guitar TAB staff and `<technical>` string/fret data survive a removal;
* the same MusicXML produces practice checkpoints with the removed note gone
  and every other target present;
* the real pipeline applies a correction end to end and keeps the uncorrected
  event count in evidence;
* the correction record round-trips through storage and the saved session
  metadata, and does not leak to another recording/target/difficulty/excerpt.

Real-browser flow (Chromium; see §4 for WebKit):

* Review panel lists 8 notes; Remove → 7; one note appears as removed;
* saved MusicXML pitch multiset changes by exactly `-1` (9 → 8 written pitches
  for 8 review events; one tie exists in the untouched score) and every other
  pitch is preserved;
* saved `omrMeta.arrangement` records `originalNoteCount=8`,
  `removedNoteCount=1`, one correction key;
* per-note Undo restores 8; two removals then Undo last then Clear all restore
  the expected counts;
* after reload the saved score reopens in the unified Practice Engine with
  OSMD ready, and re-arranging the same recording re-applies the saved
  correction (7 notes · 1 removed);
* the corrected arrangement opens the normal Practice Engine, plays, and the
  playback schedule is built from the corrected MusicXML (8 events);
* switching to solo guitar does not inherit the piano edit, and the guitar
  arrangement keeps standard notation + TAB;
* a different recording starts from the machine's full note set.

### 3.5 Known limitations

* A correction key is a musical-position key. If a completely different take
  produces a different beat grid, the key may be stale; the UI reports that
  instead of deleting a different note.
* The recording fingerprint uses file metadata, the same scheme as tempo
  corrections. A renamed/re-exported copy of the same audio will not inherit
  its corrections.
* Undo after reopening is not exposed in the saved-score view; the saved score
  is already corrected. The review/undo surface is available while the
  arrangement is open in Create from Audio, and re-arranging from the same file
  loads the record.
* Audio Vision arrangements have no active PDF, so the playback snapshot is
  suppressed by the PDF-ownership guard; the same schedule is recorded in the
  source trace. This is a diagnostics limitation, not a playback failure.

---

## 4. Regression verification

### 4.1 Unit / integration suite

| suite | result |
|---|---|
| full `npm test` | **393 files, 3918 passed, 26 skipped, 1 failed** |
| `tests/scoreFollowMotionModel.test.js` alone | **10 / 10 passed** — the full-suite failure was a 30 s timeout under load (the Hungarian Dance case takes ~5.3 s alone) |
| `tests/finalMicLowNoteCorpus.test.js` alone | **7 / 7 passed** — the full-suite failure was the pre-existing 30 s `beforeAll` corpus-build timeout under load |
| `tests/micPianoRecognition.test.js` | **13 / 13 passed** (4 new) |
| `tests/audioVisionNoteCorrections.test.js` | **31 / 31 passed** |
| `tests/micLiveProduction.test.js` | **5 / 5 passed** — real piano note, real V3 chord, real V2 fallback chord, partial chord does not advance, room noise does not advance |

No product-code failure remained after isolating the two load-sensitive
suites. The `finalMicLowNoteCorpus` timeout is the same pre-existing failure
recorded in the previous release report.

### 4.2 Real browsers

| flow | browser | result |
|---|---|---|
| Per-note corrections (Remove / Undo / Undo last / Clear, persistence, reload, regeneration, target switch, guitar TAB, different recording) | **Chromium** | **18 / 18 passed**, 0 console errors, 0 page errors |
| Same correction flow | **WebKit** | **18 / 18 passed**, 0 console errors, 0 page errors |
| Unified Practice Engine: modes, engraved score, red cursor, cursor travel, notation-vs-TAB band, natural engraving width, TAB staff | **WebKit** | **12 / 12 passed** |
| PDF-first regression: PDF practice workspace and modes | Chromium | **4 / 4 passed** |
| Audio Vision critical UX: progress latency, cancellation (35 ms), tempo correction, saved-arrangement identity, restart/reopen, unsupported/malformed/silence handling, TAB | Chromium | **19 / 19 passed**; the single console error is the intentional `OMR generation cancelled` log from the cancellation test |
| Unified practice MIDI | Chromium | **24 passed, 1 failed, 1 skipped**; the failure is the known `wfy cursor locks ... cursor=32.37 box=0` assertion, byte-identical on untouched main per the previous release report |
| Unified practice mic | Chromium | **23 passed, 0 failed, 1 skipped**; the previously stale "middle C" label assertion was corrected to accept the rendered `C4` box / "Play C4" panel |

The correction runs drive the real product path: Library → Create from audio →
review → Remove/Undo/Clear → Open in Corranzo Practice → Open Score, with the
real Basic Pitch worker/spectral fallback, not a helper replay.

### 4.3 Build

`npm run build` completed successfully; `dist/assets/index-DLDqtFXm.js` is the
candidate bundle. The only build warning is the pre-existing ineffective
dynamic import in `audioImport.js`.

---

## 5. Deployment and rollback

_To be completed only after all essential regressions pass._
