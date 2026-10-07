# Piano truth-unblock — provenance proof report

**Status: PASS on the core correspondence claim, with documented edge cases.**

This proof is a provenance/truth experiment, not a model-training run. It is
CPU-only (seconds per score), used no GPU, read no old Piano residual field,
did not touch Corpus 2.1, and did not run any decoder.

## Question

Can a deterministic renderer produce, from symbolic sources Corranzo controls,
a machine-checkable exact mapping between printed elements and their symbolic
identity — including geometry — at useful notation coverage?

## Method

```
MusicXML / MXL
  -> Verovio 6.3.0 toolkit, options {xmlIdSeed: 20261007,
                                     svgBoundingBoxes: true,
                                     svgContentBoundingBoxes: true}
  -> MEI (getMEI)          symbolic truth with xml:id on every element
  -> SVG (renderToSVG)     layout with matching ids and per-element bboxes
  -> element table         id, tag, measure/staff/layer ancestry, pitch/duration,
                           bbox, notehead anchor
```

Checks per score:

1. **id join** — every MEI element id appears in the SVG (notes, rests, mRest,
   accidentals, beams, tuplets, ties, slurs, articulations, dynamics, hairpins,
   tempo, ornaments, tremolos, arpeggios, glissandi, pedal, octave shifts,
   fingerings, fermatas, rehearsal marks, directions, endings).
2. **state join** — clef / keySig / meterSig have *no* MEI id on their rendered
   groups (they are layout-generated); each rendered group's own semantic
   attributes (`getElementAttr`) are matched to the governing source state
   (staffDef/scoreDef/inline declarations, including section-level changes,
   system-break courtesy placement, within-measure changes, and `sameas`
   aliases).
3. **geometry** — every joined element has a positive-area bbox; measure and
   staff ancestry agree with visual placement (including a cross-staff note).
4. **independent source cross-check** — diatonic pitch histogram from a music21
   parse of the same MusicXML vs the MEI note population.
5. **determinism** — byte-identical SVG across separate processes with a fixed
   `xmlIdSeed`.

## Inputs

| id | source | notes | licence |
|---|---|---|---|
| cc0-beginner-single | Corranzo fixture | 32 | CC0-1.0 |
| cc0-grand-voices | Corranzo fixture | 88 | CC0-1.0 |
| cc0-rhythm-tuplets | Corranzo fixture | 63 | CC0-1.0 |
| cc0-dense-advanced | Corranzo fixture | 264 | CC0-1.0 |
| pd-minuet | Mutopia | 204 | public domain |
| pd-hungarian-dance | Brahms WoO 1 | 1503 | public domain |
| pd-la-campanella | Liszt S.141/3 | 4388 | public domain |
| pd-gymnopedie | Satie | 469 | PD composition |
| diag-bach-fugue | local cache | 750 | diagnostic only, not redistributed |
| diag-beethoven-sonata | local cache | 1754 | diagnostic only, not redistributed |
| cc0-coverage-probe | authored for this proof | 19 | CC0-1.0 |

The coverage probe (`inputs/coverage_probe.musicxml`, sha256
`4657937c07ade49ef45b4547d1eab2092876b0b110646053309aa5bf71fce4bb`) exercises
grace notes, cue notes, tremolo, glissando, fingering, trill/mordent/turn,
fermata, rehearsal mark, tempo text, dynamics, hairpin, pedal, octave shift,
arpeggio, cross-staff ownership, multi-voice, and chord stacks.

## P0 reproduction check (pilot)

Re-run during the pilot (2026-10-07): SVG output is byte-identical and all
9,534 note joins, all state joins and cross-process stability reproduce. Three
provenance defects were found and fixed before scaling:

1. `getMEI()` embeds `<application isodate="...">`, so raw MEI bytes are
   **not** reproducible even though ids, content and SVG are. All provenance
   hashes now use **canonical MEI** (`canonical_mei()` strips `isodate`).
2. The staff-line extractor filtered vertical paths (`|x1-x2| < 0.5`) while
   staff lines are horizontal, so the visual-staff check had silently compared
   zero notes and reported a vacuous "0 disagreements". It now selects the five
   longest horizontal paths per staff group (excluding ledger lines).
3. A second extraction bug (body slice ending at the first `</g>`) was fixed by
   scanning to the staff's layer group.

Two consecutive full runs then produce byte-identical `out/summary.json`
(sha256 `813012f89614ab3654112be47371e3772f3efe237a5739085d00b186f996a8a8`).

## Results

