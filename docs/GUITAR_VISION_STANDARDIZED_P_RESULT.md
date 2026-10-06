# FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED: CASE C

## Verdict

**Train fit still fails.** Standardizing `P` before the head did not rescue transfer,
and it did not rescue train fit either. But it did something the three previous runs
did not: **it stopped `roi_projection` from collapsing**, and the reason it failed is
now measured rather than guessed.

| | shared @1200 | no-token | frozen enc | **standardized** |
|---|---|---|---|---|
| train fret | 0.4172 | 0.0678 | 0.0600 | **0.0587** |
| score-disjoint | 0.0684 | 0.0582 | 0.0557 | **0.0304** |
| chance | 0.0734 | 0.0734 | 0.0734 | 0.0734 |

    score-disjoint  0.0304  (12/395)
    Wilson 95%      [0.0175, 0.0523]   -- entirely BELOW chance
    lift vs chance  -0.0430
    vs shared       -0.0380
    vs no-token     -0.0278
    vs frozen-enc   -0.0253

Per S13 this is not judged against the head-only 0.4203. The causal questions were
whether the classifier would fit train better, use pixels, and transfer above the
near-chance runs. It did none of the three.

## The failure, named: cumulative statistics lag the moving target

The standardizer divides by its stored per-feature std. That stored value is a
cumulative average over every training row seen so far. `P` is produced by a *trainable*
`roi_projection` and backbone, so `P`'s scale moved substantially during the run:

| step | cumulative count | stored median std | P's current median std | **lag** | Z's measured std |
|---|---|---|---|---|---|
| 200 | 15,362 | 0.03435 | 0.01255 | **2.74×** | 0.358 |
| 400 | 30,507 | 0.05354 | 0.01375 | **3.89×** | 0.250 |
| 700 | 53,578 | 0.06609 | 0.01449 | **4.56×** | 0.212 |
| 1200 | 92,128 | 0.06047 | 0.01639 | **3.69×** | 0.258 |

`Z` should have per-feature std 1.0. It has **0.258** — the cumulative estimator
over-estimates the current std by 3.69×, so `z` is delivered **3.7× under-scaled**. The
lag grows through training and only partially recovers, because the cumulative average
retains the large-scale early phase while the current distribution has settled at a
much smaller scale.

So the intervention did partially work, and by a measurable amount: the input scale
deficit went from **22×** (raw `P` std 0.0452 against a head initialised at ±0.0722) to
**3.9×** (`z` std 0.258). A unit logit response needs weight travel ∝ 1/std, so the
required step count fell from ~7,400 to ~1,290 — against a budget of 1,200. The run
finished just short of the distance it needed to travel. That is a much more precise
statement than "it did not work".

## What the intervention did fix

Standardizing the head's input also scaled the gradient flowing into `roi_projection` by
1/0.06 ≈ 16×. The consequence is visible, and it is the one genuinely good result here:

| stage | frozen-encoder run | **standardized run** |
|---|---|---|
| B stride-1 ROI probe | 0.7949 | **0.8253** |
| C encoder output probe | 0.6203 | **0.6557** |
| P projection probe | 0.4506 | **0.5722** |
| **P effective rank** | **5.98** | **18.92** |
| **P PC1 variance** | **55.9%** | **20.0%** |
| P median per-feature std | 0.0488 | 0.0164 |

Across all four checkpoints the representation is uniformly healthier than the previous
run. `P`'s effective rank went from 5.98 to 18.92 and its PC1 share from 55.9% to 20.0%
— the rank collapse that the previous two campaigns attributed to "whichever stage is
trainable" **did not happen here**. Every stage probed higher.

So the picture is a clean dissociation: **a better representation that the head still
cannot read.** `P` now probes at 0.5722 score-disjoint, comfortably above the frozen-`P`
0.4506 of the previous run, and the head trained on it still lands at chance.

## Head diagnostics (S9)

