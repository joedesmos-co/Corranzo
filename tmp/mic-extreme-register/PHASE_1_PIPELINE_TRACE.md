# Phase 1 — extreme-register live microphone pipeline trace

Baseline: `c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4` (clean tracked tree at campaign start).

Protected OMR comparison point: `50a3ea39ce45d61dde470d636ee27f6ed44a2e21`. The new baseline is its direct child and changes no production OMR source, evaluator, truth data, tolerances, expected fixtures, or production tests.

## User-facing microphone modes

| User-facing path | Production composition | What a confirmed match does |
| --- | --- | --- |
| Wait For You | `usePracticeSession` creates the shared capture, builds the current WFY checkpoint, and invokes one `useWaitForYouMicInput` instance. | `onPlayerInputMatched` is queued out of the frame callback and advances to the next distinct checkpoint through `useWaitForYou` / `waitForYouEngine`. |
| Follow Along / normal playback play-along feedback | `usePracticeSession` derives the currently timed visual-lane group and invokes a second `useWaitForYouMicInput` instance with that group as a note checkpoint. | It marks the current lane group correct or wrong. Playback time, not microphone input, moves the cursor; microphone matching never seeks or auto-advances playback. |
| Microphone diagnostics | The status/test UI reads capture state and frames exposed by the same detector path; it has no independent score matcher or advancement state. | Diagnostic display/export only. |

There is one `MediaStream`, `AudioContext`, `MediaStreamAudioSourceNode`, and `AnalyserNode` shared by the two score-mode hook instances. Only one matcher/detector instance is enabled at a time because Wait For You and playback are mutually exclusive in the activation predicates. The two hook instances deliberately do **not** share confirmation, chord collection, or attack-latch state.

## End-to-end path

