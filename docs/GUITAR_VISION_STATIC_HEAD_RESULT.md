# Post-hoc static-representation fret head: CASE B

## Verdict

**A production `Linear(192 -> 26)` with the production optimiser reaches 0.5873
score-disjoint when `P` is static and exactly standardised.** That matches the
diagnostic probe's 0.5722 on the same matrix, and it is 8.0x chance.

    standardised, static P   fit 0.9984   same-score 0.6601   score-disjoint 0.5873 (232/395)
    raw, static P            fit 0.2736   same-score 0.1634   score-disjoint 0.1696  (67/395)
    chance                                                        0.0734

For comparison, every joint end-to-end run:

| run | train | score-disjoint |
|---|---|---|
| `shared` @1200 | 0.4172 | 0.0684 |
| trainable no-token | 0.0678 | 0.0582 |
| frozen-encoder no-token | 0.0600 | 0.0557 |
| standardized joint run | 0.0587 | 0.0304 |
| **static standardised head** | **0.9984** | **0.5873** |

The representation is usable and the head is capable. The fault is in joint
optimisation, not in `RoiEncoder`, not in `roi_projection`, and not in the classifier.

## 1. Extraction reproduces the probe

    checkpoint      tmp/gvprobe/std-ckpt/step1200  (the cf7a8c4096 terminal state)
    raw P           (1162, 192), cached to tmp/gvprobe/P_std_step1200.npz
    split           fit 614 / same-score 153 / score-disjoint 395
    probe           0.572152 reproduced, expected 0.5722

Exact. Everything below is measured on that same matrix.

## 2. Exact train-only statistics

Computed from the 614 fit rows only. No cumulative accumulator, no EMA, no batch
statistics, no held-out rows.

    mu      [-1.6415, 2.1944]
    sigma   [0.00973, 0.03143], median 0.01557
    FIT Z   max |per-feature mean|      = 5.21e-05
            max |per-feature std - 1|  = 1.03e-04
            near-zero-variance features = 0

`Z` is unit-scale on the fit rows to within 1e-4, which is the property the cumulative
standardizer failed to deliver (it was 3.69x off). Note the sigma magnitudes: 0.0097 to
0.0314, median 0.0156 — a **6.4x spread across features**, and about 3x smaller than the
0.0452 that raw `P` showed at the frozen-encoder checkpoint. Against a head initialised
at +/-1/sqrt(192) = +/-0.0722, raw `P` here needs a weight change of roughly
1/0.0156 = 64 to produce a unit logit response.

## 3–4. Learning curves

Score-disjoint was not computed at any intermediate checkpoint; only FIT and same-score,
both training-side.

**RAW P, production recipe**

| step | fit acc | fit loss | same-score | logit std | distinct |
|---|---|---|---|---|---|
| 200 | 0.0814 | 2.9934 | 0.0588 | 1.175 | 2 |
| 400 | 0.1026 | 2.9630 | 0.0654 | 1.843 | 5 |
| 700 | 0.0879 | 2.9131 | 0.0915 | 2.407 | 2 |
| 1200 | 0.1450 | 2.8168 | 0.1307 | 2.872 | 9 |
| 2000 | 0.2704 | 2.7005 | 0.2026 | 3.163 | 15 |
| 3000 | **0.2736** | 2.6702 | **0.1634** | 3.238 | 16 |

**STANDARDISED P, production recipe**

| step | fit acc | fit loss | same-score | logit std | distinct |
|---|---|---|---|---|---|
| 200 | 0.4642 | 2.1003 | 0.2941 | 1.064 | 20 |
| 400 | 0.7166 | 1.2439 | 0.4575 | 1.673 | 20 |
| 700 | 0.8958 | 0.5882 | 0.5882 | 2.222 | 20 |
| 1200 | 0.9772 | 0.2477 | 0.6340 | 2.868 | 20 |
| 2000 | 0.9951 | 0.1279 | 0.6471 | 3.313 | 20 |
| 3000 | **0.9984** | 0.1074 | **0.6601** | 3.428 | 20 |

