# Microphone Wait-For-You Reliability

**Date:** 2026-06-22
**Goal:** Make microphone mode reliable for normal users playing piano into a
laptop/iPad mic (single notes first; no chord detection). MIDI is untouched.

## What changed

**1. Quick automatic calibration (`micCalibration.js`, new).**
When the mic starts, ~1s of room audio is sampled (the user isn't playing yet).
From it we compute the room noise floor and overall level, then derive an
automatic gate / minimum-RMS threshold and a plain status: *Calibrating…*,
*Mic ready*, *Room is noisy…*, or *No input detected*. The result seeds the live
noise gate and the stabilizer's minimum level immediately, instead of waiting for
slow drift. Pure and unit-tested.

**2. Pitch stability (`noteStabilizer.js`).**
- Skips the **attack transient** at note onset (pitch is unstable then).
- Requires a **stable pitch held** for a short window above a confidence floor.
- **Octave-jump suppression**: a transient ±12 glitch on a building candidate is
  ignored rather than resetting/re-triggering the note.
- Rejects unstable/jumping pitch and low-confidence frames.
- Keeps a silence gap before the same note can fire again (no sustain
  re-triggers).

**3. Cents-tolerant matching.**
Pitch quantization now takes a configurable cents tolerance (default **±30**,
clamped 15–50) threaded from the Wait-For-You match settings
(`micCentsTolerance`). A note within tolerance of the expected pitch is accepted;
outside it is rejected. `frequencyMatchesMidi` and `midiCentsOffset` helpers
added. MIDI input matches exact integers and ignores this.

**4. UI feedback (small).**
The mic panel shows the calibration status line, and the test readout shows the
detected note with its live tuning offset (e.g. `C4 +8¢`) plus clarity and
signal status. Unobtrusive.

**5. MIDI untouched.**
All changes live in the microphone modules, `useWaitForYouMicInput`, mic UI, and
a new mic-only match setting. MIDI Wait-For-You (`useWaitForYouMidiInput`,
`evaluateNoteInput`, `pitchMatches`) and manual continue are unchanged.

## Tests

`tests/micDetection.test.js` (24 tests) + additions to
`scripts/test-pitch-detection.mjs` cover: quiet input ignored, white-noise
ignored, stable correct pitch accepted, unstable pitch rejected, low-confidence
rejected, attack-transient skipped, octave glitch suppressed (stability) and
octave error rejected (matching), cents tolerance (reject 40¢ at ±30, accept at
±50; configurable; default 30), repeated-note does not double-trigger, re-trigger
after silence, and calibration (quiet→ready, noisy→room-noisy with a higher gate,
dead mic→no-input, progress).

## Validation

- `npm test` → 239 passed, 5 skipped (the 5 are the canvas-gated real-PDF
  score-follow tests).
- `npm run test:scripts` → all pass.
- `npm run build` → compiles cleanly.
- `npm run lint` → 71 problems (64 errors, 7 warnings), unchanged from the
  pre-existing baseline.

## Honest notes

Pitch detection and stabilization were verified deterministically with
synthesized tones and unit-level frame sequences; I can't drive a live mic here.
The improvements target single-note reliability (calibration, attack/octave
robustness, cents tolerance). Chord detection remains out of scope and mic chord
matching stays experimental/single-tone, as before.
