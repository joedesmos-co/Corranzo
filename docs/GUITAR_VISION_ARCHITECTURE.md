# Guitar Vision — Architecture

**Status:** designed. `guitar-vision/1.0`
**Contract:** `src/features/omr/guitar/architecture.js` (vocabulary), `tabGeometry.js` (TAB geometry)
**Tests:** `tests/guitarArchitecture.test.js` — 28 assertions on the contract itself
**Reference:** `docs/GUITAR_VISION_PITCH_CONTRACT.md`, `GUITAR_VISION_EVAL_CONTRACT.md`, `GUITAR_VISION_SPLITS.md`, `GUITAR_VISION_ACQUISITION_PLAN.md`

---

## The two facts that determine the design

**A TAB staff is not a staff.** Standard notation encodes pitch as vertical offset
from a 5-line reference. A 6-line TAB encodes *string* by which line a digit sits
on and *fret* by the digit itself, with pitch implied by `tuning[string] + fret`.
A shared "staff step" feature is simply wrong for TAB, and no amount of training
data repairs a feature that cannot express the thing being predicted.

**Fret digits are small.** A fret digit is roughly half the height of a notehead,
and frets 10–24 are two glyphs. At one resolution, notation is over-sampled and
wasted, or TAB is unreadable. They are separate high-resolution **views**.

Everything below follows from those two.

---

## What is reused, and what is new

Piano Vision is **not modified**. It is read as a reference and, where the
component is genuinely instrument-agnostic, reused.

| reused read-only | why it transfers |
|---|---|
| `DetailBackbone` (1.1M params) | multiscale conv over grayscale; nothing piano-specific |
| `RegionSampler` | RoI grid sampling, correct for box-identified objects |
| `MusicalAttention` (1.0M/layer) | relation-aware attention over object tokens |
| streaming loader, pixel-digest dedup | infrastructure, instrument-agnostic |
| selection / temperature / risk validation partition | methodology |
| `quality.py` policy | blur/contrast/resolution/page-quad rejection |

| new, guitar-specific | why |
|---|---|
| **typed line vocabulary** | `notation-line-1..5` and `tab-string-1..6` are disjoint roles. A 6-line TAB is not a 6-line staff. |
| **string-conditioned sampler** | TAB objects are sampled in line-relative coordinates, not box-relative (below) |
| **string / fret / digit-count heads** | the distinguishing outputs |
| **staff↔TAB pairing relations** | pairing predicted jointly, not reconstructed afterwards |
| **marking objects with one 46-way type head** | scales to new families without new heads |
| **three views** | notation and TAB need different resolutions |
| **physical-consistency constraints in the decoder** | enforce rather than detect |

---

## String-conditioned region sampling

This is the single most important geometric difference, in
`tabGeometry.js`.

`RegionSampler` samples a grid over a bounding box, which assumes an object's
identity is carried by its extent. A TAB digit is not like that: **two digits at
the same x, same width, same height, one string apart, are different notes two
strings apart**, and a box-sampled feature cannot distinguish them.

So a TAB digit is sampled in **line-relative coordinates** — anchored on its
string line and the staff gap, not on its own box. The same box on a different
string yields a genuinely different feature, and vertical samples deliberately
*straddle* the line so the line itself is represented (a sample set entirely on
one side cannot distinguish "digit on this line" from "digit between lines").

`clusterFretDigits` handles the two-glyph case. Joining is keyed on **string
first**: a `1` on string 5 and a `2` on string 6 at the same x must never become
fret 12. That is precisely the failure the legacy engine patched with
post-hoc clustering heuristics, and it is prevented structurally here.

---

## What the model predicts

### Objects

| head | classes | note |
|---|---|---|
| `objectType` | 19 | notehead, rest, fret-digit, accidental, dot, tuplet, clef, key/time, barline, marking, chord-symbol, chord-diagram, lyric, grace/cue, open/filled/x heads |
| `staffStep` | 14 | diatonic step above the bottom line |
| `writtenOctave` | 9 | |
| `accidentalType` | 9 | |
| `durationType` / `durationDots` / `durationTupletRatio` | 14 / 4 / 12 | |
| `durationGrace` | 3 | grace, cue, none |
| **`stringNumber`** | **7** | 1–6, plus none. String 1 is the highest. |
| **`fret`** | **26** | 0–24 plus unknown. Fret 0 is an open string and is a real value. |
| **`fretDigitCount`** | **3** | 1, 2, none |
| `staffType` | 4 | notation / tab / mixed / unknown |
| `voice`, `rest` | 8, 2 | |
| **`markingType`** | **46** | one wide head, not 46 narrow ones |

