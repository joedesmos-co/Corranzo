# Audio Rendering / Piano Realism Sprint 1 — REPORT

**Date:** 2026-07-26  
**Scope:** Sound generation only. Playback Semantics Sprint 1 remains frozen.

## Separation (unchanged)

```
Recognized score → playback semantics → performed event timeline → instrument audio renderer
```

The renderer consumes performed events. It does not rewrite ties, dynamics,
articulations, tempo, frets, or written MusicXML.

## Previous engine — why it sounded synthetic

| Item | Detail |
| --- | --- |
| Intended path | Tone.js `Sampler` + Salamander Grand Piano MP3s |
| Actual path often | `PolySynth(AMSynth)` synth fallback |
| Why | Samples loaded only from the public CDN (`tonejs.github.io`). Cold start / slow network often missed the ~5s play-ready window → honest synth fallback → electronic beep timbre |
| Velocity | Single sample layer; dynamics = gain curve only (unchanged structurally) |
| Soft floor | Voice-mix floor ~0.32 crushed pp↔p contrast |
| Polyphony | Steal cap 48 — aggressive for dense chords |

## Fixes shipped

1. **Local Salamander mirror** — `public/audio/salamander/` (30 MP3s, ~2MB). Prefer `/audio/salamander/`; CDN is fallback only.
2. **Longer ready window** — `PLAY_READY_TIMEOUT_MS = 12000`; sample load timeout default 15s.
3. **Fallback reason logging** — `PIANO SAMPLE FALLBACK:` includes the real error.
4. **DEV diagnostics** — `PIANO AUDIO ENGINE:` and `PIANO TRIGGER:` (opt-in in tests/Node; on in browser DEV).
5. **Velocity / mix** — softer gain curve (floor 0.12, cap 0.92); ducking starts above 8 voices; steal cap **72**.
6. **Envelope** — attack 8ms, release 1.85s; milder master FX / trim.
7. **Engine meta** — triggers pass `midi` + `tieChainId` for diagnostics only.

## Sample set & coverage

| | |
| --- | --- |
| Set | `salamander-lite` (A / C / D# / F# grid) |
| Files | 30 MP3s under `public/audio/salamander/` |
| Keyboard | MIDI 21–108 (A0–C8): **88/88** covered |
| Max transpose | ≤ 1.5 semitones to nearest sample |
| Velocity layers | **1** (gain curve between dynamics; no multi-layer samples yet) |

## Benchmark summary (`tmp/piano-realism-sprint-1/audio-benchmark.json`)

Independent of the semantic evaluator. 14 listening fixtures.

| Metric | Result |
| --- | --- |
| Engine selected | **sampler** on all 14 fixtures |
| Missing triggers | **0** |
| Duplicate triggers | **0** |
| Tie continuation re-attacks | **0** |
| Stuck voices after Stop | **0** |
| Peak polyphony | **18** (dense passage) |
| Voice steals | **0** |
| Clipping events | **0** |
| Dynamic ladder pp→mp→mf→ff | **ordered** |

### Listening fixtures

1. Single-note scale (low / mid / high)  
2. Repeated notes  
3. Soft / loud  
4. pp → mp → mf → ff  
5. 2- / 3- / 6-note chords  
6. Dense chord passage  
7. Staccato  
8. Accent / marcato  
9. Tied note across barline  
10. Partially tied chord  
11. Fermata  
12. Crescendo / diminuendo  
13. Tempo change (onsets already performed)  
14. Stop / seek / loop cleanup  

For each fixture, performed-event fingerprints are unchanged by the renderer run.

## First-note latency

| Condition | Behavior |
| --- | --- |
| Before | CDN miss → synth from note 1; or silent wait while loading |
| After (warm / local) | Sampler ready after preload / `whenReady`; first note uses samples |
| After (cold, samples still loading) | Synth covers immediately; switches to sampler when decoded — no silent gap |

Exact wall-clock latency depends on device/network; harness measures ready→first-trigger in the fake Tone path (sub-ms once buffers “resolve”).

## Stuck-note / cleanup

`releaseAll` resets voice-mix tracking and fades master trim. Covered by fixture 14 and dense playback tests (pause/stop).

## Clipping / gain

Conservative trim (0.72), light compressor, limiter −3.5 dB. Dense chords duck gently above 8 voices. Benchmark peak mapped gain stays under the 0.95 clipping flag.

## What was **not** changed (acceptance)

- OMR recognition  
- ActiveScore / source ownership  
- Written MusicXML / pitch / durations / Guitar frets  
- Playback Semantics schedule timing & semantic velocities  
- Semantic evaluator / frozen corpus  
- Guitar tone overhaul  
- Architecture refactor  

## Remaining realism limitations

- Single velocity layer (no soft/hard hammer samples) — dynamics are gain-shaped, not layer-crossfaded  
- Lite pitch grid (minor thirds) — still pitch-shifts within 1.5 st  
- No sustain pedal modeling (by design this sprint)  
- Synth fallback still available if both local and CDN loads fail  
- Guitar audio path untouched  

## How to verify

```bash
npx vitest run tests/pianoRealismSprint1.test.js tests/playbackInstrument.test.js tests/playbackAudio.test.js
node scripts/piano-realism-benchmark.mjs
```

In the app (DEV): watch console for `PIANO AUDIO ENGINE:` (`engineType: 'sampler'`) and `PIANO TRIGGER:` lines.
