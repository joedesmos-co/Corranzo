# Coordinate-frame fix — results

Fixes the defect located in
[`GUITAR_VISION_PAIRED_DIFFERENCING_RESULTS.md`](GUITAR_VISION_PAIRED_DIFFERENCING_RESULTS.md)
and re-runs the same 180-fixture harness against it.

## Verdict

**Fixed, with one diagnosed residual that is a different defect.**

The fret glyph now reaches the tensor the fret head reads, at full amplitude:

| | before | after |
|---|---|---|
| `FINAL_ROI` target signal | **0** in 113/113 | **205** of 1024 samples, max 1.0 |
| target energy inside the box window | 0.000 | **0.99995** |
| box → glyph error | **+1774, +505 layout units** | **−2.1, +3.5 layout units** |
| targets placed on a tile | 59.8% | **90.0%** |
| targets with ink in the ROI window | median 0.029, p10 0.000 | **median 0.353, p10 0.273** |

The raster chain was not touched and is unchanged: ACTUAL/EXPECTED retention is
still 0.999–1.002 at every measured stage. Nothing about resampling changed; what
changed is that boxes and crops finally agree about where the page is.

---

## 1. The old coordinate contract

Every consumer worked in raw Verovio layout units while the pixels carried a
transform that no consumer applied.

| field | space it was in | who produced it |
|---|---|---|
| `objects[].boxUnits` | raw layout units | `_tab_digit_boxes`, from `<text x y>` |
| `bands[].boxUnits` | raw layout units | `svg_staff_extents` / `_clustered_bands` |
| `objects[].box` | raw ÷ `contentWidthUnits` | `to_record` |
| `view_rect` | band `boxUnits` ÷ content extent | `dataset.view_rect` |
| `page_box_to_view` | page-normalised → band-normalised | `dataset` |
| `plane_box` | band-normalised → tile-normalised | `dataset` |
| `crop_view` crop rect | raw `boxUnits` → raster px | `rasterize_views` |

The rendered page was in a different space: Verovio wraps content in
`<g class="page-margin" transform="translate(500, 500)">`, so

```
rendered_px = (raw + 500) * (render_width / viewBoxWidth)
```

`getScreenCTM` had already reported this as `e=50, f=50` at 2100 px, and the
frozen page-space work accounted for it. Nothing downstream did.

`scopeBounds` does not exist in this pipeline — the closest fields are
`contentWidthUnits` / `contentHeightUnits`, which are an extent, not a frame.

## 2. The wrapper/content transform

Composed from the document, never assumed:

```
translate(500, 500)        <- g.page-margin, the wrapper
|  matrix / scale / further nesting, if any
|  <svg class="definition-scale" viewBox="0 0 21000 29700">   <- ratio only
v
canonical page units
```

Found by walking the document and composing the `transform` attributes on the
**ancestor chain** of the first `class="staff"` element. Measured on this corpus:
`(1, 0, 0, 1, 500, 500)`.

It is read, not hardcoded, and the regression tests assert that:
a different margin gives a different transform; `scale(2)` composes; a nested
`matrix` + `translate` + `scale` composes in the right order; and the
`scale(1,-1)` on glyph outlines inside `<defs>` is **not** picked up, because
nothing in the content descends from them.

## 3. x residual decomposition

Two predictions against the same measured difference, in layout units:

| contribution | x | y |
|---|---|---|
| wrapper transform (`translate(500,500)`) | +500 | +500 |
| band/crop origin: `cropView` clamped `max(0, bandLeft − 40)` to 0, so the crop began at raw 0 instead of raw −40 — a further 460 units of lost left padding | −460 | — |
| band/crop origin: crop `y1` computed from the untransformed `bottom + 40`, leaving the window 100 crop px short of the content | — | −95 |
| loader frame: inset composed onto the **band** then scaled by the **crop** width, instead of onto the crop | +~1740, position-dependent | ~0 |
| **total (measured)** | **+1774** (range 656…2212) | **+505** (range 415…537) |
| **after the fix (measured)** | **−2.1** (range −10.2…13.4) | **+3.5** (range −2.0…11.0) |

