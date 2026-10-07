# Guitar Notation Vocabulary (canonical, versioned)

**Version:** `guitar-vocab/1.0`
**Module:** `src/features/omr/guitar/guitarVocabulary.js` (single source of truth; this doc summarizes it)
**Status:** foundation — no model training yet
**Fret baseline:** frozen (`guitar-vision-dedicated-roi-v1`, score-disjoint 0.9266, 366/395). Not retrained in this task.

## G0 — core principle (enforced in code)

Never silently discard notation. Every source element resolves to one of:

- `SUPPORTED_AND_LABELED`
- `SUPPORTED_BUT_NOT_YET_MODELED`
- `EXPLICITLY_UNSUPPORTED:<reason>`
- `AMBIGUOUS:<reason>`
- `INVALID_SOURCE:<reason>`

`classifySourceElement()` returns `AMBIGUOUS` for anything outside the
registry — never a silent "none". The raw-XML gap audit
(`auditRawXmlGaps()` in `guitarCanonicalEvents.js`) applies the same rule to
elements the symbolic parser drops: they become quarantine entries, not gaps
in the truth.

## Family counts (113 families, 9 categories)

| category | families |
|---|---|
| structure (score/part/system/measure/staff/barline/voices/repeats…) | 15 |
| rhythm (durations, dots, rests, beams, tuplets, ties, grace, tremolo…) | 22 |
| pitch / standard notation | 12 |
| TAB core | 11 |
| guitar techniques | 23 |
| articulation / expression | 11 |
| performance information (tuning, capo, positions, fingering) | 8 |
| harmony / text | 6 |
| navigation | 5 |

## What the numbers mean

- **72 `VERIFIED_SUPPORTED`** — truth-verifiable today with a passing fixture
  round-trip (source → parser → canonical event → serialized truth).
  "Supported" means *truth* support, not model support: only 9 families have
  honest train/validation/held-out labels (see acquisition plan), so a model
  built today still cannot claim techniques, capo, navigation, etc.
- **38 `VERIFIED_UNSUPPORTED_WITH_EXPLICIT_PRODUCT_BEHAVIOR`** — quarantined
  by construction. Product behavior is defined: decline/refuse rather than
  invent (same policy as the gated fret path).
- **0 `BLOCKING_GAP`** — every parser-silent drop found during this audit now
  has a quarantine path (the last one, `string-indication`, was resolved by
  the canonical `positionKind` field).
- **3 `UNKNOWN`** — `tremolo-picking`, `rasgueado`, `golpe`. These have no
  structured source encoding to verify against (free text or no encoding at
  all). Per G16 they must not silently proceed into training; any Dataset v2
  score leaning on them needs a schema extension first.

## Source representation audit (G2) — MusicXML/MXL findings

Verified by reading `src/features/musicxml/parseMusicXml.js`, not by assumption:

**Extracted faithfully:** pitch (sounding per `guitar-pitch/1.0`), accidentals
(printed vs sounding kept separately), key/time/clef + mid-part changes,
dots (counted, so double-dots work), tuplets (flat ratio), ties/slurs,
voices via backup/forward, beams, stem direction, string/fret, hammer-on,
pull-off, bend *presence*, slide *presence*, vibrato (heuristic only:
`other-technical` text match or `ornaments/wavy-line`), dynamics → velocity,
wedges → velocity reshaping, harmony symbols, tempo, repeats + endings,
TAB-mirror reconciliation (TAB duplicates tagged, positions copied).

**Presence without parameters (truth keeps nulls, never invents):**
bend amount (`<bend-alter>` unread), pre-bend/release flags, slide
style/direction taxonomy, vibrato width, grace timing (notes dropped entirely).

**Silently dropped before this task — now quarantined by `auditRawXmlGaps`:**
grace notes, cue notes (worse: parse as full-sounding notes), `<frame>`
(chord diagrams), `<segno>`/`<coda>`, `<rehearsal>`, `<lyric>`,
`<octave-shift>`, `<arpeggiate>`, `<tremolo>`, `<measure-style>`,
`<glissando>`, `<breath-mark>`, trill/mordent/turn, `<notehead>` variants,
unmodelled `<technical>` children (harmonic, palm-mute, let-ring, tapped,
fingering, pluck, up/down-bow), non-vibrato `<other-technical>` text,
free-text `<words>` directions (capo, positions, D.S./D.C.).

**Genuinely unrepresentable:** nested tuplets (flat `time-modification`
only), enharmonic intent beyond step+alter (preserved, but intent is not
modelled), whammy/pinch-harmonic semantics (no stable encoding).

## Standard↔TAB duplication semantics

A mixed notation+TAB part engraves every note twice (once per staff, joined
by `<backup>` rewinds in real exporter output). The parser tags TAB copies as
mirrors and copies their string/fret onto the standard note. The canonical
layer then verifies `sounding = tuning[string-1] + fret + capoFret` against
`<pitch>` (G4) and links the mirror as a pairing — proven by the
`paired-staff-tab` and `alternate-tuning-drop-d` fixtures.
