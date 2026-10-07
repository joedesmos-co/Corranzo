# Guitar Truth Schema (canonical GuitarEvent)

**Version:** `guitar-event/1.0`
**Modules:** `src/features/omr/guitar/guitarCanonicalEvents.js` (G3/G4/G5),
`src/features/omr/guitar/guitarPlayability.js` (G6)
**Tests:** `tests/guitarNotationFoundation.test.js` (47 assertions, all passing)
**Fixtures:** `datasets/guitar-vision/fixtures/notation-v1/` (38 deterministic scores + manifest)

## GuitarEvent

One playable event per notated note/rest, built deterministically from
symbolic source. Never guessed from pixels.

```
id                  sourceId:eN (stable within a source)
source              { score, partId, measure, noteId }
time                { onsetQuarters, durationQuarters, measureRelativeQuarters,
                      voice, staff, tuplet ("3:2"), dots, noteType,
                      beams (["1:begin",…]), stemDirection,
                      isGrace, isChordTone, isRest,
                      isTieContinuation, tieChainId, tie {start, stop} }
pitch               { soundingMidi, step, alter, octave, accidental } | null (rests)
tab                 { string, fret, pairing, positionKind }
techniques[]        { kind, <params>, support }
articulations       { staccato, accent, tenuto, marcato, fermata, slurs[] }
dynamics            { velocity }
support             G0 support state
```

Techniques carry parameters where required — `bend: { semitones, prebend,
release }`, `slide: { direction, style }` — and `null` where the source
layer cannot know (bend amount today). Null is honest; inventing 2 semitones
would be fake truth and would poison a future bend-amount head.

`tab.positionKind` distinguishes `tab-fret` (string+fret) from
`string-indication` (circled string number on the notation staff, string
without fret, resolved by staff role) and `unresolved` (staff unknown).
This closed the last BLOCKING_GAP without touching the shared parser.

## G4 — standard↔TAB pairing

For every event with string+fret+pitch, the layer checks
`soundingFromTab(string, fret, { tuning, capoFret }) === soundingMidi`
under the part's declared tuning (standard or `staff-details`-declared, e.g.
drop-D) plus capo offset. Matches become `pairing: 'verified'`; mismatches
become `pairing: 'quarantined'` with the semitone delta and the list of
playable positions for the notated pitch (so a reviewer can see the fix, but
the layer never applies it). TAB-mirror duplicates link as `pairings[]`
with their own verified flag. Proven by `tab-chord-verified`,
`pairing-mismatch-quarantine`, `alternate-tuning-drop-d`, `paired-staff-tab`.

## G5 — rhythm truth

Every event preserves onset, duration (quarters, divisions-independent),
measure-relative position, voice, tuplet ratio, dots, tie chain, beams, grace
and chord simultaneity. Round-trip rule: per (measure, voice, staff), sounded
quarters must reconstruct the measure length. Two deliberate semantics:

- **Tie chains are de-merged.** The parser merges tie-stop durations into the
  chain head for playback sustain; notation truth restores each segment to its
  notated length in its own measure (members share `tieChainId`, continuations
  carry `isTieContinuation`). Without this, a tied note overstates its
  measure and the round-trip fails — which is exactly what the first test run
  caught (`ties-across-measures`).
- **Chord tones share their head's onset** and are excluded from duration
  totals; grace notes contribute no time; pickups (`implicit="yes"`) and
  under-full TAB voices are not corruption.

## G6 — playability validation (quarantine, never repair)

`validatePlayability()` reports: string/fret range, impossible positions,
unverified pairings (with playable alternatives), simultaneous same-string
conflicts, tie chains that change pitch (grouped by chain id), dangling or
pitch-less hammer/pulls, bends without parameters (info), voice overflows.
Severity `error` fails the gate; `info` does not. Invalid source data is
reported with event ids — never silently repaired into plausible truth.

## G7 — render/truth correspondence

Borrowed from Piano Vision: truth declared by construction. Findings:

- **Today the render path does NOT retain source IDs.** The Verovio SVG
  pipeline (`tools/guitar-vision/render_corpus.py::extract_note_objects`)
  derives correspondence from SVG structure (`class="note"` groups) in
  document order — 1:1 with MusicXML note order by assumption, not by
  identity. Reordered or dropped elements break it silently.
- **The plumbing for identity exists but is unverified end-to-end.**
  `buildOmrMusicXml.js` emits `id="sfnh-…"` on notes and the parser reads
  those ids back; Verovio propagates `xml:id` into SVG group ids. What is
  missing is the deterministic link: emit stable per-note ids from the
  fixture/synthetic generator → confirm they survive Verovio rendering →
  parse them back into `sourceNoteheadId`. Until that loop is closed and
  tested, any render-derived box must be treated as *unverified* correspondence.
- **This foundation does not depend on that loop.** Fixture truth uses
  canonical source ids (`fixture:eN`) assigned at parse time, so schema,
  pairing, rhythm and quarantine verification are valid regardless of render
  identity. The Verovio id loop is a prerequisite for Dataset v2 *render*
  generation (G13), not for the schema.
