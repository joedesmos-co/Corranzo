# Phase 1 — Font-aware pitch error inventory

- Commit: `15422cd`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Incorrect-pitch mismatches: **26**

## Mechanism counts

| Mechanism | Mismatches |
|---|---:|
| accidental-error | 26 |
| ledger-line-ownership | 3 |

Categories can overlap when the same note is both outside the staff and vertically mis-anchored.

## Complete record map

| # | Fixture | Page/System | Staff/Voice | Measure | Expected → generated | Δ semitones / steps / octaves | Clef | Source | Font/glyph | Box | Anchor raw → selected → expected | Staff position generated → expected | Ledger support | Accidental provenance | Confidence | First divergence | Categories |
|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | piano-dense-advanced-vector | 1/0 | 1/1 | 1 | F4 → F#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 222.328,272.851 17.157×24.508 | 0.229798 → 0.224589 → factor 0.3003 | 1 → 1 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 2 | piano-dense-advanced-vector | 1/0 | 1/1 | 1 | G4 → G#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 235.784,266.316 17.157×24.508 | 0.224747 → 0.219539 → factor 0.2988 | 2 → 2 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 3 | piano-dense-advanced-vector | 1/0 | 1/1 | 1 | F4 → F#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 249.24,272.851 17.157×24.508 | 0.229798 → 0.224589 → factor 0.3003 | 1 → 1 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 4 | piano-dense-advanced-vector | 1/0 | 1/1 | 2 | G4 → G#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 391.275,266.316 17.157×24.508 | 0.224747 → 0.219474 → factor 0.2988 | 2 → 2 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 5 | piano-dense-advanced-vector | 1/0 | 1/1 | 2 | A4 → A#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 409.216,259.78 17.157×24.508 | 0.219697 → 0.214488 → factor 0.2974 | 3 → 3 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 6 | piano-dense-advanced-vector | 1/0 | 1/1 | 2 | G4 → G#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 427.157,266.316 17.157×24.508 | 0.224747 → 0.219539 → factor 0.2988 | 2 → 2 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 7 | piano-dense-advanced-vector | 1/0 | 1/1 | 3 | C5 → C#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 572.68,246.71 17.157×24.508 | 0.209596 → 0.204387 → factor 0.2945 | 5 → 5 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 8 | piano-dense-advanced-vector | 1/0 | 1/1 | 3 | A4 → A#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 590.621,259.78 17.157×24.508 | 0.219697 → 0.214488 → factor 0.2974 | 3 → 3 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 9 | piano-dense-advanced-vector | 1/0 | 1/1 | 3 | A4 → A#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 626.503,259.78 17.157×24.508 | 0.219697 → 0.214488 → factor 0.2974 | 3 → 3 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 10 | piano-dense-advanced-vector | 1/0 | 1/1 | 3 | C5 → C#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 644.444,246.71 17.157×24.508 | 0.209596 → 0.204387 → factor 0.2945 | 5 → 5 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 11 | piano-dense-advanced-vector | 1/0 | 1/1 | 4 | C5 → C#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 807.908,246.71 17.157×24.508 | 0.209596 → 0.204387 → factor 0.2945 | 5 → 5 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 12 | piano-dense-advanced-vector | 1/0 | 1/1 | 4 | A4 → A#4 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 843.791,259.78 17.157×24.508 | 0.219697 → 0.214488 → factor 0.2974 | 3 → 3 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 13 | piano-dense-advanced-vector | 1/1 | 1/1 | 5 | C5 → C#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 222.328,687.846 17.157×24.508 | 0.550505 → 0.545246 → factor 0.2924 | 5 → 5 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 14 | piano-dense-advanced-vector | 1/1 | 1/1 | 5 | D5 → D#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 235.784,681.311 17.157×24.508 | 0.545455 → 0.540196 → factor 0.2935 | 6 → 6 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 15 | piano-dense-advanced-vector | 1/1 | 1/1 | 5 | C5 → C#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 249.24,687.846 17.157×24.508 | 0.550505 → 0.545246 → factor 0.2924 | 5 → 5 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 16 | piano-dense-advanced-vector | 1/1 | 1/1 | 6 | F5 → F#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 373.333,668.24 17.157×24.508 | 0.535354 → 0.530095 → factor 0.2957 | 8 → 8 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 17 | piano-dense-advanced-vector | 1/1 | 1/1 | 6 | D5 → D#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 391.275,681.311 17.157×24.508 | 0.545455 → 0.540196 → factor 0.2935 | 6 → 6 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 18 | piano-dense-advanced-vector | 1/1 | 1/1 | 6 | D5 → D#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 427.157,681.311 17.157×24.508 | 0.545455 → 0.540196 → factor 0.2935 | 6 → 6 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 19 | piano-dense-advanced-vector | 1/1 | 1/1 | 6 | F5 → F#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 445.098,668.24 17.157×24.508 | 0.535354 → 0.530095 → factor 0.2957 | 8 → 8 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 20 | piano-dense-advanced-vector | 1/1 | 1/1 | 7 | F5 → F#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 554.739,668.24 17.157×24.508 | 0.535354 → 0.530095 → factor 0.2957 | 8 → 8 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 21 | piano-dense-advanced-vector | 1/1 | 1/1 | 7 | G5 → G#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 572.68,661.705 17.157×24.508 | 0.530303 → 0.525044 → factor 0.2968 | 9 → 9 | 1/1 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership |
| 22 | piano-dense-advanced-vector | 1/1 | 1/1 | 7 | G5 → G#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 644.444,661.705 17.157×24.508 | 0.530303 → 0.525044 → factor 0.2968 | 9 → 9 | 1/1 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership |
| 23 | piano-dense-advanced-vector | 1/1 | 1/1 | 7 | F5 → F#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 662.386,668.24 17.157×24.508 | 0.535354 → 0.530095 → factor 0.2957 | 8 → 8 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 24 | piano-dense-advanced-vector | 1/1 | 1/1 | 8 | F5 → F#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 789.967,668.24 17.157×24.508 | 0.535354 → 0.530139 → factor 0.2957 | 8 → 8 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |
| 25 | piano-dense-advanced-vector | 1/1 | 1/1 | 8 | G5 → G#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 807.908,661.705 17.157×24.508 | 0.530303 → 0.525044 → factor 0.2968 | 9 → 9 | 1/1 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership |
| 26 | piano-dense-advanced-vector | 1/1 | 1/1 | 8 | F5 → F#5 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 825.85,668.24 17.157×24.508 | 0.535354 → 0.530095 → factor 0.2957 | 8 → 8 | 0/0 | — | 0.92 | accidental_state (0.95) | accidental-error |

The machine-readable companion `pitch_error_inventory.json` contains the complete staff-line coordinate arrays, ledger candidates, vector projection, note candidate/glyph IDs, ownership, accidental provenance, and confidence objects for every row.
