# Guitar Vision: two-phase fret training and production inference

**Status: validated and integrated behind a page-at-a-time inference contract. Not yet
merged into the default production path pending approval.**

## Training

Fret prediction is trained in two phases. Phase 1 is the existing joint training and is
unchanged. Phase 2 is new.

```
Phase 1   joint training of the shared Guitar model, as before.
          Its job is only to produce a usable fret representation; the quality of the
          joint fret head is irrelevant to phase 2.

Phase 2   1. freeze the representation: backbone, RoiEncoder, roi_projection and every
             non-fret head
          2. extract P = roi_projection(encoded.flatten(-2)) over the TRAIN fret objects,
             one page per forward
          3. compute exact per-feature mean and standard deviation from the FIT fret rows
             only
          4. reinitialise fret_classifier = Linear(192, 26)
          5. train fret_classifier alone for 3000 steps with the production recipe
             (AdamW, lr 3e-3, weight decay 0.01, clip 1.0, cosine over 3000 with 25%
             warmup, batch 77)
          6. store the fixed statistics and the head in a versioned checkpoint
```

Statistics are exact training moments. There is no cumulative accumulator, no EMA and no
batch statistics, and no evaluation or held-out row ever contributes to them.

### Why phase 2 exists

A joint run reached 0.4172 fret accuracy on train and 0.0684 on score-disjoint held-out
against a 0.0734 chance baseline, while the raw ROI pixels classify the same held-out
scores at 0.934. The information was present and the joint optimisation was not reaching
it. Localisation narrowed this to two stacked causes: the fret head's input was delivered
about 22x under-scaled, and the representation moved during training. Phase 2 removes both
by freezing the representation and standardising it with exact statistics.

Reference: `GUITAR_VISION_TWO_PHASE_RESULT.md`, `GUITAR_VISION_STATIC_HEAD_RESULT.md`,
`GUITAR_VISION_HEAD_ONLY_CONDITIONING.md`.

## Inference

```
image -> backbone -> RoiEncoder -> roi_projection
      -> fixed train-stat standardisation (read-only)
      -> phase-2 fret classifier
```

Use `guitar_vision.inference`:

```python
from guitar_vision.inference import load

model = load("path/to/two-phase-checkpoint.pt", "cpu")
predictions = model.infer(pages)          # one page per forward, enforced
numbers = predictions[0].fret_numbers()   # predicted fret per fret object
```

The standardisation statistics are read-only. They are never updated during inference and
never recomputed from user input.

### Checkpoint format

`guitar-vision-two-phase-v1`. A two-phase checkpoint carries:

- format version
- representation variant
- the full model `state_dict`, with the fixed statistics riding along as buffers
- feature `mean[192]` and `std[192]`
- epsilon (`1e-6`) and the training sample count
- phase-1 source path, sha256, variant and step
- phase-1 config
- split provenance
- phase-2 step

Loading validates all of it strictly: format string, required keys, a 64-hex-digit source
digest, 192-dimensional finite statistics with strictly positive sigma, a positive sample
count, and a known standardised variant. A malformed file raises
`CheckpointFormatError`; it is never partially applied.

### Old checkpoints

A checkpoint with no format marker keeps the behaviour of the variant recorded in its own
config. No statistics are fabricated, standardisation is not silently enabled, and nothing
is upgraded implicitly. A checkpoint that declares an *unknown* format is rejected rather
than treated as legacy, so a newer file's statistics cannot be silently ignored.

## Current performance

Measured on the frozen score-disjoint split (20 scores, 395 fret objects, chance 0.0734),
reproduced through the production API by `tools/guitar-vision/h81_verify_integration.py`:

| metric | value |
|---|---|
| score-disjoint | **0.5899** (233/395) |
| Wilson 95% | [0.5407, 0.6373] |
| train (fit) | 0.9984 |
| same-score unseen | 0.6601 |
| 1-digit | 0.6744 |
| 2-digit | 0.4889 |

Pixel causality, same split:

| control | accuracy |
|---|---|
| normal | 0.5899 |
| blank page | 0.0532 |
| wrong ROI | 0.0684 |
| pixel ablation (box interiors only) | 0.0608 |

All three interventions collapse to chance, so the result depends on the correct fret
pixels.

**Scope of the claim.** 0.5899 is measured on one 20-score synthetic split with 395 fret
objects. It is not a general accuracy figure and should not be quoted as one.

## Current limitation: page-at-a-time inference

The fret representation is **not batch-invariant**, so production inference runs exactly
one page per forward. `GuitarFretModel.infer` loops; `infer_batch` raises
`MultiPageBatchError` for anything longer.

`roi_crops` normalises a per-tile score across a tile dimension derived from
`plane_count // batch`, and `collate` pads every page in a batch to the batch's maximum
plane count. Pages here carry between 7 and 29 planes, so padded planes enter that softmax
and change the representation of real objects on real pages. Measured on the validated
phase-1 checkpoint: `max |P delta| 1.12e-01`, moving 623 of 1162 objects, between a
one-page and a three-page forward.

Consequences:

- **Do not batch independent pages** through the fret path until this is fixed.
- Inference results must not be reported as batch-independent.
- The fix is specified in `GUITAR_VISION_BATCH_INVARIANCE_FIX_SPEC.md`. It is a separate
  change because it alters the phase-1 representation and invalidates the checkpoint these
  numbers were measured against.
- `tools/guitar-vision/python/tests/test_batch_invariance_known_bug.py` records the defect
  as a strict `xfail` with its measured magnitude, so it cannot be quietly forgotten or
  quietly declared fixed.

## Correction: historical ROI pixel-ablation results are invalid

The earlier `ablate_roi_pixels` implementation treated normalised `[0, 1]` box coordinates
as pixel indices. Every coordinate was floored to 0 or 1, so it ablated **2 pixels out of
1,507,328** — a no-op.

**Every ROI pixel-ablation number produced before this fix is void**, and any conclusion
resting specifically on "pixel ablation had no effect" is unsupported and must not be
cited. In particular, statements of the form "the fret pixels carry no weight because
ablation changes nothing" are withdrawn: the ablation was not doing anything.

The blank-page and wrong-ROI controls are coordinate-independent and were never affected,
so conclusions resting on those still stand. The corrected ablation removes 102,218 pixels
(6.8% of a page) and, on the validated model, drops fret accuracy from 0.5899 to 0.0608 —
which is the behaviour a working control should show.

## Verification

- `tools/guitar-vision/h81_verify_integration.py` reproduces every number above through
  the production loader and the public inference API, and asserts the page-at-a-time
  contract. All eight checks pass.
- `tools/guitar-vision/python/tests/test_production_inference.py` covers checkpoint
  loading and strict validation, legacy fallback, read-only statistics, the one-page
  contract, pagewise equivalence, cached-versus-live representation, reload determinism,
  the pixel controls and unrelated-head identity.
- `tools/guitar-vision/python/tests/test_batch_invariance_known_bug.py` records the
  unfixed batch bug.

## Not done here

Phase 1 was not retrained. No architecture, hyperparameter, ROI geometry or data change.
The padded-plane softmax was not fixed. No held-out statistics were computed. Nothing was
merged into the default production path.
