# Why a linear probe learns from P and the production linear head cannot

## Verdict: CASE B — input conditioning is binding, not the optimiser

Not capacity, not the representation, not the optimiser recipe. The head was being
handed features whose scale was ~22× too small for the step budget, and Adam's
bounded step size meant the weights could not travel far enough in 1200 steps.

The whole representation path was frozen and `P` extracted once, then a single
`Linear(192 -> 26)` trained on those fixed vectors under four configurations that
differ in exactly one factor at a time. Total cost: seconds, not hours.

## 1–2. Extraction reproduces the probe

    checkpoint  tmp/gvprobe/frz-ckpt/step1200  (FROZEN_RANDOM_ROI_ENCODER)
    P           (1162, 192), persisted to tmp/gvprobe/P_frozen_step1200.npz
    split       fit 614 / same-score 153 / score-disjoint 395
    probe       reproduced score-disjoint 0.4506  (expected 0.4506)

Exact match, so the extraction is sound and everything below is measured on the same
vectors the successful probe saw.

## 1. The successful probe, exactly as written

From `d8_stage_probes.flat_probe(kind="linear")`:

| | |
|---|---|
| input | `z = (x - mean_fit) / (std_fit + 1e-6)`, per feature |
| statistics | from the **614 fit rows only** |
| classes | 20 |
| init | `torch.nn.Linear(192, 20)` default, `torch.manual_seed(11)` |
| optimiser | `Adam(lr=1e-3)`, default betas and eps |
| weight decay | **none** |
| loss | `CrossEntropyLoss()`, mean |
| schedule | **none** — constant for all 3000 steps |
| grad clipping | **none** |
| steps / batch | 3000 / 64, sampled with replacement |

What production gives the same layer:

| | |
|---|---|
| input | **raw `P`** — no centering, no scaling |
| classes | 26 |
| optimiser | `AdamW(lr=3e-3, weight_decay=0.01)` |
| schedule | cosine, warmup 300 of 1200 |
| grad clipping | 1.0 |
| steps / batch | 1200 / ~77 fret objects (measured: 76.7) |
| loss | `F.cross_entropy(ignore_index=-100)` over fret objects, plus 2 other terms |

## 3–9. The 2×2

| input | optimiser | train | same-score | score-disjoint |
|---|---|---|---|---|
| raw | production | 0.2687 | 0.1830 | 0.1671 |
| raw | probe | 0.3257 | 0.1830 | 0.1823 |
| standardised | production | 0.8046 | 0.5033 | 0.4203 |
| standardised | probe | 0.8599 | 0.5686 | **0.4506** |

The bottom-right cell reproduces the successful probe's score-disjoint **to the digit**,
0.4506. That cell differs from the probe only in using 26 outputs instead of 20.

    conditioning effect, same optimiser (production)   +0.2532
    optimiser effect, same input (raw)                  +0.0152
    optimiser effect, same input (standardised)         +0.0304

**Conditioning moves held-out ~17× more than the optimiser does.** Swapping the whole
optimiser recipe is worth 1.5 points; centering and scaling the input is worth 25.3.

## 10–11. Feature scale statistics and the mechanism

| | raw `P` | standardised |
|---|---|---|
| feature mean, abs average | **0.11041** | 0.00000 |
| feature mean range | −0.701 to 1.666 | ~0 |
| feature std, median | **0.04520** | 1.0000 |
| feature std range | 0.0211 to 0.1251 | ~0 |
| median std/abs(mean) | **0.727** | ~3.7e6 |
| near-zero-variance features | 0 | 0 |
| effective rank | **5.74** | **9.77** |
| PC1 variance | **56.07%** | 37.79% |
| PC10 variance | 94.12% | 89.92% |
| condition number (2-norm) | 3.92e6 | 2.29e6 |
| feature norm, median | 3.505 | 12.574 |

