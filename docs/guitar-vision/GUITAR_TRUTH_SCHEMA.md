# Guitar Truth Schema (canonical GuitarEvent)

**Version:** `guitar-event/1.0`
**Modules:** `src/features/omr/guitar/guitarCanonicalEvents.js` (G3/G4/G5),
`src/features/omr/guitar/guitarPlayability.js` (G6),
`src/features/musicxml/guitarTextMarks.js` (shared text mining)
**Parser:** `src/features/musicxml/parseMusicXml.js` — extended additively
(new fields, new `scoreMarks`/`frames`/`capo` outputs, opt-in
`includeNonSoundingNotes`); default behavior byte-identical for existing callers
**Tests:** `tests/guitarNotationFoundation.test.js` (52 passing) +
`tools/guitar-vision/tests/test_render_identity.py` (6 passing)
**Fixtures:** `datasets/guitar-vision/fixtures/notation-v1/` (40 deterministic scores + manifest)

## GuitarEvent

One playable event per notated note/rest, built deterministically from
symbolic source. Never guessed from pixels.

```
id                  sourceId:eN (stable within a source)
source              { score, partId, measure, noteId }
time                { onsetQuarters, durationQuarters, measureRelativeQuarters,
                      voice, staff, tuplet ("3:2"), dots, noteType,
                      beams (["1:begin",…]), stemDirection,
                      isGrace, graceSlash, graceKind (acciaccatura/appoggiatura),
                      isCue, isChordTone, isRest, isMeasureRest,
                      isTieContinuation, tieChainId, tie {start, stop} }
pitch               { soundingMidi, step, alter, octave, accidental } | null (rests)
notehead            { value, filled, parentheses } | null
deadNote / ghostNote  booleans derived from notehead shape
tab                 { string, fret, pairing, positionKind }
techniques[]        { kind, <params>, support }
articulations       { staccato, accent, tenuto, marcato, fermata,
                      staccatissimo, breathMark, other[], slurs[] }
fingering           { left[], right (p-i-m-a), pick, openString }
lyric               { number, syllabic, text } | null
dynamics            { velocity }
support             G0 support state
```

Plus top-level `relations[]` (technique links), `navigation[]` (score
marks), `frames[]` (chord diagrams), `capo` (mined, confidence-tagged).

Techniques carry parameters: `bend{semitones, alterRaw, prebend, release,
shape}`, `slide/glissando{direction, lineType, number}`,
`harmonic{artificial, natural, basePitch, touchingPitch, soundingPitch}`,
`tapping{hand, fret}`, `palm-mute/let-ring{spanType}`,
`tremolo-picking{marks, strokeType}`, `arpeggio{direction}`. Nulls where the
source cannot know (vibrato width, slide style) — never invented.

## G4 — standard↔TAB pairing + technique relations

Pairing verifies `sounding = tuning[string-1] + fret + capoFret` under the
part's declared tuning with automatically mined capo. Relations resolve to
event identities: `slide-link` / `legato-link` (paired by number, unified
legato family for hammer/pull alternation, `inferred` flag for one-sided
exporter marks), `bend-destination` (next pitched event in lane;
self-contained pre-bends need none), with dangling-start/stop quarantine.

## G5 — rhythm truth + playable events

Per-(measure, voice, staff) reconstruction; tie chains de-merged into
per-measure segments sharing `tieChainId`; chord tones share onsets; grace
(zero-duration) and cue (marked, non-attacking) count no time. G5 proof
tests cover standard-only / TAB-only / paired × alternate tuning, capo,
chords, multi-voice, ties, grace, and technique chains.

## G6 — playability validation (quarantine, never repair)

Unchanged policy; extended to chain-aware tie checks (grouped by chain id)
and bend-destination presence. Severity `error` fails the gate.

## G7 — render/truth correspondence: LOOP CLOSED

Pilot (`tools/guitar-vision/render_identity.py` +
`test_render_identity.py`, Verovio 6.3.0):

- Verovio propagates `<note id="…">` into `<g id="…" class="note">` — stable
  source IDs survive rendering (MusicXML 3.1+ sanctions element ids).
- `inject_stable_ids()` is a pure function of the input: separate processes
  stamp byte-identical IDs (asserted via subprocess test).
- Exact joins by ID string equality: standard-only 3/3, paired 2/2
  (notehead vs TAB-text distinguished per group), TAB chord 5/5 —
  identity rate 1.0, zero duplicates, zero unmatched on either side, page +
  transform-composed bboxes per join.
- No document-order fallback: tampered IDs join 0.0 (test-pinned).
- All 40 fixtures load in Verovio (smoke test).

Remaining note: only `note` (and Verovio-generated) IDs are asserted;
technique-marking SVG identity (bend curves, harmonic diamonds) is future
render-target work, not truth-schema work.
