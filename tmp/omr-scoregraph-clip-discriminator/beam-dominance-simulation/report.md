# ScoreGraph Beam-Dominance Clip Promotion Simulation

Simulation only. Default runtime behavior and `promoteScoreGraphClips` default remain unchanged.

Guard tested:

```text
beamAttachmentRate >= 0.60
graphBeamedButCurrentLong > 0
```

## Summary

The guard rejected all clean Gymnopedie clip decisions and kept clean metrics at 100%. On dense Cruel Angel, it selected measures 56, 58, and 59 and improved duration inside the ScoreGraph shadow simulation.

Important caveat: the shadow ScoreGraph reconstruction used for this simulation is not byte-identical to runtime XML. For the dense fixture, reconstruction alone changes chord grouping before the beam-dominance guard is applied. Therefore, the guard is promising for duration, but this simulation is not sufficient to promote it to default runtime behavior.

## Runtime Default vs Guarded Simulation

| Fixture | Promoted measures | Pitch | Duration | Onset | Chord | F1 | wrongDuration | wrongOnset | noteDelta | measureDelta |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gymnopedie No. 1 (clean) | 0 (none) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 0 -> 0 (+0) | 0 -> 0 (+0) | 0 -> 0 | 0 -> 0 |
| A Cruel Angel's Thesis (dense) | 3 (56, 58, 59) | 93.67% -> 93.67% (+0.00pp) | 95.59% -> 96.23% (+0.64pp) | 95.55% -> 95.55% (+0.00pp) | 93.96% -> 91.84% (-2.12pp) | 98.95% -> 98.95% (+0.00pp) | 93 -> 75 (-18) | 94 -> 94 (+0) | -3 -> -3 | 0 -> 0 |

## Reconstruction Baseline Check

This table separates the guard effect from the ScoreGraph shadow reconstruction effect.

| Fixture | Variant | Pitch | Duration | Onset | Chord | F1 | wrongDuration | chordMismatch | noteDelta | measureDelta |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Gymnopedie No. 1 (clean) | runtime default | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 0 | 0 | 0 | 0 |
| Gymnopedie No. 1 (clean) | reconstructed shadow | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 0 | 0 | 0 | 0 |
| Gymnopedie No. 1 (clean) | guarded shadow | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 0 | 0 | 0 | 0 |
| A Cruel Angel's Thesis (dense) | runtime default | 93.67% | 95.59% | 95.55% | 93.96% | 98.95% | 93 | 175 | -3 | 0 |
| A Cruel Angel's Thesis (dense) | reconstructed shadow | 93.67% | 96.01% | 95.55% | 91.84% | 98.95% | 81 | 239 | -3 | 0 |
| A Cruel Angel's Thesis (dense) | guarded shadow | 93.67% | 96.23% | 95.55% | 91.84% | 98.95% | 75 | 239 | -3 | 0 |

## Guard-Only Effect Against Shadow Baseline

| Fixture | Promoted decisions | Duration | wrongDuration | Pitch | Onset | Chord | F1 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| Gymnopedie No. 1 (clean) | 0 | 100.00% -> 100.00% (+0.00pp) | 0 -> 0 (+0) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) |
| A Cruel Angel's Thesis (dense) | 4 | 96.01% -> 96.23% (+0.22pp) | 81 -> 75 (-6) | 93.67% -> 93.67% (+0.00pp) | 95.55% -> 95.55% (+0.00pp) | 91.84% -> 91.84% (+0.00pp) | 98.95% -> 98.95% (+0.00pp) |

## Promotion Details

### Gymnopedie No. 1 (clean)
- Reconstructed ScoreGraph baseline vs runtime: note delta 0, measure delta 0, byte-identical false.
- Solver candidates before guard: 74 measure(s), 76 clip decision(s).
- Guard-promoted: 0 measure(s), 0 decision(s), skipped 0.
- Filtered out measures: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76.

### A Cruel Angel's Thesis (dense)
- Reconstructed ScoreGraph baseline vs runtime: note delta 0, measure delta 0, byte-identical false.
- Solver candidates before guard: 6 measure(s), 7 clip decision(s).
- Guard-promoted: 3 measure(s), 4 decision(s), skipped 0.
- Filtered out measures: 5, 9, 27.
- Promoted measure diagnostics:
  - m56: beamAttachmentRate 0.9524, graphBeamedButCurrentLong 3, beamCandidateCount 5, confidence 0.90, margin 0.5625.
  - m58: beamAttachmentRate 0.9524, graphBeamedButCurrentLong 2, beamCandidateCount 6, confidence 0.90, margin 0.5625.
  - m59: beamAttachmentRate 0.6364, graphBeamedButCurrentLong 3, beamCandidateCount 3, confidence 0.90, margin 0.6250.
- Per-promoted-measure local deltas:
  - m56: wrongDuration 1 -> 0, wrongOnset 0 -> 0, wrongPitch 0 -> 0, chordMismatch 0 -> 0.
  - m58: wrongDuration 1 -> 0, wrongOnset 0 -> 0, wrongPitch 0 -> 0, chordMismatch 0 -> 0.
  - m59: wrongDuration 4 -> 0, wrongOnset 0 -> 0, wrongPitch 1 -> 1, chordMismatch 0 -> 0.

## Recommendation

Keep `promoteScoreGraphClips` default-off. The beam-dominance guard solves the clean false-positive family and improves dense duration in shadow simulation, but the simulation path is not runtime-equivalent for dense chord grouping: reconstruction alone changes chord accuracy from 93.96% to 91.84%.

The next safe step is a runtime-faithful dev simulation that applies the same guarded clip decisions through the normal MusicXML emission path, or a narrower internal hook that can be benchmarked without changing default behavior. Do not promote this guard to runtime default from the current shadow simulation alone.
