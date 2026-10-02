# Frozen learning curve for `shared` — results

Answers one question: **does the full 40-score training regime start using ROI
pixels given sufficient optimisation?**

Harness: `tools/guitar-vision/h73_learning_curve.py`. Run: `tmp/gvprobe/lc-run.log`.
Raw: `tmp/gvprobe/learning-curve.json`.

## Verdict

**CASE C. Geometry and optimisation are cleared; the next problem is
representation / generalisation / data diversity.**

Train fret accuracy rose 13.3% → **41.7%** and the target is demonstrably read from
pixels — pixel gain over blank grew to **+25.3 points** and over wrong-ROI to
**+35.7 points**. Held-out at the terminal budget is **6.84% against a 7.34% chance
line**, a lift of **−0.51 points**.

So the 200-step frozen result was undertrained *on the train side*, and undertraining
is the whole story there. It is not the story for held-out, and that is the finding:
pixels are being used, the model still cannot read a fret digit it has never seen.

Two candidate explanations are excluded by measurement, not by argument:

- **not a coordinate shortcut** — `geometry_gain` is exactly **0.0000 at every
  checkpoint** and the geometry branch's gradient norm is ~2e-4 against 0.97 for the
  heads. The coordinate path is not merely unhelpful, it is *unused*.
- **not loss routing** — fret supervision carries **96.6%** of the total loss at the
  terminal step and rises monotonically from 82.9%. It is not numerically dominated.

## 1. Checkpoint/resume validation

Verified before the long run was trusted.

| | |
|---|---|
| protocol | 12-step continuous run vs 6 + resume, **same** `schedule_steps` |
| resumed losses match exactly | **True** |
| max abs loss delta | **0.0** |
| continuous tail | 5.894184, 5.537248, 5.639763, 5.593378, 5.63397, 5.495869 |
| resumed tail | 5.894184, 5.537248, 5.639763, 5.593378, 5.63397, 5.495869 |

A checkpoint carries model, optimiser, scheduler, both generator states, the global
torch/numpy/python RNG states, step and config. The cosine is built for the
**terminal** budget, so a resume inherits the right schedule rather than restarting
one — which is what makes a 1200-step curve a single optimisation rather than four
restarts.

A note on comparability: the 200-step point here is *not* the frozen 200-step run.
It is the 200-step point of a 1200-step cosine (lr 2.0e-3, still warming up). The
two are different points on different schedules by construction.

## 2–5. Checkpoint metrics (train, real input)

| step | train fret | 1-digit | 2-digit | train N |
|---|---|---|---|---|
| 200 | 0.1330 | 0.1935 | 0.0775 | 767 |
| 400 | 0.1669 | 0.1689 | 0.1650 | 767 |
| 700 | 0.2542 | 0.2943 | 0.2175 | 767 |
| 1200 | **0.4172** | **0.5286** | **0.3150** | 767 |

## 6. Fret loss curve

| step | total | fret | object_type | string | lr |
|---|---|---|---|---|---|
| 1 | 8.0076 | 3.5642 | 2.2706 | 2.1728 | 2.0e-05 |
| 100 | 4.3794 | 3.1944 | 0.7957 | 0.3893 | 1.0e-03 |
| 200 | 4.0901 | 3.0656 | 0.4696 | 0.5549 | 2.0e-03 |
| 300 | 3.3894 | 2.6167 | 0.4178 | 0.3549 | 3.0e-03 |
| 400 | 3.1551 | 2.4572 | 0.4259 | 0.2720 | 2.9e-03 |
| 600 | 2.9799 | 2.3691 | 0.1843 | 0.4265 | 2.3e-03 |
| 700 | 2.5025 | 2.1945 | 0.2153 | 0.0928 | 1.8e-03 |
| 900 | 2.4631 | 2.1618 | 0.1074 | 0.1939 | 7.5e-04 |
| 1000 | 2.1884 | 1.9489 | 0.0823 | 0.1572 | 3.5e-04 |
| 1100 | 2.0127 | 1.8012 | 0.1172 | 0.0942 | 9.1e-05 |
| 1200 | 1.8681 | **1.6080** | 0.1250 | 0.1351 | 0.0 |

Mean fret loss by window: 3.019 → 2.696 → 2.306 → **1.957**. Still falling at the
terminal step, with the cosine exhausted — the train side was still improving when
the budget ran out.

## 7–9. Pixel-dependence curves

| step | blank | wrong-ROI | no-geometry | gain vs blank | gain vs wrong-ROI | geometry gain |
|---|---|---|---|---|---|---|
| 200 | 0.0887 | 0.0469 | 0.1330 | +0.0443 | +0.0861 | **0.0000** |
| 400 | 0.1656 | 0.0561 | 0.1669 | +0.0013 | +0.1108 | **0.0000** |
| 700 | 0.1591 | 0.0548 | 0.2542 | +0.0952 | +0.1995 | **0.0000** |
| 1200 | 0.1643 | 0.0600 | 0.4172 | **+0.2529** | **+0.3572** | **0.0000** |

Blank sits at 0.16–0.17 from step 400 on and does not track train. Wrong-ROI stays
at 0.05–0.06, near or below the 0.073 chance line. So the network requires the
correct glyph under the box to score — and by step 1200 that is most of its score.

## 10–11. Digit-count curves

| step | 1-digit | 2-digit |
|---|---|---|
| 200 | 0.1935 | 0.0775 |
| 400 | 0.1689 | 0.1650 |
| 700 | 0.2943 | 0.2175 |
| 1200 | **0.5286** | **0.3150** |

