# m94 Terminal Early Column Correction — Promotion

## Change

Runtime hook in `runPdfOmrPipeline.js`: after existing `phantomColumnCorrection`, apply `applyTerminalEarlyColumnCorrection` (`shift-terminal-early-forward`).

Shifts terminal early columns **+0.25q** (div 9→10, 10→11, 13→14) on m94-like signature:
- solo @ 2.25q
- 2-note stack @ 2.5q
- quarter anchor @ 3.0q
- 4-note terminal stack @ 3.25q → 3.5q

No note deletion. m29/m89 gated out (3-note column @ 2.25q).

## Before / After

| Metric | Before | After |
|--------|-------:|------:|
| Dense chord | 183 | **175** |
| Dense pitch | 147 | 147 |
| Dense onset | 94 | 94 |
| Dense duration | 93 | 93 |
| Clean | 100% all | 100% all |

| Measure | Before chord | After chord |
|---------|-------------:|------------:|
| m94 | 8 | **0** |
| m25 | 4 | 4 |
| m29 | 0 | 0 |
| m89 | 0 | 0 |
| m57 | 0 | 0 |
| m113 | 0 | 0 |
| m7 | 20 | 20 |
| m33 | 0 | 0 |
| m61 | 26 | 26 |

## Verification

- `tests/phantomColumnSimulation.test.js` — 10/10 pass
- `npm run build` — pass
- `npm run omr:benchmark-dashboard` — 2/2 pass

## Artifacts

- `before/` — pre-promotion dashboard snapshot (chord 183)
- `after/` — post-promotion dashboard snapshot (chord 175)
- Simulation: `tmp/omr-benchmark-iter/m94-terminal/simulation.md`
