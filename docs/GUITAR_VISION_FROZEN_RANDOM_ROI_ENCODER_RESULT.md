# FROZEN_RANDOM_ROI_ENCODER: yes, encoder training destroys it — and it wasn't the binding constraint

## Verdict: CASE B

Two separate findings, and the first one is a clean causal result while the second
one explains why fixing it changed nothing.

1. **Gradient updates to `RoiEncoder` do destroy transferable fret identity.**
   Freezing every encoder parameter restores stage C from **0.1975 to 0.6203**
   score-disjoint — a 42-point recovery — with its effective rank held between 15.9 and
   22.4 across all four checkpoints instead of collapsing to 3.14.
2. **That was not the binding constraint.** Production held-out moved from 0.0582 to
   **0.0557**. It was at chance before and it is at chance now.

And the reason is the more useful half: **the collapse moved.**

## 1. The freeze held, exactly

| checkpoint | bit-identical | max abs diff | GroupNorm affine drift | conv weight drift | frozen | buffers |
|---|---|---|---|---|---|---|
| 200 | yes | **0.0** | 0.0 (3 groups) | 0.0 (3 convs) | 12/12 | 0 |
| 400 | yes | **0.0** | 0.0 | 0.0 | 12/12 | 0 |
| 700 | yes | **0.0** | 0.0 | 0.0 | 12/12 | 0 |
| 1200 | yes | **0.0** | 0.0 | 0.0 | 12/12 | 0 |

Measured against a freshly seeded build, not asserted. `RoiEncoder` is
Conv2d + GroupNorm + GELU and GroupNorm keeps no running statistics, so there is no
buffer `train()` could have written; with no gradient, AdamW skips every parameter.
The encoder could not have moved by any route.

## 2–8. Probe and health curves, and the collapse in motion

Linear probe, score-disjoint, the `38d6fa7111` protocol unchanged:

| stage | step 200 | step 400 | step 700 | step 1200 | *trainable-encoder run @1200* |
|---|---|---|---|---|---|
| **B** stride-1 ROI | 0.8152 | 0.8152 | 0.7899 | 0.7949 | 0.8076 |
| **E** pre-height-collapse | 0.7241 | 0.7114 | 0.7215 | 0.7063 | — |
| **C** encoder output | 0.6608 | 0.6481 | 0.6380 | **0.6203** | **0.1975** |
| **P** projection output | 0.5316 | 0.5190 | 0.5038 | **0.4506** | 0.1291 |

Effective rank:

| stage | 200 | 400 | 700 | 1200 |
|---|---|---|---|---|
| B | 32.28 | 25.85 | 29.60 | 30.34 |
| E | 24.87 | 24.11 | 26.30 | 27.41 |
| C | 22.44 | 15.86 | 18.78 | **18.93** |
| P | 19.50 | 9.62 | 8.49 | **5.98** |

PC1 share of variance (%):

| stage | 200 | 400 | 700 | 1200 |
|---|---|---|---|---|
| B | 19.0 | 23.0 | 21.3 | 19.2 |
| E | 24.1 | 25.7 | 23.5 | 21.4 |
| C | 15.1 | 22.7 | 18.6 | **19.8** |
| P | 17.1 | 41.2 | 43.7 | **55.9** |

Read the last two rows together. **C is stable** — the frozen encoder holds rank ~19
and PC1 ~20% and its probe drifts only 0.66 → 0.62. **P is collapsing monotonically**
— rank 19.5 → 5.98, PC1 17% → 56%, probe 0.532 → 0.451, degrading at every
checkpoint.

`roi_projection` is the stage that received the gradient this time, and it is the
stage that degenerated. The signature is the same one the trained encoder showed
(PC1 56% against 63%, effective rank 6.0 against 3.1). Pairwise cosine on P drifts
from mean 0.9983 / sd 0.0010 to 0.9580 / 0.0331: the rows fan out along one axis.

## 3. Train-side curve (F1)

