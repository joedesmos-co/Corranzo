# Phase 1 — Font-aware pitch error inventory

- Commit: `3ff28ab`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Incorrect-pitch mismatches: **12**

## Mechanism counts

| Mechanism | Mismatches |
|---|---:|
| ledger-line-ownership | 11 |
| accidental-error | 7 |
| wrong-staff-step-anchor | 4 |
| evaluator-alignment-symptom-or-unresolved | 1 |

Categories can overlap when the same note is both outside the staff and vertically mis-anchored.

## Complete record map

| # | Fixture | Page/System | Staff/Voice | Measure | Expected → generated | Δ semitones / steps / octaves | Clef | Source | Font/glyph | Box | Anchor raw → selected → expected | Staff position generated → expected | Ledger support | Accidental provenance | Confidence | First divergence | Categories |
|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | guitar-standard-chords-vector | 1/0 | 1/1 | 1 | F#4 → F4 | -1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 195.417,305.528 17.157×24.508 | 0.255051 → 0.251784 → factor 0.2718 | 1 → 1 | 0/0 | — | 0.92 | pitch_mapping (0.85) | evaluator-alignment-symptom-or-unresolved |
| 2 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | E3 → F3 | 1 / 1 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 337.451,733.593 17.157×24.508 | 0.585859 → 0.580757 → factor 0.2336 | -7 → -7 | 3/4 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership, wrong-staff-step-anchor |
| 3 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | A3 → A#3 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 337.451,713.987 17.157×24.508 | 0.570707 → 0.565301 → factor 0.2446 | -4 → -4 | 1/2 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership |
| 4 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | E3 → F3 | 1 / 1 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 373.333,733.593 17.157×24.508 | 0.585859 → 0.580757 → factor 0.2336 | -7 → -7 | 2/4 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership, wrong-staff-step-anchor |
| 5 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | A3 → A#3 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 373.333,713.987 17.157×24.508 | 0.570707 → 0.565301 → factor 0.2446 | -4 → -4 | 1/2 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership |
| 6 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | E3 → F3 | 1 / 1 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 409.216,733.593 17.157×24.508 | 0.585859 → 0.580757 → factor 0.2336 | -7 → -7 | 1/4 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership, wrong-staff-step-anchor |
| 7 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | E3 → F3 | 1 / 1 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 445.098,733.593 17.157×24.508 | 0.585859 → 0.580757 → factor 0.2336 | -7 → -7 | 2/4 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership, wrong-staff-step-anchor |
| 8 | guitar-standard-chords-vector | 1/1 | 1/1 | 6 | A3 → A#3 | 1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 445.098,713.987 17.157×24.508 | 0.570707 → 0.565301 → factor 0.2446 | -4 → -4 | 1/2 | — | 0.92 | accidental_state (0.95) | accidental-error, ledger-line-ownership |
| 9 | guitar-standard-chords-vector | 1/1 | 1/1 | 7 | C#3 → C3 | -1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 554.739,746.664 17.157×24.508 | 0.59596 → 0.590776 → factor 0.2262 | -9 → -9 | 3/5 | — | 0.92 | pitch_mapping (0.85) | ledger-line-ownership |
| 10 | guitar-standard-chords-vector | 1/1 | 1/1 | 8 | F#2 → F2 | -1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 754.085,772.806 17.157×24.508 | 0.616162 → 0.610896 → factor 0.2116 | -13 → -13 | 6/7 | — | 0.92 | pitch_mapping (0.85) | ledger-line-ownership |
| 11 | guitar-standard-chords-vector | 1/1 | 1/1 | 8 | C#3 → C3 | -1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 754.085,746.664 17.157×24.508 | 0.59596 → 0.590804 → factor 0.2262 | -9 → -9 | 5/5 | — | 0.92 | pitch_mapping (0.85) | ledger-line-ownership |
| 12 | guitar-standard-chords-vector | 1/1 | 1/1 | 8 | F#3 → F3 | -1 / 0 / 0 | treble | pdf-text-glyph | g_d1_f3 U+E0A4 black | 754.085,727.058 17.157×24.508 | 0.580808 → 0.575625 → factor 0.2372 | -6 → -6 | 3/3 | — | 0.92 | pitch_mapping (0.85) | ledger-line-ownership |

The machine-readable companion `pitch_error_inventory.json` contains the complete staff-line coordinate arrays, ledger candidates, vector projection, note candidate/glyph IDs, ownership, accidental provenance, and confidence objects for every row.
