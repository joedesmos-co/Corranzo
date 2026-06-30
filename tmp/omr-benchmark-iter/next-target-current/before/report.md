# OMR benchmark dashboard

Generated: 2026-06-30T18:36:17.678Z
Fixtures: 2
Overall: PASS

## Status
- pass: 2
- fail: 0
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### Gymnopédie No. 1 (clean) (`pass`)
- PDF: `/Users/ryland/Downloads/gymnopedie-no-1-satie.pdf`
- Truth: `/Users/ryland/Downloads/gymnopedie-no-1-satie.mxl`
  pitch 100% | duration 100% | onset 100% | chord 100% | F1 100%
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 1 | wrongOnset 0 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)
  top duration error category: too-long (1 sampled)

### A Cruel Angel's Thesis (dense) (`pass`)
- PDF: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- Truth: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
  pitch 34% | duration 81% | onset 72% | chord 66% | F1 89%
  measureΔ 2 | noteΔ -2 | wrongPitch 1533 | wrongDuration 223 | wrongOnset 480 | chordMismatch 1134
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (97 sampled)

## Top error categories (across fixtures)
- measure-allocation: 1
- rhythm-inference: 1
