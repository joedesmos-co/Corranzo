# October 24 accuracy integration — Mic octave evidence + Audio Vision calibration

**Base:** `main` @ `a58b60e069` (deployed source `a11e55c283`)
**Candidate branch:** `integration/oct24-accuracy` (this work)
**Scope:** only the two measured accuracy wins. Piano Vision and Guitar Vision
remain research-only.

---

## 1. Integration decisions

| research | decision | reason |
|---|---|---|
| Audio Vision calibration `095638b114` + `37c67efb7e` | **integrated** | dev, unseen holdout and current-pipeline metrics reproduced; precision/recall trade measured |
| Mic octave evidence `8fc5707dde` (with `4a8f8c78e4`) | **integrated** | 40/46 legitimate parity; false completions 22/52 → 7/52 on the independent corpus |
| Piano Vision `47620474e0` | **rejected for integration** | cannot run on current PDF.js; accidentals/key signatures missing; benchmark not independent |
| Guitar Vision `020292d766` | **rejected for integration** | Python/PyTorch research runtime, unlicensed weights, font-sensitive, rests/ties/rhythms incomplete |

No whole-branch merge. The two integrated changes are additive and scoped.

### Files changed — Audio Vision

* `src/features/audio-vision/noteExtraction.js` (new): the measured
  `onset 0.65 / frame 0.50 / min 3` triple.
* `src/features/audio-vision/audioVisionPitchWorker.js`: imports the constants
  in the existing worker path (progress, cancellation and worker lifecycle
  untouched).
* `scripts/lib/basicPitchNode.mjs`: the same defaults for Node measurements.
* `tests/audioVisionPitchCalibration.test.js` (new).
* `scripts/audio-vision-threshold-sweep.mjs`, `scripts/lib/eventScore.mjs`
  (new): reproducible sweep and scorer.
* `docs/audio-vision-pitch-calibration.md`,
  `benchmarks/audio-vision/pitch-calibration-2026-10-24.json`.
* `scripts/benchmark-production-corpus.mjs` and `scripts/mic-live/live.js`:
  test-harness fidelity only (mic-real split support and real chord rolling
  windows).

### Files changed — Mic Engine

* `src/features/microphone-input/v3/octaveGhostEvidence.js` (new): the
  odd-partial (1.5 × expected fundamental) and low-confidence dominant rules.
* `src/features/microphone-input/v2/scoreInformedChordScorer.js`: exposes
  `halfPartialEnergy` / `halfPartialRatio` (additive evidence).
* `src/features/microphone-input/v3/pianoRecognition.js` and
  `guitarRecognition.js`: use the shared evidence rule; V3/V2 chord logic
  untouched.
* `tests/octaveGhostEvidence.test.js` (new), `tests/micGuitarRecognition.test.js`
  (octave cases).
* `docs/MIC_VALIDATION_AND_CHORDS.md`, `docs/MIC_PHYSICAL_ACCEPTANCE.md`.
* `scripts/benchmark-production-corpus.mjs`, `scripts/mic-live/live.js`.

Not changed: neural mic backend, V3/V2 chord completion, cursor, notehead
feedback, MusicXML, Practice Engine.

---

## 2. Audio Vision — measurements

The sweep runs the model once per recording and re-extracts notes for both
threshold triples, through the current production arrangement, against JAMS
truth. Same audio and reference for both variants.

### Development (5 takes)

| | shipped 0.5/0.3/5 | calibrated 0.65/0.5/3 |
|---|---:|---:|
| event F1 | 0.692 | **0.724** |
| precision | 0.765 | **0.844** |
| recall | 0.665 | 0.671 |
| invented | 0.128 | **0.078** |

### Unseen holdout (5 takes)

| | shipped | calibrated |
|---|---:|---:|
| event F1 | 0.751 | **0.807** |
| precision | 0.761 | **0.906** |
| recall | 0.755 | 0.746 |
| invented | 0.102 | **0.038** |
| density | 138.6 | 112.6 |

Dense: 0.651 → **0.708**. Sparse: 0.902 → **0.957**.

### Current-production mic-real corpus (49 clips)

Mixed Vienna piano, GuitarSet acoustic and EGSet electric; includes quiet,
short and sustained material.

| | shipped | calibrated |
|---|---:|---:|
| macro event F1 | 0.519 | **0.554** |
| micro precision | 0.588 | **0.644** |
| micro recall | 0.534 | **0.484** |
| micro F1 | 0.560 | **0.553** |
| invented (macro) | 0.195 | **0.161** |
| density | 4.16 | **3.69** |

**Interpretation:** the guitar holdout and sparse/dense material improve
clearly, with almost no recall cost. On the mixed, quiet mic-real corpus,
precision rises 5.6 points but recall falls 5.0 points and micro F1 is flat.
That is the honest trade-off. The setting is one revertable constant triple.

---

## 3. Mic Engine — measurements

### Independent mic-real corpus (current production harness)

