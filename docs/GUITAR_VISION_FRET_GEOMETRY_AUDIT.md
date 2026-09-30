# Fret glyph geometry — audit, and a retraction

## The retraction, first

**My previous root-cause claim was wrong.** I reported that the fret target box is
"a string gap, ~4× the glyph's height", and that fixing it was the path to making
fret pixels learnable. That claim came from a raster measurement, and the raster
measurement was wrong.

The browser's own font metrics say the opposite:

| | top above baseline | bottom below baseline | height |
|---|---|---|---|
| **Font box** (`getBBox()`) | **290u** | 80u | **370u** |
| **Current box** | **243u** | 10u | **253u** |

The current box is 253 units tall against a font box of 370. It is not four times
too big — it is *too small*, clipping 47 units off the top of the glyph box.
Adopting the font box would make every box **taller** (370u vs 253u) and every ink
coverage figure **worse**.

I should have run this measurement before writing the conclusion. Two earlier box
"calibrations" were fitted to pixels and both broke the mapping; the correct move
was to stop fitting and read the font metrics, which is what this commit does.

## Why the raster measurement was wrong, four times over

On a TAB staff the digit shares its neighbourhood with three other things, and a
bounding box in that neighbourhood is not the glyph:

- the **staff line** it sits on, which spans the full width of any measuring
  window — so every reading is the line's extent unless the line is removed;
- the **rhythm stem**, rising a full staff height above its digit;
- the **adjacent digits** on the same string.

Four passes produced "glyph heights" of 207, 119, 19 and 3 units on a 315-unit
gap, with 100%, 100%, 98% and 0% of windows flagged as clipped. Each looked
plausible. None was a glyph measurement. One pass "confirmed" 12.6-unit glyphs —
which is what a clipped sliver of a digit looks like.

## What is now established exactly, with zero variance

From `fret_font_metrics.py`, reading `SVGTextContentElement.getBBox()` and
`getExtentOfChar()` on every TAB `<text>` element, over 69 digits across 3 scores:

| quantity | value | p10 | p90 |
|---|---|---|---|
| baseline below staff line, in font units | **0.33333** | 0.32716 | 0.33951 |
| box top above baseline, in font units | **0.89506** | 0.89506 | 0.89506 |
| box bottom below baseline, in font units | **0.24691** | 0.24691 | 0.24691 |
| box width, 1 digit, in font units | **0.5001** | 0.5001 | 0.5001 |
| box width, 2 digits, in font units | **1.00019** | 1.00019 | 1.00019 |

p10 = p90 = median on every glyph quantity, which is what identifies these as font
metrics rather than measurements of ink. Verovio centres a digit on its string by
setting the baseline one third of the font size below the line; the advance is
exactly 0.5 em per digit, so a two-digit fret is exactly twice as wide.

No constant here is fitted. All of it is read from the engine that rasterises the
page the model sees, so it cannot be confused with a staff line.

## Consequence for the acceptance criterion

**The brief's target of ≥40% median ink coverage is not achievable, and should not
be used as a gate.** Ink coverage measures what fraction of a box's *area* is ink.
A digit is thin strokes inside a thin-stroked em box — "1" is mostly whitespace,
"0" is an outline. Even a box exactly tight to the glyph box will show a low
coverage figure, and raising it means shrinking the box onto the strokes, which
(a) games the metric, (b) destroys the glyph's aspect and the margin needed for
the line context the `string` head depends on, and (c) is not what the crop is
for.

The metric that does mean something is the one the brief already names as
decisive: **the pixel ablation delta**. It is currently +0.00%, which is a real
and unexplained failure, and it is not explained by box height.

## What is still unexplained, and therefore what should happen next

The ablation is 0.00% while the box contains the glyph. That leaves three
candidates, and this milestone has not distinguished between them:

1. **Resolution.** The digit is 253 units tall in a crop rendered at ~0.2 px/unit
   and then tiled to a 192–256px plane. At 20 TAB planes per page each plane shows
   ~1/20th of the strip, so the digit may be only a handful of pixels in the
   tensor the backbone sees. The `8×8` ROI grid over a box then samples that
   handful of pixels. **This is now the leading hypothesis and it is measurable**:
   the digit's height in the tensor, and the stride it lands on (the backbone runs
   strides 1/2/4/8/16; at stride 16 a 5-pixel digit is 0.3px).
2. **The ablation control itself** may be under-powered at this accuracy — a head
   at 10% with a 26-way vocabulary may be too far from signal for 0.00% to be
   meaningful. Needs a head that *can* memorise, to calibrate the control.
3. **The ROI branch's tile weighting.** It softmaxes over per-tile feature
   standard deviation; a plane of uniform paper scores ~0, but a plane containing
   a staff line scores high without containing a digit. The weighting may be
   selecting staff lines rather than digits.

No box change should be made until one of these is measured. Making the box
*smaller* to chase a coverage number would make resolution worse, which is
candidate 1.

## Objection to record: why the box is not simply "adopt getBBox()"

It would be the obvious move and it is the wrong one here. The font box is 370u
against a 253u box, so adopting it shrinks ink coverage and enlarges every crop by
46%, which directly worsens candidate 1. The current box clips the top 47u of the
font box, which is worth fixing — but on the evidence of resolution, not
coverage. Nothing has been changed; the tools are diagnostics and the frozen gate
and all three variants are untouched.

## Tools added

- `tools/guitar-vision/fret_font_metrics.py` — reads `getBBox()` /
  `getExtentOfChar()` from the browser. The authoritative geometry source.
- `tools/guitar-vision/fret_geometry_audit.py` — reads staff lines and baselines
  from the SVG and confirms the baseline rule independently. Its raster-based
  glyph measurement is superseded by the font metrics and is kept only for the
  baseline check it gets right.
- `tools/guitar-vision/measure_fret_ink.py` — the raster measurement, kept as the
  *refutation* of the earlier claim. Its outputs should not be used to set boxes.