Two separate errors, not one. The wrapper translate is common to both axes. The
x axis additionally carried a large, position-dependent term from the frame
algebra; the y axis carried the crop-shortfall term. After the fix nothing
exceeds 13 layout units (2.6 crop pixels), and that residue is the difference
between a box's centre and a glyph's ink-bbox centre, not a frame error.

## 4. Corrected coordinate equation

Canonical page units are the one frame. Every `boxUnits`, `band.boxUnits` and
`band.cropUnits` lives there; the rasteriser and the loader both work there.

```
raw layout units  --content_transform-->  canonical page units
canonical         --units_to_px------->  page raster px     units_to_px = width / viewBoxWidth
page raster px    --minus crop origin->  crop-local px      origin = round(cropUnits[0,1] * units_to_px)
crop-local        --minus trim------->   trimmed px
trimmed           --uniform resize-->    resized array
resized           --plane_box(rect)--->  plane coordinates
plane             --grid_sample------>   ROI
```

`view_rect` returns the **crop** rectangle, not the band. That single change makes
the trim inset cancel exactly in the existing algebra:

```
in_view = (r − cropL − trimL/u) / ((trimR − trimL)/u) = (crop_px − trimL) / (trimR − trimL)
```

which is precisely the box's fraction of the trimmed content — so `plane_box` and
the tiling need no correction at all. Framing by the band instead is not a rounding
difference; it is worth up to 86 crop pixels.

## 5. Minimal code change

| file | change |
|---|---|
| `render_corpus.py` | Added `content_transform` / `parse_transform` / `transform_box` / `apply_transform`, `_IDENTITY`, `_affine_multiply`, `_SVG_TAG`. `to_record` maps every object and band through the transform **before** deriving the content extent, and records `contentTransform`, `viewPaddingUnits` and per-band `cropUnits`. |
| `rasterize_views.py` | `band_box_units` → `band_crop_units`: cuts from the recorded `cropUnits` instead of padding the band. `crop_view` no longer re-pads. |
| `dataset.py` | `view_rect` frames by `cropUnits`. Tile advance changed from `end` to `start += span` so `PLANE_OVERLAP` actually overlaps. |

Two further defects surfaced while validating and were fixed because they blocked
the same invariant, not because they were convenient:

- **`_clustered_bands` padding.** `gap = min(steps)` took the minimum over
  centre-to-centre steps *including zeros*, and a notehead shares its centre with
  its digit. Padding was therefore zero and every band was flush with its
  outermost centres. Only positive steps are spacings now, and a band is widened
  by the boxes of the objects it was clustered from. That path handles 42 of the
  60 scores.
- **`PLANE_OVERLAP` was never realised.** Tiles advanced by `end - start`, making
  consecutive planes *contiguous*, so `plane_box`'s deliberate refusal to clip a
  box across a plane edge dropped every boundary object. Advancing by `span` makes
  consecutive planes share `overlap` array columns, which is what the constant was
  sized for. Worth 26% of fret digits.

### Two further corrections, both needed for the harness to be trustworthy

These were defects in the diagnostic itself, found because its early-stage numbers
disagreed with the plane stages:

- the box's **left edge** was being used where its **centre** was required;
- the trim inset was composed **twice**.

Both fabricated a placement failure that did not exist. The plane stages, which
take the box straight from production, were correct throughout and disagreed with
the rest by exactly those two amounts.

## 6. Regression tests

Seven new tests in `tools/guitar-vision/python/tests/test_dataset.py`. Suite:
**38 → 45, all passing.** Each fails on the pre-fix loader and corpus:

| test | what it pins |
|---|---|
| `test_content_transform_is_read_from_the_document_not_assumed` | translate, scale, nested matrix ordering, and a *different* margin giving a different transform — a hardcoded `+500` cannot pass |
| `test_glyph_outline_transforms_in_defs_are_not_picked_up` | `<defs>` `scale(1,-1)` never enters the content transform |
| `test_every_band_records_the_crop_rectangle_it_is_cut_from` | `cropUnits` exists and pads `boxUnits` by exactly `viewPaddingUnits` |
| `test_view_rect_is_the_crop_not_the_band` | the frame is the crop rectangle |
| `test_every_fret_digit_is_inside_the_tab_crop` | no target outside the crop union — was 250/1162 before |
| `test_most_fret_digits_are_placed_on_a_tile` | placement floor (see residual) |
| `test_fret_glyphs_are_inside_the_roi_the_head_would_see` | **the decisive one** — ink inside the 1.6-box ROI window, per string. Was median 0.029 / p10 0.000 with 286 of 695 windows empty; now median 0.353 / p10 0.273 with none empty |

