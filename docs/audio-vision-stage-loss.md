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

The gate drops a short transcribed note that has no detected attack. On the
synthesized reference that is right (+0.08 event F1 on the transcription). On
real recordings it is wrong: the spectral-flux detector misses soft picking,
so the gate deletes REAL notes.

The evidence is unambiguous - on **every** real performance the gate drops
notes and the score gets worse:

| GuitarSet take | notes before the gate | notes after | event F1 before | event F1 after |
|---|---|---|---|---|
| jazz2-solo | 102 | 80 | 0.833 | **0.772** |
| jazz1-solo | 66 | 51 | 0.916 | **0.828** |
| ss3-comp | 246 | 207 | 0.684 | **0.665** |
| bn2-comp | 225 | 182 | 0.741 | **0.694** |
| funk3-comp | 399 | 352 | 0.759 | **0.749** |

With the gate off, on the real recordings:

| metric | GuitarSet (5 real takes) | mic-real (49 real clips) |
|---|---|---|
| arrangement **event F1** | 0.656 -> **0.692** (+0.036) | 0.519 -> **0.535** (+0.015) |
| **melody** anchor recall | 0.624 -> **0.722** (+0.098) | 0.515 -> **0.609** (+0.094) |
| **bass** anchor recall | 0.735 -> **0.847** (+0.112) | 0.632 -> **0.709** (+0.078) |
| duration MAE | 121 ms -> 120 ms (flat) | 316 ms -> **295 ms** (-21 ms) |
| invented-note rate | 0.109 -> 0.128 (-0.019) | 0.195 -> 0.228 (-0.034) |
| note density | 3.91 -> 4.71 notes/s | 4.16 -> 4.90 notes/s |

The melody and the bass - the two things a musician listens for - are
measurably better, and the event F1 rises on both corpora. The honest cost:
the gate was also removing some invented notes, so the invented rate and the
density rise a little (and on the dense comps the arrangement gets busier).
The trade is taken deliberately and recorded, because a deleted real note
cannot be recovered by the reader, while an extra invented note is visible in
the review panel and can be deleted by the user.

The guitar path (solo guitar, Intermediate, the real-acceptance harness)
improves as well, but less: event F1 0.667 -> 0.672, the invented rate 0.133
-> 0.127, the melody recall unchanged at 0.722. The big piano-path gains
above come from the two-hand arrangement: with the gate on, deleted guitar
notes left the melody without its notes or pushed it into the wrong hand.

The synthesized reference is the one place the gate still helps (its extra
notes really are artifacts). It is kept as a reference, not as the arbiter:
the product's input is a real recording.

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

## Dense material: where the wrong notes actually come from

The aggregate F1 hides the mechanism, so every arrangement note on three dense
GuitarSet comps and two sparse solos was put in exactly one bucket against the
JAMS truth (`scripts/audio-vision-fp-attribution.mjs`):

| bucket | dense (3 comps) | sparse (2 solos) |
|---|---|---|
| true (pitch and onset match) | 420 | 131 |
| duplicate (same pitch moments later) | 10 | 0 |
| transcription false positive (carried from the model) | 12 | 12 |
| **wrong pitch** (a real event at that time, wrong note) | **76** | 9 |
| **late echo** (same pitch, different time) | **62** | 8 |
| **added by the arranger** | **0** | **0** |
| missed: never transcribed | 249 | 9 |
| missed: dropped by the arranger | 0 | 0 |
| missed: pitch changed | 246 | 3 |

Read it as a musician would:

* **The arranger invents nothing.** Zero notes were created between the
  transcription and the score on any take. Every wrong note was already in the
  transcription.
* **The dense problem is pitch and time attribution, not note count.** 76
  wrong-pitch + 62 late-echo notes out of 580 - the rhythm is right and the
  note is real, but it is written at another pitch or another beat. Of the
  wrong pitches, 41 % are an octave displacement, 25 % a step, 35 % a third or
  fourth (adjacent guitar strings are a fourth/fifth apart, which is exactly
  what a string confusion looks like).
* **No filter can remove them safely.** Six were implemented and measured on
  the same five takes: chord-outlier (drop non-chord tones with no attack),
  the same without the attack requirement, weak-ghost, strong-voices,
  duplicate-collapse, voicing sanity (semitone clashes and doubled octaves),
  and all of them after arranging where the melody/bass roles are explicit.
  Every one either removed nothing (the voicings are already clean) or removed
  real notes and lowered the F1 by up to 0.14. They are kept in
  `scripts/audio-vision-dense-filters.mjs` with the numbers.

### The melody-policy experiment (measured, then rejected)

A promising variant was measured: in a thick texture the salience contour can
nominate an inner voice as the line, so "the top voice is the melody" was
expected to help. It did on the dense takes (event F1 0.572 -> 0.593, melody
recall 0.566 -> 0.704) and cost almost nothing on the sparse ones in the A/B
harness. The clean production implementation was then measured on the real
stage ledger, and it **regressed** the sparse takes badly (jazz1 F1 0.923 ->
0.828): mixing the two policies at different onsets makes the melodic line
inconsistent. The A/B harness had a broken per-onset lookup that hid this.
The experiment was reverted - this is exactly why a variant is not adopted on
the strength of one harness.

### What the review flow does instead

The realistic answer for dense material is the musician: the review now lists
every note and lets them remove the wrong ones, with the edit stored
separately and surviving a rebuild
(`docs/audio-vision-note-corrections.md`). A wrong note the model is sure of
is visible in the list; a note the musician removes is gone from the score,
the preview and practice, and nothing else moves.

### The next lever (identified, not yet used)

`selectTexture` computes a per-onset texture (`melody-only`, `melody-block`,
`melody-broken`, ...) from the density and the chord confidence, and the
events carry it - but **nothing consumes it**: the number of voices kept is a
constant per difficulty. Making the texture actually govern the voicing is
the next evidence-backed way to make a dense comp playable without an
arbitrary per-measure cap.

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