**The mechanism, quantitatively.** `Linear(192, 26)` initialises weights uniformly in
±1/√192 = ±0.0722. With raw `P`, each feature is ~0.045, so the initial logits are
about √192 × 0.0722 × 0.045 ≈ **0.045** — a scale at which the 26 classes are
essentially indistinguishable. Adam moves each weight by roughly `lr` per step
regardless of gradient magnitude, so producing a *unit* logit response requires a
weight change of about 1/0.045 ≈ 22. At `lr = 3e-3` that is ≈ **7,400 steps**. The
budget was **1,200**.

Standardizing makes each feature unit-variance, so the requirement drops to
1/3e-3 ≈ **333 steps** — comfortably inside budget. This single ratio explains why
the probe worked at 3000 steps, why production failed at 1200, and why the
optimizer barely matters: the failure is a *distance* problem, and no optimizer
choice shortens the distance.

Two independent confirmations:

- **Global scaling alone** — divide by one scalar (the median std), no centering —
  recovers most of the benefit (same-score 0.4052 vs raw 0.1830, standardised 0.5033).
  So it is predominantly the ~22× **scale deficit**, not the offset, that binds.
  Per-feature scaling then adds a further ~10 points by fixing the unequal feature
  scales, visible as effective rank rising 5.74 → 9.77 and PC1 falling 56% → 38%.
- **Condition number barely moves** (3.92e6 → 2.29e6), so this is not a
  near-singularity story. Calling it "bad conditioning" in the spectral sense would
  be wrong; it is a bad *input scale*.

## 12. Gradient and logit diagnostics

| run | step | grad norm | train loss | train acc | logit std | pred entropy | distinct |
|---|---|---|---|---|---|---|---|
| raw, production | 1 | 0.545 | 3.259 | 0.046 | **0.143** | 3.248 | 4 |
| raw, production | 1200 | 0.369 | 2.560 | 0.269 | 2.185 | 2.862 | 17 |
| raw, probe | 3000 | 0.403 | 2.432 | 0.326 | **0.695** | 2.790 | 18 |
| standardised, production | 1 | 1.818 | 3.417 | 0.029 | 0.551 | 3.113 | 25 |
| standardised, production | 1200 | 0.986 | 0.882 | 0.805 | 1.989 | 1.617 | 20 |
| standardised, probe | 3000 | 0.817 | 0.693 | 0.860 | 2.396 | 1.366 | 20 |

Three signatures of the raw-input failure, all consistent with the distance account:

1. **Gradients are ~2.5× smaller** on raw input (0.37–0.40 vs 0.82–0.99).
2. **Logits never reach usable scale.** At 3000 steps the probe optimiser on raw `P`
   reaches logit std 0.695; the production optimiser on standardised input is already
   at 1.989 after 1200. The raw runs are still climbing when the budget ends.
3. **Predictions never commit.** Entropy stays at 2.79–2.86 against ln(26) = 3.258,
   and the 1200-step raw run ends predicting only 17 distinct classes. Standardized
   runs reach 20 with entropy 1.37.

No exploding logits and no vanishing-to-zero gradients — gradient norms stay healthy in
every cell. The head is moving, just far too slowly, which is what the 22× distance
prediction says.

## 13. Is representation non-stationarity causal? Partly, and it is second-order

Comparing the frozen-`P` raw run against the real 1200-step run, same head, same
optimiser, same recipe, the only difference being that `P` was moving:

    train          0.2687 (frozen)  vs 0.0600 (real)   +0.2087
    score-disjoint 0.1671 (frozen)  vs 0.0557 (real)   +0.1114

So a moving target costs real accuracy and is genuinely part of the problem — but
freezing `P` alone still only reaches 0.1671 held-out, nowhere near transfer. Both
effects are real; conditioning is the larger one (+0.2532 vs +0.1114).

This also refines the previous campaign's conclusion. The "collapse tracks
trainability" finding is consistent with this: a non-stationary target forces the
trained stage to move fast, and the stages downstream of a badly scaled input cannot
follow within budget.

## 14. Is standardisation causal? Yes

