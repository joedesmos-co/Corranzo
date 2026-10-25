# Audio Vision — trainable Basic Pitch: recovered, verified, and the pilot that lost

Research only. Production still ships the original 0.92 MB TF.js model at
`0.65 / 0.50 / 3`. Nothing here is integrated.

## 1. What was blocked, and what unblocked it

The deployed `public/neural-model/model.json` is a frozen TF.js **graph** model
(245 tensors). The public `spotify/basic-pitch` repo has the Keras definition,
the losses, `train.py` and the tfrecord tooling, but **no initialisation from
the released weights**. The released package does ship a **SavedModel**
(`basic_pitch/saved_models/icassp_2022/nmp`) whose variables are an
object-based checkpoint — that is the trainable source.

### A trap worth recording

The public `models.py` contains **two dead layers**: the contour branch's first
`Conv2D(32,(5,5))` and its BatchNorm. Their output is immediately overwritten
by the next conv, which reads `x`, not `x_contours`. The released SavedModel
was exported from a pruned graph, so its checkpoint contains **9 weighted
layers, not 11**. A naive `layer_with_weights-N` restore would bind the CQT
BatchNorm correctly and then shift every subsequent layer by two — silently
producing garbage.

The reconstruction therefore builds the architecture **without** the dead pair
(`bp_models_release.py`, 295 characters removed, everything else identical),
which gives exactly 9 weighted layers whose shapes match the checkpoint in
order.

## 2. The mapping (auditable)

`benchmarks/audio-vision/bp-weight-mapping.json` records every tensor:
checkpoint layer → Keras layer → kind → shapes → SHA-1 of the values.

| ckpt | Keras layer | role | tensors |
|---|---|---|---|
| 0 | batch_normalization | BN after the CQT | gamma/beta/mean/var `[1]` |
| 1 | conv2d | contour `(3,39)` on the harmonic stack | `[3,39,8,8]`, `[8]` |
| 2 | batch_normalization_1 | BN | `[8]`×4 |
| 3 | contours-reduced | contour reduction `(5,5)` | `[5,5,8,1]`, `[1]` |
| 4 | conv2d_1 | note branch pre `(7,7)` stride (1,3) | `[7,7,1,32]`, `[32]` |
| 5 | conv2d_3 | onset branch `(5,5)` stride (1,3) | `[5,5,8,32]`, `[32]` |
| 6 | batch_normalization_2 | BN | `[32]`×4 |
| 7 | conv2d_2 | note output `(7,3)` | `[7,3,32,1]`, `[1]` |
| 8 | conv2d_4 | onset output `(3,3)` on 33 channels | `[3,3,33,1]`, `[1]` |

**24 tensors, 9 layers, no unmapped weighted layer, no unmatched checkpoint
variable.** No transposes are required: the checkpoint is TF-layout
(`h,w,in,out`), the Keras layers are TF-layout; only the ONNX export
transposes. Batchnorm order is `[gamma, beta, moving_mean, moving_variance]`.

## 3. Numerical equivalence — verified against both references

Nine signals (silence, loud/quiet A4, bass E2, high E6, a C major chord, a real
solo-guitar take, a real dense comp take, a real piano clip), one model window
each (43 844 samples), raw **note / onset / contour** probabilities compared
before any extraction:

| comparison | worst absolute difference |
|---|---|
| reconstructed Keras vs released **SavedModel** | **5.4e-7** |
| reconstructed Keras vs production **TF.js graph** | **3.0e-5** |
| SavedModel vs TF.js graph (sanity) | 3.0e-5 |

The 5e-7 residual is float32 op-fusion noise between Keras layers and the
frozen graph; the 3e-5 is the TF.js CPU backend's own arithmetic. Both are far
below 1e-4 and far below any probability difference that changes a note.

**Primary milestone: the released model is reconstructed as a numerically
equivalent, trainable model.** Artifact: `benchmarks/audio-vision/bp-equivalence.json`.

## 4. The fine-tuning pilot

Data: **GuitarSet** (CC BY 4.0) only. Train = takes `02_*` (60 takes, 360
windows), validation = takes `00_*`/`04_*` (120 takes, 479 windows), **final
test = takes `05_*` (untouched, 10 takes chosen a priori)**. The earlier
"sealed" `02_*` split was folded into training because it had already been
inspected.

