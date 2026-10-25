# Audio Vision — can the compact model be made better? Training feasibility

Research only. Production keeps Basic Pitch (`0.65 / 0.50 / 3`, 0.92 MB, TF.js
worker, Apache-2.0). This records what training is possible, with what data,
under which rights, and what prevents a verified model improvement today.

## 1. What the deployed artefact actually is

`public/neural-model/model.json` is a **frozen TF.js graph model**:
`format: "graph-model"`, 245 weight tensors, converted by
`TensorFlow.js Converter v3.13.0` from a TF SavedModel. The graph contains
weights and ops, **not** a trainable Keras model: you cannot fine-tune this
file, and the browser cannot.

What the public `spotify/basic-pitch` repository provides (Apache-2.0):

| piece | present? | note |
|---|---|---|
| Keras model definition (`models.py`) | **yes** | 322 lines, the note/onset/contour heads |
| losses (`transcription_loss`, `weighted_transcription_loss`, `onset_loss`) | **yes** | BCE, optional positive-onset weighting |
| training loop (`train.py`) | **yes** | epochs, steps, LR, checkpoints, validation callbacks |
| data tooling (`basic_pitch/data/`) | **yes** | tfrecord serialisation/deserialisation, dataset download |
| **initialisation from the released weights** | **no** | `train.py` builds and fits a fresh model; the checkpointing is for its own runs |
| inference SavedModel (`saved_models/icassp_2022`) | **yes** | same weights as the browser graph |

**Fine-tuning verdict:** *from-scratch training is supported; fine-tuning the
shipped weights is not.* It would require mapping the SavedModel's variables
(`model_1/...`) onto the Keras model, then re-exporting to TF.js and proving
the output probabilities still match the extractor's expectations. That is an
engineering spike (roughly a day), not a training run — and it is the single
blocking step for every data-efficient improvement.

## 2. Rights-clean data audit

| source | licence | size here | use |
|---|---|---|---|
| **GuitarSet** (Zenodo 3371780) | **CC BY 4.0** (verified in `benchmarks/mic-real/manifest.json` and the fetch manifest) | 360 takes, **3.05 h**, note-level JAMS | training + development |
| mic-real clips (Vienna 4x22, Guitar-TECHS, EGSet12) | **CC BY 4.0** (verified, per clip) | 50 clips, ~2.5 min | **evaluation only** (too few to train) |
| synthesized renders from MIDI + a licensed sample library | ours | unlimited | training |
| Slakh2100 | documented as CC BY 4.0 but **not verified in this session** (Zenodo API unreachable) | not downloaded | verify before use |

**Sound libraries are a separate right from the MIDI.** A MIDI file's
availability grants nothing about the samples used to render it. Any
synthesized training set must name the sample library and its licence
(Salamander Grand Piano and FluidR3 GM are the usual permissive candidates —
each must be checked at the file level before training).

Non-commercial corpora (MAESTRO CC BY-NC-SA, MAPS research-only) are excluded,
which is also why distillation from hFT-Transformer was rejected in
`f72b808fe7`: it would launder a non-commercial corpus into a commercial
artefact.

## 3. Scale argument

GuitarSet is **3.05 hours** of solo acoustic guitar. Spotify's released model
was trained on a large multi-instrument mixture; a 0.92 MB model trained from
scratch on three hours of one instrument will not beat it — the data is too
narrow, and the target is general polyphonic transcription.

Two honest routes remain:

1. **Fine-tune the released weights** on GuitarSet (+ synthesized renders).
   This is what the 3 hours are actually good for: adapting an already strong
   model to the instrument, not teaching transcription from zero. It needs the
   weight-mapping spike from §1.
2. **Train a compact student from scratch on synthetic renders** with a
   clean-room sample library, then distil Spotify's *outputs* (not hFT's) —
   distillation targets are model outputs, and Basic Pitch's weights are
   Apache-2.0, so that path is clean. This needs a render pipeline and far more
   compute than one session.

## 4. The sealed split (contamination control)

Earlier studies used takes `00_*`/`04_*` for development and `01_*` as a
"holdout" — but that holdout has since been inspected repeatedly, so it can no
longer be called unseen. A genuinely untouched set is now defined:

**Sealed: takes `02_*` and `03_*`** (120 recordings available), used for the
first time in `scripts/audio-vision-fresh-baseline.mjs`:

| | micro F1 | precision | recall | missed | false |
|---|---|---|---|---|---|
| sealed, all 5 | **0.798** | 0.884 | 0.727 | 209 | 73 |
| sealed, dense (3 comps) | 0.772 | 0.890 | 0.681 | 201 | 53 |
| sealed, sparse (2 solos) | 0.901 | 0.865 | 0.941 | 8 | 20 |

Any future model must be compared against **these** numbers, on these takes,
and the takes must not be used for model selection.

## 5. What training could actually fix

From the widened-window audit (`f72b808fe7`): 35 % of misses have no pitch
evidence anywhere within ±70 ms/±2 semitones (inference), 14 % are
pitch-neighbour confusions, 9 % are alignment, the rest have weak evidence.

The sealed baseline adds a structural signal that *is* trainable: recall by
register is **bass 0.644, mid 0.739, high 0.875**. The model systematically
loses the low notes — the fundamentals masked under the upper voices of a
guitar chord. That is a data/objective problem (class imbalance, harmonic
masking), not an extractor problem, and it is exactly what a fine-tune on
annotated guitar performances can move. The next experiment should target bass
recall specifically, with the melody/high register held constant as a control.

## 6. Resource envelope

* Python 3.13.14; `tensorflow` 2.20/2.21 available for this interpreter.
* 16 GB RAM, 10–11 GB free disk; the model is 0.92 MB / 245 tensors.
* CPU training of a model this size is practical for a pilot (hundreds of
  steps per minute), and the export path (`tensorflowjs_converter` →
  graph-model) reproduces the current artefact format, so the worker and the
  extractor would not change.
* No training job was launched: without the weight-mapping step a from-scratch
  run on 3 hours of solo guitar would produce a worse model, and an unverified
  "trained something" result is exactly what this branch has learned to
  reject. The measured finding is the blocker itself.

## 7. The spike to run next (one session)

1. Build the Keras model from `basic_pitch/models.py`; load the SavedModel's
   variables into it (the `model_1/` prefix maps onto the functional model);
   assert the output probabilities match the TF.js graph on a reference clip
   (max absolute difference < 1e-4).
2. Convert 40 GuitarSet takes to BP's tfrecord format (their `data/` pipeline);
   hold out the sealed takes entirely.
3. Fine-tune for a bounded number of steps with early stopping on a
   development split of takes `00_*`/`04_*` (the already-inspected set, which
   is now development data).
4. Export to TF.js, run the existing extractor, and evaluate on the **sealed**
   takes with `scripts/audio-vision-fresh-baseline.mjs`.

Success criterion: beat **0.798 micro F1 / 0.727 recall** on the sealed takes,
with bass recall up and high-register recall unchanged, at the same size and
runtime. Anything less stays a research artefact.
