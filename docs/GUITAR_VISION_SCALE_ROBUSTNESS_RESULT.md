# Scale robustness: one controlled experiment — CASE C

Preregistration: `GUITAR_VISION_SCALE_ROBUSTNESS_PREREG.md` (written before training;
one run, frozen rule). Hygiene held throughout: held-out was never loaded, scored, or
aggregated in this experiment. There is no item-10 held-out read because no recipe was
frozen.

## 1. Source-resolution audit (S1; FIT/SAME only, `h84_source_audit.py`)

| quantity | measurement |
|---|---|
| vector source | Verovio 6.3.0 SVG, viewBox 21000x29700 units |
| rasterizer | headless Chromium via Playwright, lossless 8-bit PNG |
| full-page render | 2100x2970 px (~254 DPI on a 210 mm page width) |
| notation/tab band render | 2x (508 DPI effective); tab crops ~3000-4000x318-330 px |
| train fret glyphs, source px | 37.58x50.54 (1-digit, n=367) / 75.17x50.54 (2-digit, n=400); zero size variation |
| staff space, source px | 63 (all 40 train scores) |
| glyph height / staff space | ~0.80 |
| ink contrast | full 0/255; stroke ~6 px |
| ROI context box, plane px | 1.6x the plane box (e.g. 1-digit ~43-48 x 63-81), resampled to 32x32 |
| loader scale | band height -> 256 (tab ~0.78-0.80x); short final tiles stretched (plane widths to 188 px) |

## 2. Is rasterization discarding avoidable information?

No. Vector to 2x Chromium to lossless PNG preserves 38-75 px wide digits at full
contrast. A higher source DPI could not change plane pixels anyway: the loader
normalizes band height to 256 regardless. The bottleneck is the fixed 256-plane /
32x32-ROI pipeline meeting out-of-distribution small glyphs, not an upstream quality
choice. CASE A (fix rasterization instead of training) is rejected by measurement.

## 3. Glyph-size / reliability (S2; frozen head, FIT/SAME only, `h85_knee_probe.py`)

Effective short-side px -> FIT accuracy: 39.2 -> 1.0000; 37.2 -> 0.2345; 35.3 ->
0.1417; 33.3 -> 0.0961; <=31.4 -> ~0.06 (chance). SAME tracks FIT within ~0.03
throughout. The knee is AT native: even 5% resampling (blur sigma 0.026, contrast
0.95, i.e. negligible) collapses recognition. The head memorized pixel-exact native
templates with zero margin — which is also why resampling jitter was the targeted
intervention, not a guess.

## 4. Quality-threshold methodology (S7 groundwork)

Gate quantity, computable pre-inference from detection boxes alone (no labels):
effective short-side = min(box w, h) x 256 in plane px, equivalently source glyph
height (plane / 0.8 for tab bands). Trustworthy range from the FIT/SAME knee: >= ~37
plane px short-side (>= ~48 source px height), i.e. >= 0.95x the FIT reference
(39.21 / 50.54). Provisional rule, FIT-derived, to confirm on real data: warn if any
fret object < 35 px; reject the score if the median fret object < 35 px. The known
tiny-glyph held-out score (~8.5 px, 4x below the gate) would have been rejected
rather than hallucinated.

## 5. Augmentation recipe (S3/S4; preregistered, `h86_augmented_roi_head.py`)

Per FIT crop per step: P(native) = 0.5, else uniform over the six frozen lattice
levels with their frozen blur/contrast mappings. Labels unchanged. Exact validated
CNN (96,474 params), Adam 1e-3, 3000 steps, batch 64, seed 11. Single run.

## 6-8. Before / after (`c1d8ff7ba0` baseline vs augmented head)

| condition | FIT before -> after | SAME before -> after |
|---|---|---|
| native | 1.0000 -> 0.8648 (531/614) | 1.0000 -> 0.8039 (123/153) |
| mild 0.80 | 0.0603 -> 0.8567 | 0.0980 -> 0.7974 |
| moderate 0.63 | 0.0586 -> 0.8371 | 0.0850 -> 0.7974 |
| strong 0.50 | 0.0586 -> 0.7834 | 0.0850 -> 0.7778 |
| severe 0.40 | 0.0586 -> 0.6775 | 0.0850 -> 0.6536 |
| very-severe 0.32 | 0.0586 -> 0.5472 | 0.0850 -> 0.4706 |
| extreme 0.25 | 0.0586 -> 0.2638 | 0.0850 -> 0.2614 |

Mean degraded FIT: ~0.06 -> 0.661. The cliff became a graceful slope — the direction
is right — but native fell to 0.865/0.804 and was still rising at step 3000 under the
fixed budget, which the preregistration forbids extending on the basis of results.

## 9. CASE C

The frozen rule required FIT and SAME native >= 0.999 AND mean degraded FIT >= 0.50.
Native was sacrificed (0.8648 / 0.8039), so despite materially improved robustness
(0.66), the verdict is CASE C: do not replace the current model. The 96k-param head
under the fixed budget cannot hold both native-exact templates and degraded
invariance. Next: explicit glyph normalization / higher-resolution ROI input — a
pipeline change, not more augmentation tuning.

## 10. Held-out

Not read. No recipe was frozen, so the single-read condition never triggered.

## 11. Default production fret path

Unchanged: `guitar-vision-dedicated-roi-v1` at `c1d8ff7ba0` (score-disjoint 0.9266).
The augmented head (`tmp/gvprobe/dedicated-roi-aug-ckpt/head.pt`) is an experiment
artifact, not a checkpoint, and must not be served.

## 12. Input-quality gating recommendation

Adopt the Section 4 gate: refuse or warn below ~35 px effective short-side rather
than emitting fret numbers. It aligns with the Corranzo philosophy, costs one
box-arithmetic check per object, and is derived from FIT/SAME measurement — not from
the held-out failure it would also have caught.
