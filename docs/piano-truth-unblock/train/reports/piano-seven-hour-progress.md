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


## Stacked-accidental offset fix (latest)

The dense swaps were caused by accidentals placed at a consistent horizontal
offset from their chord. Using the median accidental-to-notehead offset for
each staff/system, the assignment now prefers the chord whose offset matches
the layout instead of the nearest x.

Independent matcher result after the fix:

- Dense: 264/264 full events (was 252/264).
- Total: 452/453 (was 440/453).
- Beginner/rhythm/grand/dense all practice-ready.
- The only remaining mismatch is a grand reference/engraving tie inconsistency:
  the source curve connects measure 3's last note to measure 4's first note,
  while the reference MusicXML marks a tie to a different pitch at the end of
  measure 4. The candidate's visual tie is consistent with the curve; the
  reference is internally inconsistent.
- 15/15 adversarial controls still refused; safety controls pass.