| id | notes id-joined | non-state classes joined | state groups resolved | histogram diff | cross-process stable |
|---|---|---|---|---|---|
| cc0-beginner-single | 32/32 | all | 5/5 | 0 | yes |
| cc0-grand-voices | 88/88 | all | 10/10 | 0 | yes |
| cc0-rhythm-tuplets | 63/63 | all | 5/5 | 0 | yes |
| cc0-dense-advanced | 264/264 | all | 10/10 | 0 | yes |
| pd-minuet | 204/204 | all | 22/22 | 0 | yes |
| pd-hungarian-dance | 1503/1503 | all | 62/62 | 0 | yes |
| pd-la-campanella | 4388/4388 | all | 305/305 | 968 (explained) | yes |
| pd-gymnopedie | 469/469 | all | 38/38 | 0 | yes |
| diag-bach-fugue | 750/750 | all | 42/42 | 0 | yes |
| diag-beethoven-sonata | 1754/1754 | all | 138/138 | 0 | yes |
| cc0-coverage-probe | 19/19 | all | 4/4 | 5 (explained) | yes |
| **total** | **9534/9534** | **all** | **641/641** | 9/11 exact | **11/11** |

Aggregate non-state id joins:

| class | MEI | in SVG |
|---|---|---|
| note | 9534 | 9534 |
| rest | 728 | 728 |
| mRest | 29 | 29 |
| accid | 1590 | 1590 |
| beam | 1317 | 1317 |
| artic | 2335 | 2335 |
| tie | 156 | 156 |
| slur | 110 | 110 |
| tuplet | 113 | 113 |
| dynam | 143 | 143 |
| hairpin | 75 | 75 |
| tempo | 318 | 318 |
| pedal | 238 | 238 |
| octave | 40 | 40 |
| arpeg | 70 | 70 |
| trill | 5 | 5 |
| mordent / turn | 1 / 1 | 1 / 1 |
| gliss | 1 | 1 |
| fing | 1 | 1 |
| fermata | 6 | 6 |
| reh | 1 | 1 |
| dir | 21 | 21 |
| ending | 2 | 2 |

State join breakdown: **612 exact**, **4 courtesy at a system end**, **25
within-measure / previous-state placement**; 0 unresolved.

Other checks:

- **visual staff ownership**: with the corrected staff-line extractor,
  9,253/9,534 notes (97.05%) are geometrically nearest to the staff that the
  source assigns them to; 281 notes disagree. The disagreements are
  ledger-line/between-staff placements and octave-shifted notes printed away
  from their staff (e.g. middle C equidistant to both staves at ~4.3 staff
  gaps; 8vb notes printed over the other staff). Source staff ancestry (the
  truth recorded in the objects) is unaffected; the geometric heuristic is what
  is ambiguous, not the correspondence.
- **music21 histogram**: exact on 9/11 scores. The two differences
  (la-campanella 968/4388, probe 5/19) are entirely notes under octave shifts
  (see finding 4).
- **determinism**: with `xmlIdSeed` fixed, all 11 scores render byte-identical
  SVG in separate processes. Without a seed, Verovio generates random ids.
- **rasterisation**: Verovio SVG -> PNG via `sharp` at 2480 px width
  (2480x3507, ~300 DPI A4), deterministic. Vector PDF is not emitted by
  Verovio; a vector->PDF step (cairosvg/rsvg/Chrome) is an engineering choice,
  not a truth constraint, since SVG is already vector.

## Falsification findings (hostile review)

1. **Initial clef/key/time signature groups carry layout-generated ids, not MEI
   ids.** 20 of 95 clefs and all 23 keySig / 20 meterSig declarations fail a raw
   id join. Mid-score clefs declared inline do join (75/95). Consequence: clef,
   key and time state must be joined semantically; the proof resolves 641/641
   rendered state groups with the state join, including section-level key
   changes and system-break courtesy placement. This is exact but is not a
   one-to-one id link.
2. **Renderer rest normalisation edge case.** In the first version of the probe,
   two partial rests in a voice that switched staff (cross-staff) were imported
   as durationless `<mRest>` and rendered at identical x. A minimal
   single-voice test imports partial rests correctly as `<rest>`. Corpus scores
   join 728 rests 1:1. Consequence: rest duration truth should come from the
   source symbolic file joined by order; do not trust MEI `mRest` for partial
   rests in unusual voice layouts.
3. **MusicXML single tremolo is dropped (encoding-dependent).** The probe's
   `<tremolo type="single">3</tremolo>` produces no `trem`/`bTrem`/`fTrem`
   element in MEI and no tremolo in SVG. Corpus evidence from the pilot refines
   this: some single-tremolo encodings do import as `bTrem` and map (4 scores /
   17 tremolos in the pilot), so support is encoding-dependent. Consequence:
   the pipeline must check each source for dropped features (it does) and
   quarantine or route those through MEI input.
