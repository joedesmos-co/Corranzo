# Phase 1 — Dense ledger ink rejection inventory

- Commit: `f2d3f05`
- Created: 2026-08-01T03:52:50.450Z
- Evaluator: frozen 2.0.0 / schema 2
- Production code: **not modified**

## Scope

Every high-extreme generated tone whose notehead ink anchor was rejected (fallback ≠ `ink-notehead-geometry`) across the frozen nine-fixture corpus.

## Scoreboard

- High-extreme ink rejections: **17**
- With nearby accidental glyph candidates: **0**

## By ink rejection reason

| Key | Count |
|---|---:|
| `ambiguous-components` | 10 |
| `component-outside-font-origin-range` | 6 |
| `no-head-sized-component` | 1 |

## By failure class

| Key | Count |
|---|---:|
| `several-chord-heads-treated-as-ambiguous-group` | 10 |
| `notehead-merged-with-ledger-fragments` | 6 |
| `ledger-fragments-masking-notehead-body` | 1 |

## By row-span class

| Key | Count |
|---|---:|
| `one-notehead` | 17 |

## By fixture

| Key | Count |
|---|---:|
| `piano-dense-advanced-vector` | 17 |

## Failure taxonomy (campaign)

1. `local-ledger-run-incorrectly-classified-as-staff`
2. `real-staff-geometry-correctly-suppressed`
3. `notehead-merged-with-ledger-fragments`
4. `several-chord-heads-treated-as-ambiguous-group`
5. `ledger-fragments-masking-notehead-body`
6. `stem-beam-components-creating-ambiguity`
7. `true-absence-of-usable-notehead-ink`
8. `accidental-shaped-residual-after-staff-position-correct`

## Sample rejections

| Fixture | M | Reject | Failure | Span | Rows | Heads before/after | Acc nearby |
|---|---:|---|---|---|---:|---|---:|
| piano-dense-advanced-vector | 6 | component-outside-font-origin-range | notehead-merged-with-ledger-fragments | one-notehead | 8 | 0/1 | 0 |
| piano-dense-advanced-vector | 7 | no-head-sized-component | ledger-fragments-masking-notehead-body | one-notehead | 12 | 0/0 | 0 |
| piano-dense-advanced-vector | 7 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 9 | 0/3 | 0 |
| piano-dense-advanced-vector | 7 | component-outside-font-origin-range | notehead-merged-with-ledger-fragments | one-notehead | 12 | 0/1 | 0 |
| piano-dense-advanced-vector | 8 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 15 | 0/3 | 0 |
| piano-dense-advanced-vector | 8 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 12 | 0/4 | 0 |
| piano-dense-advanced-vector | 8 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 9 | 0/3 | 0 |
| piano-dense-advanced-vector | 8 | component-outside-font-origin-range | notehead-merged-with-ledger-fragments | one-notehead | 14 | 1/1 | 0 |
| piano-dense-advanced-vector | 8 | component-outside-font-origin-range | notehead-merged-with-ledger-fragments | one-notehead | 11 | 0/1 | 0 |
| piano-dense-advanced-vector | 8 | component-outside-font-origin-range | notehead-merged-with-ledger-fragments | one-notehead | 12 | 0/1 | 0 |
| piano-dense-advanced-vector | 9 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 12 | 2/2 | 0 |
| piano-dense-advanced-vector | 9 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 11 | 1/4 | 0 |
| piano-dense-advanced-vector | 9 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 16 | 1/2 | 0 |
| piano-dense-advanced-vector | 9 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 8 | 0/2 | 0 |
| piano-dense-advanced-vector | 9 | component-outside-font-origin-range | notehead-merged-with-ledger-fragments | one-notehead | 15 | 0/1 | 0 |
| piano-dense-advanced-vector | 9 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 16 | 0/4 | 0 |
| piano-dense-advanced-vector | 9 | ambiguous-components | several-chord-heads-treated-as-ambiguous-group | one-notehead | 11 | 1/2 | 0 |

## Notes for Phase 2

- Classifier must use joint features (span vs system, staff continuity, notehead overlap), not row count alone.
- Local ledger runs incorrectly suppressed as staff are the primary recovery target; preserve real system-spanning staff suppression.
- Ambiguous stacked heads need per-glyph ownership, not broad chord ownership widening.