| step | classifier grad norm | ‖W‖ | logit std | pred entropy | distinct classes |
|---|---|---|---|---|---|
| 200 | 2.2400 | 2.9583 | 2.173 | 2.886 | 2 |
| 400 | 3.3508 | 4.6951 | 2.995 | 2.819 | **1** |
| 700 | 2.1975 | 5.3046 | 5.637 | 2.936 | 3 |
| 1200 | 0.6558 | 5.5050 | 3.358 | 2.979 | **4** |

Gradient norms are healthy — 2.2 to 3.4, larger than the previous run's 0.37. Logit
scale grew from 2.17 to 5.64. The weights did move: ‖W‖ went 2.96 → 5.51. But prediction
entropy never fell below 2.82 against ln(26) = 3.258, and at step 400 the model predicted
a **single** class for the entire training set. The head moved a long way and still never
committed, which is the signature of an input whose discriminative directions are still
too small relative to its constant offset.

## S18: the standardizer makes no difference at inference

| inference mode | held-out | train |
|---|---|---|
| normal (stored μ/σ) | 0.0304 | 0.0587 |
| **raw bypass** | **0.0734** | 0.0639 |
| center only | 0.0430 | 0.0652 |
| scale only | 0.0506 | 0.0535 |

Every mode is at or below chance, so removing the standardizer does not destroy
performance — there is no performance to destroy. Bypassing it actually scores *higher*
(0.0734 vs 0.0304), which simply means the constant predictor it was making is a worse
constant than the majority class. This is reported as measured; it is not evidence for
or against the intervention.

## Pixel causality (S14)

| control | held-out | 1-digit | 2-digit |
|---|---|---|---|
| normal | 0.0304 | 0.0372 | 0.0222 |
| blank | 0.0734 | 0.1349 | 0.0000 |
| wrong ROI | 0.0430 | 0.0605 | 0.0222 |
| pixel ablation | 0.0304 | 0.0372 | 0.0222 |

Pixel ablation is identical to normal, to four decimals, again. The fret pixels carry
no weight. Train-side the same holds at every checkpoint: real, blank, wrong-ROI and
ablation are within noise of each other.

**Not CASE D.** CASE D is "performance improves without pixel dependence". Performance
did not improve at all, so there is nothing to attribute to a shortcut.

## The constant-prediction collapse has not disappeared (S16)

    per-fret   0:0/21  1:7/29  2:0/17  3:0/23  4:1/23  5:0/21  6:0/19  7:0/23
               8:0/19  9:0/20  10:0/24  11:0/12  12:1/18  13:3/17  14:0/15
               15:0/19  16:0/20  17:0/19  18:0/22  19:0/14

Seven distinct predicted classes across 395 objects — an improvement over three in the
previous run, still constant-dominated: **fret 13 for 210 and fret 1 for 151**. Top
confusions remain `pred13->trueX` spread flat. Per-string is flat, 0.000 to 0.250.

## A note on Z's probe

`Z`'s probe score-disjoint is **identical** to `P`'s at every checkpoint (0.6000,
0.5873, 0.5899, 0.5722). That is expected and worth stating: the diagnostic probe
standardises its own input on fit rows, so it is invariant to any invertible per-feature
affine map. **The probe cannot distinguish `P` from `Z`,** and therefore cannot be used
to judge the standardizer. The scale evidence above comes from the health statistics, not
the probe.

## Verification (S1–S5, S8)

- **Freeze**: bit-identical at all four checkpoints, `max|diff| = 0.0`, 12/12 frozen,
  0 buffers, no still-trainable encoder parameters.
- **Train-only statistics**: `statistics_unchanged_by_evaluation = True` at every
  checkpoint — after running real, blank, wrong-ROI, pixel-ablation, both splits, the
  standardizer's own diagnostics, the S18 ablations and the B/C/P/Z extraction, `count`,
  `mean` and `m2` are bit-identical to their pre-evaluation values.
- **Resume**: losses bit-identical (`max|delta| = 0.0`) *and* `count`/`mean`/`m2` all
  bit-identical with `max|delta| = 0.0`, count 918 on both paths. Checked separately
  because matching losses would not catch a buffer that drifted while the loss rounded
  the same.
