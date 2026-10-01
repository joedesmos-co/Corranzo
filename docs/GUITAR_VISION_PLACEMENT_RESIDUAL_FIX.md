# Closing the last placement gap — results

Follows [`GUITAR_VISION_COORDINATE_FRAME_FIX.md`](GUITAR_VISION_COORDINATE_FRAME_FIX.md),
which fixed the coordinate frame but left a 10% placement residual. This closes it.

Audit tool: `tools/guitar-vision/r1_placement_audit.py`.

## Verdict

**Closed. Placement is 100% for every semantic object family, the target signal is
stronger than before, and the causal calibration is healthy.**

Two *separate* defects were behind the residual, and only one of them was the one
that had been diagnosed.

| | before | after |
|---|---|---|
| fret digits placed on a tile | 90.0% | **100.0%** (1162/1162) |
| noteheads placed on a tile | 99.8% | **100.0%** (1162/1162) |
| markings placed on a tile | 99.6% | **100.0%** (284/284) |
| fret boxes with no ink under them | 14 | **0** |
| fixtures measured by the harness | 159/180 | **180/180** |
| `FINAL_ROI` target signal | 205 samples | **209** samples |
| held-out `FINAL_ROI` | 207 | **208** |

---

## 1–3. R1: the refusals, measured

Every fret object enumerated through production, split PLACED / REFUSED.

**127 refused**, and the distribution is completely degenerate:

| | |
|---|---|
| violated edge | **bottom only**, 127/127 |
| visible ink clipped | **0** — `whitespace_only`, 127/127 |
| strings | 6 (115), 5 (11), 0 (1) |
| bottom overshoot | median **1.14 px**, p90 1.34, **max 2.34** |
| `trim[3] == trimmed height` | **127/127** — the trim ran to the last raster row |
| box bottom → nearest ink | median 2.34 px |

So the hypothesis is **confirmed exactly**: every refusal was semantic box
whitespace below the last ink row, removed by the content-derived trim. Not one
refusal clipped a glyph.

A second, previously invisible population only surfaced once these were fixed:

**14 fret boxes were *placed* but sat on blank paper.** All two-digit frets on the
first or last tile of a strip. They had been misaligned since before the frame fix
— checked against the `ad90a5ca4a` loader, where they also read `ink = 0.000` — so
they were never part of the 127. See §5.

## 4. R2: trim vs semantic frame

`trim = ImageOps.invert(grey).getbbox()` **did** change the semantic coordinate
domain without preserving the removed margins in the *plane*. `inset` recorded the
trim, and `build_sample` composed it — so the metadata was there, but the plane
itself had been cut to the ink, and a box had to fit inside the *ink*, not inside
the crop.

That is the contract error. A semantic box is built from font metrics and reaches
`baseline + 0.03 × font_size`; on the bottom string the lowest ink on the page *is*
the bottom staff line, so the trim cut precisely where those boxes end. The raster
was allowed to define a domain that geometry lives in.

**Design chosen: option C — the plane represents the whole crop; the trim is
storage only.** It is the cleanest of the three offered because it deletes the
inset composition outright rather than patching its result, and it is provably
target-independent: the plane's extent comes from the crop, and the crop comes from
bands that were already widened to contain every box.

Cost, measured before committing to it:

| view | kept width | kept height |
|---|---|---|
| tab | 0.912 | 0.958 |
| notation | 0.985 | 0.986 |

A fret box goes from 23.9 × 41.1 px to 23.3 × 39.2 px in the plane — still about
four times the 6 px floor the loader asserts. Buying that margin back by
re-introducing a semantic trim is what caused the loss.

## 5. R3: two target-independent fixes

Nothing keys on a fret, a string, a label, or the box being evaluated. Both derive
from global geometry.

**Fix 1 — the plane spans the crop, not the ink.** `_load_view` resizes the whole
crop to the plane and pastes the trimmed content at its true offset; `build_sample`
frames a view by `view_rect` alone. Extent comes from the crop; the trim only
decides which stored pixels are non-blank.

**Fix 2 — a short final tile is pasted whole.** A partial last tile is *resized*
(stretched to the plane) but the paste was truncated to the **pre-resize** width:

```python
plane[:, : min(width, strip_width)] = strip[:, : min(width, strip_width)]
```

so the stretched right-hand region was never written while the tile still reported
a rect covering it. `plane_box` — correctly, because it trusts rects — placed boxes
on white paper. That is the whole of the 14. The paste now uses the full width
after a resize.

The 127 needed only fix 1. The 14 needed only fix 2. They are independent and both
were necessary.

## 6. R4: regression tests

Four new tests, **45 → 49**. Verified to fail on the `ad90a5ca4a` loader and pass
after:

| test | fails pre-fix because |
|---|---|
| `test_every_fret_digit_that_is_placed_has_ink_under_it` | 14 placed boxes on blank paper |
| `test_a_short_final_tile_is_pasted_whole_not_truncated` | short tile's ink stops at column ~165 of a 206 strip stretched to 256 |
| `test_the_plane_spans_the_whole_crop_not_the_trimmed_content` | plane width tracks the trim, not the crop |
| `test_placement_is_target_independent_and_complete` | 99.8%, not 100% |

Coverage spans the cases named in the brief: bottom-string digits near the lower
boundary (the 127), boxes whose whitespace exceeds their ink (the 14, two-digit
frets at both crop edges), tile-boundary objects, single and double digit, and all
six strings — every one sweeps the corpus rather than sampling it. No test contains
a target-aware branch; `test_placement_is_target_independent_and_complete`
requires **all six** families to reach 100%, which is what would catch a future
fret-only shortcut.