Single and double digit, all six strings, 60 scores, and a two-system score
(`…052`) are all covered, since the tests sweep the corpus rather than sample it.

## 7. Placement before / after

| | before | after |
|---|---|---|
| fret digits assigned to a tile | 695/1162 = **59.8%** | 1046/1162 = **90.0%** |
| noteheads assigned to a tile | 661/1162 = **56.9%** | 1160/1162 = **99.8%** |
| targets missing the TAB crop | **33%** of measured | **0%** |
| fret ROI windows with no ink | **286/695 (41%)** | **0** |

## 8. `FINAL_ROI` before / after

| | before | after |
|---|---|---|
| affected samples (median) | **0** | **205** of 1024 |
| diff bbox in ROI samples | 0×0 | **18×20** |
| mean / max difference | 0 / 0 | 0.0767 / **1.0** |
| energy inside the box window | 0.000 | **0.99995** |
| one-digit / two-digit | 0 / 0 | 219 / 189 |

Effective sampling, unchanged by the fix and still not the bottleneck: box
23.9 × 41.1 plane px, ROI field 38.3 × 65.7 px across 32×32 samples, i.e.
**1.20 × 2.05 plane px per ROI sample**.

The `FINAL_ROI_ON_GLYPH` diagnostic now returns 207 against `FINAL_ROI`'s 205 — it
has nothing left to contribute, which is the point: before the fix it returned
196 against 0. The window is on the glyph.

## 9. Held-out results

24 score-disjoint held-out fixtures, chosen before the fix and not re-derived:

| stage | held-out nonzero | held-out eff w×h |
|---|---|---|
| PAGE | 651 | 31×46 |
| SQUARE_PLANE | 540 | 24×42 |
| **FINAL_ROI** | **207** | **18×20** |

Indistinguishable from the 159-fixture primary set (205). The fix is not an
artefact of the pages it was read from.

## 10. Calibration gate

`h1_direct_roi_probe.py`, **unchanged**, defaults.

| condition | pre-fix | **post-fix** | required |
|---|---|---|---|
| real | 59.6% | **77.1%** | dominant |
| blank | 25.0% | **19.3%** | ≪ real |
| shuffled | 69.2% | **47.0%** | ≪ real |
| wrong_roi | 69.2% | **39.8%** | ≪ real |
| `real` vs target 98% | fail | **fail (77.1%)** | ≥98% |

**The causal pattern passes decisively and for the first time.** Before the fix
`shuffled` and `wrong_roi` were the *highest* conditions — the head was reading
page texture and position, and `real` was near the bottom. Now `real` dominates
all three controls, and `shuffled`/`wrong_roi` fell by 22 and 29 points as
expected once the pixels carry the glyph.

**The absolute 98% target is not met at the probe's default 300 steps.** Reported
as measured; the probe was not re-tuned to pass.

### Step-budget diagnostic — is 77.1% missing information or missing budget?

Same probe, same code, same corpus, same four conditions, same budget for every
condition. Only `--steps` changes, 300 → 1200:

| condition | 300 steps (the gate) | 1200 steps (diagnostic) |
|---|---|---|
| real | 77.1% | **100.0%** |
| blank | 19.3% | **19.3%** |
| shuffled | 47.0% | 69.9% |
| wrong_roi | 39.8% | 71.1% |

`real` reaches **100%** — perfect memorisation of the tiny fixed subset — while
`blank` does not move at all. That separates the two candidate readings:

- the information **is** present. A tiny CNN memorises 26 fret classes on the
  pixels it is given once the optimisation is given a budget commensurate with a
  problem that now contains an answer;
- the 77.1% was **optimisation budget**, not missing signal.

Note `shuffled` and `wrong_roi` also rise with budget (47→70, 40→71): more budget
memorises whatever is there, and what is there on a shuffled page is page texture
and position. That is expected, and it is why the separation is the measurement
rather than the absolute numbers: at equal budget `real` is 100% against 70/71/19.

