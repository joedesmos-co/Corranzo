# Where score-disjoint fret information disappears

## Question

The frozen 1200-step `shared` checkpoint learns training fret appearance (41.7%) and
transfers at 6.84% against a 7.34% chance baseline. Raw `FINAL_ROI` pixels classify
the same held-out scores at 93%. The information is in the crops. This asks **which
stage of the production visual path destroys it**, by measuring information content at
each stage with the frozen model and no gradients anywhere.

## Nothing was trained

`tmp/gvprobe/lc-run/step1200/state.pt`, loaded and `eval()`, every parameter
`requires_grad_(False)`. No stage was fine-tuned. Every number below comes from a
probe fitted on 614 rows and read out on 395 untouched rows.

## Stages

| | stage | what it is | dim |
|---|---|---|---|
| A | raw `FINAL_ROI` pixels | production ROI sampler on the plane | 32×32 |
| B | stride-1 feature ROI | production `roi_crops`, before any encoder | 12ch × 8×8 = 768 |
| C | `RoiEncoder` output | immediately after `RoiEncoder` | 32 × 8 = 256 |
| D | fused fret token | literally the input to the production fret head | 192 |
| E | production logits | `heads["fret"](D)`, reference only | 26→20 |

D is captured by wrapping the production fret head's own `forward`, so it is that
head's input rather than a reconstruction of it.

### Stage C carries an honesty caveat

`FretVariantModel` builds a `RoiEncoder` only when `kind != "shared"`. **The frozen
checkpoint is `shared` and has no trained `RoiEncoder`.** C is therefore an
*untrained*, fixed-seed `RoiEncoder` applied to B.

The asymmetry matters and cuts one way only: if random-C still supports the
classification then a trained C could too, so **high C exonerates the encoder
architecture**. Low C does **not** convict it, because a trained encoder may recover
what a random one scrambles. C is used to rule the encoder out, never to rule it in.

## Protocol, fixed before any held-out number was read

One split, one seed, one optimiser, one budget, one readout family, applied
identically to every stage. No per-stage tuning; no held-out result used to select
anything.

    fit      614 rows   first 80% of each of the 40 train scores
    B        153 rows   last 20% of those same 40 scores  (unseen instance, seen score)
    C        395 rows   all 20 score-disjoint held-out scores
    seed 11, Adam lr 1e-3, batch 64, 3000 steps, no early stopping

Readouts: template NN (L2-normalise, class centroid over fit rows — zero learned
parameters); linear `d→20`; MLP `d→256→256→256→20`. A uses the established 2-D probe
unchanged (three conv-BN-ReLU blocks 32/64/128, global average pooling, linear 20) so
P3 is a real control.

| stage | probe params (MLP/CNN) | linear params |
|---|---|---|
| A | 95,700 (CNN) | — |
| B | 333,588 | 15,380 |
| C | 202,516 | 5,140 |
| D | 186,132 | 3,860 |

## P3 positive control

    A, CNN probe, score-disjoint = 0.9342   (previously established 0.9316)

Reproduces. Later stages are interpreted.

An independent from-scratch reimplementation of the raw-pixel template NN gives
**0.9949** on score-disjoint, so the zero-parameter baseline on stage A is at least as
strong as the CNN. The corpus is synthetic and rendered with one font, so glyph
appearance is near-identical across scores; that is precisely what makes the A→D
collapse interpretable, since every stage sees the same rendering.

## P4 information retention curve

