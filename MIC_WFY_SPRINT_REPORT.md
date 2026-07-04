# Wait For You setup + adaptive mic calibration — sprint report

Scope: make the Wait For You (WFY) main path beginner-simple, and make mic
calibration adaptive to real instruments. No OMR, playback-timing, or MIDI-match
logic was changed. V1 fallback preserved; expert diagnostics kept but hidden.

## The Chrome "too quiet" bug — diagnosis with evidence

`TOO_QUIET` is produced by `classifyMicSignalQuality`: it fires when there is
measurable sound (`rms ≥ 0.0035`) but the **filtered** RMS is below the noise
gate. Walking the investigation checklist against the code and the offline
pipeline:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Chrome input gain / processing is low | **CONFIRMED — primary cause** | `useMicrophoneCapture` requested `echoCancellation/noiseSuppression/autoGainControl: true`. Chrome's speech noise-suppressor treats sustained instrument tones as background noise and attenuates them, and AGC ducks steady notes → tiny RMS at the AnalyserNode → gate shut → "too quiet." Chrome-specific, matches "sound was present." |
| Level meter uses the wrong signal | **CONFIRMED** | Meter/`level = min(1, rms/0.22)` uses **raw** RMS, while the gate + label use **filtered** RMS. The meter could bounce while the label said "too quiet." |
| Calibration captures sound and raises the gate too much | **CONFIRMED (risk)** | `shouldAcceptCalibrationSample` only rejected a note if `hasPitch && gateOpen`; a pitchless-but-loud frame (plucky/distorted) counted as "room noise," and the floor was the **median** of samples → inflated gate for guitar/distorted input. |
| Filtered RMS is too small | Contributing | High-pass DC blocker (~35 Hz) barely attenuates midrange, but combined with Chrome suppression it pushed borderline frames under the gate. |
| The label itself is wrong | Partly | The label was firing on a real gate-closed condition, but the gate was closed for the wrong reasons and the UI contradicted itself (meter vs label). |
| V2 expected notes missing | Separate | A matching-path concern (`rejectReason: 'no-expected-midi'`), not the "too quiet" driver. Now surfaced in the debug frame. |
| Debug object unavailable in prod | **CONFIRMED** | `__SCOREFLOW_MIC_DEBUG__` was only populated in DEV / V2, so `window.SCOREFLOW_MIC_DEBUG.lastFrame` did not exist in a production Chrome V1 session. |

## What changed

**Root-cause capture fix** — `useMicrophoneCapture` now requests raw instrument
input (`echoCancellation/noiseSuppression/autoGainControl: false`, mono) via
`acquireInstrumentStream`, with a graceful fallback to default constraints if a
browser rejects the hint. The applied `track.getSettings()` are exposed for
diagnostics.

**Signal-shape awareness** — `micFrameAnalysis` now computes crest factor,
zero-crossing rate and a high-frequency energy ratio (`spectralEnergy`) and
classifies each frame as quiet / sustained / percussive / distorted / noisy
(`micSignalShape.js`). `classifyMicSignalQuality` uses this so "too quiet" is
reserved for input **genuinely below the gate** — a strong distorted/harmonic
signal is never reported as silence.

**Adaptive, instrument-aware calibration** — `micCalibration` rejects any
pitched frame and any loud outlier (relative to the running minimum) so note
bleed can't inflate the floor, and estimates the floor from a low percentile
(p25) instead of the median. The noise gate is now parameterizable
(`gateOpenThreshold`) and `micInstrumentProfiles` supplies small per-instrument
defaults (piano = sustained; guitar = plucky, shorter attack skip, slightly
lower gate). Electric/clean/distorted are handled adaptively by shape, not by a
wizard.

**Simplified WFY setup** — the input chooser is now a clear **Use Microphone /
Use MIDI** choice (with a quiet "no device" fallback). Choosing Microphone
auto-requests permission and auto-starts calibration ("Stay quiet for a
moment…" → "Ready — play the highlighted note"); choosing MIDI auto-connects.
The test meter, access details and recovery controls are collapsed under a
**Troubleshooting** disclosure. No "enable mic"/"test mic" buttons in the main
path.

**Diagnostics** — `window.SCOREFLOW_MIC_DEBUG` is now always published (aliased
to the legacy name), and `lastFrame` includes rms, filteredRms, spectralEnergy,
noiseFloor, gate/gateOpen, calibration state + rejected outliers, rejectReason,
v2MeanConfidence, expectedMidis, instrumentId, inputSource, signalShape, and the
applied capture settings.

## How to confirm the fix live (Chrome)

1. Enter WFY, choose **Use Microphone** — permission + calibration start on
   their own.
2. In DevTools: `SCOREFLOW_MIC_DEBUG.captureSettings` should show
   `noiseSuppression:false, autoGainControl:false, echoCancellation:false`.
3. Play a note and read `SCOREFLOW_MIC_DEBUG.lastFrame`: `gateOpen:true` with a
   healthy `rms`, and `signalQuality` should no longer be `too-quiet` for an
   audibly-played note. `signalShape` reflects the instrument (sustained /
   distorted / etc.).

## Verification (all green)

- `npm test` → 196 files, **1912 passed**, 5 skipped, 0 failed (includes 38 new
  assertions across `micAdaptiveInstruments` + `waitForYouSetupSimplification`).
- `npm run build` → compiles clean.*
- `npm run mic:accuracy-replay` → real-clip hit rate 100%, silence/noise
  correct-reject, 0% false positives (unchanged vs baseline).
- `npm run mic:polyphony-replay` → all chords hit, silence/noise reject,
  `v2-improves` verdict preserved.
- `npm run omr:benchmark-dashboard` → completes unchanged (OMR untouched).

\* In this sandbox the build's `emptyOutDir` step can't delete a macOS
`dist/.DS_Store` (a filesystem permission quirk, not a code error); building to a
fresh outDir compiles cleanly. `npm run build` runs normally on macOS.

## Constraints honored

OMR unchanged · playback timing unchanged · MIDI matching unchanged (only the
mic setup/auto-start state) · V1 fallback preserved · no full polyphonic guitar
detection · no instrument setup wizard · thresholds loosened only modestly and
backed by replay evidence.
