# Corranzo OMR semantic improvement report

## Outcome

Starting from accepted commit `3404694`, three small, general recognition
changes were accepted without changing the frozen evaluator or rewriting the
pipeline.

The frozen 9-fixture corpus improved:

| Metric | Baseline | Final | Delta |
|---|---:|---:|---:|
| Overall | 62.89% | 65.69% | **+2.80 pp** |
| Pitch | 61.51% | 65.68% | **+4.18 pp** |
| Rhythm | 67.20% | 68.25% | **+1.04 pp** |
| Sustain | 44.44% | 55.56% | **+11.11 pp** |
| Articulation | 85.36% | 85.36% | 0 |
| Measure structure | 68.38% | 71.61% | **+3.23 pp** |
| Interpretation | 13.33% | 13.33% | 0 |
| Playback | 100% | 100% | 0 |

The frozen comparison gate reports `ACCEPT: YES` and no class or per-fixture
gate regressions.

## Baseline and error map

- Commit: `3404694`
- Evaluator: frozen `2.0.0`, schema `2`, written mode
- Corpus: 9/9 fixtures completed
- Complete baseline inventory: `tmp/omr-next/error_inventory.json`
- Final-state inventory: `tmp/omr-next/final-inventory/error_inventory.json`
- Ranked analysis: `tmp/omr-next/root_causes.md`

The baseline inventory contains 978 event-level mismatch records. Every record
includes fixture, page, measure, staff, voice, expected/generated notes, onset,
duration, chord membership, pitch delta, candidate and glyph IDs when a
candidate exists, stem/beam ownership, accidental provenance, confidence, and
the first demonstrable divergent stage.

The final event-level inventory contains 1,016 rows even though every aggregate
score improves. Correcting phantom/split measures allows the inventory's strict
one-measure matcher to expose more individual timing and chord records that were
previously hidden behind unmatched measure spans. This is why campaign
acceptance and defect deltas use the frozen evaluator's aggregate report, while
the inventory is used to locate the first pipeline divergence.

Provenance coverage:

| Field | Coverage |
|---|---:|
| Page | 978/978 |
| First divergent stage | 978/978 |
| Candidate IDs | 876/978 |
| Glyph IDs | 809/978 |
| Stem ownership | 809/978 |
| Beam ownership | 809/978 |
| Accidental provenance | 641/978 |

Rows without a generated candidate retain measure-level geometry and detector
counts; a candidate/glyph ID cannot truthfully be invented for a missed symbol.

The current corpus was rerun from the checked-out baseline. Its fresh counts
slightly differ from the handoff brief (`duration-mismatch` 239 rather than 240;
`missing-note` 163 rather than 209; `extra-note` 154 rather than 198). All
before/after comparisons below use the fresh frozen run from the same checkout.

## Root causes

The traced first-divergence ranking is:

| Root mechanism | Traceable rows | Fixtures | Confidence | Risk |
|---|---:|---:|---|---|
| Duration inference + onset packing | 458 | 8 | High | High |
| Pitch mapping + accidental state | 215 | 6 | High | High |
| Notehead detection / ownership | 158 | 8 | Medium-high | High |
| True chord grouping | 78 | 6 | High | Medium-high |
| Measure/staff geometry | 15 | 4 | High | Medium |
| Articulation association | 19 | 2 | High | Medium |
| Sustain association | 10 | 4 | High | Medium-high |
| Direct voice assignment | 1 | 1 | High | High |

Important conclusions:

- Voice assignment is not the dominant remaining corpus failure. Only one
  direct voice mismatch exists, and that note also has wrong duration and tie
  state.
- Chord totals overstate chord-grouping failures. Of 140 traceable incorrect
  chords, 62 have the correct number of tones and first diverge at pitch
  mapping. The remaining 78 are actual merge/split/drop ownership failures.
- Most pitch failures are already wrong before accidental application. A
  global glyph-baseline shift is unsafe.
