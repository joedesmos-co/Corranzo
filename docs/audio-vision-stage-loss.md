# Audio Vision — where the music is lost, and what was changed

The pipeline is measured stage by stage, so a loss can be attributed to a
stage instead of to "the arrangement":

```
S0  audio            -> detected note events   (the pitch model, raw)
S1  note events      -> musical transcription  (harmonic-double suppression)
S1b transcription    -> onset corroboration    (a short note with no attack)
S2  transcription    -> tempo/beat grid        (quantization, phase, tempo)
S3  grid             -> musical transcription  (melody, bass, chords)
S4  transcription    -> solo arrangement       (per target + difficulty)
S5  arrangement      -> valid MusicXML         (emission + re-parse)
```

Every stage is scored against a reference the pipeline never sees, with one
matcher (`scripts/lib/eventScore.mjs`): pitch precision/recall, onset MAE,
duration MAE, full-reference event F1, note density, hand allocation, the
melody-anchor and bass-anchor recall, the invented-note rate and the MusicXML
validity.

```bash
node --expose-gc scripts/audio-vision-stage-loss.mjs --sources synth,micreal,guitarset
node --expose-gc scripts/audio-vision-real-acceptance.mjs   # real takes, A/B
```

## The three reference sets

| set | what it is | why |
|---|---|---|
| **synth-reference** | a piano piece with exactly known notes, onsets, durations and hands (51 notes, 100 BPM, 24 s) | the independent reference the pipeline never sees |
| **mic-real** (49 clips, in-repo) | real 3 s recordings: Vienna 4x22 piano, GuitarSet acoustic, EGSet electric | detection-grade evidence on real instruments |
| **GuitarSet** (5 performances) | real takes (14-46 s) with the JAMS note truth (Zenodo 3371780, CC-BY-4.0) | arrangement-grade evidence: a real player, a real performance |

## Where the music is lost (GuitarSet, real performances, piano / Intermediate)

| stage | jazz2-solo | jazz1-solo | ss3-comp | bn2-comp | funk3-comp | mean |
|---|---|---|---|---|---|---|
| S0 model | 0.820 | 0.909 | 0.671 | 0.743 | 0.797 | **0.788** |
| S1 suppression | 0.833 | 0.916 | 0.684 | 0.741 | 0.759 | 0.787 |
| S1b corroboration | 0.772 | 0.828 | 0.665 | 0.694 | 0.749 | 0.762 |
| S2 grid | 0.759 | 0.828 | 0.655 | 0.684 | 0.744 | 0.734 |
| S4/S5 arrangement | 0.776 | 0.828 | 0.580 | 0.573 | 0.523 | 0.656 |

* **The model is the strongest stage** (F1 0.788, the onset MAE 12 ms). It
  finds every note and invents a few.
* **The arrangement stage is the biggest loss** (-0.09 to -0.22 on the dense
  comps) and it is where the density comes from: 2.1 notes/s on a solo, but
  4.2-6.5 notes/s on a comping take.
* **The onset-corroboration gate (S1b) was a net loss on real recordings**:
  -0.06 to -0.09 on every GuitarSet performance, and -0.009 on the mic-real
  clips. It looked good on the synthesized reference (+0.08), because on that
  fixture the extra notes really were artifacts - but on a real guitar the
  flux detector misses a soft pick, and the gate then drops a REAL note.

## What was changed (and measured)

### 1. The onset-corroboration gate is OFF by default

The gate drops a short note that has no detected attack. On the synthesized
reference that is right (+0.08 event F1 on the transcription). On real
recordings it is wrong: the spectral-flux detector misses soft picking, so the
gate deletes real notes.

| corpus | gate ON | gate OFF | |
|---|---|---|---|
| GuitarSet arrangements, event F1 | 0.667 | **0.692** | +0.025 |
| GuitarSet arrangements, invented rate | 0.133 | **0.128** | better |
| mic-real arrangements, event F1 | 0.519 | **0.535** | +0.016 |
| mic-real arrangements, invented rate | 0.195 | 0.228 | worse on 3 s probes |
| synthesized reference, event F1 | 0.696 | 0.700 | equal |

The arrangement-grade evidence (the real takes) improves on both metrics; the
3-second detection probes trade a little invented-rate for a better F1. The
default follows the real takes.

### 2. Two candidate improvements were measured and REJECTED

Both looked good on the synthesized reference and both failed on real
recordings. They are kept in the tree, switched off, with the measurement
recorded, so the decision can be revisited.

