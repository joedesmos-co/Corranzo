# OMR benchmark iteration — key-relative accidental carry-forward

## Error analysis (Cruel Angel dense, before)

| Category | Count | Share |
|----------|------:|------:|
| other (note matching / staff) | 1168 | 67% |
| ±2 diatonic | 338 | 19% |
| ±1 accidental/key | 155 | 9% |
| ±octave | 85 | 5% |

Key signature detection is correct (`fifths: -3`, Eb major). Remaining ±1 errors are
mostly missing carried sharps/flats on repeated letter names within a measure, not
key-signature detection failure.

## Root cause

Measure accidental carry-forward applied `alter` to the **written natural pitch**
(`naturalMidi + alter`). That is correct for diatonic steps outside the key signature
(e.g. D → D# in Eb), but wrong for steps affected by the key signature (e.g. B♭ + ♯ carry
should yield B♮, not B♯).

Full key-relative resolution (`resolveMeasureNotePitch`) fixed carry semantics but
regressed dense matching (+1 wrong) and broke Gymnopédie dense-chord binding when paired
with greedy accidental assignment.

## Fix (generic)

`omrPitchAlteration.js`:
- `resolveNotePitchWithMeasureState()` — hybrid semantics
  - **Local glyph accidentals**: apply to written natural pitch (preserves existing chord binding)
  - **Measure carry-forward**: apply relative to **key-default pitch**
- Exclusive one-to-one accidental binding with vertical staff-line alignment (unchanged)
- `pitchAlteration` diagnostics on each note (written pitch, key default, local/carry state)

## Results

| Metric | Gymnopédie (medium) | Cruel Angel (dense) |
|--------|--------------------:|--------------------:|
| pitch accuracy | 98.51% → **98.51%** | 23.91% → **23.95%** |
| correct pitches | — | 672 → **673** (+1) |
| wrong pitches | 3 → **3** | 1748 → **1748** |
| onset | unchanged | **56.94%** (preserved) |
| measures Δ | unchanged | **+2** (preserved) |

## Tests

- `tests/omrPitchAlteration.test.js` — key signature, carry-forward, binding, diagnostics
- `tests/pdfOmrMusical.test.js` — dense-chord natural binding, key-signature cancellation
