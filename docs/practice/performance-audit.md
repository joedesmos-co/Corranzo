# Practice performance audit + prepared optimizations (M1/M5)

Read-only diagnostics run while the Score Following agent integrates and deploys
the shared preview. No tracked file was modified; the worktree was verified
byte-identical to `64383aade8` (md5) before and after the measurement passes.

Harness: `tmp/practice-perf-audit/audit.mjs` (scratch, not committed). Real
Chromium, real practice tree, real React. Instrumentation is injected into the
practice subtree as the dev server serves it; traced `useState` setters keep a
stable identity via a WeakMap on React's own dispatch function, so no extra
referential churn is introduced. Only **value-changing** dispatches are counted,
plus a per-render counter (each `useState` call in an instrumented module) which
is a proxy for component render volume.

Drives: open a practice score → Wait For You + microphone armed → Play Along +
playing + active mic, with mode switches / pause-resume / seeks on a fixed
cadence. Evidence the detector is alive (`heard=64`) in every run.

## Performance baseline (Play Along + playing + mic, ~40 s windows)

| metric | value |
|---|---|
| React state dispatches | **~48 /s** |
| State-slot renders (render volume) | **~6 600 /s** |
| Fan-out per dispatch | **~140 state slots** |
| Long tasks (>50 ms) | ~160 per 40 s, ~13.5 s total, longest ~520 ms |
| Layouts / style recalcs | ~1 800 / ~2 000 per window |
| Update-depth warnings | **0** (previous mission's fix holds) |

A/B isolating the microphone (identical otherwise):

| metric | with mic | no mic | delta |
|---|---|---|---|
| dispatches/s | 46.7 | 18.5 | −60 % |
| state-slot renders/s | 6 645 | 5 326 | −20 % |
| long tasks / total ms | 161 / 14 257 | 25 / 4 916 | −84 % |

Two important consequences:

1. The mic path owns 60 % of dispatches but only 20 % of render volume, so the
   **base** tree has the worse fan-out: ~288 state slots per dispatch versus ~47
   for the mic path. Reduce fan-out, not just dispatch count.
2. The `--no-mic` long-task drop is mostly the pitch detector's own DSP (which
   must not be touched), not React work.

## Dispatch call sites (measured, not guessed)

| rate | site | verdict |
|---|---|---|
| 16.3/s | `useWaitForYouMicInput` live-frame publish ← detector RAF `tick` | legitimate — level meter |
| 5.1 + 2.2/s | `useScorePlayback.flushTimeUpdate` | legitimate — 10 Hz display clock |
| 3.7/s | `useNeuralMicInput` per-checkpoint reset | **waste while the dev flag is off** |
| 3.7 + 3.6/s | `useWaitForYouMicInput` feedback resets (checkpoint id change) | content genuinely changes |
| 3.7/s | RAF `tick` → `setAudioTimelineIndex` | legitimate — event boundary |
| 3.6/s | `usePlayAlongVisualCheckpoint.commitCheckpoint` | legitimate — target change |
| 3.5/s | `usePlayAlongLaneFeedback.updateMisses` (80 ms interval) | legitimate — real outcomes |
| 1.0/s | `usePracticeStatsTracker` 1 s tick | legitimate |
| 0.9/s | `engine.onMetronomeDisplay` | legitimate |

Render volume by module: `useNeuralMicInput` 22 % (two idle instances × 15 state
slots), `useScorePlayback` + `useScoreFollow` 30 %, `useWaitForYouMicInput` 11 %.
The practice session hook re-renders **~61 times/s**; each re-render re-executes
~148 state slots, which is the whole cost.

## Prepared optimizations — both measured and REJECTED

Implemented, measured, then reverted because they produced no measurable gain
(negative results kept so the next attempt does not repeat them).

**OPT-A — live-frame value guard.** Skip `setLiveFrame` unless a field the mic UI
renders changes (rounded level percent, midi, clarity percent, cents offset,
signal quality, diagnostic label, note label). Result: 49.1 dispatches/s and
6 574 renders/s versus a 46.7–48 / 6 645 baseline — **no gain**, because the
rendered level percent genuinely changes on every frame. Reverted.

