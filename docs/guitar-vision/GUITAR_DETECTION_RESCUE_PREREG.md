# Detection Accuracy Rescue Preregistration (frozen before runs)

**Date:** 2026-10-08. Baseline: standard DEV P 0.27 / R 0.35 @0.3.

## Failure audit (TRAIN only)

Categorize FPs (text/staff-fragment/duplicate-peak/halo) and FNs
(small-digit/dense-chord/low-contrast/measure-edge) on TRAIN pages.
DEV touched once for the final measurement.

## One bounded improvement (no capacity sweep)

Hypothesis-first fix from the audit (likely: peak threshold/scale
handling, NMS window, target sigma, or background weighting — one change
with a control). Same TinyFCN size, ≤12 epochs, fixed seed, frozen TRAIN.

## Layouts

Train on standard + compact (split-grouped by score); eval all four.
Alternate layouts never cross TRAIN/DEV (score-grouped by construction).

## Acceptance

- DEV recall ≥ 0.55 with precision ≥ 0.35 (both must hold; no trading
  precision for recall), jitter flip-rate reduced vs 0.28-0.30.
- Else: report the exact blocker (dataset vs architecture).
- Fret checkpoint untouched. Sealed sets untouched.
