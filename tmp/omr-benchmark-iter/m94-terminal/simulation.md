# m94 Terminal Phantom/Stack Simulation

Generated: 2026-07-01T03:14:46.204Z

## Diagnosis

### Truth chord groups (m94)

| Beat (q) | Notes | Midis |
|---------:|------:|-------|
| 0 | 5 | 36, 43, 48, 67, 72 |
| 0.5 | 1 | 36 |
| 1 | 4 | 43, 48, 67, 75 |
| 1.5 | 2 | 39, 51 |
| 2 | 6 | 41, 48, 53, 68, 72, 77 |
| 2.5 | 1 | 41 |
| 2.75 | 2 | 68, 75 |
| 3 | 2 | 48, 53 |
| 3.5 | 4 | 36, 48, 68, 77 |

### Generated baseline columns (post runtime corrections)

| Div | Beat (q) | Notes | Midis |
|----:|---------:|------:|-------|
| 0 | 0 | 5 | 36, 43, 48, 67, 72 |
| 2 | 0.5 | 1 | 36 |
| 4 | 1 | 4 | 43, 48, 67, 75 |
| 5 | 1.25 | 2 | 39, 51 |
| 7 | 1.75 | 6 | 41, 48, 53, 68, 72, 77 |
| 9 | 2.25 | 1 | 41 |
| 10 | 2.5 | 2 | 68, 75 |
| 12 | 3 | 2 | 48, 53 |
| 13 | 3.25 | 4 | 36, 48, 68, 77 |

### Chord mismatches (baseline)

| Beat (q) | Truth | Gen |
|---------:|------:|----:|
| 2.5 | 1 | 2 |
| 3 | 2 | 4 |
| 3.5 | 4 | 0 |
| 2.25 | 0 | 1 |

Terminal pattern: last 1.5 beats are one sixteenth early — solo @2.25q, treble pair @2.5q→2.75q, terminal stack @3.25q→3.5q.

## Variant results

| Variant | Dense chord | Δ chord | m94 chord | Δ onset | Δ pitch | Δ dur | Note Δ | Gates |
|---------|------------:|--------:|----------:|--------:|--------:|------:|-------:|:-----:|
| drop-terminal-phantom | 318 | 135 | 7 | 2 | -5 | 1 | -29 | FAIL |
| shift-terminal-early-forward | 175 | -8 | 0 | 0 | 0 | 0 | 0 | PASS |
| drop-and-shift-terminal | 182 | -1 | 7 | 0 | 0 | 0 | -1 | FAIL |

## Control measures (dense chord Δ)

### drop-terminal-phantom
- m94: 8 → 7 (Δ -1)
- m7: 20 → 20 (Δ 0)
- m25: 4 → 4 (Δ 0)
- m29: 0 → 0 (Δ 0)
- m33: 0 → 0 (Δ 0)
- m57: 0 → 0 (Δ 0)
- m61: 26 → 26 (Δ 0)
- m89: 0 → 0 (Δ 0)
- m113: 0 → 0 (Δ 0)

### shift-terminal-early-forward
- m94: 8 → 0 (Δ -8)
- m7: 20 → 20 (Δ 0)
- m25: 4 → 4 (Δ 0)
- m29: 0 → 0 (Δ 0)
- m33: 0 → 0 (Δ 0)
- m57: 0 → 0 (Δ 0)
- m61: 26 → 26 (Δ 0)
- m89: 0 → 0 (Δ 0)
- m113: 0 → 0 (Δ 0)

### drop-and-shift-terminal
- m94: 8 → 7 (Δ -1)
- m7: 20 → 20 (Δ 0)
- m25: 4 → 4 (Δ 0)
- m29: 0 → 0 (Δ 0)
- m33: 0 → 0 (Δ 0)
- m57: 0 → 0 (Δ 0)
- m61: 26 → 26 (Δ 0)
- m89: 0 → 0 (Δ 0)
- m113: 0 → 0 (Δ 0)


## Recommendation

Simulation **PASS** for `shift-terminal-early-forward`: shift terminal early columns +0.25q. Ready for promotion review.
