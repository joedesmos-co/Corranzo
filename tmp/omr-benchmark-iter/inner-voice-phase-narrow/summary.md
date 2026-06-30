# Inner-Voice Solo/Stack Phase Simulation

Generated: 2026-06-30T23:35:13.226Z
Min stack notes: 5

## Metric comparison

| Fixture | Run | Chord | Chord Δ | Onset | Onset Δ | Pitch | Pitch Δ | Duration | Duration Δ | Wrong chord | Wrong onset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean | baseline | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 99.79% | 0 | 0 | 0 |
| clean | simulated | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 99.79% | 0.0000 | 0 | 0 |
| dense | baseline | 91.84% | 0 | 95.55% | 0 | 93.67% | 0 | 95.23% | 0 | 239 | 94 |
| dense | simulated | 92.43% | +0.0059 | 95.55% | 0.0000 | 93.67% | 0.0000 | 95.23% | 0.0000 | -18 | 0 |

## Simulation summary

| Fixture | Candidates | Applied | Note count changed | Samples |
| --- | --- | --- | --- | --- |
| clean | 0 | 0 | false | 0 |
| dense | 2 | 2 | false | 2 |

## Dense watch measures

| Measure | Chord Δ | Chord | Onset Δ | Pitch Δ | Duration Δ | Missing Δ |
| --- | --- | --- | --- | --- | --- | --- |
| 33 | -18 | 18->0 | 0 | 0 | 0 | 0 |
| 61 | n/a | n/a | n/a | n/a | n/a | n/a |
| 7 | n/a | n/a | n/a | n/a | n/a | n/a |
| 25 | n/a | n/a | n/a | n/a | n/a | n/a |
| 34 | n/a | n/a | n/a | n/a | n/a | n/a |

## Applied samples

| Measure | Start div | End div | Shift | Columns | Sizes |
| --- | --- | --- | --- | --- | --- |
| 33 | 9 | 13 | 1 | 4 | 1,5,1,5 |
| 113 | 10 | 14 | 1 | 4 | 1,5,1,5 |

## Recommendation

Simulation improves target chord grouping without pitch/duration regression and controls stay stable.

Proposed runtime slice: after `buildNoteEventsFromGroups`, detect alternating `{1, >=5}` solo/stack columns from beat 2 onward with sixteenth spacing and no solo beam evidence; shift the matched window by `+1` division before MusicXML serialization. Skip 4-note stacks (m61-like). Gate on dense chord/onset and clean stability.