| Stage | Source | Effective behavior |
| --- | --- | --- |
| Input selection | `usePracticeSession.js`, practice controls | Microphone capture is active while Practice is active, microphone is selected, the source-selection modal has been resolved, and either Wait For You is active or normal playback is playing. Note checkpoints are the only WFY microphone-matching checkpoints. |
| MediaStream | `useMicrophoneCapture.js` | Requests mono instrument input with echo cancellation, noise suppression, and automatic gain control disabled. Unsupported constraint shapes retry once with default audio; permission/device failures do not retry. |
| AudioContext | `useMicrophoneCapture.js`, `audioLifecycle.js` | Browser-chosen sample rate; UI state defaults to 44,100 Hz until opened. Suspended/interrupted contexts resume when visible. Failed resume, ended track, or device-loss signal closes the current capture and reacquires while still active. |
| Analyser/window extraction | `useMicrophoneCapture.js`, `useMicEngineV2Detector.js` | `fftSize = 2048`; one current time-domain snapshot per `requestAnimationFrame`. At 44.1 kHz the window is 46.44 ms and at 48 kHz 42.67 ms. Nominal hop is 16.67 ms at 60 Hz, but browser scheduling controls it. Frequency-domain smoothing is `0.85`, but production detection reads time-domain samples, so this setting does not smooth pitch decisions. UI publication is every third analyzed frame; matching receives every frame. |
| Calibration/noise floor | `micCalibration.js`, `micFrameAnalysis.js`, `micNoiseGate.js` | 45 acceptable/observed frames, nominally 750 ms, with a 2,500 ms timeout. Pitched or loud frames are excluded from calibration sampling. Runtime quiet frames update the floor with alpha `0.035`, clamped to `0.004..0.06`. Piano raw gate is `max(0.012, floor * 2.8)`. The score-informed quiet gate requires acoustic expected-note evidence plus filtered RMS above the floor by a register-neutral margin. |
| Frame features | `micFrameAnalysis.js`, `micSignalShape.js` | Raw RMS, high-pass filtered RMS (coefficient `0.995`), peak, crest factor, zero-crossing rate, first-difference/spectral energy, pitch clarity, and signal-shape class are calculated over one 2,048-sample frame. Raw samples feed pitch; the high-pass copy feeds only gating/noise-floor logic. |
| Blind pitch candidate | `pitchDetection.js` | Mean-centered time-domain autocorrelation searches 55–1,400 Hz. It requires raw RMS at least `0.006`, correlation at least `0.00012`, clarity at least `0.12`, and quantization within the configured cents tolerance (normally 35 cents). Integer-divisor checks 2..8 suppress long subharmonic locks. `frequencyToMidi = 69 + 12*log2(f/440)`; quantization clamps MIDI to 21..108. MIDI 21..32 and MIDI 90..108 are outside the blind tracker's supported frequency band. |
| Expected-note spectral candidates | `scoreInformedChordScorer.js`, `micSpectralAnalysis.js` | A Hann-windowed 2,048-sample Goertzel scorer probes only current expected MIDI fundamentals plus five harmonics. Nominal defaults: ratio `>=1.35`, confidence `>=0.28`, stable frames `2`, bass threshold MIDI `<60`, bass boost `1.4`, bass fundamental weight `1.65`. Adjacent probes, octave-peer relative energy, relative/peer energy, and guitar-string guards reject leakage. There is no explicit Nyquist clamp: high-note harmonic probes above Nyquist currently alias. |
| Harmonic/fundamental selection | `scoreInformedChordScorer.js`, `micMusicalAcceptance.js` | Harmonic-family confidence is a bounded log transform of signal/noise ratio. Bass may have h2 strongest; non-bass normally requires the fundamental to be the strongest partial. Formant-heavy upper tails are rejected. A narrow low-bass exception requires h1 strongest, low upper-tail energy, and independent absolute-pitch agreement. Score context only selects which frequencies are probed; exact matching and corroboration still gate advancement. |
| Spectral temporal state | `micEngineV2Live.js`, `micScoreInformedAggregation.js` | Per-expected-note tracks accumulate detected-frame counts and peak confidence; normally two detected frames or one peak-confidence frame makes a stable callback. Tracks reset on detector enablement, calibration/profile change, expected MIDI key, stability threshold, or checkpoint `analysisKey`. The frame matcher uses current-frame `v2DetectedMidis`, not stale stable callbacks. |
| Match confirmation | `micMatchConfirm.js`, `useWaitForYouMicInput.js` | A single-note match normally needs three consecutive confident frames (nominally about 50 ms) with at most 25 cents drift. Gate, musical-shape checks, current expected-note detection, and independent autocorrelation corroboration (where the expected fundamental is inside 55–1,400 Hz) all apply. Very low and very high expected notes bypass independent contradiction because they are outside that band. |
| Attack/release/rearm | `micAttackLatch.js`, `useWaitForYouMicInput.js` | A completed score event consumes the latch. Four gate-closed frames (nominally 67 ms) release it. A broad 1.6x RMS rise can rearm any genuine new attack. The accepted repeated-bass behavior adds guarded rearm after six frames from either a 1.55x first-difference-energy rise with an absolute margin or a 1.45x RMS rise, while strong expected low-note harmonic evidence is present. Different-note dominance must agree in absolute MIDI; octave-related transitions cannot use the looser score-informed transition. A held tone cannot repeatedly advance. |
| Exact score matching | `waitForYouNoteMatch.js`, `midiPitchMatch.js`, `waitForYouMatchSettings.js` | Microphone V2 supplies integer detected expected pitches. Defaults are exact absolute MIDI, no octave mistakes, no transposition, and 35-cent acoustic tolerance before integer matching. Optional `allowOctaveMistakes` exists in shared user settings, but the accepted default is false; the campaign must not broaden it. |
| WFY cursor/advance | `useWaitForYouMicInput.js`, `usePracticeSession.js`, `useWaitForYou.js` | On complete confirmation, the attack is consumed synchronously and the distinct WFY checkpoint advances in a microtask. Checkpoint identity contains score-event identity/time, so same-pitch consecutive score events are distinct. Tied continuations are not new attacks. |
| Follow Along outcome | `usePracticeSession.js`, `usePlayAlongLaneFeedback.js` | The same detector/matcher marks the time-selected visual group correct/wrong. Playback remains the cursor authority. The mode uses its own confirmation/latch state and resets it when inactive; it does not inherit WFY state. |