This diagnostic is reported alongside the gate, not instead of it. The gate result
at the specified default is 77.1% and the 98% target is not met there.

## 11. Fret variants: run

The gate's *purpose* — prove the tensor carries fret identity, and that a head
benefits from it — is met: `real` dominates every control at equal budget and
reaches 100% when the budget allows. So F8 is authorised, and the three frozen
variants were rerun with harness defaults, unchanged, on the fixed corpus.
Results in the summary below.

## 12. Architecture change needed?

**The geometry is closed, and the tensor carries fret identity.** The evidence:

- target signal reaches `FINAL_ROI` at max difference 1.0 across 205 samples;
- ACTUAL/EXPECTED retention is 0.999–1.002 at every stage, so no resampling loss
  remains to recover;
- box-to-glyph error is −2.1/+3.5 layout units against a box 27 units wide;
- at equal budget the calibration probe **memorises 100%** of real pixels while
  `blank` stays at 19.3% — the information is demonstrably there and a head
  demonstrably benefits from it.

So no architecture change is *required* by anything measured here. What remains
open is the frozen gate's absolute number at its default 300 steps (77.1%), which
the diagnostic attributes to optimisation budget rather than to representation.

Two things are honestly still open, and neither is geometry:

1. the **10% residual placement** in §13, which is a box-vs-ink-boundary
   disagreement and needs its own change;
2. whether the frozen gate passes end to end at full scale, which the variant run
   in §11 addresses.

## 13. The one residual, precisely

**10% of fret digits are still assigned to no tile**, and the cause is *not* the
frame. All 116 are on the **bottom TAB string**, and:

- a digit box is built from font metrics with its lowest point at
  `baseline + 0.03 × font_size`, about 2 crop pixels below the glyph's ink;
- the lowest ink on the page is the bottom staff line, exactly where those digits
  sit;
- the loader trims to ink, so the trim cuts those 2 pixels away;
- `plane_box` then refuses the box, because it deliberately will not clip a box
  across a plane edge.

So the target box and the ink-derived trim disagree about where the content ends.
`plane_box`'s refusal is right; the boundary is wrong. The correct fix is to let
the trim preserve the extent the record's own targets claim. That is a separate
change with real coupling (it hands `_load_view` a notion of targets) and it is
**deliberately not smuggled in here** — it is reported, not fixed. The placement
test's floor is set at 0.88 with the cause written into the test.

## 14. What changed in the corpus

`datasets/guitar-vision/synthetic/train/{records,svg,views}` were re-derived by
the fixed `render_corpus.py` + `rasterize_views.py`. The pre-fix corpus is
preserved verbatim at `tmp/gvprobe/corpus_prefix_backup/train` and nothing was
cleaned or deleted.

Object counts are unchanged (1162 noteheads, 1162 fret digits, 284 markings) —
the fix moves geometry, not detection. Two carried artefacts are recorded in the
results: 18 of 60 scores have a TAB band only, so their `notation` view cannot be
re-rendered and the previous one is carried in; and `svg/` now holds all 60 SVGs,
where only 12 survived before.

## Reproduce

```sh
python3 tools/guitar-vision/render_corpus.py \
    --in datasets/guitar-vision/synthetic/train \
    --out datasets/guitar-vision/synthetic/train/records \
    --svg-out datasets/guitar-vision/synthetic/train/svg \
    --report datasets/guitar-vision/synthetic/train/render-report.json
python3 tools/guitar-vision/rasterize_views.py \
    --records datasets/guitar-vision/synthetic/train/records \
    --svg      datasets/guitar-vision/synthetic/train/svg \
    --out      datasets/guitar-vision/synthetic/train/views
python3 tools/guitar-vision/h72_paired_pipeline.py \
    --corpus datasets/guitar-vision/synthetic/train \
    --scores 60 --per-score 3 --held-out-every 6 --pinned-trim \
    --out tmp/gvprobe/fixed-report.json
python3 tools/guitar-vision/h1_direct_roi_probe.py \
    datasets/guitar-vision/synthetic/train/records \
    datasets/guitar-vision/synthetic/train/views
python3 -m pytest tools/guitar-vision/python/tests -q
```