# Paired differencing through the real raster pipeline — results

Implements and runs `docs/GUITAR_VISION_FRET_SIGNAL_METHOD.md` against production
code. Harness: `tools/guitar-vision/h72_paired_pipeline.py`.

## Verdict

**No stage of the pipeline loses fret signal. The target's box simply never lands
on the target's glyph inside a band crop, so the tensor handed to the fret head
contains no trace of it.**

The raster chain is exonerated by measurement: at every resampling stage the
actual A/B difference equals the difference you get by pushing the *previous*
stage's difference through the identical operation (ratio 0.999–1.001). Nothing
is discarded. The collapse to zero at `FINAL_ROI` is not a loss — it is a
displacement, and it is present already in the first stage.

## Fixture set

| | |
|---|---|
| fixtures | 180 (3 per score) |
| scores | 60 of 60 |
| held-out (score-disjoint) | 20 of the 113 measured |
| digit counts | 80 one-digit, 33 two-digit measured |
| strings represented | 1–6 (mode 5) |
| SVGs re-derived from committed MusicXML | 48 (only 12 survive on disk) |

## Equivalence gate

| class | n | meaning |
|---|---|---|
| **CLASS 1** | **180** | natural equivalent — source dims, trim, post-trim dims, scaled dims, plane count and tile rects all identical |
| CLASS 2 | 0 | trim differed |
| CLASS 3 | 0 | later layout differed |

The hazard the method doc warned about **did not fire on a single fixture**:
suppressing a fret digit never moved the content bbox, because the trim is set by
the leftmost system rather than by any digit. The `trim_override` path exists and
was available but was not needed; no pinned-trim result is pooled here.

**Tile identity:** asserted per pair — same global tile index, same tile rect, same
plane box. **Zero disagreements.** 180/180 passed; no fixture was dropped for it.

Outcomes of the 180: 113 measured, 67 **not placed by production** (`plane_box`
refused the target in every tile — its documented behaviour for a box crossing a
tile edge). That is a real production outcome, reported separately, not an A/B
disagreement.

## A side is the shipped corpus

The A views this harness differences are byte-identical to the committed corpus
views for **180/180 fixtures, all three kinds**. Where production refused to render
a kind (18 of 60 scores have a TAB band only, so their committed `notation` PNGs
cannot be re-derived) that view was carried into A and B identically; carrying the
same bytes into both sides cannot contribute to a difference, and every stage
measured here is in the TAB view.

## Stage-by-stage difference (median over 113 CLASS 1 fixtures)

`A/E` is ACTUAL L1 ÷ EXPECTED L1, where EXPECTED is the previous stage's actual
difference pushed through the same operation. 1.0 means the operation moved the
signal exactly as an ideal linear resample of that same signal would.

| stage | nonzero | max | eff w×h | A/E | energy in box | box→ink dx,dy (px) |
|---|---|---|---|---|---|---|
| PAGE | 388 | 1.000 | 27×45 | – | **0.000** | 383.3, 127.9 |
| TRIMMED_CROP | 388 | 1.000 | 27×45 | 1.0000 | **0.000** | 383.3, 127.9 |
| RESIZED_ARRAY | 390 | 1.000 | 28×39 | 0.9993 | **0.000** | 349.2, 122.0 |
| TILE | 166 | 1.000 | 21×15 | 1.0000 | **0.000** | 340.5, 105.7 |
| SQUARE_PLANE | 138 | 1.000 | 18×15 | 1.0014 | **0.000** | 61.0, 84.3 |
| PRE_ROI | 138 | 1.000 | 18×15 | – | **0.000** | 61.0, 84.3 |
| **FINAL_ROI** | **0** | 0.000 | 0×0 | – | – | – |

**`energy in box` is 0.000 at every stage, including PAGE.** The fraction of the
target's own difference energy falling inside the target's own box window is zero
everywhere. The signal is present and the window is somewhere else.

Honesty about the medians: 37 of the 113 measured fixtures show **no** difference
at PAGE at all, and 50 of 113 show none in the target's tile — see *Content loss*
below. The medians above are over the fixtures that do carry signal at that stage.

### ACTUAL vs EXPECTED

