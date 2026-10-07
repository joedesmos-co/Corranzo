# Guitar fret input-quality gate (V1 productization)

Implementation: `tools/guitar-vision/python/guitar_vision/quality_gate.py`
(pure stdlib, no model, no thresholds in user copy).
Tests: `tools/guitar-vision/python/tests/test_quality_gate.py` (14 passed).

## Metric

`effective_height_px = (y1 - y0) * 256` for plane-normalized fret boxes — the digit
cap height in plane pixels. Height, not min-dimension: native 1-digit glyphs are
22-36 px wide yet transcribe at 1.000 (measured h84/h87), so a min-dimension gate
would reject the reliable region itself. Cap height is digit-count invariant and
stable under the loader's horizontal tile squeeze.

## Internal thresholds (provisional — FIT/SAME-derived, NOT universal)

| effective height | class | measured basis |
|---|---|---|
| >= 39 | ACCEPT | 1.0000 at 39.2 |
| 35-39 | WARN | 0.23 at 37.2 |
| 31-35 | STRONG_WARN | 0.06-0.14 |
| < 31 | REJECT | chance |

Boundaries belong upward (39.0 accepts, 31.0 strong-warns). Every report carries
`gate_version: fret-quality-gate/v1` plus this provenance string so future
calibration on real-world Guitar inputs can supersede it. Do not hard-code these
into the product as universal constants without that calibration.

## Product behavior

| class | behavior |
|---|---|
| ACCEPT | process normally, no message |
| WARN | process; "Some fret numbers are a bit small, so a few may be less certain." |
| STRONG_WARN | process with low-confidence flags; "Some fret numbers are too small to read confidently. Try a higher-resolution PDF, scan, or photo." |
| REJECT (object) | no fret number emitted (None/unsupported) — never invented |
| page, all fret REJECT | refuse fret transcription for the page; "This TAB is too low-resolution to read reliably. …" |
| page, mixed | process the readable, refuse only affected objects, report localized indices |

Vector sources get the "...larger or higher-resolution export" variant. No pixel
numbers reach ordinary users.

## Vector vs raster

The gate measures effective post-load resolution, which is what the model sees —
identical logic for all inputs. `SourceType` (vector/raster/photo/unknown) is
recorded in diagnostics and selects the help copy. For vector: low effective
resolution means a dense/small layout, not a bad scan — do not blame source
quality when re-rendering could help. For raster/photo: missing pixels are
unrecoverable; say so by asking for a better source, not by guessing.

## Partial success and diagnostics

`assess_page` returns per-object verdicts + `refused_indices`/`affected_indices`;
`gate_fret_numbers` maps REJECT to None positionally. Unrelated heads
(object/string/tile) are never touched — proven by test. Diagnostics persist
gate version, thresholds, source type, counts, and per-object px + class
(JSON-serializable, deterministic). No source content is collected.

## Calibration plan (not this task)

Collect per-object heights + gate class + downstream correction rate on real
inputs; re-fit the three cut points; bump the version string. The tiny-glyph
synthetic failure (32/32 rows at 9.08 px, unanimously refused by the frozen gate
without ever reading its labels) is the standing proof the mechanism catches the
known failure mode.
