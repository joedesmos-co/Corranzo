# OMR Semantic Corpus Baseline (Frozen)

**Label:** `freeze-baseline`  
**Captured:** 2026-07-18T19:30:00.354Z  
**Git:** `15aa1db`  
**Evaluator:** `2.0.0` / schema `2` (**frozen**)  
**Mode:** `written`  
**Fixtures:** 9/9 enforced CC0 corpus  
**Artifacts:** `baseline.json`, `baseline.txt`

Process: [`docs/OMR_RECOGNITION_QUALITY.md`](../../docs/OMR_RECOGNITION_QUALITY.md)

## Scoreboard (mean)

| Metric | Score |
| --- | ---: |
| **Overall** | **49.7%** |
| Pitch | 16.5% |
| **Rhythm** | **56.8%** |
| Sustain / Tie | 55.8% |
| Articulation | 68.5% |
| Measure structure | 50.6% |
| Interpretation | 0.0% |

Use this table as the “before” for the next recognition sprint.
Do not change the evaluator to move these numbers.

## Top recurring errors

| Defect | Class | Count | Fixtures |
| --- | --- | ---: | ---: |
| missing-note | pitch | 461 | 8 |
| extra-note | pitch | 389 | 9 |
| incorrect-chord | measure-structure | 333 | 7 |
| incorrect-pitch | pitch | 272 | 9 |
| **duration-mismatch** | **rhythm** | **182** | **8** |
| **onset-mismatch** | **rhythm** | **145** | **7** |
| incorrect-tie | sustain | 44 | 3 |
| missing-accent | articulation | 39 | 3 |
| missing-staccato | articulation | 27 | 2 |
| missing-voice | measure-structure | 24 | 3 |
| split-measure | measure-structure | 22 | 4 |
| extra-rest | rhythm | 16 | 3 |
| tuplet-mismatch | rhythm | 10 | 1 |

## Per-fixture (rhythm focus)

| Fixture | Overall | Rhythm | Pitch | Sustain | Articulation | Measure | Interp |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| piano-beginner-single-vector | 72.6% | 84% | 24% | 100% | 100% | 100% | 0% |
| piano-grand-voices-vector | 40.5% | 53% | 0% | 100% | 0% | 30% | 0% |
| piano-rhythm-tuplets-vector | 51.0% | 47% | 37% | 0% | 100% | 73% | 0% |
| piano-articulation-scan | 32.9% | 80% | 1% | 3% | 17% | 30% | 0% |
| piano-dense-advanced-vector | 34.0% | 28% | 5% | 100% | 0% | 5% | 0% |
| guitar-tab-sparse-vector | 68.5% | 17% | 70% | 100% | 100% | 92% | 0% |
| guitar-standard-chords-vector | 37.0% | 45% | 0% | 0% | 100% | 14% | 0% |
| guitar-paired-chords-vector | 58.7% | 73% | 6% | 100% | 100% | 32% | 0% |
| guitar-techniques-paired-vector | 52.6% | 83% | 5% | 0% | 100% | 80% | 0% |

## Next phase

**Phase 2 — Rhythm.** Target mean rhythm ↑ without dropping other classes by >1%.

Primary rhythm defects to attack first:

1. `duration-mismatch`
2. `onset-mismatch`
3. `extra-rest` / rest placement
4. `tuplet-mismatch` (especially `piano-rhythm-tuplets-vector`)

Weak rhythm fixtures: `guitar-tab-sparse-vector` (17%), `piano-dense-advanced-vector` (28%), `guitar-standard-chords-vector` (45%), `piano-rhythm-tuplets-vector` (47%).

## Re-capture (only when intentional)

```bash
npm run omr:semantic-baseline
```

Replacing this baseline mid-sprint without a documented reason invalidates comparisons.
