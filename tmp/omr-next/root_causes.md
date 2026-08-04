# Corranzo OMR root-cause map

Baseline: commit `3404694`, frozen semantic evaluator `2.0.0` / schema `2`,
written-mode corpus, 9/9 fixtures.

This ranking uses the 978 event-level records in `error_inventory.json`. The
corpus report's compact defect totals are higher for several codes because it
counts every evaluator observation, while the inventory reconstructs one
traceable event/chord record at a time. Scores and before/after defect counts
in the improvement report use the frozen corpus report; the counts below are
the traceable root-cause population.

## Ranked mechanisms

| Rank | First divergence | Traceable mismatches | Fixtures | Confidence | Regression risk | Finding |
|---|---|---:|---:|---|---|---|
| 1 | Duration inference and rhythm packing | 458 | 8 | High | High | 229 duration rows already disagree at glyph/beam/gap normalization; 229 surviving candidates are placed at the wrong onset during lane packing/resnap. |
| 2 | Pitch mapping and accidental state | 215 | 6 | High | High | 183 rows have the wrong natural staff pitch before MusicXML and 32 more diverge when accidental state is applied. |
| 3 | Notehead detection / ownership | 158 | 8 | Medium-high | High | Missing and extra events generally begin with absent, duplicate, or staff-line-connected notehead components, not with MusicXML emission. |
| 4 | Chord grouping after pitch is known | 78 | 6 | High | Medium-high | Of 140 traceable chord failures, 62 preserve cardinality and are pitch errors; the remaining 78 actually inflate or drop chord tones. |
| 5 | Measure/staff geometry | 15 | 4 | High | Medium | Phantom staff bands and stems classified as barlines shift entire measures and make later missing/extra/chord defects secondary symptoms. |
| 6 | Articulation association | 19 | 2 | High | Medium | Vector path dots were absent from the text-glyph stream; raster articulations remain entangled with staff-line-connected components. |
| 7 | Sustain association | 10 | 4 | High | Medium-high | The notes exist, but six missing and four incorrect tie records still differ at curve ownership/emission. |
| 8 | Voice assignment | 1 | 1 | High | High | The only direct mismatch is a stem-down C5 in tuplets measure 5 emitted as voice 3 instead of voice 1; it also has wrong duration and tie state. Voice reassignment is not the dominant remaining corpus mechanism. |

## A. Voice assignment and staff ownership

- Stem and beam ownership was joined for 809/978 baseline mismatch records.
  Despite that coverage, the frozen evaluator reports only one direct
  `voice-mismatch` and no direct `staff-mismatch`.
- The single voice case has correct pitch and onset, but a detected half-note,
  down-stem lane is emitted as voice 3 with duration 2 instead of the expected
  dotted duration 3 and lacks the tie. A voice-only rewrite would leave the
  musical failure intact.
- A major staff-ownership cascade was nevertheless present in the
  single-staff guitar fixture: two one-pixel ledger-line bands were grouped as
  extra systems. Low chord tones were then owned by phantom staves and measures
  9–16 were fabricated. This was fixed at staff-system selection.
- No corpus evidence supports a global stem-direction-to-voice rewrite.
  Cross-staff notation needs a joint staff/stem/beam model, not a filename or
  clef-based reassignment.

## B. Chord reconstruction

- Traceable chord records: 140 across 7 fixtures.
- Same cardinality but wrong pitch membership: 62. These first diverge at pitch
  mapping and should not be “fixed” by changing chord grouping.
- Actual grouping failures: 78 across 6 fixtures: 40 inflated chords and 38
  dropped/split chords.
- Generated chords containing a duplicate MIDI: 32 across 4 piano fixtures.
  In the raster scan these are usually duplicate connected components; in dense
  vector piano they are competing same-onset/stem ownership.
- The previous adjacent-slot chord timing fix remains valid. Broadening the
  chord merge radius would combine voices and regress dense textures, so the
  next safe step requires explicit notehead-to-stem ownership before grouping.

## C. Pitch and staff inference

- Incorrect-pitch event records: 153 across 6 fixtures.
- Dominant semitone deltas are `-1` (40), `+1` (38), and `-2` (28), but the
  vector path accidental trace shows that 32 rows are accidental-state
  divergences and 121 are already wrong at natural staff-position mapping.
- A global vector notehead-baseline shift was tested. It changed a local
  alignment symptom but collapsed corpus pitch from 61.5% to 35.2%, increased
  incorrect-pitch from 172 to 313, and increased incorrect-chord from 199 to
  251. The attempt was rejected and reverted.
- The remaining dense-piano errors require per-font glyph anchors plus
  staff-line/ledger evidence. A single global vertical offset is demonstrably
  unsafe.

## D. Duration and onset inference

- The largest duration transitions are:
  - quarter expected → eighth generated: 62, including 49 in dense piano;
  - eighth expected → sixteenth generated: 42, including 36 in dense piano;
  - half expected → quarter generated: 24, all in the raster articulation scan;
  - eighth expected → quarter generated: 22, including 21 in dense piano.
- The raster 2→1 cluster begins when filled noteheads, hollow interiors, stems,
  and staff lines collapse into connected components. It cannot be repaired by
  doubling durations without corrupting real quarter notes.
- Vector augmentation-dot paths now reach note candidates. Two previously
  missed dot-ownership defects are removed. A remaining tuplet dot is detected
  (`dotted: true`) but its candidate is later shortened/repositioned during
  packing, proving that detection thresholds are no longer the first failure.
- Onset and duration errors co-occur heavily in dense measures. Fixing them
  safely requires a joint per-voice rhythm lattice constrained by beams, rests,
  and measure capacity; independent late normalization has already reached its
  safe limit.

## E. Detection failures

- Symbol-detection/ownership rows: 158 across 8 fixtures.
- The raster scan alone contributes 53 traceable missing/extra events and shows
  staff-line-connected notehead clusters in the rendered geometry.
- The paired dense guitar fixture contributes 38 missing/extra events. A broad
  “note columns are not barlines” rule improved the monophonic techniques page
  but regressed dense chords, proving that chord stacks need different evidence.
  The accepted rule is restricted to systems with separated singleton attacks.
- Further global threshold lowering or component splitting is unsafe: prior
  raster chord-splitting probes created duplicate notes and worsened chord
  integrity. A larger detector change needs staff-line removal with component
  reconstruction and confidence-preserving deduplication.

## Accepted root-cause fixes

1. Filled PDF Bézier circles are extracted as augmentation-dot candidates;
   repeat-dot pairs are retained for diagnostics but excluded from note
   ownership.
2. Degenerate one/two-line ledger fragments are excluded from single-staff
   system grouping only when normal staves remain.
3. Vector note-column evidence suppresses false barlines in paired notation only
   for separated singleton attacks; chord-stacked systems retain the established
   pixel/barline path.

## Proven architectural remainder

- Dense polyphonic onset/duration packing needs a joint voice/rhythm lattice.
- Dense pitch needs font-aware notehead anchors and explicit ledger evidence.
- Raster chords need staff-line removal followed by connected-component
  reconstruction.
- Dense paired notation needs joint barline, chord-column, and TAB-correspondence
  inference.

Those changes are larger architectural work. The tested global substitutes
(vertical pitch offset, broad paired-note column hints, and prior raster chord
splitting) all regressed real fixtures and were rejected.
