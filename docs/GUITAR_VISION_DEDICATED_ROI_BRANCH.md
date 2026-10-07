# Dedicated raw-ROI fret branch: CASE A

## Verdict

**The raw-ROI signal integrates without loss and without touching anything else.**

| | score-disjoint | train | same-score |
|---|---|---|---|
| established ROI-only probe (reproduced here) | **0.9342** | 1.0000 | 1.0000 |
| the model's own dedicated head | **0.9266** (366/395) | 1.0000 | 1.0000 |
| current production two-phase fret path | 0.5899 | 0.9984 | 0.6601 |

The integrated branch lands within 0.008 of the probe it was built to reproduce, and
**+0.3367** over the production fret path.

    Wilson 95% [0.8965, 0.9484]
    1-digit 0.9256 (215)   2-digit 0.9278 (180)
    predicted classes 20 of 20

Pixel controls, on the crop:

| control | accuracy |
|---|---|
| normal | **0.9266** |
| blank page | 0.0709 |
| wrong ROI | 0.0785 |
| pixel ablation | 0.0709 |

## 1. Provenance of the crop

Before any measurement, the canonical `guitar_vision.roi.sample_roi` was compared
numerically against `h1_direct_roi_probe.sample_roi`, the implementation that produced the
0.934 result:

    max |delta| on fret objects = 0.000e+00

Same box, same 1.6x context, same `linspace(-1, 1, 32)` grid, same bilinear `grid_sample`
with `align_corners=False`, same per-plane addressing. The extraction is the validated one,
not a reimplementation.

The established probe was then re-run on the crops the **model itself** computes, with its
own recipe:

    probe params 95,700 | train 1.0000 | same-score 1.0000 | score-disjoint 0.9342
    1-digit 0.9395   2-digit 0.9278

Exact. Both the input and the probe reproduce, so everything below is interpretable.

## 2. Architecture

`guitar_vision.roi.RoiFretCnn`, reproduced exactly from `d3_roi_probe.RoiProbe` and
`d8_stage_probes.cnn_probe`:

```
Conv2d(1, 32, 3, padding=1) -> BatchNorm2d(32) -> ReLU
Conv2d(32, 64, 3, padding=1) -> BatchNorm2d(64) -> ReLU
Conv2d(64, 128, 3, padding=1) -> BatchNorm2d(128) -> ReLU
AdaptiveAvgPool2d(1) -> Flatten -> Linear(128, 26)
```

Global average pooling over **both** axes is kept even though it discards the
left-to-right order of a two-glyph fret. That is what the validated probe did, and
two-digit still scored 0.9278 with it, so changing it here would break the comparison for
no measured reason.

