# Explicit glyph normalization: preprocessing-only test — CASE B, reject

Preregistration: `GUITAR_VISION_GLYPH_NORMALIZATION_PREREG.md` (method and canonical
scale documented before the lattice evaluation). Hygiene held: held-out never loaded,
scored, or aggregated. No retraining occurred (G5). There is no item-10 held-out read.

## 1. Exact stage where scale information is lost (G1; `h87_pipeline_trace.py`)

Production resample chain, measured on all 767 train fret objects:

1. Chromium SVG to PNG at 2x for notation/tab bands (sound; glyphs 38/75x51 px).
2. Loader: band height to 256 LANCZOS **plus a horizontal squeeze on effectively
   every tile** — 742/767 train fret objects deviate >15% from uniform scale; plane
   glyph widths spread 22-188 px for 38/75 px source glyphs.
3. `sample_roi`: 1.6x context box in plane px to 32x32 via bilinear grid_sample.

Stage metrics (medians): S0 source 50x75, 112 gray levels, occupancy 0.214, edge
53.0; S1 plane 40x44, 147 levels (interpolation invents grays), occupancy 0.214,
edge 60.0; S2 ROI 32x32, 85 levels, occupancy 0.106 (expected: 1.6x context adds
paper, 1/1.6^2 = 0.39 x 0.214 = 0.084), edge 53.7. Median 7.3 distinct source pixels
feed each ROI output pixel — native is well-sampled at every stage, nothing is
undersampled in-distribution. Yet the two candidate chains disagree by 0.0588
mean-abs: the head sees a resampling signature, not just ink.

First irrecoverable stage: the SOURCE itself for small layouts (genuinely
low-information pixels; no upstream stage discards anything avoidable), and the
post-ROI crop for the stress lattice (destruction applied where no upstream tap can
reach back). The final 32x32 resize is NOT the sole problem — op 2's squeeze is the
larger measurable distortion, and neither causes the cliff (below).

## 2. Normalization method (G2)

Source-direct canonical ROI: record boxUnits to source view px (verified mapping),
same 1.6x context box, ONE LANCZOS downsample to 32x32. Same box, same context,
same target, same frozen CNN. Nothing invented.

## 3. Vector-local rerasterization (G3)

Not executable here (no Chromium/Playwright in this environment; corpus PNGs were
rendered elsewhere). Determination by measurement: the 2x source oversamples the
32x32 target ~2-4x linearly, and the head collapses under a 0.95 resampling whose
pixel delta is far smaller than any 2x-vs-4x render difference — a vector rerender
cannot move the knee. The raster path is universal (photos have no vector), so the
raster path is THE path; no vector branch, no fallback needed.

## 4-6. Frozen-head results (`h89_normalized_roi_eval.py`)

| condition | FIT baseline -> direct | SAME baseline -> direct |
|---|---|---|
| native | 1.0000 -> 1.0000 (614/614) | 1.0000 -> 0.9673 (148/153) |
| mild 0.80 | 0.0603 -> 0.0586 | 0.0980 -> 0.0850 |
| moderate and below | 0.0586 -> 0.0586 | 0.0850 -> 0.0850 |

Mean degraded FIT 0.0586 — bit-identical cliff. The cleaner chain preserves FIT
perfectly, flips 5/153 dev objects (the head memorized the plane-path resampling
signature; dev moves first), and changes degraded robustness by exactly zero. The
lattice destroys information AT the crop; no preprocessing upstream of the
destruction point can recover it. Repeat computation bitwise identical (G10; production
`sample_roi` untouched, so no production batch risk introduced).

## 7. Retraining needed?

No — and per G7, none launched. Preprocessing-only failed both conditions for
success, so training on the new path was not attempted.

## 8. Quality-gate recommendation (G9)

Gate variable: effective short-side = min(box w, h) x 256 in plane px. It directly
measures the classified object's sampling and needs no staff detection (staff space
is constant 63 px in train — zero variation — so it cannot be validated as a gate
variable here; glyph-box wins by default and by mechanism). Measured FIT/SAME table:

39.2 px -> 1.0000 | 37.2 -> 0.2345 | 35.3 -> 0.1417 | 33.3 -> 0.0961 | <=31.4 -> ~0.06

Recommended bands (FIT-derived, single corpus — confirm on real data before
hard-coding): reliable >= 39; warning 35-39 (transition band: accuracy spans
0.14-1.0 across ~4 px, so the threshold location is uncertain even though the
cliff is sharp); degraded-signal 31-35; reject < 31 (chance). For vector inputs the
same effective-resolution gate applies post-load; an optional pre-load source-px
check can warn earlier but adds no decision power. The known ~8.5 px failure sits
4x below reject — refusal, not hallucination.

## 9. CASE B — reject the method

Preregistered rule: A needs native >= 0.999 on both plus degraded improvement.
SAME native fell to 0.9673 (harms native) with zero robustness gain. Reject the
source-direct path. Mechanism confirmed is C-type (irrecoverable undersampling),
but the verdict that binds is B: it must not replace anything.

## 10. Held-out

Not read. No freeze, no single-read trigger.

## 11-12. Production recommendation

Keep `c1d8ff7ba0` (`guitar-vision-dedicated-roi-v1`, 0.9266) byte-for-byte. Do not
adopt source-direct preprocessing. Implement the Section 8 input-quality gate as
the product fix for small-glyph scores. If scale robustness is ever required of
the model itself, the prior experiment showed augmentation buys robustness only by
spending native — that trade needs a product decision, not another silent recipe.
