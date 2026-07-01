# m25 Phantom-Column Diagnosis (Family B)

Generated: 2026-06-30T23:59:15.080Z

## Measure stats (baseline, post inner-voice)

- Chord mismatches: 24
- Wrong onset: 2
- Wrong pitch/duration/missing/extra: 0/0/0/0

## Truth onsets vs generated columns

Truth onsets (quarters): 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5 (8 columns).

| Div | Onset (q) | Notes | Role | Midis (sample) |
| --- | --- | --- | --- | --- |
| 0 | 0.00 | 5 | stack | 55,43,79,72,… |
| 2 | 0.50 | 1 | solo | 50 |
| 3 | 0.75 | 1 | phantom-solo | 43 |
| 5 | 1.25 | 6 | linked-stack | 55,50,43,79,… |
| 7 | 1.75 | 1 | phantom-solo | 43 |
| 9 | 2.25 | 6 | linked-stack | 55,50,43,79,… |
| 11 | 2.75 | 1 | phantom-solo | 43 |
| 12 | 3.00 | 4 | stack | 55,43,74,71 |
| 14 | 3.50 | 2 | stack | 50,43 |

## Phantom identification

Phantom solos sit at div%4===3 (0.75q, 1.75q, 2.75q). Linked stacks at div%4===1 (1.25q, 2.25q) are +0.25q early vs truth beats at 1.0q and 2.0q.

## Phantom/stack pairs

| Phantom div | Stack div | Stack size | Duplicate midis | Splits attack? |
| --- | --- | --- | --- | --- |
| 3 | 5 | 6 | 43 | yes (dup in stack) |
| 7 | 9 | 6 | 43 | yes (dup in stack) |

Mechanism: x-position gaps between truth sixteenths insert phantom solo columns; the following harmony stack lands one sixteenth early. Shifting stacks −1 division realigns chord sizes without deleting notes.