## Resolution and register limits

- Claimed piano range under test: MIDI 21 (A0, 27.5 Hz) through MIDI 108 (C8, 4,186.01 Hz).
- A 2,048-sample frame contains only 1.28 A0 cycles at 44.1 kHz (1.17 at 48 kHz), 2.55 A1 cycles, and 4.26 E2 cycles. Exact-frequency Goertzel evaluation is not constrained to FFT-bin centers, but short-window leakage makes adjacent deep-bass probes and weak fundamentals unstable.
- The same window contains many high-register cycles, but blind autocorrelation stops at 1,400 Hz and current h2..h6 probes can cross Nyquist. At 44.1 kHz, C8 h6 is above Nyquist; unbounded digital probing folds this energy rather than representing a physical harmonic.
- The raw autocorrelation integer-period resolution worsens with frequency; parabolic interpolation is not used. High notes therefore rely mainly on score-informed exact-frequency probes.
- A single fixed window and fixed three-frame confirmation are used for all registers at baseline.

## Latency budget

- Audio hardware/browser buffer and permission: device-dependent and outside deterministic measurement.
- Rolling analysis window: 42.67–46.44 ms at common sample rates.
- Animation-frame scheduling: nominal 0–16.67 ms after a usable window; background throttling is browser-dependent.
- Spectral stability: usually 0–33 ms, overlapping the match confirmation path.
- Match confirmation: three consecutive frames, nominally about 33–50 ms from the first accepted frame depending on timestamp convention.
- Release: four closed frames, nominally 67 ms; guarded bass same-note rearm cannot occur until six post-consume frames, nominally 100 ms.
- Actual attack-to-match latency must be measured from corpus timestamps because these stages overlap.

## Lifecycle and stale-state audit

- Capture disable/unmount invalidates pending requests, removes recovery listeners, stops every track, nulls stream/analyser/buffer references, and closes the context.
- An ended track, failed visible context resume, or confirmed device loss reacquires one capture. Hidden pages defer resume to the visibility listener.
- The RAF is cancelled and V2 runtime state reset whenever its hook is disabled or unmounted.
- Detector calibration, analysis state, confirmation state, chord buffers, feedback, and attack latch reset on the relevant enablement/checkpoint/mode boundaries. Score replacement clears input-source session readiness and changes checkpoint identity. Instrument/profile changes rebuild the analyzer and reset V2 state.
- Wait For You and Follow Along have separate hook-local state but share the one capture. Activation predicates prevent simultaneous detector loops.

## Stage hypotheses to test before production changes

1. **Candidate generation/resolution:** MIDI 21..32 have fewer than 2.6 cycles per 2,048-sample frame and no independent pitch candidate. Deep-bass weak-fundamental and neighbor cases may first diverge in expected-note scoring.
2. **Harmonic/fundamental selection:** non-bass acceptance requires h1 to be strongest, which may reject weak-fundamental high piano. Unbounded above-Nyquist harmonic probes may contaminate high-register scores.
3. **Temporal confirmation:** short high attacks may disappear before three confident frames, while a single fixed confirmation duration is applied across the range.
4. **Attack/rearm:** the accepted low-note transient path must remain intact; the same guarded mechanism currently stops at MIDI 59, so repeated high notes depend on release or the broad RMS rule.
5. **Score-event matching:** exact MIDI matching is shared and should reject wrong octaves; any acoustically correct candidate that does not advance must be traced through musical acceptance, corroboration, confirmation, and latch state.
6. **Mode integration:** matcher code is shared. Differences can still arise because WFY changes checkpoints only on confirmed input while Follow Along changes targets with playback time, and each instance has independent calibration/temporal/latch state.

No production code has been changed in Phase 1. The deterministic corpus will identify the first divergent stage for each failing case before repair.
