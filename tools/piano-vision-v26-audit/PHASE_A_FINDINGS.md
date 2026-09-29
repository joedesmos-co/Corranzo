# Phase A — Forensic audit: why production PDFs destroy pitch

Frozen champion: V2.5 step-2100, `sha256 10fe90b9…7373e1`, 26,332,539 params,
images 192×512, `region_grid=3`. All numbers below come from the scripts in
`tools/piano-vision-v26-audit/`, run on CPU against that exact checkpoint.
Nothing was trained. Source corpus = factory validation (3 deterministic
scores). Production corpus = `out/realpdf`, rebuilt by the unmodified
`build_corpus.py` from the same PDFs the failed campaign used.

## Headline

The brief's premise — *"geometry by itself was not the major failure.
Production raster / visual representation was"* — **is not supported by the
evidence, and the opposite is true.** The prior `DIAGNOSIS.md` perturbed
geometry while holding pixels byte-identical, so it could not measure the
raster at all. When the raster is actually swapped, nothing happens.

| probe | written pitch | Δ | n |
|---|---|---|---|
| production as-is (PyMuPDF 150 DPI) | 0.0550 | — | 200 |
| **same geometry, FACTORY raster (pdfjs 1000 px)** | **0.0500** | **−0.005** | 200 |
| production raster, box restored to corpus 1.18×1.84 | 0.0950 | +0.040 | 200 |
| production raster + box restored, factory raster | 0.1000 | +0.045 | 200 |

Swapping the raster to the exact training convention is worth **nothing**.
Repairing the box geometry is worth 8× more. The pixel domain is not the
bottleneck.

## What was ruled out

**1. Raster / antialiasing / DPI / colour.** The factory renders via
`pdfjs-dist` + `@napi-rs/canvas` at 1000 px page width; production uses PyMuPDF
at 150 DPI. Intermediate-gray fraction (antialiasing signature) is 0.124 source
vs 0.115 production — near identical. Alpha is constant 255 in the factory
pages, so the RGBA→L conversion is a no-op. Swapping the raster moves written
pitch by −0.005 (above).

**2. `graph_features` / `source_features`.** Production zeroes both; the source
domain gives them real signal (mean_abs 0.228 / 0.229). Zeroing them on the
source corpus costs nothing:

| arm | written pitch | staff step | duration |
|---|---|---|---|
| baseline | 0.9889 | 0.9879 | 0.9965 |
| zero `graph_features` | 0.9879 | 0.9868 | 0.9875 |
| zero `source_features` | 0.9889 | 0.9879 | 0.9965 |
| zero both | 0.9889 | 0.9868 | 0.9865 |

**3. The clef / context path.** Perfect on production — `clef` 1.0000,
`clef_line` 1.0000, `clef_octave` 1.0000, `key_fifths` 0.9804.

**4. Clipping.** `object_features[10..11]` are `clip(·, −2, 2)`; measured range
is [−1.19, +1.34]. The clip never binds. Hypothesis rejected.

## What the failure actually is

**The representation is sufficient; the pitch head miscalibrates it.**

A 37-feature MLP probe, trained and tested **within production**, on
source-only scalars, with **no pixels at all**:

| features | staff step (held-out) | written step (held-out) |
|---|---|---|
| production majority baseline | 0.195 | 0.229 |
| **V2.5 champion** | **0.360** | **0.105** |
| the model's own 24-dim object vector | 0.400 | 0.206 |
| + scale-free staff channels | **0.533** | 0.238 |

A trivial probe beats the qualified 26 M-parameter model on staff step by
**+17 points** and on written step by **+10 points**, using 140 training
objects and zero image data. The information is present. The head is not
reading it.

The same probe trained on source and applied zero-shot to production scores
0.12–0.22 — i.e. the *source* mapping does not transfer. That is the real
defect: not missing information, but a **domain-specific geometry→pitch
mapping**.

## Mechanism

`pitch_written_step` sits *below* its 1-in-7 chance baseline (0.105 vs 0.143).
Scoring below chance is the signature of a consistent displacement, not noise.
Measured `(predicted − true)` on production: `−1`×39, `−2`×33, `+2`×23,
`0`×22, `+1`×21 — an error band of roughly **±1 staff space**, on a model that
is exact on source (987/988).

The cause is in the object vector (`piano_vision/data.py::_object_vector`). The
**only** staff-relative channels are indices 10 and 11:

```python
np.clip((cy - upper_y) / sh, -2, 2),   # sh = SCOPE HEIGHT
np.clip((cy - lower_y) / sh, -2, 2),
```

They are divided by the **scope height**, not the **staff gap**. `sh` is a
measure-dependent, detector-dependent quantity whose production distribution is
far heavier-tailed:

| `object_features[13]` (scope height) | p5 | p50 | p95 |
|---|---|---|---|
| source | 0.0862 | 0.0863 | 0.0997 |
| production | **0.0239** | 0.0781 | 0.0878 |

A 3.6× heavier low tail means the same musical position lands at up to 3.6×
the feature value it had in training. There is **no** gap-normalized,
un-clipped staff-relative channel anywhere in the model. The quantity that
actually determines pitch — `(band_centre − cy) / staff_gap` — is never supplied.

So the head falls back on the visual grid, and the grid cannot help:
`region_grid=3` samples 3 points across a region that spans ~4.6 staff spaces
(`region_h_spaces` 4.87 source / 4.55 production), i.e. **fewer samples than
staff lines**, with no staff-specific ROI. The prior `DIAGNOSIS.md` measured
exactly this: resizing that box on clean pixels cost 29 points.

## Resolution, for the record

The production region is **0.61× the pixel area** of source at equal staff-space
extent — the domain genuinely is lower-resolution (staff space 12.4 px vs
17.6 px in the 192×512 view) — but per §1 this is not what breaks pitch.

## Conclusion

The bottleneck is a **representation/normalization defect on the pitch path,
plus a head calibrated to the source normalization**. It is *not* a visual
backbone problem. The fix belongs in the pitch feature channel and a
parameter-efficient adapter, with the strong V2.5 semantic core frozen.
Adapting the visual trunk — as the failed 300-step run did — attacks the wrong
component and pays for it in the −0.028 retention regression.