| stage | readout | train-instance | same-score | score-disjoint |
|---|---|---|---|---|
| **A** pixels | template NN | 1.0000 | 1.0000 | **1.0000** |
| **A** pixels | CNN | 1.0000 | 1.0000 | **0.9342** |
| **B** stride-1 crop | linear | 0.9984 | 0.8954 | **0.7899** |
| **B** | MLP | 0.9984 | 0.8301 | 0.7570 |
| **B** | template NN | 0.7736 | 0.4967 | 0.4785 |
| **C** encoder out | linear | 0.9984 | 0.6797 | **0.6354** |
| **C** | MLP | 0.9984 | 0.6078 | 0.5443 |
| **C** | template NN | 0.5049 | 0.3660 | 0.3266 |
| **D** fused token | MLP | 0.9821 | **0.1765** | **0.0633** |
| **D** | linear | 0.5554 | 0.2288 | 0.0684 |
| **D** | template NN | 0.3371 | 0.2353 | 0.0684 |
| **E** production logits | — | 0.4169 | 0.4183 | 0.0633 |

Chance on the score-disjoint split is 0.0734. Stage E reproduces the production
number, which validates the whole extraction: D fed through the frozen head gives back
0.0633 against the 0.0684 recorded in training.

Successive losses of score-disjoint accuracy: **A→B −14.4, B→C −15.5, C→D −56.7
points.** The degradation is progressive, but D is the decisive single break.

## 1-digit vs 2-digit, score-disjoint

| stage | 1-digit (n=215) | 2-digit (n=180) |
|---|---|---|
| A | 0.9395 | 0.9278 |
| B | 0.7907 | 0.7167 |
| C | 0.5907 | 0.4889 |
| D | 0.0698 | 0.0556 |
| E | 0.0744 | 0.0500 |

Two-digit is worse than one-digit at every stage, which is what the pixel-density
measurement predicted: the production box spans the same fraction of ROI width for one
digit as for two, so a two-digit fret gets about half the samples per digit. The gap
widens as information is lost (A: 1.2 points, C: 10.2 points).

## P5 feature-separability control

Template NN, score-disjoint: **A 1.0000 → B 0.4785 → C 0.3266 → D 0.0684.**

Class identity is progressively destroyed. At B, linear (0.7899) beats the parameter-
free NN (0.4785) by 31 points, so a large part of B's fret information is present but
needs nonlinear decoding — the "information exists but needs decoding" case. By C the
NN has fallen below linear but linear is still 0.6354. At D the NN is at chance, and
so is a 186k-parameter MLP: **at D the identity is simply gone**, not merely hard to
read.

## P6 pixel causality

Probes fitted on **normal** fit rows only, then read out on intervened held-out rows,
so a drop is caused by the representation and not by a weaker readout.

| stage | cos(blank) | acc(blank) | cos(wrong ROI) | acc(wrong ROI) |
|---|---|---|---|---|
| A | 0.952 | 0.071 | 0.924 | 0.099 |
| B | 0.968 | 0.058 | 0.976 | 0.061 |
| C | 0.994 | 0.048 | 0.996 | 0.076 |
| D | 0.743 | 0.078 | 0.339 | 0.035 |

Every stage collapses to chance when the pixels are removed, so every stage is
genuinely pixel-driven — consistent with the earlier finding that production logits
depend on pixels at 1200 steps.

D is the informative row. It is the **most** pixel-sensitive stage — cosine similarity
to the normal representation falls to 0.339 under a wrong ROI, by far the largest shift
anywhere — while carrying the **least** transferable fret identity. D's dependence on
pixels is therefore carrying position and layout, not digit identity, which is what
`geometry_projection(boxes)` and the multi-scale shared sampler in `shared_tokens`
would predict.

## P7 score identity — a clean negative

On train scores only: 30 scores fit, 10 unseen train scores evaluated, 30-way.

| stage | score-identity accuracy | chance |
|---|---|---|
| B | 0.0000 | 0.0333 |
| C | 0.0047 | 0.0333 |
| D | 0.0233 | 0.0333 |

At or below chance everywhere. **Score/style entanglement is not the mechanism.** D
encodes training-*instance* identity (MLP 0.9821) but neither transferable fret
identity nor score identity. It is memorising, not stylising.

## P8 verdict

**CASE 2 — the shared token/fusion path destroys fret identity.** With the caveat that
B and C are already degraded before the final break.

