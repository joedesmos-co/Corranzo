# Audio Vision — accuracy and real musical playability

Research only. No merge or deployment. Produced model weights unchanged.

## Resource state

Disk 4.2 GiB at start. Cleared the npm, Vite and uv caches only (no recordings,
user files, checkpoints or research evidence). Work stayed lightweight; no
downloads, no training, no corpus generation. Disk 3.9–4.2 GiB during the run —
below the 5 GiB floor, so only source edits and in-memory tests were performed.

## Objective 1 — honest transcription benchmarking

Rights-cleared collection already in place: 50 `mic-real` clips (CC-BY-4.0;
GuitarSet, EGSet12, Guitar-Techs, Vienna 4x22, 3 s excerpts with reference
notes), split dev / eval / eval-fresh.

Independently verified synchronization:
- **Confirmed:** `vienna-mozart-p01` reference drift ~0.5–0.7 s (model-free
  spectral-flux cross-correlation, consistent across all four clips).
- **Unresolved:** Schubert p01/p02 and Mozart p02 (method inconsistent; full
  Vienna source files are not available locally).
- Full source-file verification is still required. No in-sample correction is
  claimed as model accuracy.

Honest strict metrics (raw, no timing correction):

| slice | strict event F1 | pitch-only recall |
|---|---|---|
| acoustic guitar (21 clips) | 0.779 | — |
| electric guitar (18 clips) | 0.708 | — |
| piano (11 clips, raw) | 0.075 | 0.889 |

The model-optimized piano 0.583 remains **in-sample and unverified** and is not
used as a headline.

## Objective 2 — where transcription errors enter

Traced the production pipeline (`runAudioArrangementPipeline`):
audio → analysis → Basic Pitch → note extraction → arrangement → MusicXML.

- The pipeline **preserves notes** (transcribed ≈ arranged) on all sampled
  clips; no note loss in arrangement or MusicXML.
- Guitar errors are onset timing on dense chords and weak attacks
  (raw recalls 0.79–0.82).
- Piano strict errors are dominated by unresolved reference timing; the model
  detects the correct pitch within 1 s for 0.889 of notes.
- No evidence of a pipeline-stage bug that invents or deletes notes beyond the
  disclosed playability reductions.

## Objective 3 — guitar playability extended

- Hard constraints retained: no same-string conflicts, span ≤ 3/4/5 by
  difficulty, ≤ 4 fretted fingers, barre-aware.
- New: actual finger assignment (`assignFingers`), barre/partial-barre
  provenance, hand-jump and fast-shift detection using real beat duration,
  same-string overlap (sustained-note conflict) diagnostics.
- Musical preservation (12 real clips, OLD vs NEW, same transcription):
  melody **1.000 → 1.000**, bass 0.667 → 0.667, note retention 0.953 → 0.950,
  chroma similarity 0.988 → **0.999**, validator violations **4 → 0**.
  The arrangement does not pass by deleting music; only impossible notes are
  reduced and every drop is disclosed.

## Objective 4 — piano playability (new)

`src/features/audio-vision/pianoPlayability.js`:
- per-hand span (default ≤ 12 semitones, octave) and note count (≤ 5);
- hand travel between onsets and shift speed;
- left/right hand crossing;
- whole-arrangement gate (`validatePianoArrangement`), wired into
  `arrangeSoloPiano` and exposed as `playability` through the pipeline.
The arranger keeps its existing per-onset span enforcement; the new gate adds
the phrase-level checks a single-onset check cannot see.

## Objective 5 — independent acceptance

Not yet achieved. This mission provides algorithmic and export evidence
(219 Audio Vision tests, 16 guitar + 8 piano playability tests, MusicXML export
consistency, preservation metrics). **An independent guitarist/pianist review
of full-length passages is still required** before declaring an arrangement
genuinely playable. That review is the next acceptance step, not a substitute
for passing tests.

## Remaining limits

- Guitar barres are conservative (lowest fret = one finger; no partial/thumb
  barres); sustained-note finger conflicts are reported, not solved across time.
- Piano playability is span/density/travel based; it does not model individual
  finger choice or pedal.
- Transcription evaluation still lacks a held-out piano set with verified
  source alignment.
- No browser acceptance run in this environment.

## Tests

`tests/audioVisionGuitarPlayability.test.js` (16) and
`tests/audioVisionPianoPlayability.test.js` (8) plus the existing Audio Vision
suite: **219 tests pass**.

## Reproduction

```bash
npx vitest run tests/audioVision*.test.js
node --expose-gc scripts/audio-vision-guitar-preservation.mjs
node --expose-gc scripts/audio-vision-independent-offset.mjs
```

Artifacts: `pianoPlayability.js`, updated `soloPiano.js`, updated
`guitarPlayability.js`/`soloGuitar.js`, the two playability test files, and the
existing real-audio/offset artifacts.
