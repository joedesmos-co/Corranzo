# Guitar Vision mixed-rhythm candidate — independent audit (2026-10-25)

**Reviewed:** `48a5790f7e` (mixed-rhythm fixture + blocker) and the later
`6683d65e3b` text-run splitting fix on `codex/guitar-vision`.
**Decision: the timing candidate is not integrated. The isolated text-run split
was integrated as extraction-only experimental work; practice stays closed.**
The mixed fixture still has no evidence-based duration or valid measure.

## Reproduction on the pinned mixed fixture

Fixture: `guitar-mixed-rhythm-vector` (4/4, 4 measures, 21 onsets, 60 notes,
quarters/eighths/sixteenths, reference MusicXML from the same event model).

| pipeline | string/fret | noteheads | onsets | confident onsets | valid measures | durations |
|---|---:|---:|---:|---:|---:|---|
| current main (`07f4…` core) | 60/60 | 18/21 | 21 | 0/21 | **0/4** | `{1, null}` |
| `6683d65e3b` | 60/60 | **21/21** | 21 | **0/21** | **0/4** | placeholder `1` |

`6683` splits merged SMuFL runs using advances derived from standalone
noteheads/run width; both notation systems now pair exactly
(10/10 and 11/11 columns), and string/fret remains 60/60. But the extracted
events all carry:

```js
rhythm: { duration: 1, beams: 0, flags: 0, stem: false, confident: false }
```

There is no stem/beam/flag evidence on this page. The `duration: 1` values are
placeholders, not verified quarters. The research note says “durations still all
quarter” and the next blocker is stem/beam evidence; that is consistent with
this audit.

The reported “1/21 complete timed” is at best one accidental timing match. We
do not count any placeholder-quarter event as complete timed. The exact
evidence-based complete-event count is therefore **0/21**, and the
measure-validation gate correctly reports **0/4** until beam/flag ownership is
recovered.

## Regression on the verified fixtures

`6683` preserves the controlled results:

| fixture | events | noteheads | onsets | confident | measures |
|---|---:|---:|---:|---:|---:|
| paired/chords | 116 | 116 | 32 | 32 | 8/8 |
| techniques | 32 | 32 | 32 | 32 | 8/8 |
| sparse TAB | 32 | 0 | 32 | 0 | 0/8 |
| notation-only mixed (40/40 onset classifier) | — | — | 40 | 40 | — |

The techniques reference still contains unsupported ties. Sparse still abstains
with null durations. No regression was observed on the controlled paired
fixtures.

## Why not integrated

- `48a` adds a research fixture and documents a blocker; it is not a product
  change.
- `6683` improves **notehead extraction** but does not recover the duration of
  any mixed-rhythm event. Integrating it would change the score’s noteheads
  while leaving all durations as fabricated quarters and 0/4 valid measures.
- The current product gate already remains practice-disabled for every guitar
  vector score because ties/rests/dots/voices are unaudited. A partial notehead
  fix does not justify changing that.

The text-run split is useful future extraction work, but the mission’s rule is
explicit: do not integrate a speculative fix until it passes complete-event
timing evaluation. It does not.

## What would be needed

1. Recover stem/beam/flag evidence on the mixed fixture after splitting the
   text runs, and make `confident` true only when that evidence exists.
2. Validate 21/21 complete timed events against the reference, including
   quarter/eighth/sixteenth/dotted/beam groups and chord onsets.
3. Preserve the paired/techniques/sparse regression counts.
4. Keep practice off until ties, rests, dots and voices are audited.

Current main remains at the verified paired/chords evidence:
116/116 string+fret, 32/32 confident onsets, 8/8 measures, but all guitar vector
practice remains disabled.


## Round-4 integration: extraction-only split accepted

The isolated `notationNoteheads` change from `6683d65e3b` was ported without any
stem/beam changes from the newer research branch. It was paired with a strict
unknown-rhythm guard:

- `attachRhythm` keeps `duration = null` when the notehead/stem/beam/flag
  evidence is not confident.
- After measure validation, every event in an incomplete measure has its
  duration set back to `null` and `confident=false`.
- `rhythm_recovered` now additionally requires
  `onsets_confident === onsets`.

Independent result on `guitar-mixed-rhythm-vector`:

- 60/60 string/fret events;
- **21/21 noteheads** (was 18/21);
- 21 onsets, **0/21 confident**;
- 4/4 measures declared, **0/4 valid**;
- every event duration is **null** (no fabricated quarter);
- MusicXML contains the explicit `duration not recovered` footnote and no
  `<type>quarter</type>`;
- `rhythm_recovered=false`, assessment `pitchOnly=true`, `practiceReady=false`.

Actual browser PDF.js extraction (Chromium, source module) reproduced the same
21 noteheads, null durations, 0/4 measures and placeholder XML. The product
browser flow (Chromium and WebKit) passes 27/27 and the mixed fixture falls back
without experimental practice metadata.

The paired/chords and techniques fixtures remain unchanged: 116/116 and 32/32
events, 32/32 confident onsets, 8/8 measures. Sparse remains pitch-only with
null timing. The new fixture and tests are committed with the extraction change.
