# Microphone integration instructions (Step 5 launch sprint)

Owner: product agent. Nothing here requires UI work; it documents what the
microphone engine now does, what it cannot do, and where to surface that.

## What changed in the shipped path (mic-owned modules only)

1. `src/features/microphone-input/micChordPolyphonyEvidence.js` (new) —
   `chordCollectionEvidenceMidis(frame, expectedMidis)`: the tones the chord
   collection should consume for a frame (the v2 score-informed
   detections plus the monophonic pitch). The v2 detections are, by
   construction, a subset of the checkpoint's expected pitches, so feeding
   them cannot introduce an unexpected tone.
2. `src/features/practice/waitForYouMicChordCollection.js` — the collection
   now keeps a hit counter **per expected tone** instead of a single
   pending index, so several expected tones heard in the same frame can
   accumulate. A genuinely wrong note still clears the progress.
3. `src/features/practice/useWaitForYouMicInput.js` — two monophonic-only
   guards no longer discard frames that carry chord polyphonic evidence
   (they dropped them before the collection could use them).

No cursor, notehead, feedback or practice-control behaviour was touched.
The spectral recognizer remains the default; the neural recognizer remains
experimental and OFF by default.

## Chord completion status (read this before shipping chords)

- With the **v2 collection path** (V3 performance expectations off, or a
  score without expectations): real piano chords now COMPLETE — browser
  verified ("Heard C4 + E4 + G4 — all tones matched"). The fixes are in
  the mic-owned modules listed above; no UI change is needed.
- With the **default V3 path**: the v2 evidence is complete (all three
  tones detected every frame) but the V3 match result does not emit
  COMPLETE, so the checkpoint does not advance. This is in the shared V3
  layer (`src/features/microphone-input/v3/`), which this worktree did
  not modify. **Product decision needed**: either the V3 chord decision
  is fixed, or the mic path is switched to the v2 collection for chord
  checkpoints. Until then, do not promise chord completion to users.

## UI contract (what to show, and when)

The production path exposes these states today (all via the existing
microphone hook):

| State | Signal | Suggested UI |
|---|---|---|
| Calibrating | `micCalibrating` / `calibration.status === 'measuring'` | Existing "Calibrating…" chip (already wired) |
| Room too noisy | `calibration.status === 'room-noisy'` | Existing status label ("Room noisy — play louder") — already wired |
| Model unavailable (neural only) | `neural.error` | Banner, practice continues on the spectral path |
| Recognition uncertain | `rejected.count` / `rejected.reason` | Post-run summary only (never mid-practice) |
| Chord in progress | `feedbackOutcome === 'chord-partial'` | Existing partial-chord feedback — no change needed |

**New requirement (honest supported range)**: when a checkpoint expects a
pitch that is an octave or a semitone neighbour of what the player
produced, the production spectral engine CANNOT distinguish the harmonic
from the real note (measured: 18 false completions, 7 of them octave
confusions on the legacy corpus). Until the neural path is validated and
enabled, Wait For You should not advance on such checkpoints **unless the
player strikes the tone separately**. Two options for the product agent:

- (recommended, no engine change) keep the current behaviour but make sure
  the score's chord voicings avoid pure octave doublings where the
  expectation is a single pitch.
- (engine change, needs review) add a per-checkpoint flag
  `micRequireIndependentAttack` that makes the engine wait for a fresh
  transient instead of accepting sustained harmonic energy. The evidence
  for this lives in `micAttackEvidence.js`; the rule is not implemented
  because it costs true-note recall in dense passages (measured).

## Verification the product agent can run

- `npm run mic:browser-qa` — the browser QA for the production path. NOTE:
  it currently fails at the app-UI step ("Try Demo Piece" button) because
  the Practice UI is mid-repair; the frame-replay suite (13 checks) passes.
  That is a UI-state issue, not a microphone issue.
- `npx vitest run tests/micLiveProduction.test.js` — the new production
  MediaStream injection suite (real capture, real v2 detector, real
  checkpoint): single note advances, chord never falsely advances, room
  noise never advances.
- `node scripts/benchmark-spectral-corpus.mjs` — the production corpus
  benchmark (the A/B counterpart of the neural scorer).
- `node scripts/measure-mic-resources.mjs` — CPU/heap for both engines.

## Do not

- Do not enable the neural recognizer automatically. It is experimental:
  it needs a model download and a WebGL/CPU backend, and its numbers come
  from injected-stream tests, not physical microphones.
- Do not lower the flatness threshold or the attack-flux threshold
  (`micNoiseFlatness.js`, `micNeuralStream.js`): both were calibrated with
  measured margins, and lowering them suppresses real playing.
