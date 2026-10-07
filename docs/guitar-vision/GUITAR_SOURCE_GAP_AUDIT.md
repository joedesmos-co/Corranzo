# Guitar Source-Gap Audit (G2) — all 38 unsupported families reclassified

**Basis:** `guitar-vocab/1.0` → parser/truth upgrade in this task.
**Method:** every family traced to its MusicXML representation (W3C MusicXML
4.0 reference), MEI/Verovio behavior where relevant, old parser behavior,
and the fix or the evidence for unfixability.
**Gap classes:** `PARSER_GAP` · `RELATIONSHIP_GAP` · `RENDER_MAPPING_GAP` ·
`SOURCE_FORMAT_LIMIT` · `GENUINELY_AMBIGUOUS`

"Unsupported" is never the explanation. Every row ends in a fix or in
evidence.

## PARSER_GAP — representable, parser dropped it, now fixed

| family | MusicXML representation | old behavior | fix |
|---|---|---|---|
| measure-rest | `measure-style/multiple-rest` count + `rest measure="yes"` | no multiple-rest handling | count parsed into measures; rest flagged |
| grace-note | `grace@slash` + typeless note | dropped from note list | zero-duration events with `includeNonSoundingNotes` (default still drops: historical behavior preserved) |
| cue-note | `cue` | parsed as full-sounding note (timing overstated) | `isCue` marked; never attacks, counts no time |
| acciaccatura-appoggiatura | `grace@slash=yes` vs absent | slash never read | `graceKind` acciaccatura/appoggiatura |
| tremolo / tremolo-picking | `notations/tremolo type="single"` + marks | never read | `tremolo-picking {marks, strokeType}` (this is the TAB tremolo-picking encoding) |
| notehead-variant | `notehead` + `@filled/@parentheses` | never read | preserved per event; x → `deadNote`, parentheses → `ghostNote` |
| muted-dead-x, dead-note, ghost-note | `notehead(x)`, parentheses | never read | mapped from notehead shape |
| fingering-tab, left-hand-fingering | `technical/fingering` + attrs | never read | values + substitution/alternate preserved |
| right-hand-fingering | `technical/pluck` | never read | p-i-m-a preserved |
| pick-direction | `technical/up-bow`, `down-bow` | never read | preserved as pick direction |
| bend-amount, pre-bend, bend-release | `bend/bend-alter`, `pre-bend`, `release` | presence-only bend | full `bend{alterSemitones, prebend, release, shape}` |
| slide, glissando | `slide`/`glissando` + type/number/line-type | slide presence-only; glissando unread | both parameterized; paired by number into relations |
| natural-harmonic, artificial-harmonic | `technical/harmonic` (+`artificial`, base/touching/sounding pitches) | never read | `harmonic{artificial, natural, basePitch, touchingPitch, soundingPitch}` |
| tapping | `technical/tap` (fret/hand) and `tapped` (tolerated exporter shorthand) | never read | `tapping{hand, fret}` |
| palm-mute, let-ring | `technical/palm-mute`, `let-ring` + type | never read | span types preserved |
| golpe | `technical/golpe` (structured since MusicXML 3.1) | assumed text-only — wrong | preserved as structured technique (prior reason corrected) |
| arpeggio | `notations/arpeggiate` + direction | never read | direction preserved |
| staccatissimo, breath-mark | articulations children | never read | booleans + generic `otherArticulations` catch-all |
| ornament-trill | trill-mark/mordent/turn/shake | never read | preserved by kind |
| vibrato | `ornaments/wavy-line`, `other-technical` vib text | heuristic presence | kept + source recorded; width unencoded (documented null) |
| capo | no element; `words "Capo N"` in all exporters | never read | text mining (`guitarTextMarks.js`) with confidence tag; drives pairing math |
| position-indication, barre | `words "III"`, `"BIII"`, `"1/2BII"` | never read | same text-mining module, source text retained |
| octave-shift | `direction-type/octave-shift` | never read | spans recorded as score marks |
| chord-diagram | `harmony/frame` (NIFF-based) | never read | strings/frets/first-fret/notes/barre preserved |
| lyrics | `lyric` per note | never read | number/syllabic/text per event |
| rehearsal-mark | `direction-type/rehearsal` | never read | score mark |
| segno, coda | `direction-type/segno`, `coda` | never read | positions as score marks |
| ds-dc-navigation | `sound` jump attrs + D.C./D.S./Fine/To-Coda words | nothing extracted | sound-jumps + word mining; unmatched words quarantine as `unresolved-text` |
| text-direction | `words` (other) | ignored | matched patterns resolve; rest quarantines explicitly |

## RELATIONSHIP_GAP — fixed via cross-note relations

Bend destinations (next pitched event in lane; pre-bends self-contained),
slide/glissando start↔stop pairing by number, hammer-on/pull-off legato
chains (unified family pairing), all in `buildTechniqueRelations()` with
dangling-start/stop quarantine. Relations carry `inferred` flags where the
exporter marked only one side.

## RENDER_MAPPING_GAP

- **pinch-harmonic**: no engraving distinct from artificial harmonic; arrives
  (if at all) as `other-technical` text (`P.H.`), which quarantines by name.
  Truth cannot type what the source does not distinguish.

## SOURCE_FORMAT_LIMIT

- **nested-tuplet**: `time-modification` is flat (one ratio per note);
  nesting is unrepresentable in MusicXML. Flat ratios round-trip exactly.
- **whammy-bar**: no stable encoding across exporters; free
  `other-technical` text only. Preserved verbatim, quarantined by name.
- **pinch-harmonic**: as above (shared with render-mapping gap).

## GENUINELY_AMBIGUOUS

- **rasgueado**: no structured MusicXML encoding found (4.x element
  reference, importer behavior, exporter behavior all negative — see G6).
  Arrives as staff text; text-mining it as a technique would be guessing.
  Retains AMBIGUOUS status with evidence.
- **capo-text confidence**: mining `"Capo N"` is interpretation of prose.
  The fret drives math, but the confidence tag (`text-mined`) travels with
  it so no consumer mistakes it for structure.

## G6 evidence (tremolo-picking / rasgueado / golpe)

- **tremolo-picking**: structured — `tremolo type="single"` + stroke count.
  Implemented with marks parameter. (MusicXML also defines measured
  tremolo; guitar TAB uses single-note subdivision for picking.)
- **golpe**: structured — `<golpe>` is a MusicXML 3.1+ `technical` element
  ("tapping the pick guard in guitar music", W3C reference). The prior
  "text only" reason was wrong and is corrected above. Implemented.
- **rasgueado**: unstructured — absent from the MusicXML 4.x reference and
  element index, zero importer recognition, exporters emit staff text.
  Stays AMBIGUOUS. If a future exporter convention emerges, `other-technical`
  text already quarantines by name, so the upgrade path is a mining pattern,
  not a schema change.

MEI note: MEI `tech`/`artic` can carry richer performance semantics, but the
Dataset route is MusicXML-first (Verovio renders it; the identity pilot joins
on it). No MEI-exclusive semantics are required for any V1 family above.
