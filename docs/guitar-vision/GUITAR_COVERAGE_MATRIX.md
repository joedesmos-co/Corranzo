# Guitar Coverage Matrix (fixtures, round-trips, gate)

**Artifact:** `datasets/guitar-vision/fixtures/notation-v1/coverage-matrix.json`
**Generator:** `tools/guitar-vision/coverage-matrix.mjs` (re-run after any schema/fixture change)
**Tests:** `tests/guitarNotationFoundation.test.js` — 47/47 passing
**Corpus:** 38 deterministic fixtures (`tools/guitar-vision/build-notation-fixtures.mjs --out …`), byte-identical on rebuild

## Gate result (G16)

| gate | families |
|---|---|
| `VERIFIED_SUPPORTED` | 72 |
| `VERIFIED_UNSUPPORTED_WITH_EXPLICIT_PRODUCT_BEHAVIOR` | 38 |
| `BLOCKING_GAP` | 0 |
| `UNKNOWN` | 3 (`tremolo-picking`, `rasgueado`, `golpe`) |

No green status merely because a glyph appears visually: `VERIFIED_SUPPORTED`
requires a fixture to round-trip source → parser → canonical event →
serialized truth with exact semantic equality (event counts, quarantine
codes, timing preservation, spelling/pairing/beaming spot-checks).

## What each gate means for the product

- **VERIFIED_SUPPORTED** — truth can represent it and a fixture proves it.
  (Still ≠ model support: only 9 families have honest labels. Do not let a
  training plan cite this column as recognition coverage.)
- **VERIFIED_UNSUPPORTED_WITH_EXPLICIT_PRODUCT_BEHAVIOR** — the truth layer
  quarantines it by construction (see list below); the product must
  decline/refuse rather than invent, same policy as the gated fret path.
- **UNKNOWN** — no structured source encoding exists to verify against.
  These three must not silently proceed into training; any Dataset v2 score
  leaning on them needs a schema extension first.

## Quarantine paths proven by fixtures (unsupported → explicit behavior)

Grace/cue notes, nested tuplets, tremolo subdivisions, notehead variants,
dead/ghost/muted strings, bend amount/pre-bend/release, all harmonic kinds,
tapping, palm mute, let ring, pick direction, arpeggio, whammy, ornaments,
staccatissimo, breath marks, capo/position/barre text, LH/RH fingering,
octave shifts, chord-diagram frames, lyrics, rehearsal marks,
segno/coda/D.S./D.C. navigation, measure rests, text directions.

## Unknown-notation behavior (G10)

`unknown-notation-quarantine` plants `<squiggle/>` plus an impossible
`string 9`: the audit flags the element (`AMBIGUOUS`, never dropped), the
pairing check quarantines the position, playability reports
`string-out-of-range`, and the offending values survive verbatim in truth.
`classifySourceElement` returns `AMBIGUOUS` for any unregistered element and
`INVALID_SOURCE` for empty names.

## Fixture inventory (38)

Simple/dotted/tuplet/nested-tuplet rhythms; multi-voice + unison; TAB chord
(verified) + mismatch (quarantined); paired staff+TAB with `<backup>` mirror;
bend presence/partial + bend-params gap; hammer/pull chain; slide pair;
glissando gap; natural/artificial/pinch harmonics; palm-mute + tapping;
let-ring/pick/fingering/arpeggio/ornament/tremolo/octave-shift bundle;
dead/ghost x-noteheads; vibrato (wavy-line); whammy text; drop-D tuning;
capo/position/barre/rehearsal/lyrics text gaps; chord symbols vs frame gap;
repeats + endings; segno/coda gap; grace + cue gaps; pickup anacrusis;
TAB rests + multi-digit frets + string indications; measure-rest gap;
beams/stems/whole→64th durations; accidentals/enharmonics/ledger/key+time+clef
changes; dynamics/articulations/slur/hairpin/tempo; ties across measures
(with chain de-merge); rests.

## Known audit catches worth remembering

- The parser merges tie-stop durations into chain heads (playback sustain);
  truth de-merges or measure totals overstate — the test suite caught this.
- The parser synthesizes chord-sheet notes when pitched notes are
  outnumbered by harmony events; chord fixtures carry 4 real quarters.
- Paired-staff TAB duplicates need `<backup>` rewinds, as real exporters write.
- `bend-alter`/`pre-bend`/`release` live under `<bend>`, not `<technical>`;
  the audit scans both scopes so nothing flags twice.
- `<cue/>` notes parse as full-sounding notes (timing overstatement) —
  flagged `cue-misread`, a distinct code from grace handling.