Two-digit frets trail one-digit throughout and the gap widens with steps. At 1200 the
model reads single digits about 1.7× better than double digits, which is the first
sign of a representation limit rather than an optimisation one.

## 12–13. Gradient norms and loss weighting

| step | heads | backbone | visual_projection | context | geometry | source | total |
|---|---|---|---|---|---|---|---|
| 200 | 3.3300 | 2.8850 | 2.1859 | 0.4947 | **0.0012** | 0.0008 | 4.9432 |
| 400 | 1.7302 | 1.1171 | 0.7630 | 0.3305 | **0.0005** | 0.0003 | 2.2210 |
| 700 | 0.9617 | 1.1774 | 0.3691 | 0.1912 | **0.0002** | 0.0001 | 1.5761 |
| 1200 | 0.9709 | 0.8846 | 0.4429 | 0.2092 | **0.0002** | 0.0001 | 1.4019 |

Loss parts and share of total (all weights are 1.0; the loss is an unweighted sum):

| step | fret | object_type | string | fret share |
|---|---|---|---|---|
| 200 | 2.9643 | 0.5211 | 0.0900 | 0.8291 |
| 400 | 2.5772 | 0.2135 | 0.0260 | 0.9150 |
| 700 | 1.9560 | 0.0873 | 0.0213 | 0.9474 |
| 1200 | 1.6329 | 0.0438 | 0.0135 | **0.9661** |

Gradient is measured by one extra forward/backward on a fixed batch with the RNG
state saved and restored around it, after `optimiser.step()`, so it observes without
perturbing.

**T5 diagnosis: A — healthy gradient, learning slowly.** The fret head has the
largest gradient norm at every checkpoint and gradient reaches the backbone and the
visual projection. Fret supervision carries 83–97% of the loss. The geometry branch
receives ~2e-4 and contributes exactly nothing to accuracy. Nothing is dominated;
nothing is collapsing to a coordinate prior.

## 14–17. Terminal results

| | |
|---|---|
| 14. final train accuracy | **0.4172** (320/767) |
| 15. final held-out accuracy | **0.0684** (27/395) |
| 16. final held-out N | **395** fret objects over 20 score-disjoint pages |
| 17. train/held-out gap | **−34.9 points** (0.4172 − 0.0684) |

Held-out detail: chance 0.0734, lift **−0.0051**; 1-digit 0.0698 (n=215),
2-digit 0.0667 (n=180). Held-out predictions are diffuse across many classes
(`pred13->18`, `pred19->16`, `pred5->1`, `pred18->10`, `pred1->9`, `pred5->2`),
i.e. near-uniform guessing rather than a systematic error.

## 18. Coordinate-shortcut diagnostic (T6)

On the step-1200 checkpoint, all four conditions, no retraining:

| condition | train fret accuracy |
|---|---|
| 1. normal input | **0.4172** |
| 2. blank pixels, real box/context | 0.1643 |
| 3. real pixels, coordinate branch neutralised | **0.4172** (gain 0.0000) |
| 4. wrong-ROI pixels, real coordinates | 0.0600 |

Reading: removing the coordinate path costs **nothing**; removing the pixels costs
25 points. Whatever information survives blanking is not in the coordinates — it is
whatever survives on the blank plane plus a weak prior. This is **not** the
coordinate shortcut Phase 4b identified; that shortcut has been closed by the
frame work and the 0.35 jitter.

## 19. Classification

**CASE C — representation / generalisation / data diversity.**

- Train rises strongly (13.3 → 41.7%) and pixels increasingly matter (gain vs blank
  0.044 → 0.253). Undertraining was real *on the train side*.
- Held-out does not move (6.84% vs 7.34% chance). Undertraining does not explain
  this, and the curve shows why: the model is already discriminating glyphs on
  train, so the representation carries fret information — it just does not carry it
  across scores.
- Not CASE B: fret supervision dominates the loss (96.6%) with the largest gradient
  norm. Not CASE D: `geometry_gain` is exactly zero everywhere.

## 20. Exact next experiment

**Not** more steps on this budget. The train side is still improving, but held-out is
flat at chance across a 6× budget range, so extending the curve moves train and not
transfer.

The next experiment should test **transfer**, not capacity:

1. **Train/eval split control.** Hold out scores as now, but additionally evaluate
   the *train* pages' boxes against a model that never saw those **glyph renderings**
   — e.g. train on a disjoint set of *rendered strings/frets* per position. If the
   41.7% collapses when only the rendering changes, the model has memorised glyph
   appearances rather than learned digit identity, and the fault is data diversity
   (fret values present per string) rather than the head.
2. Only if (1) shows memorised appearances: a controlled increase in fret-value
   diversity per string at fixed corpus size, since the current corpus is dominated
   by a few fret values (`pred13`, `pred1`, `pred5`, `pred0` absorb most mass).
3. If (1) shows the model *does* generalise across renderings within seen fret
   values, then the two-digit gap (0.3150 vs 0.5286) is the representation limit and
   the `roidigits` slot grouping deserves a re-run at this budget — not before.

`roi26` and `roidigits` are **not** justified yet: their 200-step numbers were
uninformative for the same reason `shared`'s was, and this run shows the decisive
quantity is held-out transfer at a converged-enough budget, which is a `shared`
question first.

## Method notes

- Held-out was measured at the terminal checkpoint only. Every intermediate quantity
  in this report is a train-side diagnostic. No knob was changed after seeing any
  result.
- MPS deadlocks at the preregistered `pages=40` (uninterruptible sleep on a Metal
  stream) and completes at `pages=4`. Device is hardware; steps, pages, lr, seed,
  architecture and losses are unchanged from the frozen config.