The standardised head is already at 0.4642 fit by step 200 — where the raw head is at
0.0814 — and reaches 20 distinct predicted classes immediately. The raw head only
reaches 0.2736 fit after 3000 steps, still climbing when the budget ends, exactly as the
1/std distance account predicts.

## 5–11. Terminal

| | raw | standardised |
|---|---|---|
| fit train | 0.2736 | **0.9984** |
| same-score unseen | 0.1634 | **0.6601** |
| score-disjoint | 0.1696 | **0.5873** |
| correct / 395 | 67 / 395 | **232 / 395** |
| Wilson 95% | [0.136, 0.210] | **[0.538, 0.635]** |
| lift over chance | +0.0962 | **+0.5139** |
| lift over `shared` (0.0684) | +0.1012 | **+0.5189** |
| lift over standardized joint (0.0304) | +0.1392 | **+0.5569** |

## 12. Digit split

| | 1-digit (n=215) | 2-digit (n=180) |
|---|---|---|
| raw | 0.2093 | 0.1222 |
| standardised | **0.6744** | **0.4833** |

Two-digit remains harder, consistent with the pixel-density finding (the production box
occupies the same ROI fraction for one digit as for two, so a two-digit fret gets about
half the samples per glyph). But both are far above chance, so two-digit rendering is not
a blocker.

## 13. Per-fret

**Standardised** — every one of the 20 classes is learned, none at zero:

| fret | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| | 13/21 | 20/29 | 11/17 | 15/23 | 17/23 | 12/21 | 15/19 | 14/23 | 14/19 | 14/20 |

| fret | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|
| | 17/24 | 5/12 | 5/18 | 8/17 | 6/15 | 7/19 | 9/20 | 7/19 | 12/22 | 11/14 |

**Raw** — the constant-collapse signature survives: fret 1 gets 26/29 while classes 2, 3,
4, 6, 11, 14, 15, 16, 18 sit at exactly 0.

## 14. Predicted-class count

Raw: 14 distinct classes on held-out, 16 on train. Standardised: **20 on both** — the
full vocabulary, no collapse.

## 15. Confusion matrices

Full matrices are in `tmp/gvprobe/static-head.json` under `tables.{raw,standardised}.confusion_matrix`.
The standardised errors are genuine near-neighbour digit confusions, not a constant
predictor; the raw errors are dominated by `pred1->trueX`.

## 16. Gradient and logit diagnostics

| | raw | standardised |
|---|---|---|
| weight norm | 31.589 | 18.877 |
| logit std | 3.238 | 3.428 |
| prediction entropy | **2.934** | **0.412** |
| distinct (train / held) | 16 / 14 | 20 / 20 |

Prediction entropy is the clearest separator: 0.412 against ln(26) = 3.258 for the
standardised head — it commits — versus 2.934 for the raw head, which never does. Note
the raw head's *larger* weight norm: it grew its weights further and still produced
nearly flat predictions, which is the distance problem in one number.

## 17. P was static

`P` was extracted once into `tmp/gvprobe/P_std_step1200.npz` and every head trained
against that array. No forward pass touches the model after extraction, so
non-stationarity is not merely controlled but **impossible**: the head's input cannot
change by construction. Upstream parameters were additionally frozen
(`requires_grad_(False)`) during extraction.

## 18. 20-vs-26 vocabulary audit

    production classes   26  = 0..24 fret numbers, index 25 = NO_FRET
    probe classes        20  = 0..19
    fret values present  0..19
    never positive       20, 21, 22, 23, 24, 25

`20..24` are valid fret numbers that never occur in this corpus; `25` is `NO_FRET` and is
a target only for non-fret or padded slots, which the fret loss masks out with
`ignore_index=-100`. So **6 of 26 logits are always negative** during training.

## 19. 20-class diagnostic

Same static standardised matrix, same recipe, head restricted to 20 outputs:

    fit 0.9984   same-score 0.6601   score-disjoint 0.5899

