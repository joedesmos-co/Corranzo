# Fret signal: paired differencing through the real raster pipeline

## Why this and not a coordinate table

The previous milestone was going to be a PAGE→G table built by propagating the
target bbox and the production box through the same transforms. That is
tautological: transform both by the same function and their relative alignment is
preserved by construction, so every row would read ~1.0 and would prove nothing
about the implementation. It would have looked like success and meant nothing.

The page-space box is cleared — capture 1.0000, zero-capture 0%, centre dx 0.15px,
dy 0.66px, verified against an isolated single-glyph mask at a CTM of exactly 0.1.
So the question is no longer *where should the glyph be* but *does its actual
pixel contribution survive the raster pipeline*. That can only be answered by
differencing two real renders.

## The method

For each fixture, two otherwise-identical page renders:

    A   the semantic fret target present
    B   the same page with only that target suppressed

Identical in every other respect: dimensions, SVG, styles, groups, background,
staff, other notation. The absolute difference at the page is the target glyph,
and this is already validated — a 16x23px diff bbox for a 1-digit fret on a
2100x2970 page, glyph aspect 0.625 vs 1.167 for 1- vs 2-digit.

Then feed A and B **independently through the real loader** and difference the
actual arrays at every stage. Never predict where the glyph should be; measure
where its contribution survives.

## One implementation detail already established

The relationship between viewport pixels and crop pixels is **exact, not a guess**:

    viewport px = layout units * 0.1     (measured: getScreenCTM, a=d=0.1,
                                          validated against getBoundingClientRect
                                          to 0.0px over 40 fixtures)
    crop px     = layout units * 0.2     (unitsPerPixel=10 with VIEW_SCALE=2,
                                          both explicit in production code)

so `crop_px = viewport_px * 2`. This is a measured value times a production
constant. It must not be re-derived by assumption — that assumption is what
produced the five earlier contaminated measurements.

## Stages to instrument, and what each answers

| stage | capture | answers |
|---|---|---|
| PAGE | target diff in page render | positive control |
| BAND | diff in the real band extraction | does the crop contain the glyph |
| CROP | diff in the real post-trim array | does the trim keep it |
| RESIZED | diff after the loader's resize | resampling loss |
| TILE | diff inside the **actually selected** tile | tile selection |
| SQUARE PLANE | diff after strip→square resize | the known 0.769 x-anisotropy |
| PRE-ROI | diff immediately before ROI sampling | is the signal already gone |
| ROI | `abs(ROI(A) - ROI(B))` | **the endpoint** |

**Tile selection is the highest-value check.** If A and B select different tiles
for the same page, that is a production defect on its own. Note the loader assigns
an object to the *first* tile whose rect contains it, so a tile-boundary object is
a candidate.

## Metrics — binary capture is not enough

Resampling changes raw pixel counts, so a count comparison across stages is
meaningless. Use:

- diff bbox
- nonzero pixel/sample count
- **L1 diff energy**
- **normalised retained energy vs the previous stage**
- zero-signal rate

The first stage with a major, target-specific collapse in retained energy is the
first bad stage.

## The bottom-margin hypothesis must be tested, not assumed

The page-space glyph bottom margin is ~0.07px — the glyph's bottom edge sits on
the box's bottom edge. The prediction is that bilinear `grid_sample` at a
boundary half-samples it, costing about one glyph row: roughly 1px of a 23px glyph,
~4% of vertical signal.

Measure bottom-edge target pixels at each raster stage and report whether they
survive. If they do, **clear the hypothesis**. Do not widen the box pre-emptively.

## Provenance constraints

- Semantic pairing stays: digit string + x tolerance. No order dependency.
- No nearest-ink search, no centre-ink occupancy, no blob search, no assumed
  scale. All three of those produced wrong conclusions here.
- Production code is not modified until a real collapse is located and its cause
  is derived.
- ≥40 fixtures, single and double digit, multiple strings, multiple scores, with
  a **held-out subset**. Do not derive a fix from all fixtures and then report
  those same fixtures as validation.

## Decision rule

Only if `ROI_DIFF` is non-trivial and the calibration probe still fails does the
question return to the model. At that point the search space is small: the crop is
verified, the transform is verified, and only ROI sampling density and the
backbone remain.
