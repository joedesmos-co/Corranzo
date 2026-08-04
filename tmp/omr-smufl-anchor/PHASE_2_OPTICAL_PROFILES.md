# Phase 2 — Optical-center profile derivation

- Commit baseline: `f2d3f05`
- Evidence: Phase 1 fallback inventory + paired ink-vs-metric offsets on frozen corpus PDFs
- No SMuFL `glyphnames.json` / Bravura metadata is bundled in-repo

## Evidence summary

Trusted ink notehead centers (when ink succeeds) place the optical center
**≈ 0.48–0.51 staff spaces above the PDF text origin** for MuseScore-embedded
SMuFL `noteheadBlack` (U+E0A4), across piano and guitar fixtures.

Generic metric fallback (`resolveMetricNoteheadYNorm`) only applies
**≈ 0.23–0.32 staff spaces** for the same glyphs (PDF.js reports tall metric
boxes ~1.5–2.0 staff spaces; the height×centerFactor formula under-corrects).

Residual ≈ **0.18 staff spaces** — enough to flip many nearest staff-step
decisions on dense upper ledgers where ink is rejected
(`no-head-sized-component`, `ambiguous-components`,
`component-outside-font-origin-range`).

The ink component scorer already encodes the same prior
(`yOriginOffset ≈ 0.51`). Metric fallback should reuse that geometry class
prior when ink is unavailable.

## Profile hierarchy (proposed)

| Priority | Profile ID | Match | Correction | Confidence |
|---:|---|---|---|---:|
| 1 | *(ink)* | trusted ink component | visual center | 0.96 |
| 2 | *(explicit metadata)* | none available in-repo | — | — |
| 3 | `musescore-embedded-smufl-notehead-black-v1` | font `g_d*_f*` **or** named bravura/leland/petaluma; glyph U+E0A4; heightRatio ∈ [1.2, 2.4] | origin → optical center = **0.51 × local staff gap** (image-up) | 0.72 |
| 4 | `geometry-smufl-notehead-black-metric-box-v1` | glyph U+E0A4; heightRatio ∈ [1.45, 2.2]; **not** legacy-normalized; unknown/other family only when transform axis-aligned | same 0.51×gap | 0.55 |
| 5 | `generic-metric-fallback` | everything else | existing height×centerFactor | 0.45 |

Unknown fonts that do **not** match SMuFL noteheadBlack + metric-box geometry
keep profile 5 unchanged.

## Profile details

### `musescore-embedded-smufl-notehead-black-v1`

- **Affected fallback tones (inventory):** ~413 MuseScore-embedded U+E0A4 tones
  (dominant corpus population); high-extreme subset ≈ 17 metric-fallback tones
  in the inventory binning.
- **Fonts:** reusable class `musescore-embedded-smufl` (`g_d*_f*` subset IDs)
  plus named SMuFL families when present.
- **Glyph class:** `notehead-black` only for v1 (inventory has no half/whole
  fallback population).
- **Measured anchor error before:** metric offset median ≈ 0.32 spaces vs ink
  prior 0.51 → bias ≈ −0.19 spaces (generated too low / too far down).
- **Measured anchor error after (predicted):** ≈ 0 vs ink prior when profile
  applies; staff-step flips near decision boundaries should decrease.
- **Evidence source:** paired ink vs metric offsets on frozen vector PDFs; ink
  scorer prior `yOriginOffset ≈ 0.51`.
- **Uncertainty:** medium — profile does not use per-document constants, but
  relies on PDF.js metric-box height band; stem-inclusive ink boxes that share
  the same text origin may still need ink (which still wins when available).
- **Unknown glyphs:** no match → generic metric.

### `geometry-smufl-notehead-black-metric-box-v1`

- Narrow geometry-class fallback for axis-aligned U+E0A4 with the same tall
  metric box when the embedded family string is absent/unknown.
- Lower confidence; rejected if multiple profiles could match ambiguously
  with conflicting offsets (v1 uses identical offset, so no conflict).
- **Uncertainty:** higher — apply only when heightRatio is clearly in-band.

### Rejected / deferred profiles

| Profile | Why rejected/deferred |
|---|---|
| Universal Y offset for all music fonts | Hard rule: forbidden |
| Broad stem-composite ownership widening | Prior campaign; global regressions |
| Dense-ledger non-suppression | Prior campaign; global regressions |
| Half/whole notehead optical profiles | No fallback inventory population yet |
| Named Bravura JSON anchors | Metadata not bundled |
| Document/fixture-keyed offsets | Forbidden hardcoding |

## Scaling requirements

Correction is stored as **staff-space units from text origin**, then:

`yNorm = (glyph.y / imageHeight) - (originToOpticalCenterSpaces * gapNorm)`

This scales with local staff spacing, glyph/page transforms that preserve
axis-aligned text origins, and font size (via gap). Non-axis-aligned
transforms fall back to generic metric unless ink succeeds.

## Acceptance plan for Phase 5

Accept `musescore-embedded-smufl-notehead-black-v1` only if:

- High-extreme exact chord accuracy rises materially above 15%
- High-extreme missing tones fall materially below 24
- Global Pitch / missing / extra / Guitar / low-extreme gates hold

Accept geometry-class profile independently only if it helps without regressing
unrelated fonts. Prefer the named MuseScore-embedded family alone if geometry
class is risky.