Against the 26-class head's 0.5873, the vocabulary penalty is **0.0026** — about a
quarter of one percent, and smaller than the difference between the diagnostic probe
(0.5722) and this head (0.5873) in the other direction. **The six unused logits are not a
measurable problem** and should be left alone.

## 20. CASE B

Raw fails, standardised succeeds. And it goes further than CASE B requires: the
standardised static head **matches the diagnostic probe's own ceiling** (0.5873 vs
0.5722), so the production classifier is not merely "capable of learning", it is as good
as the probe that was used to argue the representation was usable.

## 21. Is non-stationarity causally established?

**Strongly implicated, not isolated.** The contrast is:

    static P  + exact statistics  -> 0.5873
    moving P  + lagged cumulative -> 0.0304

Two things differ between those rows, so this experiment alone cannot apportion them.
What it *does* establish is decisive for the framing: **the representation and the head
are both sufficient**, so the joint run's failure cannot be a representation defect or a
head-capacity defect. The remaining fault is in the joint optimisation loop.

Isolating non-stationarity from statistics lag would need a run with exact statistics on
a *moving* `P`, which does not exist. It should not be claimed until measured.

## 22. Is scale causally established?

**Yes, twice, independently.**

- This experiment, static `P`: raw 0.1696 → standardised 0.5873, **+0.4177**, with the
  head, optimiser, data and budget all held fixed.
- The earlier head-only diagnostic at `ca400d984e`, a different static `P`: raw 0.1671 →
  standardised 0.4203, **+0.2532**, with the optimiser fixed.

Two different representations, two different magnitudes, same direction and same order of
effect. Feature scale is causally required for this head.

## 23. Is a two-phase schedule justified?

**Yes — and this experiment is effectively its phase-2 half, already measured to work.**

Take a representation produced by joint training (here the `cf7a8c4096` terminal state,
whose `P` probes at 0.5722), freeze it, compute exact train-only `mu`/`sigma`, and train
the fret classifier on the static features. That is exactly what was run, and it produced
0.5873 score-disjoint from a joint run that itself scored 0.0304.

Notably phase 1 does **not** need a working fret head: the joint run's `P` was already
good while its head was failing, so phase 1's job is only to produce a usable
representation.

## 24. Exact next full experiment

A **two-phase training schedule**, specified here and deliberately not launched:

> **Phase 1** — the existing joint run, unchanged, to convergence at 1200 steps. Its
> output is the representation; the fret head's quality is irrelevant to phase 1.
>
> **Phase 2** — freeze backbone, `RoiEncoder` and `roi_projection`; recompute exact
> train-only per-feature `mu`/`sigma` from the fit rows; reinitialise `fret_classifier`
> as `Linear(192 -> 26)`; train it alone on the frozen representation with the production
> optimiser recipe.

Predicted score-disjoint **≈ 0.59**, from the measurement above. The prediction is stated
before the run so it can fail.

Two honest caveats to carry into it:

1. The 0.5873 was measured against the *same* 614 fit rows used to compute `mu`/`sigma`.
   In a production phase 2 that is still correct — those statistics are training
   statistics — but the head sees features standardised with statistics derived from its
   own training set, which is the intended behaviour and not a leak, since no held-out row
   is involved.
2. Phase 2 discards whatever the joint head learned. That is deliberate: the joint head
   never fit, so there is nothing to preserve.

Resource profile: phase 1 as measured (~6–8 h CPU), phase 2 trivial by comparison — head
only on a cached matrix, the same cost as this diagnostic.

## Reproduce

```bash
python3 -u tools/guitar-vision/h79_static_head.py
```

Cached `P` is reused on later runs, so repeats take seconds.

## What was not done

No production file was modified. No backbone, `RoiEncoder` or `roi_projection` training.
No cumulative or batch statistics. No momentum. No geometry, data or augmentation change.
No full model run was launched. Score-disjoint was read once, at the preregistered 3000th
step, and no checkpoint was chosen from it. No 6–10 hour job.
