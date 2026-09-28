# Guitar Vision — Notation Data Acquisition Plan

**Status:** quantified. `guitar-acquisition/1.0`
**Artifacts:** `datasets/guitar-vision/coverage.json`, `datasets/guitar-vision/acquisition-plan.json`
**Regenerate:**
```sh
node tools/guitar-vision/notation-coverage.mjs --json datasets/guitar-vision/coverage.json
node tools/guitar-vision/acquisition-plan.mjs  --json datasets/guitar-vision/acquisition-plan.json
```

---

## The correction that changed every number

Phase 0 reported "42 of 78 families have zero labels". That figure was **wrong**,
because the coverage tool globbed recursively and counted the repository's ~670
committed `tmp/` MusicXML files — which are **OMR engine output**, not labels.

With provenance enforced, the inventory is:

```
scores scanned:          665
excluded, OMR-generated: 619   (engine output, never a label)
excluded, no truth:       27
guitar scores:            19
scores with a real TAB:    1
```

| | Phase 0 (wrong) | Corrected |
|---|---|---|
| families with zero labels | 42 | **59** |
| articulation labels (staccato/accent/marcato/fermata) | 20 545 | **0** |
| dynamics | 105 | **0** |
| hairpins | 1 215 | **0** |
| slurs | 1 566 | **0** |
| fret numbers | 6 077 | **324** |

Every articulation, dynamic, hairpin and slur "label" in the repository is the
engine's own output. The model was being credited with data it produced itself.

---

## Current state

```
families tracked:             78
no labels at all:             59
under-represented:            10
adequate for its tier:         9
parser cannot extract:         40
need real-page capture:       13
claimable as supported:        9
real instances still needed: 1731
```

### The only 9 families that may be claimed as supported

`note`, `rest`, `chord`, `fret-number`, `string-number`, `augmentation-dot`,
`tuplet`, `accidental`, `tie`

Everything else is a known gap. **No guitar technique family is claimable** —
`bend`, `bend-amount`, `vibrato`, `hammer-on`, `pull-off`, `slide`,
`natural-harmonic`, `artificial-harmonic`, `pinch-harmonic`, `tapping`,
`palm-mute`, `let-ring`, `tremolo-picking`, `whammy-bar` and `capo` all have zero
labels and the parser cannot extract most of them. A model built today could not
honestly claim to read a single guitar technique.

---

## Requirements per family

Tiers are set by **real-world frequency**, not importance, because chasing a
family that never appears in published guitar music would distort the corpus
without helping a user. `trainCollections` is a collection-level floor because
three Aguado studies sharing an engraver are not three independent observations.

| tier | train | validation | heldout | train collections |
|---|---|---|---|---|
| essential | 60 | 12 | 12 | 4 |
| important | 30 | 6 | 6 | 3 |
| occasional | 15 | 3 | 3 | 2 |
| rare | 8 | 2 | 2 | 1 |
| unobtainable-real | 0 | 0 | 0 | 0 |

**A family is claimable only when it has honest real labels in training,
validation *and* held-out.** That is enforced in code, not by convention.

---

## Real data versus synthesis

Synthetic data may supplement training. It may never stand in for real
validation or held-out evaluation, because the generator is part of the training
pipeline: a model that memorises generator quirks scores perfectly and
generalises not at all.

`tools/guitar-vision/generate-synthetic.mjs` therefore **refuses** to write into
any split other than `train`, and the refusal is tested:

```
$ node tools/guitar-vision/generate-synthetic.mjs --split validation --count 1
REFUSED: synthetic data may only be generated into train, not "validation".
```

**13 families additionally require real page capture**, because a renderer cannot
honestly reproduce how an engraver draws them: `dynamic`, `ritardando`,
`accelerando`, `performance-text`, `vibrato`, `pinch-harmonic`, `palm-mute`,
`let-ring`, `tremolo-picking`, `whammy-bar`, `pick-direction`, `ghost-note`,
`capo`.

### The generated corpus (train only)

60 deterministic scores, seed `20260928`, reproducible byte-for-byte:

```
2 324 notes | 60 TAB staves | 1 162 string/fret positions | 0 impossible positions
techniques: 115 bends, 58 pull-offs, 57 hammer-ons, 34 slides
```

Pitches come from real fretboard positions rather than a pitch sampler, so every
string/fret/pitch triple is physically playable, and the TAB staff is *backed by*
the notation staff rather than guessed — both are rendered from one event model,
so they cannot disagree.

Building it surfaced three real bugs in the generator, all now tested: nested
`<notations>` elements that made every technique silently vanish, `<slide>` and
`<glissando>` placed inside `<technical>` instead of directly in `<notations>`,
and `<time-modification>` placed inside `<notations>` instead of on the note.
Misplacement is silent — the parser looks in the schema-correct place, so a
misplaced marking disappears rather than erroring.

---

## Acquisition routes

| route | realistic | notes |
|---|---|---|
| Mutopia Project / public-domain guitar editions | yes | already the richest source in the repository |
| IMSLP / MuseScore public-domain guitar collections | yes | large volume, many with paired staff+TAB |
| Deterministic synthesis (train only) | yes | supplies volume and exact geometry |
| Page capture from published scores | yes | required by 13 families |
| **Hand-transcribed real TAB scores** | **no** | see below |

**The hard blocker: TAB does not exist in the public-domain classical
repertoire.** `tab-staff`, `fret-number`, `paired-staff-tab` and
`string-assignment` are all *essential* tier, and the acquisition plan marks
their real-data route `realistic: false` — obtaining them means transcribing real
TAB by hand and rendering it, or licensing existing TAB editions. There is no
shortcut, and the current corpus has **one** TAB score.

The 5 real guitar TAB PDFs in `corranzo-holdout-intake` (canon-in-d, gravity-falls,
home-undertale, pirates, save-me-bts) are the most representative real-world
guitar TAB in the repository and have **no ground truth at all**. Transcribing
even two of them to MusicXML would do more for Guitar Vision than any amount of
synthetic generation.

---

## Second blocker: 40 families the parser cannot read

Even with labels, 40 of 78 families cannot be scored because
`parseMusicXml` does not extract them — `glissando`, `tapping`, all harmonic
variants, `palm-mute`, `let-ring`, `tremolo-picking`, `cue`/`ghost`/`dead` notes,
first/second endings, `segno`, `coda`, DC/DS, key/time/clef changes, `barre`,
`chord-diagram`, `pick-direction`, `sforzando`, and every `*-amount` variant.

These are reported as `unscoreableFamilies` in every strict evaluation report, so
a missing capability is never mistaken for a recognition failure. Closing them is
a data-engine task (Phase 3), and the synthetic generator already writes them in
schema-correct positions so they become readable the moment the parser is
extended.

---

## What this means for shipping

Corranzo can ship guitar recognition that reads notes, rests, chords, dots,
tuplets, accidentals, ties, fret numbers and string numbers, and should say so
plainly.

It cannot yet claim bends, hammer-ons, pull-offs, slides, harmonics, palm mute,
let ring, tapping, vibrato, tremolo, whammy, capo, chord diagrams, or any
structural navigation. Those need data first.

Given the strict evaluation contract, the honest position is that Guitar Vision
needs **1 731 more real labelled instances** and at least one hand-transcribed
real TAB score before a claim of comprehensive guitar notation support is
merely aspirational rather than false. Delaying the release is the right call.