| experiment | synthesized reference | real GuitarSet takes | verdict |
|---|---|---|---|
| **drop re-detections of a note that is already ringing** (`noteCleanup.js`) | F1 0.701 -> 0.748 (+0.047), 14 notes removed (13 invented, 1 genuine) | F1 0.759 -> 0.527 on funk3-comp: **157 genuine notes removed** | **rejected** |
| **hold each note until the next note in its part** (`arrangementDurations.js`) | duration MAE 171 ms -> 149 ms | duration MAE 123 ms -> **147 ms** (worse on 4 of 5) | **rejected** |
| the same cleanup, gated on the model's own note strength | removes nothing anywhere | removes nothing anywhere | no value |

The lesson is recorded rather than hidden: *a same-pitch note next to another
same-pitch note is usually a real re-strike on a real instrument*, and the
model's frame-based duration is often closer to the truth than "until the next
onset".

### 3. What was deliberately NOT done

* No note was deleted to make the score look cleaner, and nothing was
  transposed to fit a staff.
* The density budget was not tightened: measured on the real takes, a tighter
  per-beat budget changed the note count by less than 1 % (the melody and the
  bass root are protected, and on a dense comp the melody itself is dense).
  A dense guitar comp cannot become a sparse solo arrangement by thinning -
  that would be arbitrary.

## The model benchmark

See `docs/audio-vision-model-benchmark.md`. Measured on the same reference with
the same matcher: Basic Pitch F1 0.646 (pitch recall 1.000, 40 % invented,
durations 313 ms off) against hFT-Transformer F1 0.842 (0 % invented,
durations 42 ms off, 20.5 MB, MIT code but weights trained on a
non-commercial corpus). The stronger model wins on the reference and still
loses on the product's constraints - so it is **not** integrated, and the
measured weakness of the current model (precision, durations) is addressed in
the pipeline instead.

## Verification

| check | result |
|---|---|
| audio-vision unit suites (analysis, arrangement, pipeline, import, measure integrity, MusicXML semantics, tempo persistence, agreement) | **90 passed / 0 failed** |
| new regression suites (`audioVisionTranscriptionCleanup`, `audioVisionMusicXmlOutput`) | **23 passed** |
| browser flow, upload -> arrangement -> review -> import -> practice -> playback (`browser-audio-vision-uiflow.mjs`) | **7 passed / 0 failed** |
| browser critical-UX suite | 13 passed / 6 failed - **identical to the pre-change baseline** (the 6 are the research branch's known gaps: the TAB staff, the corrected tempo in the score, the active-score switch and the arrangement persistence across a reload - all features that live on the product branch) |
| MusicXML written by the real pipeline | every measure exactly one bar per voice in the detected meter, no overfull measure, every note survives a write -> read -> parse round trip |
| full repository suite | unchanged from the branch baseline (the 7 known UI failures and the 2 load-dependent neural-injection flakes, both reproduced without these changes) |

The browser runs were executed with the production Practice Engine untouched:
the other agent's in-progress `PracticeSessionContext` / `usePracticeSession`
edit was set aside for the duration of the run (saved as a patch, restored
byte-for-byte afterwards, md5 verified) because that in-progress edit crashes
the practice view with `Cannot read properties of undefined (reading
'effectiveTempo')` - a failure of their change, not of this one.

## What is still weak (and honest about it)

* **Density on dense material.** 2.1 notes/s on a guitar solo, 4.2-6.5 on a
  comping take. The arrangement cannot be sparser without arbitrary thinning.
  The answer for a dense source is the Easy difficulty, and the review panel
  says how much of the recording the arrangement covers.
* **A comping performance has no single melody.** The "highest note at each
  onset" of a funk comp is a ghost note, not a line; the arrangement's melody
  anchor recall on funk3-comp is 0.17, and on the two solo performances
  0.78-0.81.
* **The arrangement stage is the biggest remaining loss** (-0.09 to -0.22 on
  the comps). The next thing to attack is how the arrangement chooses the
  texture (which notes become the accompaniment) - not the model, and not the
  notation.
* **The model's durations** are 313 ms off on the reference. The arrangement
  inherits part of that; the rejected duration experiment shows that
  "until the next onset" is not the fix.
* A multi-instrument song is still transcribed as one flat note stream: the
  pipeline cannot tell a vocal line from a guitar chord, so the arrangement
  cannot reliably be "a solo piano version" of it. The honest product answer
  is a solo arrangement of what the model heard, with the density and the
  confidence reported.