**OPT-C — idle-feedback reset guard.** Skip the `setInputFeedback` in
`resetFeedback` when the previous feedback is already idle with the same
outcome/message/tone. Result: 47.7 dispatches/s, 6 555 renders/s — **no gain**,
because the checkpoint target changes to different pitches, so the idle message
changes too. Reverted.

## The remaining lever (needs the next milestone, and deployment first)

The dispatch stream is almost entirely legitimate. The only large structural
waste is:

- **Two idle `useNeuralMicInput` instances** contributing 22 % of render volume
  and 3.7 dispatches/s while the experimental neural flag is off. Fixing this
  needs the two hook call sites moved behind a conditionally rendered child
  component (hook order forbids an inline guard). ~8 % dispatch reduction and
  ~22 % less hook-body execution.
- **Session/provider fan-out**: `clock` sits in the session memo, so every clock
  tick rebuilds the session and the provider value and re-renders all 8
  `usePracticeSessionContext()` consumers. The codebase already has the right
  pattern for this (`PracticeTickContext`, quantized time) plus a
  `PracticeSessionStableContext`; only 3 components use the stable context.
  Migrating the tick-only consumers (`PracticePositionTick`,
  `PracticeFullscreenHudTick`) off the full session would cut the per-tick
  fan-out without changing behaviour.

Both are contained refactors, not rewrites, and both should wait until the Score
Following deployment has landed on the shared preview.

## IMPLEMENTED AND MEASURED (after Score Following deployment landed)

Score Following merged into the shared preview (`579650eee2`) and deployed. The
mic live frame was moved off React state into an imperative runtime, following
the codebase's own score-follow cursor runtime pattern.

`src/features/microphone-input/micLiveFrameRuntime.js` (new) holds the live
frame; `useWaitForYouMicInput` publishes instead of `setLiveFrame`; the mic
readout (`MicTestPanel`, and `MicrophoneInputStatusPanel` for its calibration
label) subscribes via `useSyncExternalStore`. Recognition is untouched — the
detector still produces and consumes every frame; only the delivery to React
changed.

Measured on the merged tip, same 40–42 s windows, same flow:

| metric | before | after | delta |
|---|---|---|---|
| React state dispatches | 46.7–48.1/s | **31.6–32.0/s** | **−34 %** |
| State-slot renders | 6 573–7 084/s | **5 310–5 420/s** | **−20 %** |
| Practice-session renders | 392/s | **276/s** | **−30 %** |
| Live-frame dispatcher (was 16.3/s) | present | **gone from top 5** | — |
| Update-depth warnings | 0 | **0** | holds |
| Mic detection evidence | heard=64 | **heard=64** | unchanged |

The remaining ~31 dispatches/s are all legitimate (playback clock 7.3/s,
checkpoint-target changes ~7.3/s, RAF event-boundary ticks ~7.2/s, Play Along
miss interval ~3.5/s, stats 1/s, metronome 0.9/s).

Regression coverage: `tests/micLiveFrameRuntime.test.js` and
`tests/micLiveFrameSubscription.test.js` (6 tests) — dedupe, reset, subscriber
notification, React binding, and the "does not take the frame as a prop" /
"publishes rather than stores in state" guards.

## Rejected candidates (null results, recorded so they are not repeated)

**OPT-A — live-frame value guard in the detector.** Skip `setLiveFrame` unless a
rendered field changes. No gain (49.1 dispatches/s): the rendered level percent
genuinely changes every frame.

**OPT-C — idle-feedback reset guard.** Skip `setInputFeedback` in
`resetFeedback` when already idle for the same checkpoint. No gain (47.7
dispatches/s): the advancing target changes pitch, so the idle message changes.

Both were implemented, measured, and reverted; the files were verified
byte-identical to HEAD afterwards.
