# Glyph normalization: canonical-scale selection (preregistered before lattice eval)

G4 answer, documented BEFORE the frozen-lattice evaluation in `h89_normalized_roi_eval.py`.

## Method (G2): source-direct canonical ROI ("one clean downsample")

For each fret object, map record boxUnits to source view pixels (mapping verified
bit-exact in h84: patch ink present, labels match), take the SAME 1.6x context box the
production path uses, and downsample ONCE with LANCZOS to 32x32. No other change:
same box, same context, same 32x32 target, same frozen CNN.

## Why this is the simplest strategy the pipeline supports (G1)

`h87_pipeline_trace.py` (train pages only) enumerated the production resample chain:
op 1 Chromium 2x render (sound); op 2 loader band-height to 256 LANCZOS PLUS a
horizontal squeeze on effectively every tile (742/767 train fret objects deviate
>15% from uniform scale; plane widths spread 22-188 px for 38/75 px source glyphs);
op 3 `sample_roi` bilinear grid_sample to 32x32. Median 7.3 distinct source pixels
feed each ROI output pixel, so native is well-sampleed nowhere undersampled — yet the
two chains disagree by 0.0588 mean-abs on a 0-1 scale. The head therefore sees a
resampling signature, not just ink. The one-clean-downsample path removes op 2's
squeeze and replaces two chained resamples with one controlled downsample from 1.25x
more pixels. It invents nothing: no sharpening, no generative step, no OCR.

## Canonical scale (G4)

The existing native scale: 32x32 output covering the 1.6x context box. No continuous
hyperparameter is searched; staff space enters only as the gate variable (G9), not as
a sampling parameter.

## Vector-local rerasterization (G3)

Not executable in this environment (no Chromium/Playwright; corpus PNGs were rendered
elsewhere). Determination by measurement instead: the 2x source already oversamples
the 32x32 target ~2-4x linearly, and the head collapses under a 0.95 resampling
perturbation whose pixel delta is far smaller than any plausible 2x-vs-4x render
difference. A vector rerender therefore cannot move the knee; it could only polish
downsample antialiasing that the experiment below shows is not the bottleneck either
way. The raster path is universal (photographed inputs have no vector), so the raster
path is THE path and no vector fallback branch is needed.

## Evaluation (G5, frozen head, FIT/SAME only)

`h89_normalized_roi_eval.py` runs the c1d8ff7ba0 head unchanged on source-direct
32x32 inputs: FIT native, SAME native, frozen lattice, batch-invariance check.
CASE A needs native >= 0.999 on both plus material degraded improvement; anything
else is CASE B (harms native) or C (no recovery), per the frozen rules.
