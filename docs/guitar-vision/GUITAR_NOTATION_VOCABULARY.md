# Guitar Notation Vocabulary (canonical, versioned)

**Version:** `guitar-vocab/1.0`
**Module:** `src/features/omr/guitar/guitarVocabulary.js` (single source of truth; this doc summarizes it)
**Status:** source-truth completion — parser gaps closed, no model training yet
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
(`auditRawXmlGaps()` in `guitarCanonicalEvents.js`) mirrors the parser's
knowledge: it flags only genuinely unrepresented content (exotic technical
children, unmined free text, multi-measure-rest counts, grace notes when
parsed without the non-sounding flag).

## Family counts (115 families, 9 categories)

113 canonical families + `golpe` (was missing), `tremolo-picking`,
`fine`, `to-coda` (navigation split out of the `ds-dc-navigation` bundle).

## Gate result (G9 categories)

| gate | families |
|---|---|
| `VERIFIED_SUPPORTED` | 111 |
| `VERIFIED_UNSUPPORTED_WITH_SOURCE_LIMITATION` | 3 (`nested-tuplet`, `pinch-harmonic`, `whammy-bar`) |
| `AMBIGUOUS` | 1 (`rasgueado` — no structured encoding anywhere; evidence in G6) |
| `BLOCKING_GAP` | 0 |

"Supported" means *truth* support, not model support: only 9 families have
honest train/validation/held-out labels (see acquisition plan), so a model
built today still cannot claim techniques, capo, navigation, etc. The G2
audit (`GUITAR_SOURCE_GAP_AUDIT.md`) records per-family representation,
old behavior, and gap class for all 38 formerly-unsupported families plus
the 3 former unknowns.

## Source representation audit (G2) — MusicXML/MXL findings

Verified by reading `src/features/musicxml/parseMusicXml.js` and extended
in this task (all additive; existing callers see byte-identical behavior):

**Now extracted with parameters:** bend amount/pre-bend/release, slide +
glissando (type/number/line-type), hammer-on/pull-off (numbered for chains),
harmonics (artificial flag + base/touching/sounding pitches), tapping
(`tap` fret/hand + tolerated `tapped`), palm-mute/let-ring spans, golpe
(structured since MusicXML 3.1 — the old "text only" reason was wrong),
tremolo-picking (stroke marks), arpeggio direction, trill/mordent/turn/shake,
staccatissimo, breath-mark, notehead shape (x → dead, parentheses → ghost),
fingering/pluck/pick direction, lyrics, rehearsal marks, octave-shift spans,
chord-diagram frames (strings/frets/first-fret/notes/barre), segno/coda
positions, `sound` jump attributes, D.C./D.S./Fine/To-Coda word mining,
capo/position/barre word mining (confidence-tagged), measure-rest counts,
grace notes (zero-duration, flag-gated) and cue notes (marked, never attack).

**Presence without parameters (truth keeps nulls, never invents):**
vibrato width, slide shift-vs-legato style (unencoded in MusicXML).

**Genuinely limited:** nested tuplets (flat `time-modification`),
pinch-vs-artificial distinction, whammy semantics (free text),
rasgueado (no encoding; AMBIGUOUS with 3-leg evidence).

## Standard↔TAB duplication semantics

A mixed notation+TAB part engraves every note twice (once per staff, joined
by `<backup>` rewinds in real exporter output). The parser tags TAB copies as
mirrors and copies their string/fret onto the standard note. The canonical
layer then verifies `sounding = tuning[string-1] + fret + capoFret` against
`<pitch>` (G4) — capo now flows automatically from text-mined score marks —
and links the mirror as a pairing. Proven by `paired-staff-tab`,
`alternate-tuning-drop-d` (drop-D + Capo 2) and `tab-chord-verified`.
