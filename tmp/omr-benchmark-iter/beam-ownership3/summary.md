# Beam Ownership Reconstruction Phase 3 Voice Serialization Simulation

Generated: 2026-06-30T18:19:36.498Z

## Metric comparison

| Fixture | Run | Duration | Dur Δ | Wrong dur | Wrong dur Δ | Onset | Onset Δ | Chord | Chord Δ | Pitch | Pitch Δ | F1 | F1 Δ | Notes/measures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean | baseline | 99.79% | 0 | 1 | 0 | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 469/78 |
| clean | simulated | 99.79% | 0.0000 | 1 | 0 | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 469/78 |
| dense | baseline | 80.96% | 0 | 223 | 0 | 71.81% | 0 | 66.41% | 0 | 34.34% | 0 | 88.93% | 0 | 2808/127 |
| dense | simulated | 80.89% | -0.0007 | 225 | +2 | 71.81% | 0.0000 | 66.41% | 0.0000 | 34.34% | 0.0000 | 88.93% | 0.0000 | 2808/127 |

## Simulation summary

| Fixture | Candidates | Applied | Moving notes | Sustained notes | Duration-adjusted events | Note count changed | Measure count changed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clean | 0 | 0 | 0 | 0 | 0 | false | false |
| dense | 24 | 17 | 30 | 21 | 17 | false | false |

## Dense applied samples

| Measure | Event | Start | Duration | Moving notes | Sustained notes | Moving voice | Sustain voice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 7 | 7 | 3->2 | 1 | 2 | upper:treble:up:beamed-moving:beam:rg-6-1 | upper:treble:up:sustain:no-beam |
| 23 | 1 | 0 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-23-3 | upper:treble:up:sustain:no-beam |
| 24 | 1 | 0 | 3->2 | 1 | 2 | upper:treble:down:beamed-moving:beam:rg-24-2 | upper:treble:down:sustain:no-beam |
| 38 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-38-1 | upper:treble:up:sustain:no-beam |
| 40 | 7 | 9 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-40-1 | upper:treble:up:sustain:no-beam |
| 47 | 14 | 12 | 4->2 | 1 | 2 | upper:treble:down:beamed-moving:beam:rg-47-1 | upper:treble:down:sustain:no-beam |
| 66 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-66-1 | upper:treble:up:sustain:no-beam |
| 70 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-70-1 | upper:treble:up:sustain:no-beam |
| 85 | 1 | 0 | 3->2 | 1 | 2 | upper:treble:down:beamed-moving:beam:rg-85-1 | upper:treble:down:sustain:no-beam |
| 96 | 7 | 7 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-96-1 | upper:treble:up:sustain:no-beam |
| 98 | 7 | 9 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-98-1 | upper:treble:up:sustain:no-beam |
| 100 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-100-1 | upper:treble:up:sustain:no-beam |
| 102 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-102-1 | upper:treble:up:sustain:no-beam |
| 118 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-118-1 | upper:treble:up:sustain:no-beam |
| 120 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-120-1 | upper:treble:up:sustain:no-beam |
| 122 | 7 | 9 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-122-1 | upper:treble:up:sustain:no-beam |
| 126 | 7 | 8 | 3->2 | 2 | 1 | upper:treble:down:beamed-moving:beam:rg-126-1 | upper:treble:up:sustain:no-beam |

## Dense skipped reasons

| Reason | Count |
| --- | --- |
| low-ownership-confidence | 7 |

## Dense changed measures

| Measure | Wrong dur Δ | Wrong dur | Wrong onset Δ | Wrong onset | Wrong pitch Δ | Chord mismatch Δ | Error Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 85 | +1 | 7->8 | 0 | 2->2 | 0 | 0 | +1 |
| 96 | +1 | 0->1 | 0 | 5->5 | 0 | 0 | +1 |

## Interpretation

Simulation is not clean enough to promote as-is.

## Why not runtime yet

Dense duration delta: -0.0007, wrong-duration delta: +2.
Dense onset delta: 0.0000, chord delta: 0.0000, pitch delta: 0.0000, F1 delta: 0.0000.
Only 2 dense measures changed. Duration improved in 0 measure(s) and worsened in 2; onset improved in 0 and worsened in 0; chord improved in 0 and worsened in 0.
The stricter confidence gate skipped 7 candidate(s), all for ownership confidence rather than page or piece identity.
Voice serialization by itself did not move chord grouping, pitch, F1, or onset because the note onsets and onset cluster sizes were preserved. The only effective metric change came from shortening beam-owned moving notes, and that over-shortened the two measures that changed.
The simulation should stay offline until voice ownership improves duration/chord/onset without trading against another main metric.