## 3. Parameter count

    96,474 at 26 classes  (95,700 at 20, which is the probe's own figure)
    under the 0.1M budget; the model's total is 3,359,012

Deliberately not enlarged. The point is to reproduce a measured capability, not to explore
capacity.

## 4. Training configuration

    3000 steps, batch 64, Adam lr 1e-3, no weight decay, no schedule
    seed 11, the existing 614 / 153 / 395 split, no data or geometry change

The probe's own recipe, so the comparison is like for like. Score-disjoint was read once,
at the terminal step. The shared model is the validated phase-1 checkpoint, held fixed;
only `roi_head` trains.

## 5–7. Learning curve and terminal

| step | train acc |
|---|---|
| 200 | 0.8274 |
| 400 | 0.9756 |
| 700 | 1.0000 |
| 1200 | 1.0000 |
| 2000 | 1.0000 |
| 3000 | 1.0000 |

    train-instance      1.0000
    same-score unseen   1.0000
    score-disjoint      0.9266   (366/395)

## 8–9. Correct and interval

    366 / 395   chance 0.0734
    Wilson 95%  [0.8965, 0.9484]

## 10–11. Digit split

| | accuracy | n |
|---|---|---|
| 1-digit | 0.9256 | 215 |
| 2-digit | 0.9278 | 180 |

No two-digit collapse. Against the raw-ROI reference of 0.9395 / 0.9278, one-digit is
0.014 lower and two-digit is exact. Nothing here suggests an input mismatch.

## 12. Per-fret

Every one of the 20 classes is learned, none near zero:

| fret | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| | 18/21 | 29/29 | 16/17 | 19/23 | 22/23 | 21/21 | 17/19 | 22/23 | 17/19 | 18/20 |

| fret | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|
| | 22/24 | 12/12 | 18/18 | 12/17 | 14/15 | 18/19 | 19/20 | 17/19 | 22/22 | 13/14 |

Per-string: string 1 is 23/23, strings 2–6 are 0.925–0.956, and string 0 is 2/8 — but
string 0 has only 8 held-out objects, all of them on the one score discussed below.

## 13. Confusion matrix

Full matrix in `tmp/gvprobe/dedicated-roi.json` under
`r4_training.terminal.confusion_matrix`. The top confusions are all `pred1->trueX`
(5, 4, 3, 2, 2, 2, 2, 2) — one predicted class against many truths, which is the signature
of a single page being unreadable rather than a systematic digit confusion.

## 14. The error is one score, and that score is a rendering outlier

This is the most useful thing in the run. **All 29 errors come from one held-out score.**

| | |
|---|---|
| 19 of 20 held-out scores | **1.0000 each** |
| `synthetic-train-20260928052` | 3/32 = 0.0938 |
| errors attributable to that score | 29 of 29 |

Excluding it, the branch is **363/363 = 100%** on score-disjoint.

That score is not like the others:

| | failing score | every other score |
|---|---|---|
| median box width | **8.5 px** | **44.8 px** |
| median box height | **9.1 px** | **39.2 px** |
| page ink fraction | 0.034 | 0.077 |
| planes on the page | 7 | median 20, range 15–29 |

A ~5x smaller box. The crop is 1.6x the box, so the branch is being asked to read a glyph
a few pixels tall, upsampled. `tmp/gvprobe/roi_scale_compare.png` shows eight crops from
the failing score above eight from a normal score: the failing glyphs are small, blurry and
low-contrast, the normal ones are crisp. A human struggles with the top row too.

**So the residual error is corpus scale variation, not an integration defect.** The branch
is not scale-invariant, and one held-out score sits far outside the training scale
distribution. This is worth its own investigation, but it is not a reason to change the
architecture, and it is not caused by adding the branch to the model.

## 15. Unrelated-head regression

    object_type  bit-identical to the shared baseline
    string       bit-identical
    tile         bit-identical

on every page checked. This is expected and is the point of the design: the branch reads
`images` and `boxes`, which are data, so the fret loss has **no path** to the backbone,
the samplers or the token path. A test asserts the zero gradient rather than trusting the
observation.

## 16. Versus the 0.5899 production baseline

    +0.3367 score-disjoint
    366/395 against 233/395
    all 20 classes learned against a constant-predictor collapse

## 17. Versus the previous ~0.93 ROI-only probe

    0.9266 against 0.9342, a difference of 0.008

Within run-to-run variation for two differently initialised heads on the same crops. The
capability survived integration intact.

## 18. CASE A

## 19. Remaining accuracy bottleneck

**One held-out score rendered at ~5x smaller scale than the rest.** Nothing else. Nineteen
of twenty scores are perfect, both digit lengths are equal, and every class is learned.
The residual is a corpus-rendering outlier, and the branch's weakness is scale, not
integration.

## 20. Should the dedicated fret CNN replace the current fret path?

**Scientifically, yes — and it should be prepared for production, not merged
automatically.**

The case is strong: +0.3367 over the current path, controls that collapse to chance,
unrelated tasks bit-identical, 96k parameters, and a structural guarantee that it cannot
damage anything else. The simplest architecture it implies is exactly the one measured:

```
shared model          object_type, string, tile  (unchanged)
dedicated raw-ROI CNN fret                       (new)
```

Do **not** fuse it with the shared fret representation. There is no measured reason to, and
fusing is what `roi26` did — adding a collapsed token to a good representation — which is
the mistake this line of work exists to undo.

Two things to settle first:

1. **Scale.** The branch fails on the 8.5 px score. A production branch should either be
   trained with scale variation or be given a crop that normalises glyph size. The
   train/dev-only scale-stress benchmark below now supplies that evidence: the branch has
   no resolution margin, so scale handling is the prerequisite for any production switch.
2. **Batch invariance.** The dedicated branch uses `sample_roi`, which addresses each
   object's own plane and is therefore batch-invariant, unlike `roi_crops`. That is now
   asserted explicitly (`test_raw_roi_branch_is_batch_invariant`); the public API still
   enforces one page per forward because the shared forward is unchanged.

## Artifacts

    experimental head  tmp/gvprobe/dedicated-roi-ckpt/head.pt  (head weights only, not loadable as production)
    production         tmp/gvprobe/dedicated-roi-production.pt  (format guitar-vision-dedicated-roi-v1)
    verify report      tmp/gvprobe/dedicated-roi-production-verify.json
    scale stress       tmp/gvprobe/scale-stress-train-dev.json  (train/dev only)
    report      tmp/gvprobe/dedicated-roi.json
    figure      tmp/gvprobe/roi_scale_compare.png

## Reproduce

```bash
python3 -u tools/guitar-vision/h82_dedicated_roi_branch.py
```

Crops are extracted once through the model's own path, then the head trains in seconds.

## Production integration

The branch is now served through the production loader as
`guitar-vision-dedicated-roi-v1` (`DEDICATED_ROI_FRET`), assembled without retraining by
`tools/guitar-vision/h83_dedicated_roi_production.py`:

- shared phase-1 model from `tmp/gvprobe/std-ckpt/step1200/state.pt` (SHA
  `8878bab7…`) supplies the backbone and the unrelated heads;
- the frozen h82 head supplies the 96,474-parameter `RoiFretCnn`;
- the production artifact is `tmp/gvprobe/dedicated-roi-production.pt` (SHA
  `89093b66c19c75261056b74b1e574f4ca6e3de7be0b7cbf57c8fc30274701ce8`).

Golden reproduction through the public loader: train 1.0, same-score 1.0,
score-disjoint 0.9266 (366/395), cached-vs-production logits delta 0.0, head
bit-identical, reload deterministic, unrelated heads (`object_type`, `string`, `tile`)
bit-identical to phase-1 on train pages, full-model inference one page per forward.
Batch invariance is asserted for the raw-ROI branch itself (identical crops and logits
across five batch compositions with 7–29 planes per page); the conservative one-page
contract stays because the shared forward still carries the padded-plane softmax bug.

Pixel causality through the production API: blank 0.0709, wrong-ROI 0.0785,
pixel-ablation 0.0709 vs normal 0.9266.

## Scale stress (train/dev only, characterization, not tuning)

`tools/guitar-vision/scale_stress_benchmark.py` degrades the 32x32 production crops
(downsample + blur + contrast, fixed lattice 1.00→0.25) and scores only FIT and
SAME-SCORE rows. No held-out row enters. At native resolution fit and same-score hold at
1.0; every degraded level collapses both to 0.06–0.10 (chance). The branch has no
resolution margin: this is consistent with the known concentration of all 29 held-out
errors on the single tiny-glyph score, and it is the evidence for training with scale
variation or normalising glyph size before any production switch. That step is out of
scope here: no retraining, no tuning, held-out read once at the terminal step.

## What was not done

The production fret path was not replaced: the dedicated artifact is versioned separately
(`guitar-vision-dedicated-roi-v1`) and the two-phase default is unchanged. The
padded-plane softmax was not fixed. Geometry, data, split and augmentation are unchanged.
No synthetic data. The CNN was not enlarged. No shared token was fused in. Nothing was
tuned from score-disjoint held-out, which was read once at the terminal step. Piano and
unrelated Corranzo paths were not touched.