- Dense rhythm errors are systematic: quarter→eighth (62),
  eighth→sixteenth (42), raster half→quarter (24), and
  eighth→quarter (22). They need different evidence paths, not a duration
  multiplier.
- Raster staff lines, hollow noteheads, stems, and chord tones remain connected
  at the first detector stage. Late chord or duration normalization cannot
  recover that missing topology.

## Accepted fixes

### 1. Filled PDF path augmentation dots

Actual failure:

The ReportLab fixtures draw augmentation dots as filled Bézier circles. They
were absent from the PDF text-glyph stream, so the note candidate never
received dot ownership. Repeat bar dots use the same circle primitive.

General rule:

- Extract only compact, filled, closed, near-square curved paths at
  staff-relative dot size.
- Emit them as vector augmentation-dot candidates.
- Tag vertical repeat-dot pairs and exclude those pairs from note ownership.
- Normalize the path's visual center to the vector notehead font baseline only
  when comparing the two source types.

Evidence:

- Filled/stroked/notehead-sized geometry controls were added.
- Repeat-dot ownership control was added.
- `missing-dot` changed 3→1.
- Rhythm improved 67.20%→67.38%.
- Overall improved 62.89%→62.92%.
- No score or fixture gate regression.

One remaining tuplet case now has a detected `dotted: true` candidate but is
shortened/repositioned during rhythm packing. That proves the remaining failure
is downstream of detection.

### 2. Reject degenerate ledger bands as single-staff systems

Actual failure:

In `guitar-standard-chords-vector`, two one-pixel, two-line bands beneath the
real staves are ledger fragments from low chords. They were grouped as complete
single-staff systems, producing four systems and sixteen measures instead of
two systems and eight measures. The candidates on those phantom systems were
false/wrong-staff events, not valid additional notation.

General rule:

- Preserve the established multi-staff viability filter.
- On single-staff pages, remove rejected bands only when normal viable staves
  remain and every removed band is at most 0.6% page height with at most two
  detected lines.
- If that narrow proof is absent, retain all original staves.

Evidence:

- Geometry fixture reproduces two normal staves plus two ledger ghosts.
- The guitar fixture changes 4→2 systems and 16→8 measures.
- Fixture overall improves 46.0%→63.9%.
- Fixture pitch improves 30.0%→45.5%.
- Corpus overall improves 62.92%→64.90%.
- Incorrect chord 199→196; incorrect pitch 172→167; missing note 163→156;
  extra note 154→132; split measure 12→8; incorrect tie 6→4.
- Sustain improves 44.44%→55.56%.
- No frozen score or fixture gate regression.

The compact onset count changes 250→256 after the phantom measures are removed:
six formerly unalignable/wrong-measure events become aligned timing
differences. This is a defect reclassification, not worse recognized timing:
the rhythm score improves 67.20%→67.45%, the fixture rhythm score improves, and
the comparison gate reports no regression. The count is disclosed rather than
hidden.

### 3. Singleton note-column evidence for paired notation

Actual failure:

In `guitar-techniques-paired-vector`, monophonic note stems at x≈425 and x≈624
were mistaken for barlines, producing six measure spans per system instead of
four. Paired notation previously disabled vector note-column evidence to
protect dense chord stacks.

General rule:

- Enable vector note-column barline rejection on paired notation only when
  there are at least three notehead columns and every adjacent x position is
  separated by more than 0.6% page width.
- Any close/staggered chord stack keeps the established paired-notation path.

Evidence:

- Failing geometry fixture covers separated singleton attacks and dense chord
  controls.
- Technique fixture changes to the correct eight measures.
- Technique pitch, rhythm, and measure structure reach 100%.
- Technique overall improves 64.4%→71.4%.
- Dense paired chords remain exactly 69.4%; their measure count and defect
  profile are unchanged.
- Corpus overall improves 64.90%→65.69%.
- Pitch improves 63.22%→65.68%; rhythm 67.45%→68.25%; measure structure
  69.39%→71.61%.