## 7–9. R5: placement gate

| family | before | after | gate |
|---|---|---|---|
| fret-digit | 1046/1162 = 90.0% | **1162/1162 = 100.0%** | ≥99% ✅ |
| notehead | 1160/1162 = 99.8% | **1162/1162 = 100.0%** | ≥99% ✅ |
| marking | 283/284 = 99.6% | **284/284 = 100.0%** | ✅ |

No object is excluded from any denominator. The audit's `no-view` count (411
noteheads, 103 markings) is *not* a placement failure: those are objects on the 18
scores that carry a TAB band only and therefore have no notation view to index. They
are page-kind facts, unchanged, and excluded identically before and after.

**Remaining refusal taxonomy: empty.** 0 refused, 0 placed-on-blank, 0 unplaced,
across every family.

## 10–11. R6: 180-fixture causal harness

| | |
|---|---|
| fixtures | 180 (60 scores, 29 score-disjoint held out) |
| CLASS 1 / 2 / 3 | **180 / 0 / 0** |
| measured | **180** (was 159; 0 refused, 0 tile-identity failures) |
| tile identity | **180/180** |
| A reproduces committed corpus | **180/180**, all three kinds |
| box → glyph error | **−2.2, +3.5** layout units (unchanged) |

| stage | nonzero | max | eff w×h | ACTUAL/EXPECTED | energy in box |
|---|---|---|---|---|---|
| PAGE | 651 | 1.000 | 30×46 | – | 1.000 |
| INK_CONTENT | 598.5 | 1.000 | 29×40 | 0.9999 | 0.99973 |
| RESIZED_ARRAY | 598.5 | 1.000 | 29×40 | 1.0001 | 0.99973 |
| TILE | 598.5 | 1.000 | 29×40 | 1.0000 | 0.99973 |
| SQUARE_PLANE | 507 | 1.000 | 24×40 | 1.0013 | 0.99967 |
| PRE_ROI | 507 | 1.000 | 24×40 | – | 0.99967 |
| **FINAL_ROI** | **209** | **1.000** | **18×20** | 1.0000 | **0.99992** |

Retention is unchanged at ~1.0, so no resampling loss was introduced. Effective ROI
sampling 37.2 × 62.7 px across 32×32, i.e. 1.16 × 1.96 plane px per sample —
still not the bottleneck.

**Held-out (29 score-disjoint fixtures): `FINAL_ROI` 208 samples, 18×20, max 1.0.**
Indistinguishable from the primary set (209).

The frame fix from `ad90a5ca4a` is intact: same box error, same transform, same
CLASS 1 result, same retention.

## 12. R7: unchanged 300-step calibration

| condition | pre-frame | post-frame | **post-residual** |
|---|---|---|---|
| real | 59.6% | 77.1% | **65.9%** |
| blank | 25.0% | 19.3% | **17.6%** |
| shuffled | 69.2% | 47.0% | **38.8%** |
| wrong_roi | 69.2% | 39.8% | **36.5%** |

**Causal separation is healthy and the budget was not touched.**

```
real 65.9%  >  shuffled 38.8%  >  wrong_roi 36.5%  >  blank 17.6%
```

`real` fell from 77.1% to 65.9% while the probe's target set *grew* from 83 to 85
— the two bottom-string digits that were previously dropped are now present and
must actually be read. That is the task getting harder, not the signal degrading:
`blank` moved down too (19.3 → 17.6), and the separation widened.

The 1200-step result is kept only as the established capacity diagnostic
(real 100.0%, blank 19.3%) and is not re-run.

## 13. Gate: **PASS**

Placement 100% (≥99% required) and causal calibration healthy
(real > shuffled > wrong_roi > blank). R8 is therefore authorised.

## 14. Frozen fret variants

Run once, with the existing preregistered budgets and configs, no tuning of
architecture or losses. See the summary for results.

## 15. Is architecture implicated by the held-out result?

**No.** Nothing in this milestone implicates the architecture, and nothing here
should be read as doing so:

- target signal reaches `FINAL_ROI` at max difference 1.0 across 209 samples;
- ACTUAL/EXPECTED retention is 1.0 at every stage, so nothing is lost in resampling;
- effective sampling is ~1.2 × 2.0 plane px per ROI sample with the glyph spanning
  18×20 of 32×32;
- at equal budget the probe memorises 100% of real pixels while blank stays flat;
- `real` dominates every control at the unchanged 300-step budget.

What remains open is the frozen gate's end-to-end number at full scale, which is
what the variant run measures. That is a train/held-out generalisation question,
not a placement or representation one — and per the brief, held-out transfer is the
question the gate exists to answer, not something this geometry milestone claims.

## Method notes

- `r1_placement_audit.py` asks **production** which objects it placed, then uses
  local geometry only to diagnose the rest. It is view-aware: a fret digit lives in
  the TAB view and a notehead in notation, and measuring either against the wrong
  view reports it out of frame when it is perfectly placed. A record stores an
  object's type by name and a collated sample by index; both directions are handled.
- The audit's first two versions were wrong in ways worth recording: an inverted
  right/bottom sign convention, and noteheads measured against the TAB view. Both
  reported 0% or 1162 refusals. Neither matched production, which is what caught
  them — placement truth is taken from production, never from the diagnostic's own
  arithmetic.
- The harness gained an `INK_CONTENT` stage in place of `TRIMMED_CROP`, since the
  plane no longer represents trimmed content. Its energy-in-box is now measured in
  the paste's own frame.
- The pre-fix corpus is preserved at `tmp/gvprobe/corpus_prefix_backup/train`.