| stage | MAE | max | normalised L1 discrepancy |
|---|---|---|---|
| TRIMMED_CROP | 0.0 | 0.0 | 0.0 |
| RESIZED_ARRAY | 1.0e-5 | 0.1068 | 1.0e-5 |
| TILE | 0.0 | 0.0 | 0.0 |
| SQUARE_PLANE | 1.6e-5 | 0.0516 | 1.6e-5 |
| FINAL_ROI | 0.0 | 0.0 | 0.0 |

The two selection stages (`TRIMMED_CROP`, `TILE`) match their expectation
**exactly**. The two resampling stages differ by ~1e-5, which is production's
8-bit re-quantisation at each step and is what the float-domain expectation cannot
reproduce. There is no stage where production loses signal that a correct resample
would have kept. **The raster transform chain is cleared.**

## Where the discrepancy actually is

Two independent predictions against the same measured difference, in the TAB view:

| | median | p90 abs |
|---|---|---|
| glyph position predicted from the SVG's own declared `x`/`y`, through the production crop geometry | **−0.5, +0.4 px** | 1.1, 0.7 px |
| glyph position that production's target box maps to — error in layout units | **+1774, +505** | range x [656, 2212], y [415, 537] |

So the render and the crop are faithful to under a pixel: the glyph is exactly
where the SVG says. The box is 505–2212 **layout units** away — 100–440 crop
pixels, against a box half-height of 43 px.

The y component is tight and equals a round number: range **[415, 537]**, median
**505**, and subtracting Verovio's outer `translate(500, 500)` leaves a residual
of **5 units** (0.26% of the crop height). The x component is larger and varies
with position across the strip (656–2212), leaving 1274 units after the same
subtraction.

**Root cause.** Verovio wraps page content in `<g transform="translate(500, 500)">`.
`getScreenCTM` returns `e=50, f=50` for the 2100-px view, which is that translate
at 0.1 px/unit — the frozen page-space work accounted for it. But
`rasterize_views.crop_view` cuts the page using raw band `boxUnits`, and
`dataset.view_rect` / `page_box_to_view` express boxes in the same raw units.
Neither applies the translate. The crop is therefore taken 100 px (500 units) up
and left of where the band says the content is, while the boxes are placed in the
untranslated frame. The residual x term is the second half of the same contract
error: the loader maps a band-relative fraction onto the crop's full pixel width,
which is only valid if the crop's origin is the band's origin and the crop spans
exactly the band. Neither holds, because of the same 500 units.

This is the discrepancy the method doc's stage table predicted would not exist:
`BAND → CROP` was specced as identity.

### Content loss, same cause

37 of 113 measured fixtures (**33%**) show **zero** pixel difference at PAGE — the
target glyph is not in the TAB view at all. The crop's lower edge is computed from
`band_bottom + 40` in raw units while the content renders 500 units lower, so the
window is 100 px short and the lowest digits fall outside it. Verified on three
cases: all three miss by exactly 53 px, with the band reporting the digit as
inside it.

So one unaccounted 500-unit translate produces **two** distinct production faults:
a displacement that moves every box off its glyph, and a crop window that is short
enough to drop the lowest ~third of digits entirely.

## Bottom-margin hypothesis: CLEARED

Share of difference energy in the bottom 20% of the difference's own extent:

| PAGE | TRIMMED_CROP | RESIZED_ARRAY | TILE | SQUARE_PLANE | PRE_ROI |
|---|---|---|---|---|---|
| 0.193 | 0.193 | 0.167 | 0.160 | 0.160 | 0.160 |

The predicted cost was ~4% of vertical signal, and the drop here is 0.193 → 0.160.
That is **not** evidence for the hypothesis, because the same stage also reports
ACTUAL/EXPECTED = 1.0014: whatever the bottom-edge share does, an ideal resample of
that same signal does it identically. There is no target-specific bottom-edge loss
to explain. And a 0.07 px page-space margin cannot produce a 383 px displacement.

**The hypothesis is cleared. The box was not widened.**

## FINAL_ROI

With production's box, over all 113 measured fixtures: **nonzero = 0 in 113/113.**

### DIAGNOSTIC — the same ROI sampler, box translated onto the glyph

