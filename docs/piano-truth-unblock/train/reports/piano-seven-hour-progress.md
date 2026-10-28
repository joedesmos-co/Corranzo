# Piano seven-hour accuracy campaign

## Baseline

- Research head: `28cc0b6ce1`
- Canonical measure-keyed matcher: 447/447 notes, 6/6 rests.
- Independent QA matcher: 440/453 strict full events (PDF.js 5.4.296).
- Dense: 12 false positives + 12 false negatives, all semitone swaps between adjacent onsets in measures 3, 4, 6, 7.
- Grand: 1 duration mismatch (quarter vs half at measure 3, onset 3).

## Independent comparison

Committed as `reports/independent_accuracy_compare.json`.

| Core | Emitted | Matched | Truth | Practice |
| --- | ---: | ---: | ---: | --- |
| main | 453 | 273 | 453 | limited |
| `417964b6ee` | 453 | 440 | 453 | 4 ready |
| `28cc0b6ce1` | 453 | 440 | 453 | 4 ready |
| candidate + ambiguity gate | 453 | 440 | 453 | dense preview-only |

## Root cause found

Dense mismatches are stacked-accidental ownership swaps. Pitch, onset and
duration each match as multisets, but a sharp is assigned to the adjacent
onset notehead at the same staff position. This produces paired semitone
swaps that the canonical multiset matcher cannot see.

## Safety change

Added `ambiguousAccidentals` detection: a path accidental that is vertically
compatible with noteheads at different onsets increments the count. The gate
emits `accidental-ownership-ambiguous` and refuses Practice.

Result: beginner/rhythm/grand remain practice-ready; dense becomes
preview-only. This matches the independent QA recommendation until ownership
is resolved.

## Tests

- Independent matcher: 440/453 (unchanged recognition).
- Practice safety controls: OK, including the new ambiguity case.
- 15/15 integration adversarial controls still refused.
