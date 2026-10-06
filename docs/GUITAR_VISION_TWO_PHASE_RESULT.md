# Two-phase fret training: materialised and verified end to end — CASE A

## Verdict

**Two-phase training is validated.** The recipe was turned into a serialisable
checkpoint and driven from real image input, and the end-to-end model reproduces the
static-matrix result.

    end-to-end (image -> backbone -> frozen encoder -> roi_projection -> fixed stats -> head)
      train          0.9984
      same-score     0.6601
      score-disjoint 0.5899   (233/395)
      Wilson 95%     [0.5407, 0.6373]
      lift vs chance +0.5165      lift vs the joint run +0.5595

    cached-matrix vs end-to-end logits   max|delta| 0.000e+00   agreement 1.000000

Every pixel control collapses to chance: normal 0.5899, blank 0.0532, wrong ROI 0.0684,
pixel ablation 0.0608. The rescue depends on the correct fret pixels.

## 1. Phase-1 checkpoint

    path      tmp/gvprobe/std-ckpt/step1200/state.pt
    sha256    8878bab7a6e890cc121e8a33d3d3aad8982569ef66d58dbafff27afeab6c645c
    variant   FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED
    step      1200
    config    pages 40, batch_pages 4, lr 3e-3, jitter 0.35, seed 11, image 256,
              max_objects 128, hidden 192, layers 4, roi_grid 8, roi_context 1.6

This is the exact checkpoint that produced the cached `P` used at `d35d3e2964`; the
script asserts the variant before doing anything and refuses to continue otherwise.

## 2. Live P equals the cached P

    cached      (1162, 192), fit 614 / same-score 153 / score-disjoint 395
    live        (1162, 192)
    max|delta|  0.000e+00
    row order   identical (labels, scores, pages and rows all match)

Exact, not approximate.

## 3. Exact train-only statistics

Recomputed from the live frozen model over the 614 fit rows:

    mu      [-1.6415, 2.1944]
    sigma   [0.00973, 0.03143], median 0.01557
    FIT Z   max |per-feature mean|     = 5.21e-05
            max |per-feature std - 1| = 1.03e-04
    held-out rows used: no

Both figures reproduce the established values to the digit.

## 4–5. Phase-2 learning curve

| step | fit | (reference) | same-score | (reference) |
|---|---|---|---|---|
| 200 | 0.4691 | 0.4642 | 0.2941 | 0.2941 |
| 400 | 0.7231 | 0.7166 | 0.4444 | 0.4575 |
| 700 | 0.8990 | 0.8958 | 0.6209 | 0.5882 |
| 1200 | 0.9772 | 0.9772 | 0.6536 | 0.6340 |
| 2000 | 0.9951 | 0.9951 | 0.6601 | 0.6471 |
| 3000 | **0.9984** | 0.9984 | **0.6601** | 0.6601 |

Fit tracks the reference to within 0.005 throughout. Same-score differs slightly because
the head here is the model's own `fret_classifier`, initialised as part of a full
`build()` rather than as a standalone `Linear`, so its draw order differs. The reference
curve was preregistered as a reference, not a target, and nothing was adjusted.

`frozen tensors that moved: none` — the head is the only thing that changed.

## 6–15. Terminal evaluation

    train               0.9984
    same-score          0.6601
    score-disjoint      0.5899   (233/395)
    chance              0.0734
    Wilson 95%          [0.5407, 0.6373]
    lift vs chance      +0.5165
    lift vs joint run   +0.5595
    1-digit             0.6744  (n=215)
    2-digit             0.4889  (n=180)
    distinct predicted  20 of 20

**Per-fret** — every class learned, none at zero:

| fret | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| | 13/21 | 20/29 | 10/17 | 15/23 | 17/23 | 12/21 | 15/19 | 14/23 | 14/19 | 15/20 |

| fret | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|
| | 17/24 | 5/12 | 5/18 | 8/17 | 6/15 | 7/19 | 9/20 | 9/19 | 12/22 | 10/14 |

