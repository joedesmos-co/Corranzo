# Scale-robustness augmentation: preregistration

Written BEFORE training. The single training run below may not be altered, retuned, or
repeated on the basis of its results. One run, one evaluation, one CASE decision.

## S0 hygiene

No score-disjoint held-out row is loaded, scored, or aggregated at any point in this
experiment until and unless a recipe is frozen under the CASE B rule below, at which
point held-out is read exactly once. All selection uses FIT (n=614) and SAME-SCORE DEV
(n=153) only. The known tiny-glyph held-out score is not inspected further.

## Why augmentation (S1 summary)

`h84_source_audit.py` (train pages only): vector SVG → headless Chromium at 2x for
notation/tab bands → lossless PNG. All 767 train fret glyphs are 37.58x50.54 (1-digit)
or 75.17x50.54 (2-digit) source px, full 0/255 contrast, ~6px strokes, staff space
63px. Rasterization is sound; no avoidable upstream information loss exists (a higher
source DPI could not change plane pixels anyway: the loader normalizes height to 256).
CASE A (fix rasterization instead) is rejected by measurement.

## Why this augmentation (S2 summary)

`h85_knee_probe.py` (frozen production head, FIT/SAME only): factor 1.00 -> fit 1.0000;
factor 0.95 -> fit 0.2345. At 0.95 the bundled blur (sigma 0.026) and contrast (0.95)
are negligible, so the collapse is pure resampling sensitivity: the head memorized
pixel-exact native templates with zero margin. Resampling jitter during training is the
targeted intervention, not a guess.

## Recipe (fixed)

- Data: the 614 FIT crops only, exact fret labels unchanged, extracted through the
  model's own `roi_crops` path exactly as in h82.
- Per sampled crop per step, independent draw: P(native) = 0.5; P(each degraded
  level) = 0.5/6 over the six frozen lattice levels (mild 0.80, moderate 0.63, strong
  0.50, severe 0.40, very-severe 0.32, extreme 0.25) with their frozen blur/contrast
  mappings, applied via `scale_stress.perturb_crop`. No other transform exists.
- Model: exact validated `RoiFretCnn`, 96,474 parameters, constructed identically
  (same seed 11, same shared-weight loading, everything frozen except `roi_head`).
- Optimizer/budget: Adam lr 1e-3, no weight decay, no schedule, 3000 steps, batch 64,
  generator seed 11. Identical to the baseline run except for the per-crop draws, which
  come from the same seeded generator.

## Evaluation (frozen)

- FIT native, SAME native, and the full frozen FIT/SAME scale-stress lattice.
- Baseline (c1d8ff7ba0): native 1.0/1.0; degraded FIT mean ~0.06, SAME mean ~0.09.

## Decision rule (frozen)

- CASE B iff FIT native >= 0.999 AND SAME native >= 0.999 AND mean degraded FIT
  accuracy over the six lattice levels >= 0.50. Then: assemble a production artifact
  the h83 way, verify it, and read score-disjoint held-out exactly once.
- Otherwise CASE C: do not replace the current model; next step is explicit glyph
  normalization / higher-resolution input, not more augmentation tuning.
