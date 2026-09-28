# Guitar Vision — Strict Evaluation Contract

**Status:** frozen. `guitar-eval/1.0`.
**Modules:** `src/features/omr/guitar/guitarObjects.js`, `guitarMetrics.js`, `assignment.js`
**Baseline:** `node tools/guitar-vision/corpus-baseline.mjs --out <path>`

---

## The problem this replaces

The Phase 0 audit found the existing metric reporting:

| Legacy bag metric | Value on 13 real guitar scores |
|---|---|
| pitch accuracy | 17.4% |
| note detection F1 | 52.7% |
| onset **time** accuracy | 0.4% |

and, on the synthetic fixtures, **100% pitch accuracy while order-sensitive
recovery was 0%** and *not one* of 793 matched notes had a correct onset time.

A bag metric answers "does a note with this pitch exist anywhere in the score?" It
cannot distinguish that from "this specific note is correct." Reporting 52.7%
detection F1 when the engine has actually identified ~10% of the notes correctly
is not a rounding problem, it is a different question being asked.

## The two stages

**1. Identity.** Truth and generated note objects are paired by optimal
assignment (Jonker-Volgenant, O(n³)) within each part/measure bucket. The cost
combines onset, duration and pitch together, and a pair is *impossible* — not
merely expensive — when a rest would pair with a pitched note, when the onset gap
exceeds half a beat, when the pitch gap exceeds an octave, or when the two sit on
different staves.

Greedy matching is not good enough. Resolving each truth note to its cheapest
remaining candidate lets one early mistake cascade: a duplicated or misread
notehead consumes a partner a later correct note needed, and the error is then
charged to two objects instead of one. Optimal assignment minimises total cost
over the whole bucket, so residual error is a real recognition error.

**2. Attributes.** Only after identity does any attribute get credit. Each of
`noteVsRest`, `soundingPitch`, `writtenPitch`, `onset`, `duration`, `dots`,
`tuplet`, `string`, `fret`, `voice`, `staff`, `accidentals` is scored over matched
pairs, with unmatched truth counted as misses and unmatched generated counted as
false positives.

## Two invariants that keep the metric honest

**Detection is always reported, and always first.** Attribute accuracies are
conditional on having matched. The pathological case — every pitch present and
correct, one note displaced a beat — scores `soundingPitch: 1.0` and
`detection.f1: 0.5`. Only reading detection alongside the attribute reveals the
error. `endToEndNoteAccuracy` collapses both into the single number a product
decision should rest on.

**Nothing reports 1.0 for an empty comparison.** An attribute with no comparable
objects returns `null`. This caught two real bugs during development: matching on
raw `partId` paired *nothing* (imported scores use a content hash, our emitter
writes `P1`) and the empty set was scoring as a clean sweep. Both are now tested.

## No evidence is reported as `n/a`, never as 0%

A metric with no comparable objects is a data gap, not a failure. The real
13-score corpus contains **zero** string/fret labels, so "string accuracy 0%" would
read as "the engine got every string wrong" when the truth is "this corpus cannot
say". The baseline prints `n/a (0 scores)` and records `scoresWithEvidence`.

The same principle governs notation families. A family the MusicXML parser cannot
extract is listed in `unscoreableFamilies` and reported as unsupported, never as
recall 0. Blaming the recogniser for a data-layer gap is its own kind of lie.

---

## Current results, 13 real guitar scores

Bag metrics, retained because the existing benchmark thresholds are written
against them:

| | mean |
|---|---|
| pitch accuracy | 17.4% |
| note detection F1 | 52.7% |
| onset time accuracy | 0.4% |

Strict per-object metrics, 12 of 13 scores transcribed:

| metric | value | scores with evidence |
|---|---|---|
| note detection F1 | **9.9%** | 12 |
| detection precision | 10.3% | 12 |
| detection recall | 9.6% | 12 |
| **end-to-end note accuracy** | **5.1%** | 12 |
| sounding pitch | 48.5% | 7 |
| written pitch | 48.5% | 7 |
| onset | 38.1% | 7 |
| duration | 48.2% | 7 |
| voice | 91.0% | 7 |
| staff | 100.0% | 7 |
| accidentals | 0.2% | 5 |
| accidentals *(when present)* | 0.3% | 4 |
| tuplets *(when present)* | 0.0% | 1 |
| dots | 100.0% | 7 |
| dots *(when present)* | n/a | 0 |
| string | n/a | 0 |
| fret | n/a | 0 |
| TAB consistency | n/a | 0 |

**The headline is the gap between 52.7% and 9.9%.** The engine finds roughly the right
*number* of noteheads but identifies only about one in ten correctly. The bag
metric was measuring ink coverage, not recognition.

**`accidentals: 0.2%`** is genuinely comparable and genuinely near-zero — the
recogniser is not reading accidentals at all on these scores.

**`dots: 100%` is a lie, and the contract says so.** Almost every note has zero
augmentation dots, so unconditional dot accuracy is dominated by the default and
reads a perfect 100%. The companion `dots (when present)` figure is `n/a (0
scores)`, because these scores have no dots to find. Reporting only the
unconditional number would have let a total failure read as a total success.
Sparse attributes therefore always get a conditional companion, restricted to
pairs where the truth is non-default.


---

## Marking families

46 notation families are compared as anchored sets: a marking matches only the
same family, in the same measure, within a quarter-beat, with the same payload.
Each reports its own precision and recall so a missing family cannot hide inside
an aggregate.

| family | status |
|---|---|
| `tie`, `slur`, `staccato`, `accent`, `tenuto`, `marcato`, `fermata` | scoreable |
| `hairpin`, `tempoMarking`, `chordSymbol`, `graceNote` | scoreable |
| `hammer-on`, `pull-off`, `slide`, `bend`, `fingering`, `fret-position` | scoreable |
| `bend-amount`, `pre-bend`, `bend-release`, `vibrato` | **unscoreable** — parser drops them |
| all harmonic variants, `palm-mute`, `let-ring`, `tapping`, `tremolo-picking`, `whammy-bar`, `capo`, `tuning`, `barre`, `chord-diagram`, `pick-direction`, `octave-shift`, `arpeggio`, `dynamic`, `repeat`, `ending`, `segno`, `coda`, `ghost`, `dead` | **unscoreable** |

`unscoreableFamilies` is emitted in every report. As the data engine grows, that
list must shrink — it is a work list, not a footnote.

---

## What this contract does not yet do

- **Score-level risk.** No Clopper-Pearson bound yet, so "usable score rate" is
  not yet statistically defensible. Coming with the split manifests.
- **Structure.** Repeats, voltas, segno, coda and DC/DS are extracted but not yet
  scored as a structural alignment, because the real corpus has no ground truth
  for them.
- **Page-level and cross-page alignment.** Everything is matched within a
  measure, so a score whose measure segmentation is wrong is charged for it in
  `detection` rather than diagnosed as a segmentation failure. The measure-grid
  diagnostics cover that separately.
- **Lyrics.** Not modelled. The real corpus has 9 lyric labels, so any score
  would be noise.
