# Instrument Platform Plan — Piano + Guitar

Goal: Corranzo becomes an instrument practice platform. Piano behavior is frozen (no regressions); Guitar gets a clean foundation. Every generalization must leave piano output byte-identical where tests/benchmarks observe it.

## Audit — where the app assumes Piano

| Subsystem | File(s) | Assumption |
|---|---|---|
| Playback voice | `playback/pianoInstrument.js`, `pianoInstrumentStatus.js`, `pianoVoiceMix.js`, `pianoVelocity.js`, `pianoSampleWarmup.js` | The only voice is a sampled grand piano + synth fallback. The *interface* (`triggerAttackRelease`/`releaseAll`/`output`/`status`) is already generic. |
| Score engine | `playback/scorePlaybackEngine.js` | Hardcodes `import('./pianoInstrument.js')`, piano preload, piano voice rebuild. Transport/scheduling/loop logic is instrument-neutral. |
| MIDI engine | `playback/midiPlaybackEngine.js` | Same hardcoded piano voice pattern. |
| Reference player | `practice/referenceNotePlayer.js` | Hardcodes piano for Wait For You reference pitches. |
| App shell | `App.jsx` | `warmupPianoSamplesOnIdle()`; no notion of a selected instrument. |
| Notation model | `musicxml/parseMusicXml.js` | No clef parsing (can't see TAB), no `<technical>` string/fret, notes carry pitch only. |
| OMR emission | `omr/buildOmrMusicXml.js` | `<part-name>Piano</part-name>`, hardcoded G clef, voice = clef(treble/bass). |
| OMR pipeline | `omr/runPdfOmrPipeline.js`, `processOmrPage.js`, `omrConstants.js` | `stavesPerSystem` defaults to piano grand staff (2); no 6-line TAB staff classification; no fret-digit reading; piano-flavored error copy. |
| Wait For You | `practice/waitForYouCheckpoints.js` | Engine + matching are already pitch-generic (`expectedMidis`). Checkpoints don't carry tab positions; labels are pitch-only. Imports `alignChordScoreTime` from a piano-named module. |
| Visual Practice | `VisualPracticeView.jsx`, `staffLaneLayout.js`, `visualPracticeLane.js` | Lane = treble/bass staff + piano keyboard strip. Groups/target/window/scroll are instrument-neutral. |
| Stats/Progress | `profile/profileStatsSchema.js`, `autoPracticeTracker.js`, `manualPracticeLog.js` | Session records have no instrument field. |
| Session persistence | `session/sessionPersistence.js`, `practicePrefsStorage.js` | Saved session meta has no instrument. |

Already instrument-neutral (no changes needed): timeline API, practice clock, loop engine, score-follow cursor/anchors, checkpoint matching engine, metronome, MIDI input, mic pitch detection (pitch → MIDI works for guitar).

## Architecture

One new core module owns the concept of an instrument:

```
src/features/instruments/
  instruments.js        # registry: piano, guitar — ids, labels, clefs, staves hints,
                        # tuning, polyphony, visual kind, voice module loader key
  instrumentStorage.js  # persisted selection (localStorage), default 'piano'
  fretboard.js          # string/fret ↔ MIDI math, position derivation heuristic
InstrumentContext.jsx   # React context: selected instrument, setter (src/context/)
```

Rules:
- Consumers never switch on `instrumentId` inline; they read capabilities/config off the instrument definition (no giant switches).
- Piano definition reproduces today's behavior exactly; `'piano'` is the universal default so every legacy path is unchanged.
- Voice creation goes through a registry (`playback/instrumentVoices.js`) that maps id → dynamic import, so samples stay lazy per instrument.

## Phases (ranked by architectural importance)

1. **Instrument core** (everything hangs off it): registry + persistence + context + fretboard math + selector UI.
2. **Playback generalization**: extract the generic sampled+fallback voice from `pianoInstrument.js` into `sampledInstrumentVoice.js`; `pianoInstrument.js` becomes a thin config wrapper with an unchanged public API; add `guitarInstrument.js` (nylon/steel samples + plucked synth fallback); engines and reference player resolve voices via the registry. Transport, scheduling, looping, metronome untouched.
3. **Notation model**: parse clefs (incl. TAB), `<technical>` string/fret, staff-tuning; notes gain optional `string`/`fret`/`staffClef`; timing map gains `notation` summary (hasTab/hasNotation/suggested instrument). Derivation fills missing guitar positions from pitch (lowest-fret + position-continuity heuristic).
4. **Wait For You + Visual Practice**: checkpoints carry positions; instrument-aware labels via a describe layer (engine untouched). New `FretboardVisualLane` + fretboard strip; `VisualPracticeView` picks the lane by the instrument's `visualKind`. Clock/scroll/checkpoint/timing engines reused as-is.
5. **Stats / sessions / persistence**: `instrumentId` on session records, piece aggregates, saved session meta, practice prefs; legacy records normalize to `'piano'`. No parallel stats implementations.
6. **OMR tablature** (largest, most isolated — last): staff-kind classification (5-line vs 6-line + TAB clef glyph), fret-digit extraction on TAB staves, mixed-system pairing (notation staff drives rhythm+pitch, TAB supplies positions), TAB-only positional rhythm fallback; `buildOmrMusicXml` gains an instrument option (default emits today's piano XML byte-identically). Guitar fixtures/benchmarks kept fully separate from the piano corpus.

## Tech debt cleaned up along the way

- `alignChordScoreTime` (generic chord-onset alignment) lives in `pianoVoiceMix.js` but is consumed by checkpoints + engine → move to `playback/chordTiming.js`, re-export from the old spot.
- `INSTRUMENT_STATUS` in `pianoInstrumentStatus.js` is already instrument-neutral → becomes `instrumentVoiceStatus.js` with a compat re-export.
- Engine's velocity soften + voice-mix polyphony become per-voice config (piano keeps current constants; guitar gets 6-voice polyphony).
- `warmupPianoSamplesOnIdle` → instrument-aware warmup keyed off the persisted selection.
- OMR failure copy de-pianofied ("digital piano PDF" → instrument-neutral).

## Out of scope (architecture leaves room, no implementation)

Bends/slides/hammer-ons/pull-offs/harmonics live as future `technique` fields on notes; alternate tunings/capo = future `tuning` override on the instrument definition; polyphonic guitar mic detection = future input adapter. None of these require another rewrite later.

## Non-negotiables

- All existing tests pass; `npm run build` clean; piano OMR benchmarks untouched and green.
- No changes to Score Follow behavior, playback timing, WFY matching behavior, Visual Practice timing, benchmark thresholds.
- Guitar benchmarks (if added) live separately from piano benchmarks.
