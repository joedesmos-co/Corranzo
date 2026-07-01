# m113 Precision Sprint Summary

Generated: 2026-07-01

## Before / After Dashboard

| Fixture | Metric | Before | After | Δ |
| --- | --- | ---: | ---: | ---: |
| clean | pitch / duration / onset / chord / F1 | 100% | 100% | 0 |
| clean | wrong* counts | 0 | 0 | 0 |
| dense | chord mismatch | **201** | **189** | **−12** |
| dense | chord % | 93% | 93% | +0.4pp |
| dense | onset / duration / pitch | 94 / 93 / 147 | unchanged | 0 |
| dense | F1 | 99% | 99% | 0 |
| m113 | chord mismatch | **12** | **0** | **−12** |

## Kept

| Change | File | Why |
| --- | --- | --- |
| Opening lead-note merge (runtime) | `src/features/omr/openingLeadNoteMerge.js` | Lone div-0 note merged into adjacent div≤1 stack; fixes m113 opening chord split |
| Pipeline hook (before inner-voice) | `src/features/omr/runPdfOmrPipeline.js` | Only m113 matched in dense corpus |
| Simulation harness | `scripts/simulate-opening-lead-note.mjs` | Offline gate before promotion |
| Tests | `tests/openingLeadNoteMerge.test.js` | m113-like pattern + skip guards |

## Reverted

None.

## Root cause (not what we initially assumed)

m113 is **not** primarily MusicXML serialization or inner-voice phase error. All 12 chord mismatches exist at **raw vector events** (opening F5 solo @ div 0, six-note stack @ div 1). Inner-voice correction on beats 2.5–3.5 leaves chord count unchanged.

## Verification

| Check | Result |
| --- | --- |
| `npm run omr:benchmark-dashboard` | PASS |
| `npm test -- --testTimeout 30000` | 141 files, 1332 passed |
| `npm run build` | PASS |

## Reports

- Diagnosis: `tmp/omr-benchmark-iter/m113-precision/diagnosis.md`
- Funnel JSON: `tmp/omr-benchmark-iter/m113-precision/diagnosis.json`
- Simulation: `tmp/omr-benchmark-iter/m113-precision/simulation.md`
- Dashboard: `tmp/omr-benchmark-dashboard/report.md`

## Stop point

Target complete. Do not chase further fixes this sprint.
