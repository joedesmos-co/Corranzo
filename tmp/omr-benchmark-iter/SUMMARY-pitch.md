# OMR benchmark iteration — per-staff clef pitch mapping

## Root cause
Grand-staff pitch mapping conflated **physical staff** (upper/lower) with **clef sign** (G vs F).
Cruel Angel uses **treble clef on both staves** (MusicXML: G/G). Lower-staff notes were
mapped with bass-clef reference → systematic ±12/±24 semitone errors (e.g. G4→G2, C4→C3).

Gymnopédie correctly uses G+F; clef glyphs from distant systems were mis-assigned before
staff-span filtering.

## Fix (generic)
`pitchFromStaffPosition.js`:
- `resolveStaffRoleForY()` — pick upper/lower staff by geometry
- `resolvePitchFromGrandStaff(y, staffLines, staffClefs)` — map MIDI with per-staff clef sign
- `detectStaffClefsFromGlyphs()` — read SMuFL G/F clef glyphs within each staff's y-span

Wired through vector + raster OMR; `pitchMapping` diagnostics on each note.

## Results

| Metric | Gymnopédie | Cruel Angel |
|--------|-----------|-------------|
| pitch | 98.51% → 98.51% | **22.95% → 23.91%** (+1.0pp) |
| onset | 99.15% → 99.15% | 57.12% → 56.90% (−0.2pp) |
| duration | 98.51% → 98.51% | 64.63% → 64.59% (flat) |
| measures Δ | 0 → 0 | +2 → +2 |
| wrong pitch count | 3 → 3 | **1776 → 1748** (−28) |

Debug sample octave-multiple errors: **20 → 3** (±24: 6 → 0). **m1 wrong pitches: 8 → 0**.

## Preserved
Opening beat alignment onset gain, barline/measure grid, clean-score metrics.