`markingType` is one head deliberately. Notation runs to dozens of families, and a
wide type head scales to a new one without touching the architecture, whereas 46
separate binary heads would each need their own data and would silently score
zero for a family with no labels. Its classes are **derived from the notation
family registry**, and a test asserts the two cannot drift — it caught `trill`,
`mordent` and `turn` missing from the registry, which is why they were added.

### Relations — where a guitar model earns its keep

| relation | classes | note |
|---|---|---|
| `notationTabPair` | 2 | the legacy engine paired these **after** recognition with three heuristics |
| `fretOnString` | 7 | |
| `bendTarget` | 2 | a bend resolves to a later note, not just a glyph |
| `slideTarget` | 3 | none / up / down |
| `harmonicNode` | 2 | artificial harmonic anchors a diamond to its stopped note |
| `markingAttachment` | 2 | |
| `chordMember`, `attack`, `laneContinuation` | 2 each | |
| `tieLink`, `slurSpan` | 3 each | |
| `staffPair` | 2 | which notation staff engraves the same measures as which TAB staff |
| `beamOwnership` | 4 | |
| `measureBoundary` | 6 | repeat fwd/back, volta 1/2, segno, coda, section |

The point of predicting `notationTabPair` jointly: the legacy engine could emit a
confident but wrong fingering for a misread notehead, because pairing happened
afterwards and independently. Joint prediction means the two views must agree, and
**disagreement becomes calibrated uncertainty rather than a confident invention.**

### Page context

Key, clef, meter, `staffRole`, tempo, `octaveShift`, `capoFret`, `tuningVariant`,
`scordatura` are predicted **per staff band, not per note**. Two notes in one
measure must not be able to disagree about the time signature.

---

## Views

| view | carries | why |
|---|---|---|
| `full-page` | barlines, repeats, voltas, segno/coda, chord symbols, staff pairing | structure a crop cannot see |
| `notation` | noteheads, clefs, accidentals, beams, technique markings | needs resolution |
| `tab` | fret digits, string lines | digits are half-size and two glyphs wide |

---

## Capacity

`maxObjects: 512`, `maxRelations: 32768` — larger than the piano preset (192) for
a concrete reason: a six-note chord engraves as six noteheads **and** up to six
TAB digits **and** string numbers **and** markings. One beat can exceed the piano
budget, and silently truncating a chord is worse than missing the page.

Measured reference point: Piano Vision V2 compact is 10.7M parameters.

---

## Structured constraints

Enforced in the decoder, so they are true by construction rather than caught by a
downstream validator:

- every `string`/`fret` is playable on the detected tuning;
- a notation↔TAB pair sounds the same pitch;
- fret 0 is an open string, not "no fret";
- written pitch is an octave above sounding pitch (`guitar-pitch/1.0`).

A pair that violates a constraint is not emitted silently. It becomes an explicit
low-confidence outcome, which is what lets the product decline rather than invent.

---

## Input-quality rejection

A **non-learned, deterministic** gate runs before recognition, reusing the Piano
Vision quality policy: minimum short side, minimum contrast, minimum Laplacian
variance (blur), page-quad convexity (perspective), content bounds (cropping),
and a pixel-count ceiling. Phone photos, screenshots and scans differ mainly in
these six properties, so the gate is a function of the input, not of the score.

The model additionally emits a per-page `unreadable` probability. Rejection
requires the gate; the model head is a second signal, not the sole authority.

---

## Confidence and selection

- **Selection** on the `selection` validation partition only.
- **Temperature** fitted on the `temperature` partition.
- **Risk** reported on the `risk` partition and on held-out, with a
  Clopper-Pearson exact bound over **whole scores**, implemented without scipy
  (not installed here).
- Held-out is touched exactly once, after a candidate is selected.

This is the same discipline Piano Vision uses, and it is what the Phase 0 audit
was missing: the engine reported **89% confidence on 5.7%-accurate output** and
was never questioned.

---

## Honest capability statement

Representation is not support. The architecture has a class for every one of the
83 tracked families, and a test asserts it (`familiesWithoutHonestLabels()` is
empty — the architecture can represent the whole surface, so nothing is silently
dropped).

But the acquisition plan says **9 of 83 families** have honest labels in
training, validation and held-out: `note`, `rest`, `chord`, `fret-number`,
`string-number`, `augmentation-dot`, `tuplet`, `accidental`, `tie`.

So a model built today could read notes, rests, chords, dots, tuplets,
accidentals, ties, fret numbers and string numbers. It could not honestly claim
bends, hammer-ons, pull-offs, slides, harmonics, palm mute, let ring, tapping,
vibrato, tremolo, whammy, capo, chord diagrams, or structural navigation —
**and 1 785 more real labelled instances are needed before it could.**