- Duration mismatch 239→235; missing note 156→152; extra note 132→128;
  split measure 8→4.
- No frozen score or fixture gate regression.

## Rejected fixes

### Global vector notehead vertical-center shift

Hypothesis:

Move the vector notehead center correction from 20% to 50% of glyph height to
repair dense-piano staff positions.

Result:

- Overall collapsed 62.89%→57.21%.
- Pitch collapsed 61.51%→35.22%.
- Incorrect pitch increased 172→313.
- Incorrect chord increased 199→251.

Conclusion:

The local symptom is real, but glyph anchors vary by font/engraver and cannot
share one global offset. The attempt was fully reverted.

### Broad paired-notation note-column hints

Hypothesis:

Enable vector note-column barline rejection for every paired notation system.

Result:

- Technique fixture improved 64.4%→71.4%.
- Dense paired chords regressed 69.4%→67.5%.

Conclusion:

Chord stacks make note-column evidence ambiguous. The broad change was rejected
and replaced by the accepted singleton-only rule.

### Global raster chord/component splitting

Previously captured campaign probes and the current geometry review show that
splitting staff-line-connected raster components globally creates duplicate
noteheads and worse chord integrity. It was not reintroduced. A safe version
requires staff-line removal plus component reconstruction, which is a larger
detector change.

## Before/after defect counts

These are the frozen evaluator's compact corpus totals.

| Defect | Baseline | Final | Delta |
|---|---:|---:|---:|
| Onset mismatch | 250 | 256 | +6 reclassified |
| Duration mismatch | 239 | 235 | -4 |
| Incorrect chord | 199 | 196 | -3 |
| Incorrect pitch | 172 | 167 | -5 |
| Missing note | 163 | 152 | -11 |
| Extra note | 154 | 128 | -26 |
| Missing dot | 3 | 1 | -2 |
| Split measure | 12 | 4 | -8 |
| Missing tie | 6 | 6 | 0 |
| Incorrect tie | 6 | 4 | -2 |

The final comparison artifact is
`tmp/omr-next/final-compare.json`; its result is `ACCEPT: YES` with no
regressions/gate failures.

## Validation

- Frozen semantic corpus: 9/9 fixtures, pass.
- Final frozen comparison: accept, no gate failures.
- Added/focused geometry tests:
  - PDF path dot extraction and repeat-dot rejection;
  - single-staff ledger-ghost filtering;
  - singleton versus dense paired note-column selection.
- Full unit suite: **275 files passed, 2,767 tests passed, 5 skipped**.
- Guitar notation/TAB and Wet Hands paired-notation regressions: pass as part
  of the full suite.
- Tie, accidental, playback, report, confidence, and PDF performance suites:
  pass as part of the full suite.
- Production build: pass (`vite build`, 1,493 modules transformed).
- Build emits the pre-existing large-chunk advisory; there is no build error.
- Targeted diff whitespace check: pass.

## Remaining bottlenecks

The remaining high-mass failures are not safely addressable by another local
threshold:

1. **Dense polyphonic rhythm:** needs a joint per-voice lattice constrained by
   beam groups, rests, simultaneity, and measure capacity.
2. **Dense vector pitch:** needs font-aware notehead anchors and explicit ledger
   evidence instead of a global baseline offset.
3. **Raster chord detection:** needs staff-line removal followed by connected
   component reconstruction and confidence-preserving deduplication.
4. **Dense paired notation:** needs joint barline/chord-column/TAB
   correspondence; the singleton rule cannot safely generalize to chord stacks.
5. **Tie/voice edge case:** the remaining direct voice mismatch couples stem
   lane, dotted duration, and tie ownership and should be solved as one event,
   not by renumbering the voice.

The campaign therefore stops at the boundary requested: three safe,
cross-fixture rules are accepted; two tempting global substitutes are proven
regressive and reverted; the remaining clusters require larger architectural
work with new geometry fixtures and intermediate-stage models.
