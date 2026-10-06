# Specification: make the fret representation batch-invariant

**Status: specified, not implemented. Do not merge this fix together with the validated
two-phase integration.**

## The defect

`roi_crops` in `tools/guitar-vision/python/guitar_vision/fret_experiments.py` builds a
tile dimension and normalises a per-tile score across it:

```python
plane_count, channels, height, width = finest.shape
tiles = plane_count // batch
maps = finest.reshape(batch, tiles, channels, height, width)
...
values = values.reshape(batch, tiles, channels, objects, grid * grid)
values = values.permute(0, 3, 1, 2, 4).reshape(batch, objects, tiles, channels * grid * grid)
score = values.std(dim=-1, keepdim=True)
weights = torch.softmax(score * 8.0, dim=2)
combined = (values * weights).sum(dim=2)
```

`collate` pads every page in a batch to that batch's maximum plane count. Pages in this
corpus carry between **7 and 29 planes** (histogram: 7, 15×2, 16×5, 17×5, 18×8, 19×9,
20×3, 21×6, 22×5, 23×7, 24×2, 25×4, 26×2, 29). The padded planes are **not masked out
of `weights`**, so they enter the softmax and change `combined` for real objects on real
pages.

### Measured effect

On the validated phase-1 checkpoint (`tmp/gvprobe/std-ckpt/step1200`, sha256
`8878bab7…c645c`), comparing a page extracted alone against the same page batched with a
longer page:

    max |P delta|                                  1.12e-01
    fret objects changed, of 1162                   623
    plane-count range driving it                    7 to 29

A fret object's representation therefore depends on which other pages happened to share
its batch. The same page can yield different fret predictions depending on its
neighbours.

### Why this matters

- **Correctness.** Inference results become a function of request batching, which is an
  operational detail the caller should not have to control to get stable answers.
- **Reproducibility.** Any evaluation that batches pages differently reports different
  numbers on identical data.
- **Training.** `h73.training_loop` trains with `batch_pages=4`, so the training
  representation is itself a batch-padded one.

## Why production avoids it for now

`guitar_vision.inference.GuitarFretModel` runs exactly one page per forward, and
`infer_batch` raises `MultiPageBatchError` for anything longer. This is a **guard, not a
fix**: it makes results well defined by fixing the batch composition at one page, which
is the convention every validated number was measured under.

## Why it is not fixed in the integration change

Excluding padded planes changes the phase-1 representation. That invalidates
`8878bab7…c645c` and every number measured against it — 0.5899 score-disjoint, the
per-fret table, the controls — so it must be its own change with its own phase-1
retraining and re-validation.

## The fix

Padded planes must be excluded from the tile normalisation. The tile count per page is
available at collation time, so the mask can be constructed without new inputs.

### Required changes

1. **Carry a per-page tile mask through `collate`.** `collate` already computes
   `object_counts`; it needs the equivalent for planes — a boolean `(batch, tiles)` mask
   marking real tiles, or a per-page tile count from which it can be derived.

2. **Mask before the softmax in `roi_crops`.** Accept the tile mask and apply it as an
   additive `-inf` (or a large negative) bias on the tile axis before `softmax`, so
   padded tiles receive zero weight:

   ```python
   score = values.std(dim=-1, keepdim=True)          # (batch, objects, tiles, 1)
   score = score.masked_fill(~tile_mask[:, None, :, None], float("-inf"))
   weights = torch.softmax(score * 8.0, dim=2)
   ```

   A finite large negative value is preferable to `-inf` if any downstream code
   differentiates through `weights`, to avoid `0 * inf = nan`.

3. **Handle the degenerate case.** If every tile in a row were masked the softmax would
   be uniform-over-nothing. With a real page present this cannot happen, but the mask
   construction should assert at least one real tile per object.

4. **Make the tile count independent of the batch.** After masking, `combined` must not
   depend on `tiles`. This is the property to test, not the implementation.

### Acceptance criteria

The fix is correct when, within numerical tolerance (say `1e-5` on `P`):

    representation(page A alone) == representation(page A batched with page B)
    representation(page B alone) == representation(page B batched with page A)
    for every page in the corpus, and for batch sizes 1, 2, 3, 4

and when the existing fret metrics are unchanged for a one-page forward, since a
one-page batch has no padding.

### Tests to flip

- `tools/guitar-vision/python/tests/test_batch_invariance_known_bug.py`:
  `test_representation_is_batch_invariant` is currently `xfail(strict=True)`. When the
  fix lands, this test starts passing, `strict=True` turns that into a failure, and the
  marker must be removed. `test_bug_is_still_present_and_measured` must be deleted or
  inverted at the same time.
- `test_production_inference.py::test_batch_invariance_bug_is_real_through_the_public_api`
  asserts the bug is present and must be updated.

### Follow-on work this unblocks

Once `P` is batch-invariant:

1. `GuitarFretModel.infer` may batch pages for throughput, and `infer_batch`'s
   `MultiPageBatchError` can be relaxed.
2. Phase 1 can be retrained under the corrected crop, and phase 2 re-run on the new
   representation.
3. The re-validated numbers must be re-measured; they will differ from 0.5899 and the
   difference is expected, not a regression.

## What must not happen

- Do not fix this and re-run only phase 2. A corrected `roi_crops` changes what phase 1
  learns, so phase 1 must be retrained for the comparison to mean anything.
- Do not relax the one-page guard before the invariance test passes.
- Do not treat a one-page evaluation as evidence that batching is safe.