+0.2532 score-disjoint with the optimizer held fixed, +0.2683 with the probe optimizer
held fixed, and the standardized + probe cell landing exactly on the probe's 0.4506.
Selection of the normalization used train fit and same-score only; score-disjoint was
recorded but never chosen on.

## Which normalization (selected without held-out)

Rule fixed in advance: maximise same-score accuracy, tie-break on train accuracy.

| candidate | same-score | train | *score-disjoint (reported only)* |
|---|---|---|---|
| raw | 0.1830 | 0.2687 | *0.1671* |
| **train-stat standardised** | **0.5033** | **0.8046** | *0.4203* |
| global scale only | 0.4052 | 0.6775 | *0.3671* |
| LayerNorm(192) affine | 0.2288 | 0.4430 | *0.2304* |
| LayerNorm(192) non-affine | 0.2288 | 0.4430 | *0.2304* |

Selected: **per-feature train-statistic standardization**. LayerNorm is much weaker —
normalizing each 192-dim object by its *own* statistics is the wrong operation here,
because the informative variation is small relative to each row's norm, so per-row
statistics inject noise instead of removing scale.

## 15. CASE B

## 16. Smallest justified next full experiment

**Not** a new architecture. One affine transform between `roi_projection` and
`fret_classifier`, in the experimental variant only:

> Standardize `P` per feature as `z = (x - mu) / max(sigma, eps)`, with `mu` and `sigma`
> accumulated over training data only, stored as buffers, frozen at inference.
> Nothing else changes: same crop, encoder, projection, classifier, loss, schedule,
> optimiser, seed.

Why this and nothing larger:

1. It is the only factor with a measured effect (+0.2532 held-out), and the effect is
   17× the next largest.
2. It is one affine map, adding 2×192 parameters as buffers, zero compute.
3. It is inference-safe and involves no held-out data.
4. It is falsifiable: predicted held-out ≈ 0.42 if `P` stays as measured, and the
   prediction is stated before the run so it can fail.

Deliberately **not launched.** D9 permits it only once the cause is unequivocal and no
model-selection choice remains, and the choice of *which* variant to pair the fix with
is still open: `P` was measured on the **frozen-encoder** checkpoint, where
`roi_projection` had already collapsed to effective rank 5.98. With the encoder
trainable again, `P` would be differently conditioned to begin with, so the 0.42
prediction is a direction, not a guarantee.

## 17. Resource profile of that experiment

Identical to the two runs already completed, since the change is a buffer add:

    wall clock    ~6.4 h CPU (19–21 s/step at 1200 steps), measured not estimated
    peak RSS      ~7.0 GB, observed
    checkpoints   every 50 steps, ~40 MB each
    disk          ~1 GB of checkpoints
    process       one, nice 10, no MPS
    launch        via an os.setsid() launcher -- the caller's process-group cleanup
                  killed two earlier attempts, which looked like OOM kills

Health-checked at 200/400/700/1200 with `memory_pressure`, `vm_stat` and `df`, per the
standing protocol.

## What was not done

No production file was modified — `git diff` against the previous commit over
`guitar_vision/python/` is empty, and 76 tests pass. No architecture run was launched.
Held-out was never used to select anything.

## Method notes

The head-only batch size was measured from the corpus rather than assumed: 76.7 fret
objects per 4-page batch, matching what `fret_classifier` actually received.

Two bugs in this diagnostic were caught and fixed rather than reported as findings. My
first verdict used an absolute 0.90 train-accuracy threshold and so labelled a clean
result "CASE D — none reproduce the probe"; the threshold was arbitrary, and D4's 0.3257
was in fact the informative number showing the probe's memorisation came from
standardization, not the optimizer. That prompted adding the fourth cell of the 2×2,
without which conditioning and optimizer would have remained confounded — the
successful probe used standardized input *and* the probe optimizer, so only the
complete grid separates them.

## Reproduce

```bash
python3 -u tools/guitar-vision/h77_head_only_p.py
```

Seconds after the first extraction. The persisted `P` dataset is reused on later runs.