| step | fret | 1-digit | 2-digit | blank | wrong ROI | ablation | fret loss |
|---|---|---|---|---|---|---|---|
| 200 | 0.0535 | 0.0000 | 0.1025 | 0.0535 | 0.0535 | 0.0535 | 3.0696 |
| 400 | 0.0639 | 0.0000 | 0.1225 | 0.0652 | 0.0639 | 0.0639 | 3.0197 |
| 700 | 0.0652 | 0.0027 | 0.1225 | 0.0639 | 0.0652 | 0.0652 | 3.0206 |
| 1200 | 0.0600 | 0.0409 | 0.0775 | 0.0639 | 0.0574 | 0.0600 | 3.0051 |

Blank, wrong-ROI and ablation all sit within noise of real at every checkpoint. The
fret loss plateaued near 3.00 from step 200 onward, barely moving in 1000 steps.

## 9–18. Terminal evaluation

    train-instance fret      0.0600  (46/767)
    same-score unseen        0.0654  (10/153)   Wilson [0.0359, 0.1161]
    score-disjoint           0.0557  (22/395)
    chance                   0.0734
    Wilson 95%               [0.0371, 0.0829]   <- contains chance
    lift vs chance           -0.0177
    lift vs shared           -0.0127
    lift vs trainable        -0.0025

Controls: blank 0.0734, wrong ROI 0.0430, **pixel ablation 0.0557 — identical to
normal**, with identical 1-digit and 2-digit splits. Removing every fret glyph from
the page changes the prediction not at all.

Digits: 1-digit 0.0651 (14/215), 2-digit 0.0444 (8/180).

## 19–20. Per-fret and confusion

Only three of twenty classes receive anything, and they are the constant
predictor's residue: fret 1 at 14/29, fret 13 at 7/17, fret 18 at 1/22. All others
exactly 0. Three distinct predicted classes across 395 objects — 13 (258), 1 (121),
18 (16). Top confusions are `pred13->trueX` spread flat across classes.

Per-string is flat: 0.000 to 0.250, no string structure.

## 21. Unrelated heads — still no regression

Reference is the frozen `shared` @1200 checkpoint.

| head | shared train | frozen train | shared held | frozen held |
|---|---|---|---|---|
| object_type | 0.9790 | **0.9860** | 0.8910 | **0.9067** |
| string | 1.0000 | **1.0000** | 0.9316 | **0.9342** |
| tile | 0.1225 | 0.0806 | 0.1220 | 0.0813 |

`object_type` and `string` are unchanged or marginally better. `tile` is lower, as in
the previous run, and is near-useless in `shared` too (0.1220) — a weak head going
slightly weaker, reported rather than buried.

## 22. Causal verdict

**Do gradient updates to `RoiEncoder` destroy transferable fret identity? Yes.**

Freezing the parameters at initialisation holds C at 0.6203 score-disjoint with
effective rank ~19 and PC1 ~20%, where training them produced 0.1975, effective rank
3.14 and PC1 62.6%. Nothing else changed — same module, same shapes, same random
initialisation, same seed, same forward pass, same loss, same schedule, and the
weights verified bit-identical at every checkpoint. That is as clean an attribution
as this setup permits.

**But it was not the bottleneck on production accuracy.** Removing it moved held-out
by −0.0025.

## 23. The collapse mechanism

**Degeneracy tracks trainability, not architecture.** Across the three runs, the
fret objective destroys whichever representation it is allowed to reach:

| run | frozen stages | stage that collapsed | eff. rank | PC1 % | its probe | production held-out |
|---|---|---|---|---|---|---|
| `shared` @1200 | — | the shared token (D) | — | — | 0.0684 | 0.0684 |
| `ROI_ONLY_NO_TOKEN` | — | the encoder (C) | 3.14 | 62.6 | 0.1975 | 0.0582 |
| `FROZEN_RANDOM_ROI_ENCODER` | encoder | `roi_projection` (P) | 5.98 | 55.9 | 0.4506 | 0.0557 |