46 non-excluded clips, identical audio/checkpoints/scenarios.

| metric | production | candidate |
|---|---:|---:|
| legitimate completions | **40 / 46** | **40 / 46** |
| false completions | **22 / 52** | **7 / 52** |
| false reduction | — | **−68 %** |
| onset→advance p50 | 50–62 ms | 62 ms |

Movements between the sets:

* `piano-mozart2-triad`: production miss; candidate completes.
* `acoustic-rock-single`: production completes only at ~21.7 s (near timeout);
  candidate does not. Focused trace shows `non-musical-input`, not the octave
  guard. Borderline detector/timing flake, not a guard rejection.
* `piano-schubert-single`: candidate completes on a clean focused run
  (`matched [48]`, `wrong 0`).

### Focused 23-scenario matrix

| metric | production | integrated |
|---|---:|---:|
| legitimate completions | 6 / 7 | **6 / 7** |
| false completions | 4–6 / 16 | **1 / 16** |
| remaining false | guitar strum vs octave chord | guitar strum vs octave chord |

The six-string open-Em strum true completion fails on both revisions (low E
fundamental never clears the detection ratio). Octave false awards for single
piano/guitar notes are gone. Chords are deliberately untouched; a
six-string-vs-octave-chord substitution remains.

**False-rejection audit:** the earlier confidence-branch version rejected
`electric-gtechs-low` and `piano-schubert-single`; the final rule requires the
lower octave to be the dominant or independently heard. Both now advance.
Wrong-note reports increase while a wrong octave is held (the guard re-fires
per frame); that is feedback noise, not a false acceptance.

No physical microphone has been used. All mic evidence is injected at the
MediaStream boundary.

---

## 4. Real-browser verification

| flow | browser | result |
|---|---|---|
| Audio Vision generation → review → corrections → save → reload → practice | Chromium | **18 / 18** |
| Same | WebKit | **18 / 18** |
| Unified Practice Engine, red cursor, TAB, engraving | WebKit | **12 / 12** |
| Mic live production | Chromium | **5 / 5** |
| Unified mic practice | Chromium | **23 / 23 passed, 1 skipped** |
| Progress, cancel (35 ms), tempo, restart/reopen | Chromium | **19 / 19 passed** |
| Full unit suite | Node | **3939 passed, 19 skipped, 0 failed** |

The cursor, playback, Audio Vision Worker, progress, cancellation, note
corrections, save/restore and Practice Engine remain intact.

---

## 5. Piano Vision blockers (no merge)

* The committed PDF.js extractor does not run with production
  `pdfjs-dist@5.4.296`: `constructPath` argument shape yields
  `route:image / no staff systems`, so the benchmark is not reproducible.
* Emitted MusicXML contains **no `<alter>`** in any of the four fixtures;
  accidentals and key signatures are not decoded.
* No ties; rest placement/voices incomplete; dense fixture has 13 measure
  violations. 321/447 complete events on four hand-built fixtures.
* Licensing is fine (PDF.js Apache-2.0), but this is not a production engine.
* Minimum safe path: fix the PDF.js 5 API, add accidentals/key/tie/rest/voice
  support, independent unfamiliar-score tests, experimental flag, keep image
  OMR fallback.

## 6. Guitar Vision blockers (no merge)

* Python/NumPy/PIL/PyTorch research pipeline, not a browser module.
* Research weights (`proof-model.pt`, `stringnet.pt`, heatmaps) have no
  explicit license/provenance file; not shippable.
* Cross-font leave-one-font-out complete events range from 0/116 to 30/116;
  “font-independent” is not supported.
* Rhythm slashes (TAB-only layouts) unimplemented; rests not emitted; ties not
  detected; multi-voice unresolved; large layouts at 0 % measures.
* The PDF.js text path is Apache-2.0 and viable; the raster path is not.

---

## 7. Deployment

| item | value |
|---|---|
| source commit | `b0dcff7b0e` (accuracy integration; built after the docs commit) |
| bundle | `dist/assets/index-DRzsCFhE.js` |
| bundle SHA-256 | `f23a60c89eaa1b34d06e2124eacf440633656b13a70a0aca417f8f87ec58668a` |
| Worker version | `6113726f-aa90-4708-beb7-146930119397` |
| Deployment id | `a5e05cb3-b1aa-4fff-b441-5759b7d90e41` (2026-10-24T20:07:30Z) |
| live bundle | `index-DRzsCFhE.js`, SHA-256 matches local |
| live routes | `/`, `/privacy`, `/terms`, `/contact` → 200 |
| rollback target | `d42dd9b4-c2de-42c5-bbb9-94869eb8d314` (the previous production version) |

Rollback:

```
npx wrangler rollback d42dd9b4-c2de-42c5-bbb9-94869eb8d314
```

The built bundle passed the Audio Vision correction flow on `vite preview`
(18/18) and the same flow against the live URL after deployment.