- **No `+ tokens`**, head still `Linear(192 -> 26)`, no vocabulary or capacity change.
- **Initial weights bit-identical** to the unstandardized frozen variant — the
  standardizer holds buffers only and consumes no RNG.
- **Resources**: no RESOURCE_PAUSE. Memory stayed 51–75% free, peak RSS 6.9 GB, disk
  35–39 GB free, one `nice`d process, no MPS, `os.setsid()` launcher. 8.14 h at
  ~24 s/step, slower than the previous 6.42 h because of host contention.

## S17: unrelated heads, no regression

Reference is the frozen `shared` @1200 checkpoint.

| head | shared held | standardized held | shared train | standardized train |
|---|---|---|---|---|
| object_type | 0.8910 | 0.9000 | 0.9790 | 0.9831 |
| string | 0.9316 | **0.9620** | 1.0000 | 1.0000 |
| tile | 0.1220 | 0.1159 | 0.1225 | 0.1236 |

`string` improved by 3 points, `object_type` by 1, `tile` is flat and weak in both.

## 37. Remaining bottleneck

**The head still cannot fit the training set (0.0587, 45/767), and the reason is now
measured: `z` is delivered 3.7× under-scaled because cumulative statistics lag a
non-stationary target.**

Two effects remain stacked, and this experiment separated them:

1. **Scale lag, 3.69×.** Cumulative statistics over a drifting `P` over-estimate the
   current std. This is a faithful implementation of the preregistered design — which
   specified cumulative deterministic statistics precisely to avoid a tuned momentum —
   and that design is what fails. Momentum-free does not mean lag-free.
2. **Non-stationarity.** The head-only diagnostic read a *frozen* `P` and reached 0.4203;
   the same recipe on the moving `P` of the previous run reached only 0.1671. That
   0.25 gap is untouched by anything here.

And a third observation that changes the framing: the representation is now *better* than
any previous run at every stage (`P` probe 0.5722, effective rank 18.92). Whatever is
wrong is no longer about the representation's quality.

## 38. Production integration recommendation

**Do not merge.** The variant is worse than `shared` on held-out and no better on train,
and the S18 ablations show the standardizer contributes nothing at inference.

The module itself is production-shaped if the causal story ever lands: buffers only,
train-only updates, bit-identical resume, `float64` Welford, no held-out involvement, and
a fallback question (old checkpoints have no `p_standardizer.*` keys) that would need a
default-initialised branch. But none of that is worth integrating for a variant that
scores 0.0304. Awaiting user approval regardless; nothing here is queued for merge.

## 39. Next experiment

**Not run.** One change, and it is the only thing the evidence points at: make the
normalization statistics track the current distribution with **zero lag**, instead of
lagging it 3.69×.

The tension is real and worth stating plainly. The preregistered design chose cumulative
statistics to avoid introducing a momentum that could only be tuned on held-out. That
reasoning was sound and the design failed anyway, because the target moved faster than
any cumulative estimator tracks. The fix that introduces no hyperparameter at all is
**current-batch statistics**: normalise the valid training rows by their own batch mean
and std. That is exactly unit-scaled at every step by construction, needs no momentum,
and cannot be tuned on anything.

Two things must be settled honestly before running it:

1. **Train/evaluation mismatch.** Batch statistics are only available in training. At
   evaluation the stored cumulative values would be used, and those are exactly the
   lagged ones measured here. The mismatch is bounded — by the terminal step the
   distribution has largely settled — but it must be measured, not assumed.
2. **The non-stationarity gap is untouched.** Even with perfect scaling, the frozen-`P`
   head-only result of 0.4203 versus the previous run's moving-`P` 0.1671 suggests a
   staged schedule (head warm-up on a temporarily frozen representation) is a separate,
   later question. Fixing scale first is right because it is the measured one.

Selection between the two would use train fit and same-score only, never score-disjoint.

## Reproduce

```bash
python3 -u tools/guitar-vision/h78_standardized_p.py \
  --steps 1200 --checkpoints 200,400,700,1200 --save-every 50 --log-every 25 \
  --ckpt-root tmp/gvprobe/std-ckpt \
  --out tmp/gvprobe/standardized-p.json
```