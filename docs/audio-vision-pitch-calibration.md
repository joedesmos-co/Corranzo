# Audio Vision — pitch transcription: the model was not the problem, its calibration was

## The question

The arrangement event F1 on real guitar was ~0.692, with dense material
dominated by wrong pitches, late echoes and missed notes. Was the Basic Pitch
model itself too weak, or was its evidence being read badly?

## What the model's own evidence says

`scripts/audio-vision-pitch-evidence.mjs` runs the model, keeps its 88-pitch
probability matrix, and for every note it reports asks two independent
questions at that note's OWN start frame:

* does the model's matrix give the reference pitch a higher probability than
  the pitch it reported?
* does the audio's harmonic structure (a windowed harmonic sum, odd harmonics
  weighted in) favour the reference pitch?

On two dense GuitarSet comps:

| | count |
|---|---|
| wrong-pitch notes | 151 |
| the reference pitch is ALSO reported at that moment (an extra harmonic sibling) | **114 (75 %)** |
| only the wrong pitch is reported (a substitution) | 37 (25 %) |
| the model's own matrix favours the reference pitch | 97 (64 %) |
| the audio's harmonics favour the reference pitch | 64 (42 %) |
| neither favours it | 50 (33 %) |

So three quarters of the dense wrong notes are not "invented music": the model
found the right note and also reported a harmonic sibling. That is a
note-EXTRACTION problem, not a model-capacity problem.

A dedicated harmonic-sibling consolidator was then built and measured
(`src/features/audio-vision/harmonicEvidence.js`, `scripts/audio-vision-harmonic-siblings.mjs`):
it removes **nothing** on top of the shipped suppression, because the shipped
suppression already removes every sibling the evidence clearly identifies, and
for the rest the spectrum genuinely has energy at the reported pitch too (a
guitar string's second harmonic is loud). That route is closed - by
measurement, not by opinion.

## The fix: calibrate how the model's probabilities become notes

Basic Pitch turns its probability matrices into notes with three thresholds:
onset 0.5, frame 0.3, minimum 5 frames. Those are library defaults for general
material. `scripts/audio-vision-threshold-sweep.mjs` runs the model **once per
recording**, keeps the matrices, and re-extracts notes for 48 threshold
triples - same weights, same audio, only the reading changes - scoring each
candidate through the real arrangement against the JAMS truth.

Chosen on 5 development takes, then **checked on 5 unseen takes**:

| metric (5 unseen GuitarSet takes) | shipped 0.5 / 0.3 / 5 | calibrated 0.65 / 0.50 / 3 |
|---|---|---|
| arrangement event F1 | 0.751 | **0.807** |
| pitch precision | 0.761 | **0.906** |
| pitch recall | 0.755 | 0.746 |
| invented-note rate | 0.102 | **0.038** (-63 %) |
| note density | 138.6 | **112.6** (-19 %) |
| melody-anchor recall | 0.823 | 0.802 |
| bass-anchor recall | 0.878 | 0.881 |

By density:

| | dense takes | sparse takes |
|---|---|---|
| shipped | 0.651 | 0.902 |
| calibrated | **0.708** (+0.057) | **0.957** (+0.055) |

On the development takes the same setting gives 0.692 -> 0.724 (+0.032) and
precision 0.719 -> 0.844.

**Why this is not overfitting:** the choice was made on one set of takes and
confirmed on a disjoint set with the same direction and a similar size; the
direction (raise the onset and frame thresholds) is consistent on dense and
sparse material, and on two different instruments (the mic-real corpus below).

**The cost, stated honestly:** recall is 0.009 lower, the dense melody-anchor
recall 0.042 lower, and the score is 19 % sparser. Precision rises 0.145 and
the invented notes fall 63 %. The arrangement's separate melody and bass
protection is untouched, so this changes which notes are heard from the model,
not the arrangement's musical rules.

## Where the knobs live

* `src/features/audio-vision/audioVisionPitchWorker.js` — `NOTE_EXTRACTION`
  (the browser worker, the only place the model is run).
* `scripts/lib/basicPitchNode.mjs` — the same defaults, so a Node measurement
  describes the same pipeline.

## What this says about replacing the model

It is no longer justified by the evidence gathered here. With the calibrated
extraction the model reaches precision 0.906 and recall 0.746 on unseen real
performances. The earlier hFT-Transformer comparison (F1 0.646 vs 0.842 on a
synthesized piano reference) still describes a stronger piano model, but on
real guitar the measurable loss was in the extraction step, and that is fixed
without a 20 MB PyTorch checkpoint, without a licensing question and without a
browser port.

The remaining dense errors are the 25 % substitutions (the model reports one
pitch where the performance has another - mostly adjacent-string and octave
confusions) and the notes never heard at all. Those are model-capacity
limits; the next honest step is an instrument-specific model, and the
benchmark requirements for it are recorded in
`docs/audio-vision-model-benchmark.md`.

## Not touched

Note corrections, MusicXML generation, the arrangement rules and the Practice
Engine are unchanged. Only the model's probability-to-note calibration moved.
