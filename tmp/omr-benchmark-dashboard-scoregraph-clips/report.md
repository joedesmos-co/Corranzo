# OMR benchmark dashboard

Generated: 2026-07-01T16:08:52.763Z
Fixtures: 2
Overall: FAIL

## Status
- pass: 1
- fail: 1
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### Gymnopédie No. 1 (clean) (`fail`)
- PDF: `/Users/ryland/Downloads/gymnopedie-no-1-satie.pdf`
- Truth: `/Users/ryland/Downloads/gymnopedie-no-1-satie.mxl`
  pitch 100% | duration 84% | onset 100% | chord 100% | F1 100%
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 76 | wrongOnset 0 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)
  top duration error category: too-short (76 sampled)
  ScoreGraph IR (observation): 989 nodes, 1963 edges across 78 measures; geometry bridge 100%
  IR ↔ runtime parity: noteheads ok, rests ok
  ScoreGraph clip promotion: 74 measures, 76 decisions, skipped 0
  promoted measures: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, ... (+50 more)
- reasons: durationAccuracy: 0.838 (need ≥0.95)

### A Cruel Angel's Thesis (dense) (`pass`)
- PDF: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- Truth: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
  pitch 94% | duration 96% | onset 96% | chord 94% | F1 99%
  measureΔ 0 | noteΔ -3 | wrongPitch 147 | wrongDuration 88 | wrongOnset 95 | chordMismatch 175
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (49 sampled)
  ScoreGraph IR (observation): 5930 nodes, 12554 edges across 125 measures; geometry bridge 100%
  IR ↔ runtime parity: noteheads ok, rests ok
  ScoreGraph clip promotion: 10 measures, 20 decisions, skipped 0
  promoted measures: 5, 9, 27, 29, 33, 56, 58, 59, 89, 94

## Top error categories (across fixtures)
- measure-allocation: 1
- rhythm-inference: 1
