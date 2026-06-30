# Inner-Voice Solo/Stack Phase Simulation

Generated: 2026-06-30T23:27:34.094Z

## Metric comparison

| Fixture | Run | Chord | Chord Δ | Onset | Onset Δ | Pitch | Pitch Δ | Duration | Duration Δ | Wrong chord | Wrong onset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean | baseline | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 99.79% | 0 | 0 | 0 |
| clean | simulated | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 99.79% | 0.0000 | 0 | 0 |
| dense | baseline | 91.84% | 0 | 95.55% | 0 | 93.67% | 0 | 95.23% | 0 | 239 | 94 |
| dense | simulated | 93.22% | +0.0138 | 95.55% | 0.0000 | 93.77% | +0.0010 | 95.34% | +0.0011 | -42 | +3 |

## Simulation summary

| Fixture | Candidates | Applied | Note count changed | Samples |
| --- | --- | --- | --- | --- |
| clean | 0 | 0 | false | 0 |
| dense | 3 | 3 | false | 3 |

## Dense watch measures

| Measure | Chord Δ | Chord | Onset Δ | Pitch Δ | Duration Δ | Missing Δ |
| --- | --- | --- | --- | --- | --- | --- |
| 33 | -18 | 18->0 | 0 | 0 | 0 | 0 |
| 61 | -24 | 26->2 | +3 | 0 | 0 | -3 |
| 7 | n/a | n/a | n/a | n/a | n/a | n/a |
| 25 | n/a | n/a | n/a | n/a | n/a | n/a |
| 34 | n/a | n/a | n/a | n/a | n/a | n/a |

## Applied samples

| Measure | Start div | End div | Shift | Columns | Sizes |
| --- | --- | --- | --- | --- | --- |
| 33 | 9 | 13 | 1 | 4 | 1,5,1,5 |
| 61 | 8 | 14 | 1 | 6 | 1,4,1,4,1,4 |
| 113 | 10 | 14 | 1 | 4 | 1,5,1,5 |

## Recommendation

Do not promote to runtime yet.

- Global dense chord mismatch delta: -42
- Global dense onset delta: +3 (evaluator count) / 0.0000 (accuracy)
- Global dense pitch delta: 0
- Global dense duration delta: 0
- Target measures improved: yes
- Target measures regressed: no
- Controls stable: yes
- Clean stable: yes