Labelled separately and never pooled with the primary metrics. Purpose: separate
"the tensor is blind to the glyph" from "the window is not on the glyph".

| | |
|---|---|
| affected samples | **158** of 1024 |
| diff bbox | 17×18 samples |
| mean / max | 0.0657 / **0.9998** |
| normalised L1 | 0.0657 |

The tensor is not blind. Put the window on the glyph and the ROI carries it at
full amplitude. **The window is not on the glyph.**

### Effective ROI glyph sampling

| | |
|---|---|
| box in the plane | 27.8 × 42.9 px |
| ROI field of view (1.6 boxes) | 44.4 × 68.6 px across 32×32 samples |
| plane px per ROI sample | **1.39 × 2.14** |
| glyph inside the ROI | 17×18 of 32×32 samples |

**ROI sampling density is not the bottleneck.** A 1-glyph digit spans 17×18
samples; the head has ample samples. This is not a sampling-starvation case.

## Calibration probe (unchanged, rerun)

`h1_direct_roi_probe.py`, defaults, 4 pages / 32×32 crop / 256 plane / 300 steps.

| condition | frozen | rerun |
|---|---|---|
| real | 48.1% | **59.6%** |
| blank | 23.1% | **25.0%** |
| shuffled | 55.8% | **69.2%** |
| wrong_roi | 55.8% | **69.2%** |

Same structure, and the probe's own conclusion is the finding:
`shuffled == wrong_roi` — the head is reading page texture and position, not
digits. Its verdict: *"cannot memorise even real pixels: the crop does not contain
the glyph."* The probe is right, and this run says why.

## First real signal-collapse stage

There is none in the sense of loss. The target's difference is present and
full-amplitude from PAGE through PRE_ROI, and **survives every operation intact**
(ACTUAL/EXPECTED ≈ 1.0). The first stage at which the *target's signal stops
reaching the head* is `FINAL_ROI`, and the reason is not that the signal was
attenuated — it is that the sampling window, which is derived from the box, does
not contain the glyph. That condition is already fully present at PAGE.

## Final classification

**Raster transform — specifically a crop-vs-frame offset, not a signal loss.**

Not the alternatives, each on measurement:

- *trim instability* — **excluded.** 180/180 CLASS 1, 0 CLASS 2, 0 CLASS 3. The
  hazard was real and it did not fire.
- *signal loss in the raster chain* — **excluded.** ACTUAL/EXPECTED 0.999–1.001 at
  every stage; the two selection stages match exactly.
- *tile selection* — **excluded.** 180/180 identical tile index, tile rect and box.
- *ROI sampling density* — **excluded.** 1.39×2.14 plane px per ROI sample; the
  glyph occupies 17×18 of 32×32 samples when the window is placed on it.
- *downstream representation / model* — **excluded as the cause.** With the window
  on the glyph the ROI carries max 0.9998. The architecture is not the limit.
- **crop-vs-frame offset — confirmed.** One unaccounted 500-unit page translate,
  producing both a 383×128 crop-pixel box displacement and a 100-px-short crop
  window that drops ~33% of digits from the view entirely.

## What this does and does not authorise

Authorised: fixing the crop/frame contract so the band geometry and the rasterised
crop agree about where the page origin is, then re-running this harness. That is a
one-line-class change in the crop/frame mapping and it is **not** made here — the
brief forbids adding offsets before a collapse is located and its cause derived.
The cause is now derived and measured.

Not authorised: any change to the fret head, the ROI context, the losses, the
corpus size, or the box dimensions. Every one of those is downstream of a fault
this run has located, and none of them should be tuned until it is fixed.

## Method notes

- `dataset.py` gained two optional, default-`None` keyword parameters, `trace` and
  `trim_overrides`. They expose production's own intermediates and permit a
  caller-supplied trim; they add no transform, scale or offset. Verified: with both
  omitted, `load_dataset` output is byte-identical to the HEAD module over 8 pages,
  and identical again with `trace` supplied. `tools/guitar-vision/python/tests`
  remains **38 passed**.
- `trim_override` was never exercised in the reported run (no CLASS 2 fixture), so
  no pinned-trim numbers are reported and none are pooled.
- Fixtures are selected by cycling digit count per score, so a score whose frets
  are all one digit cannot supply the whole set.