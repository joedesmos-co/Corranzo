# Phase 1 — Glyph-metrics fallback inventory

- Commit: `f2d3f05`
- Created: 2026-08-01T03:41:56.236Z
- Evaluator: frozen 2.0.0 / schema 2
- Production code: **not modified**

## Scope

Every generated note whose `noteheadAnchor.source === glyph-metrics-fallback` across the frozen nine-fixture corpus.

## Scoreboard

- Fallback tones: **413**
- Truth-aligned fallback tones: **347**

## By normalized font family

| Key | Count |
|---|---:|
| `musescore-embedded-smufl` | 413 |

## By embedded subset font name

| Key | Count |
|---|---:|
| `g_d9_f3` | 180 |
| `g_d15_f4` | 101 |
| `g_d13_f3` | 53 |
| `g_d3_f3` | 44 |
| `g_d5_f3` | 33 |
| `g_d17_f4` | 2 |

## By glyph class

| Key | Count |
|---|---:|
| `notehead-black` | 413 |

## By glyph composition class

| Key | Count |
|---|---:|
| `unknown-composition` | 204 |
| `window-saw-chord-stack` | 112 |
| `likely-notehead-plus-stem` | 92 |
| `multi-char-run` | 5 |

## By font|glyph|composition

| Key | Count |
|---|---:|
| `musescore-embedded-smufl|notehead-black|unknown-composition` | 204 |
| `musescore-embedded-smufl|notehead-black|window-saw-chord-stack` | 112 |
| `musescore-embedded-smufl|notehead-black|likely-notehead-plus-stem` | 92 |
| `musescore-embedded-smufl|notehead-black|multi-char-run` | 5 |

## By transform type

| Key | Count |
|---|---:|
| `uniform-or-axis-aligned` | 413 |

## By register

| Key | Count |
|---|---:|
| `high-normal` | 283 |
| `low-normal` | 83 |
| `middle` | 28 |
| `high-extreme` | 17 |
| `low-extreme` | 2 |

## By ink rejection reason

| Key | Count |
|---|---:|
| `no-head-sized-component` | 188 |
| `ambiguous-components` | 155 |
| `component-outside-font-origin-range` | 70 |

## Staff-step error direction (truth-aligned)

| Key | Count |
|---|---:|
| `0` | 163 |
| `-1` | 65 |
| `+1` | 29 |
| `-2` | 19 |
| `+3` | 18 |
| `-3` | 13 |
| `-4` | 13 |
| `+2` | 9 |
| `-5` | 6 |
| `+4` | 5 |
| `-6` | 3 |
| `+5` | 2 |
| `+7` | 2 |

## Staff-step error magnitude (truth-aligned)

| Key | Count |
|---|---:|
| `0` | 163 |
| `1` | 94 |
| `3` | 31 |
| `2` | 28 |
| `4` | 18 |
| `5` | 8 |
| `6` | 3 |
| `7` | 2 |

## Ink-calibrated optical-center prior

- Trusted ink anchors (same fonts/glyphs): optical center ≈ **0.5** staff spaces above PDF text origin.
- Generic metric fallback: ≈ **0.32** staff spaces.
- Residual metric bias: ≈ **0.18** staff spaces (enough to flip many nearest-step decisions).

## High-extreme fallback sample

| Fixture | M | Font | Glyph | Reject | Comp | Step err | Pitch Δ |
|---|---:|---|---|---|---|---:|---:|
| piano-dense-advanced-vector | 6 | musescore-embedded-smufl | U+E0A4 | component-outside-font-origin-range | unknown-composition | 1 | 1 |
| piano-dense-advanced-vector | 7 | musescore-embedded-smufl | U+E0A4 | no-head-sized-component | unknown-composition | -1 | -2 |
| piano-dense-advanced-vector | 7 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | 1 | 1 |
| piano-dense-advanced-vector | 7 | musescore-embedded-smufl | U+E0A4 | component-outside-font-origin-range | unknown-composition | -1 | -2 |
| piano-dense-advanced-vector | 8 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | likely-notehead-plus-stem | -1 | -1 |
| piano-dense-advanced-vector | 8 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | -2 | -2 |
| piano-dense-advanced-vector | 8 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | 1 | 1 |
| piano-dense-advanced-vector | 8 | musescore-embedded-smufl | U+E0A4 | component-outside-font-origin-range | unknown-composition | -1 | -1 |
| piano-dense-advanced-vector | 8 | musescore-embedded-smufl | U+E0A4 | component-outside-font-origin-range | unknown-composition | -2 | -2 |
| piano-dense-advanced-vector | 8 | musescore-embedded-smufl | U+E0A4 | component-outside-font-origin-range | unknown-composition | -1 | -1 |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | — | — |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | — | — |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | — | — |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | — | — |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | component-outside-font-origin-range | unknown-composition | — | — |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | — | — |
| piano-dense-advanced-vector | 9 | musescore-embedded-smufl | U+E0A4 | ambiguous-components | window-saw-chord-stack | — | — |

## Notes for Phase 2

- Optical-center profiles must key on `fontFamily` + `normalizedMusicalGlyphClass` (and composition class when height implies stem-inclusive metrics).
- No SMuFL glyphnames metadata is bundled in-repo; profiles must derive from geometry + reusable font/glyph identity observed in PDF text.
- MuseScore embedded subset IDs (`g_d*_f*`) carrying U+E0A4 are the dominant fallback population; treat as `musescore-embedded-smufl`.
- Unknown / other-music-font families must keep the existing generic metric fallback.

