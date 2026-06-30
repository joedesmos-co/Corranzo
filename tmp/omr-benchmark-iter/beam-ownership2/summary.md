# Beam Ownership Reconstruction Phase 2 Simulation

Generated: 2026-06-30T18:08:26.840Z

## Metric comparison

| Fixture | Run | Duration | Dur Δ | Wrong dur | Wrong dur Δ | Onset | Onset Δ | Chord | Chord Δ | Pitch | Pitch Δ | F1 | F1 Δ | Notes/measures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean | baseline | 99.79% | 0 | 1 | 0 | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 469/78 |
| clean | simulated | 99.79% | 0.0000 | 1 | 0 | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 469/78 |
| dense | baseline | 80.96% | 0 | 223 | 0 | 71.81% | 0 | 66.41% | 0 | 34.34% | 0 | 88.93% | 0 | 2808/127 |
| dense | simulated | 80.89% | -0.0007 | 225 | +2 | 71.89% | +0.0008 | 66.41% | 0.0000 | 34.34% | 0.0000 | 88.93% | 0.0000 | 2808/127 |

## Simulation summary

| Fixture | Candidates | Applied | Moving notes | Sustained notes | Note count changed | Measure count changed |
| --- | --- | --- | --- | --- | --- | --- |
| clean | 0 | 0 | 0 | 0 | false | false |
| dense | 24 | 24 | 38 | 29 | false | false |

## Dense applied samples

| Measure | Event | Start | Duration | Moving notes | Sustained notes | Stem dirs | Reasons |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 7 | 7 | 3->2 | 1 | 2 | up | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 23 | 1 | 0 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 24 | 1 | 0 | 3->2 | 1 | 2 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 29 | 4 | 8 | 4->2 | 1 | 2 | down | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 32 | 3 | 4 | 3->2 | 1 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 33 | 10 | 11 | 3->2 | 1 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 35 | 11 | 13 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 38 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 40 | 7 | 9 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 47 | 14 | 12 | 4->2 | 1 | 2 | down | beamed-and-unbeamed-notes, multiple-likely-voices, event-longer-than-beam-unit |
| 60 | 3 | 3 | 3->2 | 1 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 66 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 70 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 85 | 1 | 0 | 3->2 | 1 | 2 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 92 | 3 | 4 | 3->2 | 1 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 93 | 10 | 11 | 3->2 | 1 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 96 | 7 | 7 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 98 | 7 | 9 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 100 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 102 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 118 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 120 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 122 | 7 | 9 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |
| 126 | 7 | 8 | 3->2 | 2 | 1 | down, up | beamed-and-unbeamed-notes, mixed-stem-directions, multiple-likely-voices, event-longer-than-beam-unit |

## Dense changed measures

| Measure | Wrong dur Δ | Wrong dur | Wrong onset Δ | Wrong onset | Wrong pitch Δ | Chord mismatch Δ | Error Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 29 | -1 | 11->10 | 0 | 6->6 | 0 | 0 | -1 |
| 33 | 0 | 4->4 | -1 | 10->9 | 0 | 0 | -1 |
| 35 | +1 | 3->4 | 0 | 9->9 | 0 | 0 | +1 |
| 85 | +1 | 7->8 | 0 | 2->2 | 0 | 0 | +1 |
| 93 | 0 | 5->5 | -1 | 7->6 | 0 | 0 | -1 |
| 96 | +1 | 0->1 | 0 | 5->5 | 0 | 0 | +1 |

## Interpretation

Simulation is not clean enough to promote as-is.

## Why not Phase 3 yet

Dense duration delta: -0.0007, wrong-duration delta: +2.
Dense onset delta: +0.0008, chord delta: 0.0000, pitch delta: 0.0000.
Only 6 dense measures changed. Duration improved in 1 candidate measure(s) and worsened in 3; onset improved in 2 measure(s).
The simulation preserves note/measure count, but the same-start split is still not a reliable proxy for true voice serialization. It can over-shorten the beamed note in MusicXML where the current event duration was already the best matched written duration, while a small onset gain comes from backup/forward ordering rather than a cleaner chord grouping result.
The split model should remain offline until the simulated XML improves duration while preserving onset/chord/pitch and clean metrics.
