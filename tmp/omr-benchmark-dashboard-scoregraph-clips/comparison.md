# ScoreGraph Clip Promotion Benchmark Comparison

Default report: `tmp/omr-benchmark-dashboard/report.json`
Promotion report: `tmp/omr-benchmark-dashboard-scoregraph-clips/report.json`

Recommendation: keep `promoteScoreGraphClips` off. The dense duration gain is small, while clean duration regresses hard.

| Fixture | Status | Pitch | Duration | Onset | Chord | F1 | wrongDuration | wrongOnset | noteΔ | measureΔ | Promoted | Measures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gymnopédie No. 1 (clean) | pass -> fail | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 83.80% (-16.20pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 100.00% -> 100.00% (+0.00pp) | 0 -> 76 (+76) | 0 -> 0 (+0) | 0 -> 0 | 0 -> 0 | 74 measures / 76 decisions | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 ... (+62) |
| A Cruel Angel's Thesis (dense) | pass -> pass | 93.67% -> 93.67% (+0.00pp) | 95.59% -> 95.77% (+0.18pp) | 95.55% -> 95.52% (-0.03pp) | 93.96% -> 93.96% (+0.00pp) | 98.95% -> 98.95% (+0.00pp) | 93 -> 88 (-5) | 94 -> 95 (+1) | -3 -> -3 | 0 -> 0 | 10 measures / 20 decisions | 5, 9, 27, 29, 33, 56, 58, 59, 89, 94 |

## Notes

- Default user/runtime behavior remains unchanged because `promoteScoreGraphClips` still defaults to `false`.
- Promotion diagnostics are emitted only in enabled benchmark runs.
- Clean regression is dominated by too-short durations: 76 wrong durations after promotion.