Objective: note + onset BCE with a properly **normalised** positive-class
weight (bass ×2, onset ×8), contour head excluded from the loss (it is only for
pitch bends), **BatchNorm frozen** so the released statistics survive. Adam
1e-4, batch 4, 12 epochs, seed 20261025, best validation checkpoint.

A first attempt used an unnormalised weighted BCE; the loss fell 30× while the
onset recall collapsed 0.72 → 0.06 (the negatives drowned the sparse positive
class). That run was discarded — a textbook example of why loss is not
accuracy.

Validation (takes 00/04) after the fix:

| | before | after |
|---|---|---|
| note frame F1 | 0.758 | **0.792** |
| onset frame F1 | 0.212 | **0.364** |
| bass note recall | 0.563 | **0.620** |

## 5. Final test on the untouched takes — the pilot loses

Same extractor as production (`outputToNotesPoly`, onset 0.65, frame 0.50,
min 3), same matcher, non-overlapping windows applied identically to both
models, ten never-inspected `05_*` takes (5 comps, 5 solos, 810 reference
notes):

| variant | micro F1 | P | R | dense | sparse | bass | mid | missed | false | octave |
|---|---|---|---|---|---|---|---|---|---|---|
| **production** | **0.879** | 0.830 | **0.934** | **0.881** | 0.874 | **0.966** | **0.931** | **70** | 204 | **23** |
| fine-tuned | 0.841 | 0.836 | 0.846 | 0.830 | 0.872 | 0.898 | 0.840 | 164 | **177** | 35 |
| fine-tuned @onset 0.5 | 0.843 | 0.804 | 0.887 | 0.830 | **0.881** | 0.966 | 0.878 | 121 | 231 | 40 |
| production @onset 0.5 | 0.828 | 0.742 | 0.937 | 0.827 | 0.833 | 0.966 | 0.934 | 67 | 348 | 25 |

**The fine-tune does not beat production.** It buys a little precision
(0.836 vs 0.830) and 27 fewer false notes, and pays for it with a large recall
loss (0.846 vs 0.934), more octave errors (35 vs 23) and a far worse dense
result (0.830 vs 0.881). The validation gains did not survive the untouched
split.

**Why**: 12 minutes of training audio (360 windows from 60 takes, all one
instrument) is enough to shift the model, not to improve it; the validation
takes share sessions and players with the training takes, so the validation
gain was optimistic; and lowering the onset threshold cannot recover it
because the fine-tuned onset distribution moved (recall 0.43 vs 0.72 at the
same threshold).

Artifacts: `bp-finetune-pilot.json`, `bp-finetune-holdout-05.json`.

## 6. What this establishes

1. **The released weights are recoverable** as a trainable Keras model, with a
   documented, audited mapping and equivalence at the 1e-7 (SavedModel) and
   1e-5 (browser) level. That is the enabling step for every future training
   experiment.
2. **A small fine-tune on one instrument's 12 minutes does not beat the
   production model** — measured on data no decision touched. The limit is
   data scale and split hygiene, not the architecture or the licence.
3. The exported-artefact path (Keras → SavedModel → TF.js) is the remaining
   engineering step; the converter toolchain conflicts with the training env
   and needs its own virtualenv (documented below).

## 7. Next experiment (ranked)

1. **More clean data, stricter splits.** Slakh2100 (CC BY 4.0, verify at file
   level) piano/guitar stems + synthesized renders from MIDI with a named,
   permissively licensed sample library. Split by **performer and composition**
   (GuitarSet's take numbers are sessions, not a clean holdout).
2. **Train longer and smaller.** Freeze the CQT-adjacent layers, train only
   the note/onset heads, and stop on a genuinely disjoint validation set. The
   pilot's validation gain came from shared sessions; that must not repeat.
3. **Export path in its own venv** (`tensorflowjs` drags a conflicting
   protobuf/decision-forests set): convert the SavedModel, verify the graph
   outputs against the Keras model on the equivalence battery, then run the
   production worker.
4. **Only then** consider the sealed `05_*` set, once, with a candidate chosen
   entirely on validation data.

## 8. Reproduce

The spike lives in `/tmp/bp-pkg` (scratch, not committed): `bp_models_release.py`,
`verify_mapping.py`, `train_finetune.py`, `dump_test_outputs.py`,
`compare_tfjs.py`. The committed artifacts are the mapping, equivalence table,
pilot report and holdout results. Environment: Python 3.12 virtualenv,
`tensorflow==2.21.0` + `tf-keras` (`TF_USE_LEGACY_KERAS=1`), scipy, soundfile.
