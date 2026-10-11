# Neural Mic — Practice Engine Integration Contract (Step 5)

Status: neural mic remains EXPERIMENTAL and default OFF. This document is
the integration contract for the Practice Engine agent. It changes no UI
code — it specifies what the hook already exposes and what the UI should
show for each user-facing state. All fields below are live on the
`neural` object returned by `useNeuralMicInput` (or `null` when the
spectral path owns input, per `selectMicInputSource`).

## Source of truth

`useNeuralMicInput` → `.neural` (exposed by `usePracticeSession` as
`neuralMic.neural`). Gate: `selectMicInputSource({ flagEnabled, neuralPhase })`
routes input to the neural path only while `phase === 'listening'`;
otherwise the spectral engine runs exactly as before.

## State table (exhaustive for the neural path)

| User-facing state | Signal fields | Recommended UI |
|---|---|---|
| Model loading | `phase: 'loading'` | Spinner + "Loading recognition model…" |
| Warmup/benchmarking | `phase: 'warming'` | Spinner + "Checking device speed…" |
| **Live** | `phase: 'listening'`, `matchingEnabled: true` | Existing WFY/PlayAlong UI |
| **Model unavailable** | `phase: 'unavailable'`, `error` = `'model assets missing'` \| `'too slow on <backend> (<ms> ms)'` \| load error message | Persistent non-blocking banner: "Recognition unavailable — using standard detection." Spectral path already owns input; do NOT block practice. |
| **Permission denied** | capture hook `errorMessage` / `micError` (NotAllowedError surfaced by `useMicrophoneCapture`) | Existing permission UI; unchanged. The neural hook idles (`phase: 'idle'`), spectral path unaffected. |
| **Input too quiet (neural stalls)** | `silenceSkips` increasing while `phase: 'listening'` and `debug.lastPumpReason === 'silence'`; `debug.neuralFloor` (0.003–0.006) exceeded by everything heard | Non-blocking hint after ~5 s of pure skips: "Playing too quietly for neural recognition — play closer to the mic or louder." The adapted floor is honest (`debug.ambientRms`). |
| **Room too noisy (flatness gate)** | `noiseFlatSkips` increasing and `debug.lastFlatness > 0.48` | Non-blocking warning after ~5 s: "Background noise is masking recognition — find a quieter room." Measured: unstructured noise above the gate makes the model hallucinate pitched notes; the gate now withholds inference, so awards stop rather than lie. |
| **Recognition uncertain (rejections)** | `rejected: { count, reason }` (reason = "heard N unexpected, missing M") | Optional dwell indicator; do NOT surface mid-practice. Feed into the post-run summary only. |
| **Heard but wrong note** | existing `onWrongNote` callback / `feedbackOutcome` | Existing wrong-note UX; unchanged. |
| **Heard and correct** | `detectedNotes[]` (per tone: `midi`, `label`, `onsetCaptureMs`, `attackFlux`, `attackPresence`), `feedbackOutcome: 'complete'` | Existing success UX; unchanged. |

## Hard rules (do not violate)

1. **Never gate WFY advancement on `attackFlux` / `attackPresence`.**
   They are OBSERVATIONAL evidence only. Calibration shows true piano
   attacks read presence ~0 (felt hammers are HF-soft; the flux sensor
   misses them), and guitar ghosts read HIGH (pick-shared spectra). No
   validated discriminator exists (see `harmonicGhostVetoes` docstring
   negatives #1–#5).
2. **Do not re-tune the flatness threshold (0.48) downward.** Music
   mixed with noise measures 0.44 at −3 dB SNR; lowering the threshold
   suppresses real playing.
3. **Do not display `debug.*` raw.** Derive user-facing states from the
   counters/thresholds above.
4. **Neural stays OFF by default.** No UI may enable it without the
   existing explicit opt-in (flag/global/storage).

## Known V1 gaps this UI must not paper over

- Multi-pitch octave ghosts (split-register chords: the model emits a
  true-sounding octave above a played fundamental). Single-pitch
  checkpoints are already vetoed in-engine; chord checkpoints are not
  (vetoing there stalls real users — measured on dense music).
- Physical microphone acceptance has not been run. All latency numbers
  are headless Chromium (SwiftShader WebGL / CPU). Do not quote them as
  device performance.
