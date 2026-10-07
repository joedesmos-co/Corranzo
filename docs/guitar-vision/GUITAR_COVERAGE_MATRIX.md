# Guitar Coverage Matrix (fixtures, round-trips, gate)

**Artifact:** `datasets/guitar-vision/fixtures/notation-v1/coverage-matrix.json`
**Generator:** `tools/guitar-vision/coverage-matrix.mjs` (re-run after any schema/fixture change)
**Tests:** `tests/guitarNotationFoundation.test.js` — 52/52 passing;
`tools/guitar-vision/tests/test_render_identity.py` — 6/6 passing
**Corpus:** 40 deterministic fixtures (`tools/guitar-vision/build-notation-fixtures.mjs --out …`), byte-identical on rebuild, all Verovio-loadable

## Gate result (G9 categories)

| gate | families |
|---|---|
| `VERIFIED_SUPPORTED` | 111 |
| `VERIFIED_UNSUPPORTED_WITH_SOURCE_LIMITATION` | 3 (`nested-tuplet`, `pinch-harmonic`, `whammy-bar`) |
| `AMBIGUOUS` | 1 (`rasgueado`) |
| `BLOCKING_GAP` | 0 |

Rule change from the previous pass: a common V1 family is NOT acceptable
merely because Corranzo can decline it. Anything the source structurally
supports but Corranzo truth does not handle is `BLOCKING_GAP` — and there
are none left, because the parser gaps were fixed rather than quarantined.

`VERIFIED_SUPPORTED` requires a fixture round-trip
source → parser → canonical event → serialized truth with exact semantic
equality (event counts, quarantine codes, timing preservation,
spelling/pairing/beaming/parameter spot-checks, relation/navigation/frame
presence). Never visual appearance.

## What moved since the schema-audit pass

34 of 38 formerly-unsupported families are now `VERIFIED_SUPPORTED` via
parser extensions + fixtures (bend params, slides, glissando, harmonics,
tapping, palm-mute, let-ring, golpe, tremolo-picking, arpeggio, ornaments,
dead/ghost noteheads, fingering/pluck/pick, capo/position/barre mining,
frames, lyrics, rehearsal, octave-shift, segno/coda/DC/DS/Fine/To-Coda,
grace/cue, measure rests). The 4 that stay out have format-level evidence
in `GUITAR_SOURCE_GAP_AUDIT.md` (G6 included).

## Fixture inventory (40)

Previous 38 plus `multivoice-tab` (two TAB voices, verified pairing) and
`golpe-mark` (structured golpe); expanded in place: 4-event slide chain
with two links, drop-D + Capo-2 pairing, full navigation (segno/coda/
D.S.-al-Coda/Fine/sound-jump/To-Coda), parameterized bend + destination,
artificial harmonic pitch triple, staccatissimo/breath/trill/tremolo/fingering
bundle, dead + parenthesised noteheads, acciaccatura grace event, marked cue.

## Lessons pinned by fixtures

- The parser merges tie-stop durations into chain heads (playback sustain);
  truth de-merges or measure totals overstate.
- The parser synthesizes chord-sheet notes when pitched notes are
  outnumbered by harmony events; chord fixtures carry 4 real quarters.
- Paired-staff TAB duplicates need `<backup>` rewinds, as real exporters write.
- `<cue/>` notes parse as full-sounding notes without an explicit mark.
- `<tapped/>` is tolerated exporter shorthand; schema element is
  `<tap hand="left|right">` — both supported, documented.
