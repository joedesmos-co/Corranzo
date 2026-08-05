# Phase 1 — Font-aware pitch error inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Incorrect-pitch mismatches: **1**

## Mechanism counts

| Mechanism | Mismatches |
|---|---:|
| wrong-staff-step-anchor | 1 |

Categories can overlap when the same note is both outside the staff and vertically mis-anchored.

## Complete record map

| # | Fixture | Page/System | Staff/Voice | Measure | Expected → generated | Δ semitones / steps / octaves | Clef | Source | Font/glyph | Box | Anchor raw → selected → expected | Staff position generated → expected | Ledger support | Accidental provenance | Confidence | First divergence | Categories |
|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | piano-articulation-scan | 1/0 | 1/1 | 3 | F#4 → G#4 | 2 / 1 / 0 | treble | raster-or-path | — — — | 563,283 25×15 | 0.22643 → 0.224483 → factor — | 1 → 1 | 0/0 | — | 0.802872380952381 | pitch_mapping (0.85) | wrong-staff-step-anchor |

The machine-readable companion `pitch_error_inventory.json` contains the complete staff-line coordinate arrays, ledger candidates, vector projection, note candidate/glyph IDs, ownership, accidental provenance, and confidence objects for every row.
