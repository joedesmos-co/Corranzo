# Phase 1 — Font-aware pitch error inventory

- Commit: `f0c0c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Incorrect-pitch mismatches: **0**

## Mechanism counts

| Mechanism | Mismatches |
|---|---:|

Categories can overlap when the same note is both outside the staff and vertically mis-anchored.

## Complete record map

| # | Fixture | Page/System | Staff/Voice | Measure | Expected → generated | Δ semitones / steps / octaves | Clef | Source | Font/glyph | Box | Anchor raw → selected → expected | Staff position generated → expected | Ledger support | Accidental provenance | Confidence | First divergence | Categories |
|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|

The machine-readable companion `pitch_error_inventory.json` contains the complete staff-line coordinate arrays, ledger candidates, vector projection, note candidate/glyph IDs, ownership, accidental provenance, and confidence objects for every row.
