# OMR benchmark dashboard

Generated: 2026-07-01T03:19:32.658Z
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
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 0 | wrongOnset 0 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)

### A Cruel Angel's Thesis (dense) (`pass`)
- PDF: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- Truth: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
  pitch 94% | duration 96% | onset 96% | chord 94% | F1 99%
  measureΔ 0 | noteΔ -3 | wrongPitch 147 | wrongDuration 93 | wrongOnset 94 | chordMismatch 175
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (50 sampled)

## Top error categories (across fixtures)
- measure-allocation: 1
- rhythm-inference: 1
