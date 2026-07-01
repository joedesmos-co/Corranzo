# Family B Phantom-Column Simulation

Generated: 2026-06-30T23:55:47.739Z
Strategy: shift linked stacks −0.25q (keep phantom solos)
Min linked stack notes: 4

## Metric comparison

| Fixture | Run | Chord | Chord Δ | Onset | Onset Δ | Pitch | Pitch Δ | Duration | Duration Δ | Wrong chord | Wrong onset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean | baseline | 100.00% | 0 | 100.00% | 0 | 100.00% | 0 | 99.79% | 0 | 0 | 0 |
| clean | simulated | 100.00% | 0.0000 | 100.00% | 0.0000 | 100.00% | 0.0000 | 99.79% | 0.0000 | 0 | 0 |
| dense | baseline | 92.43% | 0 | 95.55% | 0 | 93.67% | 0 | 95.23% | 0 | 221 | 94 |
| dense | simulated | 93.09% | +0.0066 | 95.55% | 0.0000 | 93.67% | 0.0000 | 95.23% | 0.0000 | -20 | 0 |

## Simulation summary

| Fixture | Candidates | Applied | Note count changed | Samples |
| --- | --- | --- | --- | --- |
| clean | 0 | 0 | false | 0 |
| dense | 3 | 3 | false | 3 |

## Dense watch measures

| Measure | Chord Δ | Chord | Onset Δ | Pitch Δ | Duration Δ | Missing Δ |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | -20 | 24->4 | 0 | 0 | 0 | 0 |
| 7 | 0 | 20->20 | 0 | 0 | 0 | 0 |
| 33 | 0 | 0->0 | 0 | 0 | 0 | 0 |
| 34 | 0 | 0->0 | 0 | 0 | 0 | 0 |
| 61 | 0 | 26->26 | 0 | 0 | 0 | 0 |

## Applied samples

| Measure | Phantom divs | Stack shifts |
| --- | --- | --- |
| 25 | 3,7 | 5->4; 9->8 |
| 29 | 3,11 | 5->4; 13->12 |
| 89 | 3,11 | 5->4; 13->12 |

## Rejected strategies (diagnosis)

Naive phantom **removal** (with or without stack shift) regressed global chord and missing-note counts. Duplicate-only removal after shift also regressed (221→226 chord). Only linked-stack realignment passes gates.

## Recommendation

Simulation passes acceptance gates.

Proposed runtime slice: after inner-voice phase correction, detect Family B phantom signature (≥2 solo columns at div%4===3 each followed two sixteenths later by a stack at div%4===1 with ≥4 notes). Shift each linked stack **−1 division** (−0.25q). Do **not** delete phantom solos — removal regresses missing/chord counts.

Gate on dense m25 chord gain + global chord/onset/pitch/duration stability + clean unchanged.