**Per-string** — no collapse: 0.250 (n=8), 0.696, 0.582, 0.444, 0.475, 0.624, 0.735.

Top confusions are genuine near-neighbour digit errors (`pred13->true12`, `pred13->true15`,
`pred3->true1`), not a constant predictor. The full confusion matrix is in
`tmp/gvprobe/two-phase.json` under `p7_terminal.tables.confusion_matrix`.

## 16. Pixel controls

| control | accuracy |
|---|---|
| normal | **0.5899** |
| blank page | 0.0532 |
| wrong ROI | 0.0684 |
| pixel ablation (box interiors only) | 0.0608 |

All three interventions collapse to chance. Removing the glyphs alone is enough to
destroy the result, so the rescue is genuinely pixel-driven.

## 17. Cached versus end-to-end

    max |logit difference|      0.000e+00
    prediction agreement        1.000000

Exact. This is the test that would have caught a serialisation or inference error, and it
is the reason the artifact can be trusted rather than merely measured.

## 18. Reload determinism

A fresh interpreter loads `tmp/gvprobe/two-phase-ckpt/phase2.pt` with no cached matrix,
runs deterministic evaluation, and reports:

    mean_sha   dd612413b7b0842a...   sigma_sha  088ac03e703426a5...
    count      614.0
    prediction_sha 097508c7f4efdb6a...
    score-disjoint  0.589873   (233/395)

Every hash matches the parent process, including the held-out predictions themselves.

## 19. Unrelated heads

Bit-identical to the phase-1 checkpoint on all 1162 objects:
`object_type True, string True, tile True`. Expected, since every non-fret parameter is
frozen and the shared token path is untouched.

## 20. Old-checkpoint compatibility

Behaviour is selected by the **variant recorded in the checkpoint config**, and the
statistics live in the variant's own module type, so nothing can be applied by accident:

- A checkpoint with no phase-2 statistics cannot be silently standardised. Strict
  `load_state_dict` of the phase-1 model into the two-phase variant is **refused** with
  a missing-keys error, verified in the run, rather than defaulting `mu`/`sigma`.
- An unconfigured two-phase model is the identity: defaults are `mu = 0`, `sigma = 1`,
  so its fret path matches the unstandardized variant to within the 1e-6 epsilon. A test
  asserts this.
- The two module types even have different buffer schemas — phase 1 carries
  `(count, mean, m2)`, the accumulating estimator; phase 2 carries
  `(count, mean, sigma, eps)`, the fixed one — so a blind copy fails loudly.
- Phase 1's cumulative statistics are **deliberately discarded** on load, with the reason
  recorded in the report: they are the lagging estimator the static experiment identified
  as the fault.

## 21. CASE A

## 22. Two-phase training: VALIDATED

Both halves of the recipe now exist as artifacts and were verified separately: phase 1 is
a checkpoint that exists and is unchanged; phase 2 is a checkpoint that loads on its own
and reproduces, from raw images, the result that was measured on a cached matrix.

## 23. Production integration plan

Proposed, **not merged** — awaiting approval.

**Training**

```
Phase 1  existing joint training, unchanged. Its job is only to produce a usable
         representation; the fret head's quality is irrelevant to it.
Phase 2  freeze backbone, RoiEncoder, roi_projection and every non-fret head
         reinitialise fret_classifier = Linear(192, 26)
         extract P over the phase-1 train pages, one page per forward
         mu, sigma = exact per-feature moments over the FIT fret rows only
         train fret_classifier alone, production recipe (AdamW 3e-3, wd 0.01,
         clip 1.0, cosine over the phase-2 horizon, 25% warmup)
```

**Module and location** — `FrozenTrainStatsStandardizer`, between `roi_projection` and
`fret_classifier`, as `TWO_PHASE_STANDARDIZED` already implements it. Buffers only, no
learnable parameters, no RNG consumed at construction.

**Statistics lifecycle** — computed once at the start of phase 2 from training rows,
installed via `set_statistics`, and never updated in any mode. `forward` does not consult
`self.training`, so there is no train/eval discrepancy and no path by which an evaluation
batch could reach `mu` or `sigma`.