4. **Octave shifts are applied to the notated pitch.** For notes under an
   octave shift, Verovio writes MEI `oct` = shifted (printed) pitch and keeps
   the source pitch in `oct.ges` (e.g. source G4 under 8vb -> `oct="3"
   oct.ges="4"`; the notehead is printed at G3 with the bracket). 1,827 of
   4,388 la-campanella notes (41.6%) are affected. Consequence: a truth record
   must store both `oct` (what is printed) and `oct.ges` (what the source
   notates), plus the `octave` element with `startid`/`endid`; a naive
   pitch label from `oct` alone disagrees with the source.
5. **No source identity is lost for notes and non-state events.** Every MEI
   note/rest/event id is present in the SVG (16,910/16,973 = 99.63% of all MEI
   elements; the 63 misses are exactly the initial clef/keySig/meterSig state
   groups handled by the state join).
6. **No notation rewriting detected** in ties, slurs, beams, tuplets,
   accidentals, dots, dynamics, hairpins, pedal, octave, arpeggios, glissandi,
   fingerings, ornaments, fermatas, directions or endings: all were rendered
   and id-joined.
7. **Determinism is opt-in and MEI needs canonicalisation.** `xmlIdSeed` must
   be set; otherwise ids are random per run (geometry content is unchanged).
   `getMEI()` additionally embeds `<application isodate="...">`, so raw MEI
   bytes vary by run; provenance hashes must use canonical MEI. Both are build
   parameters, not truth gaps, but they must be pinned and recorded.
8. **The visual-staff check was initially vacuous and is now honest.** The
   original extractor filtered vertical paths and therefore found zero staff
   lines; `staff_visual_agree = staff_visual_disagree = 0` was reported as
   "100% agreement". The corrected check gives 9,253/9,534 (97.05%); the 281
   disagreements are ledger-line/between-staff/octave-shift placements where a
   geometric nearest-staff heuristic is genuinely ambiguous. The id join and
   source staff ancestry are unaffected. This defect was caught only because the
   pilot re-ran the proof as a hard gate.

## Reproduction

```bash
python3 -m pip install verovio==6.3.0 music21==10.5.0
cd docs/piano-truth-unblock/proof
python3 render_probe.py            # writes out/*.paired.json, out/summary.json
python3 render_probe.py --svg-hash pd-minuet   # one render hash
```

Raster sample (optional, Node with sharp):

```js
const sharp = require('sharp');
sharp('out/coverage_probe.svg', {density: 96, limitInputPixels: false})
  .resize({width: 2480, fit: 'inside'})
  .flatten({background: '#ffffff'}).png().toFile('out/coverage_probe.png');
```

## Artifacts

- script: `render_probe.py` (sha256 `d58531cd9b4e2137bc2d1d784293b50e977efde3f4659319995b31abecac1bf3`)
- inputs: `inputs/coverage_probe.musicxml` (sha256
  `4657937c07ade49ef45b4547d1eab2092876b0b110646053309aa5bf71fce4bb`)
- paired sample: `out/<score>.paired.json` (element tables with id, tag,
  measure/staff/layer, pitch/duration/grace/cue, bbox)
- summary: `out/summary.json` (sha256
  `813012f89614ab3654112be47371e3772f3efe237a5739085d00b186f996a8a8`)
- raster sample: `out/coverage_probe.png` (sha256
  `4eca6c5920ae71caea5e550923ca080350ef739ea9b82bd673b2cca7d3b2d78e`),
  `out/coverage_probe.svg` (sha256
  `48ede281f28dd4e45c7b223909d7536295799b7f116d51c99ec255e9ec7fae73`)
- representative paired file: `out/cc0-coverage-probe.paired.json` (sha256
  `a0d19bbceb301d3e869843f5d5a2effcdac98ba472b1483d6ae7a2100daf900d`),
  `out/pd-la-campanella.paired.json` (sha256
  `263c945b02ab3d7142c93216bca265c6235d3c423da16bb1c7a0e57bbcc87800`)

Environment: Python 3.13.14, verovio 6.3.0, music21 10.5.0, macOS (darwin).

## What this does and does not establish

It establishes that **source->render correspondence for self-rendered symbolic
scores is exact, machine-checkable and complete for notes and all event classes
tested, with a fully specified semantic join for clef/key/time state, at
thousands of notes per score, CPU-only and deterministic**.

It does **not** establish real-world scan/photo accuracy, engraver-domain
realism, or that every MusicXML in a large corpus imports without renderer
errors. Those are pipeline-hardening and evaluation questions handled in the
research and reopen-decision documents.
