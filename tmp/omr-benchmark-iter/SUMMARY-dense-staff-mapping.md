# OMR benchmark iteration — dense staff / pitch mapping

## Error analysis (Cruel Angel dense, baseline)

| Category | Count (sample in report) | Likely cause |
|----------|-------------------------:|--------------|
| other | ~67% | Note matching + wrong staff + large interval |
| ±2 diatonic | ~19% | Staff line / notehead y rounding |
| ±1 accidental | ~9% | Key / carry (prior pass) |
| ±octave | ~5% | Wrong staff / clef |

Dense clusters **6–7 ink rows per staff** (not 5). Quintet extraction is available via
`normalizedStaffLineYs()` but wiring it into pitch mapping did not beat benchmarks yet.

## Changes kept (no metric regression)

### Grand-staff ledger span clipping (`pitchFromStaffPosition.js`)
- `staffSpanWithLedger()` accepts optional `clipTop` / `clipBottom`
- `resolveStaffRoleForY()` clips treble/bass ledger spans at `splitY` so dense systems
  do not double-assign notes in the inter-staff gap

### Staff-line row metadata (`detectStaffLines.js`)
- `normalizedStaffLineYs()` — pick 5 uniformly spaced rows from 6–7 row clusters
- Staves carry optional `lineYs` for diagnostics/future pitch refinement

### Pitch error diagnostics
- `src/features/omr/omrPitchErrorAnalysis.js`
- `scripts/analyze-omr-pitch-errors.mjs`
- `tests/omrPitchStaffMapping.test.js`

## Attempted (reverted — metrics did not improve)

| Approach | Dense pitch | Clean pitch | Notes |
|----------|------------:|------------:|-------|
| Notehead Y center (−0.5× height) | 4.2% | 17.5% | Catastrophic regression |
| Adaptive notehead offset | 24.0% | 98.5% | Neutral (XML changes, no metric gain) |
| Quintet line positions (ungated) | 23.4% | 98.5% | −16 correct, onset −2.2pp |
| Gap-only correction (>12% drift) | 23.3% | 98.5% | −19 correct, onset −1.9pp |

## Results (baseline = after for kept changes)

| Metric | Gymnopédie (clean) | Cruel Angel (dense) |
|--------|-------------------:|--------------------:|
| pitch accuracy | **98.51%** | **23.95%** |
| onset accuracy | **99.15%** | **56.94%** |
| duration accuracy | **98.51%** | **64.63%** |
| measure count Δ | 0 | +2 |
| wrong pitch count | 3 | 1748 |

## Next generic targets (not implemented)

1. Validate quintet `lineYs` against notehead clusters before applying (5 critical staves
   drove regressions when gap correction fired)
2. Notehead anchor calibration using glyph height / staff gap (needs benchmark-safe factor)
3. Reduce evaluator “other” bucket via chord onset matching (orthogonal to pitch map)

## Reports

- Before: `tmp/omr-benchmark-iter/dense-staff-mapping/before-{medium,dense}.json`
- After: `tmp/omr-benchmark-iter/dense-staff-mapping/after-{medium,dense}.json`
- Comparison: `tmp/omr-benchmark-iter/dense-staff-mapping/comparison-dense.json`

Run:

```bash
npm run omr:evaluate -- --pdf ~/Downloads/gymnopedie-no-1-satie.pdf --truth ~/Downloads/gymnopedie-no-1-satie.mxl --json tmp/omr-benchmark-iter/dense-staff-mapping/after-medium.json
npm run omr:evaluate -- --pdf ~/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf --truth ~/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl --json tmp/omr-benchmark-iter/dense-staff-mapping/after-dense.json
node scripts/analyze-omr-pitch-errors.mjs --before tmp/omr-benchmark-iter/dense-staff-mapping/before-dense.json --after tmp/omr-benchmark-iter/dense-staff-mapping/after-dense.json --out tmp/omr-benchmark-iter/dense-staff-mapping/comparison-dense.json
```