Freeze any one of them and that stage is preserved while the damage appears in the
next trainable stage. The frozen encoder proved this by construction, and the
progression is not gradual — P's PC1 share goes 17% → 41% between step 200 and 400,
so most of the damage is early, then grinds down.

**And the collapse never produces a fit.** In all three runs production train fret
accuracy stayed at or below 0.0678 while the token-reading heads reached
0.986–1.000 on the same train split. A representation driven to rank 6 by an
objective should at least memorise the training set. This one does not. So the
fret head is not being led anywhere useful — it is failing to learn at all, and the
low-rank degeneracy is a symptom of that rather than a cause.

**`mean(dim=2)` is not the culprit.** With the encoder frozen, `E` (height preserved)
probes 0.7063 and `C` (height collapsed) probes 0.6203. The height collapse costs
**8.6 points**, not 42. It is a real and separate cost, and removing GroupNorm or
changing the pooling now would be chasing a 8.6-point effect while a 42-point one sits
in the optimisation.

## 24. Smallest justified next change

Not the encoder architecture, not `mean(dim=2)`, not GroupNorm, not more data, not a
longer schedule. The evidence puts the next question in the head/projection
optimisation, and there is a sharp discriminator already in hand:

> A diagnostic probe reads **the same `P`** that production reads, and gets 0.4506
> score-disjoint while fitting train at ~1.0. Production's `Linear(192 -> 26)` on that
> same `P` gets 0.0600 on train. Both are linear maps.

So the smallest justified change is to give the fret head what the probe has and
production lacks — a normalised input and a dedicated non-linear readout on `P`,
touching nothing else in the model. The one ingredient the probe uses that production
does not is input standardisation: `d8.standardise` z-scores `P` on fit rows before
the linear layer, and production feeds raw `P` straight into the classifier.

Deliberately **not** run and **not** implemented. `G12` forbids training another
architecture, and the standing instruction for this phase forbids redesigning the fret
branch. Stating the discriminator is the deliverable; running it needs authorisation.

If a normalised dedicated head still cannot fit the *training* set, the failure is in
the loss mixture or the optimiser rather than the representation, and the diagnostic
probe's advantage is a capacity effect (`CASE D`) rather than a conditioning one.

## Method notes

Fresh initialisation. Full-scale configuration imported from `fret_experiments`:
40 train scores, 20 score-disjoint held-out, 256px, 128 objects, hidden 192, 4 layers,
AdamW lr 3e-3, cosine with 25% warmup built for the 1200-step terminal budget, grad
clip 1.0, jitter 0.35, roi grid 8, context 1.6, seed 11, CPU. Training 6.42 h, one
`nice`d process, no MPS. Held-out evaluated at the terminal checkpoint only.

Checkpoints every 50 steps rather than only at the reported four, so a crash or a
resource stop costs at most 50 steps. Checkpointing writes a file and touches no RNG,
optimiser or schedule state, so the trajectory is unaffected.

### Process and code problems hit along the way

- The long run died silently twice at the same point, which looked like an OOM kill
  but was not: the caller's process-group cleanup was reaching the backgrounded job.
  A launcher calling `os.setsid()` fixed it, verified by watching a job survive
  several tool-call boundaries before committing to a 6-hour run. Worth knowing for
  every future long run in this environment.
- `E` was initially sliced to the fret count, but the encoder emits one row per object
  *slot* including padding, so it misaligned against the keep indices.
- `max()` on an empty checkpoint set, and `len()` on a generator.

None of these reached a reported number; all are fixed and covered.

## Reproduce

```bash
python3 -u tools/guitar-vision/h76_frozen_random_roi_encoder.py \
  --steps 1200 --checkpoints 200,400,700,1200 --save-every 50 --log-every 25 \
  --ckpt-root tmp/gvprobe/frz-ckpt \
  --out tmp/gvprobe/frozen-random-roi.json
```