| case | reading |
|---|---|
| 1: A high, B 90%+, C collapses | no — B is 0.7899, C is 0.6354 (not chance, and C is untrained so cannot convict the encoder) |
| **2: A/B/C retain, D collapses** | **yes — D is the first stage at chance, and the only one failing even on same-score instances (0.1765)** |
| 3: all stages fine, head bad | no — D is not fine |
| 4: A high, B collapses | no — B retains 0.7899 |

The most striking single number is not D's 6.33% on score-disjoint but its **17.65% on
same-score unseen instances**. A representation that cannot classify a new fret in a
score it has already been trained on is not a representation of fret. E confirms the
head is not the problem in isolation: it is reading a vector that has already lost the
information.

## P9 does `roi26` bypass the collapse stage? **No.**

`fret_experiments.py:411`:

```python
fused = self.roi_projection(encoded.flatten(-2)) + tokens
out["fret"] = self.fret_classifier(fused)
```

`roi26` **adds** the shared token to the ROI encoding. It does not route around the
measured bottleneck; it feeds the bottleneck into the head as an additive term whose
own score-disjoint accuracy is 6.84% and whose same-score accuracy is 17.65%.

This retroactively explains an otherwise puzzling result: `roi26` has been measured
transferring no better than `shared` despite reading a stage (C, 0.6354) that is ten
times better than the token. Adding a good representation to a collapsed one does not
remove the collapse. Every prior `roi26` result is contaminated by the term this
diagnostic identifies, which is why re-running it as-is could not have answered the
question.

`roidigits` has the identical additive term at line 420 and is contaminated the same
way.

## P11 smallest justified architecture experiment

Not a new architecture. **Take the existing `roi26` variant and remove the `+ tokens`
term**, so the fret head reads the dedicated ROI branch alone:

```python
fused = self.roi_projection(encoded.flatten(-2))   # tokens dropped
out["fret"] = self.fret_classifier(fused)
```

Why this is the minimum:

1. It deletes one term rather than adding a module.
2. Its input is exactly stage C, measured at 0.6354 score-disjoint with an *untrained*
   encoder — a floor, not a ceiling, since a trained encoder is what production would
   use.
3. It is the only change that removes the measured bottleneck from the head's input
   while keeping everything that already works (stride-1 crop, width-preserving
   encoder, production sampler).
4. It is directly falsifiable: if score-disjoint fret accuracy does not exceed the
   6.84% baseline with the token removed, then the collapse is upstream of the token
   and the A→B and B→C degradations become the next target.

Deliberately **not** done here: production architecture is unchanged, and no training
was run. This section specifies the experiment; it does not authorise it.

## Bugs caught rather than reported as findings

- `p_all` was shadowed by the B/C/D loop, so stage A's per-digit breakdown was
  silently computed from stage D's predictions — which is why it first printed at
  chance (0.0698) while A's headline read 0.9342. Renamed to `p_stage`; the corrected
  numbers are 0.9395 / 0.9278.
- P7 indexed eval labels into the *fit* score list, giving `-1` for every eval row and
  an accuracy of exactly 0.0000 — a broken measurement that looked like a strong
  finding.
- The extractor reset its store after the normal pass, discarding the only
  representations the retention curve is reported from.
- Stage A's template NN reading exactly 1.0000 was treated as suspect and verified by
  an independent reimplementation (0.9949) rather than reported as-is.

## Reproduce

```bash
python3 -u tools/guitar-vision/d8_extract_stages.py \
  --records datasets/guitar-vision/synthetic/train/records \
  --views datasets/guitar-vision/synthetic/train/views \
  --checkpoint tmp/gvprobe/lc-run/step1200/state.pt \
  --out tmp/gvprobe/stages.npz

python3 -u tools/guitar-vision/d8_stage_probes.py \
  --stages tmp/gvprobe/stages.npz \
  --checkpoint tmp/gvprobe/lc-run/step1200/state.pt \
  --out tmp/gvprobe/d8-probes.json
```