**Checkpoint serialisation** — format `guitar-vision-two-phase-v1`: full model
`state_dict` (statistics ride along as buffers), plus `statistics`, `source_phase1`
(path, sha256, variant, step), `split`, `config`, `phase2_step` and `phase2_recipe`. The
source digest makes provenance auditable.

**Inference loading** — build the variant from the checkpoint's own `config`, then
`load_state_dict`. No cached matrix, no external statistics file.

**Deterministic evaluation** — one page per forward. This is load-bearing, see the
batching finding below.

**Compatibility and fallback** — old checkpoints keep their own variant and behaviour;
there is no defaulting of statistics and no implicit standardisation. A future loader
should branch on the recorded variant and refuse an unknown one.

**Automating phase 2** — a full training command should run phase 1 to its terminal step,
then automatically enter phase 2 on that checkpoint: freeze, extract, compute statistics,
reinitialise the head, train, and write a two-phase checkpoint. Phase 2 is cheap (head
only, on a cached matrix) so it need not be optional.

### Two blockers to resolve before merging

1. **`ablate_roi_pixels` had a coordinate bug.** Boxes are normalised `[0, 1]`, not pixel
   indices, and the helper treated them as pixels — flooring every coordinate to 0 or 1
   and ablating **2 pixels out of 1,507,328**. It is fixed (now ablates 102,218 pixels,
   6.8% of the page), and the fixed control behaves correctly. **Every ablation number
   reported before this fix is void**, including the repeated claim that "pixel ablation
   is identical to normal, so the fret pixels carry no weight". That conclusion survives
   on the blank and wrong-ROI controls, which are coordinate-independent and always
   showed chance-level performance — but the ablation was not evidence for it and should
   not be cited as such.

2. **The fret representation is not batch-invariant.** `roi_crops` builds a tile
   dimension from `plane_count // batch` and softmaxes a per-tile score across it;
   `collate` pads pages to the batch's maximum plane count; plane counts in this corpus
   range from **7 to 29 per page**. The padded planes therefore enter the softmax and
   change the combined crop:

       max |P delta| chunk 1 vs chunk 3   1.12e-01
       objects moved of 1162              623

   An earlier version of this verification compared a one-page cached matrix against a
   three-page inference path and reported a 16.7 logit divergence — that was this effect,
   not a serialisation bug. The artifact is pinned to one page per forward, which is the
   convention the cached matrix used and the only one under which an object's
   representation depends on its own page alone. **A production inference path that
   batches pages will feed the head a different representation** unless padded planes are
   excluded from the tile softmax. That is a real model bug worth fixing separately; it
   was deliberately not fixed here because it would invalidate the phase-1 checkpoint and
   this phase forbids architecture changes.

## 24. Further architecture experiments

**None needed for the two-phase recipe.** It is validated end to end, the representation
and head are both sufficient, and the controls are clean.

The one open engineering item is the padded-tile softmax in `roi_crops`, which is a
correctness bug rather than a research question: it makes a fret's representation depend
on its batch neighbours. Fixing it would require retraining phase 1, so it should be
decided as an engineering change, not folded into this line of experiments.

## Artifacts

    checkpoint   tmp/gvprobe/two-phase-ckpt/phase2.pt
                 sha256 c6d42e6b11cb4b232bac185ab241f2dcbad1bf2495d96f2de7e132be06605466
    report       tmp/gvprobe/two-phase.json
    reload probe tmp/gvprobe/two-phase.reload.json

## Reproduce

```bash
python3 -u tools/guitar-vision/h80_two_phase_materialize.py
```

Phase 1 is never retrained. The head-only phase 2 runs in seconds on the cached matrix,
and the end-to-end verification is one forward per page.

## What was not done

Phase 1 was not rerun. No representation parameter was unfrozen. No cumulative, EMA or
batch statistics. Epsilon, learning rate, schedule, architecture, ROI geometry and data
were all left alone. Shared tokens were not restored. Held-out statistics were never
computed and held-out was read once, at the preregistered terminal step. No production
file was merged. 118 tests pass.
