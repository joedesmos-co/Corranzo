# Prereg: ONE bounded native-font augmentation experiment

**Frozen first. This document is written before any training is run.**

## Problem (from the frozen 7-page native-font eval, commit 4d08d83e0c)

tabdigit precision 0.207, recall 0.076, F1 0.111. Per-page tabdigit
precision ranges 0.857 (ode-to-joy) to 0.000 at identical normalised
scale, so glyph appearance per page is the discriminator. The detector
was trained on Palatino-shaped glyphs only.

## Eval sets (both frozen; scored at most once per model)

- **REGRESSION BENCHMARK** — the existing 7-page native-font set
  (`docs/guitar-vision/NATIVE_EVAL_SET.md`, 4 scores). Already used to
  guide development, so it is *not* fresh holdout evidence. Acceptance is
  measured here.
- **RESERVED HOLDOUT** — score-disjoint heldout samples never used in
  any development or selection step, run ONCE after acceptance to check
  the improvement is not benchmark-specific: `pdmx-QmWUU3iiqd6M`
  (validation), `pdmx-QmZ2JSSWForn` (diagnostic) — chosen from splits
  never touched by TRAIN-fit or by the 7-page set. Held-out tab-digit
  counts and pages recorded before scoring.

## TRAIN-only material

Scores from the `train` split with tab-text joins. The two tuned-on
scores (`pdmx-QmTxoAbitsi9`, `pdmx2-QmekQbhC1yAP`) are EXCLUDED from
training pages so the controlled-render regression stays a genuine
holdout for the model. Training draws from the remaining train-split
tab-bearing scores plus `guitar-ode-to-joy`-style heldout *etudes that
carry no overlap with the eval set*. Final sample list is recorded in the
out dir manifest before training.

## Fonts (all local, no downloads)

Genuine distinct serif families present on this machine:
`Times`, `Times New Roman`, `Georgia`, `Baskerville`, `Charter`,
`Hoefler Text`, `Palatino` (control), `Liberation Serif`, `DejaVu Serif`,
`PT Serif`. Nine non-control fonts — real glyph shapes, not
transformed Palatino.

## Rendering variation

Each TRAIN page rendered once per font at the TRAIN width (gap 26px),
plus one control (native, no override). No other augmentation (no jitter,
no further scaling): the failure mode is glyph shape.

## Model / optimisation (unchanged; architecture not swept)

TinyFCN4, warm start from the frozen v1 weights, Adam 1e-4, batch 4,
seed fixed, **8 epochs** (cap 12), device mps.

## Resource budget

10 fonts x <=10 pages = <=100 rasters (chromium ~2s each) + 8 epochs on a
~1.15M-param model. Bounded to <30 min; aborted if RSS exceeds 8GB.

## Acceptance (on the frozen 7-page regression benchmark)

ACCEPT and keep the new weights **only if all hold**:
1. tabdigit **per-page precision >= 0.30 on EVERY page** (no page at
   0.00-0.01 as today), and
2. aggregate tabdigit F1 >= 0.20 (from 0.111), and
3. controlled-render decode-eval on the two tuned-on scores does not
   regress by more than 0.02 F1 versus the frozen detector.

REJECT and revert to the frozen weights if any criterion fails, or if
the gain only shows on aggregate while pages stay at 0.

## Rollback

`datasets/guitar-vision/proof-detection/heatmap-ignore.pt` is the frozen
artifact; the experiment writes only to its out dir and is installed only
on acceptance.

## Explicitly out of scope

No architecture change, no threshold tuning on the benchmark, no
rest-detector work (that is M5 and has its own budget), no lens on
sealed TEST.
