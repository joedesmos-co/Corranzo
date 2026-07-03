# Microphone Engine V2 — Research & Architecture

**Status:** Design sprint (no runtime implementation)  
**Date:** 2026-07-03  
**Scope:** True simultaneous polyphonic chord recognition for Wait For You (WFY)  
**Constraint:** WFY, Score Follow, playback, and OMR remain unchanged. Mic V2 only improves what flows *into* matching.

---

## Executive summary

Corranzo’s Mic Engine V1 is a **monophonic** pipeline: Web Audio `AnalyserNode` (2048 FFT) → autocorrelation → single-note stabilizer → one MIDI at a time. WFY chord checkpoints are handled today by **sequential collection** (`waitForYouMicChordCollection.js`) — the user plays tones one-by-one while the engine hears one note. MIDI already supports real chords; the mic path does not.

**Mic Engine V2** should output a **polyphonic event stream**:

```ts
interface MicNoteEvent {
  midi: number           // 21–108
  confidence: number     // 0–1
  onsetMs: number        // relative to stream start or performance clock
  releaseMs: number | null
  centsOffset?: number   // optional fine pitch
}

interface MicEngineFrame {
  timeMs: number
  notes: MicNoteEvent[]  // zero or more simultaneous partials
  roomQuality?: 'quiet' | 'moderate' | 'noisy'
  diagnostic?: string    // optional, for existing diagnostic UI
}
```

WFY continues to call the same matching layer (`waitForYouNoteMatch.js`); a thin **adapter** converts `MicEngineFrame[]` or stable chord snapshots into the existing `evaluateMicNoteInput` / chord-buffer APIs. No WFY UI redesign required for V2 research — only a swap of the detector behind `useWaitForYouMicInput`.

**Strategic insight:** Corranzo is not building a general-purpose music transcriber. At each WFY checkpoint we already know **expected MIDI pitches** (and often voicing/register). V2 should exploit **score-informed verification** (harmonic templates at expected fundamentals) in addition to blind multi-pitch estimation. This dramatically improves accuracy vs. open-world chord ID.

**Recommended direction:** Phased hybrid — improved preprocessing + CQT/chroma **expected-note scoring** (Phase 1–2), then **multi-pitch prototype** (pYIN-style or lightweight NMF on CQT) for blind partials (Phase 3–4), optional **Basic Pitch / small TF.js model** for hard cases (Phase 5), production **hybrid fusion** (Phase 6).

---

## Current state (V1)

| Layer | Module | Role |
|-------|--------|------|
| Capture | `useMicrophoneCapture.js` | `getUserMedia`, `AnalyserNode` 2048, AGC/NS/EC |
| Calibration | `micCalibration.js` | Noise floor, gate, stabilizer thresholds |
| Frame analysis | `micFrameAnalysis.js` | High-pass (gate only), autocorrelation pitch |
| Stabilization | `noteStabilizer.js` | Hold frames, attack skip, octave reject |
| Loop | `usePitchDetector.js` | rAF ~60 Hz, calibration → frames → stable note |
| WFY bridge | `useWaitForYouMicInput.js` | Single `onStableMidi`, chord collection workaround |
| Measurement | `micReplayHarness.js`, `benchmarks/mic-accuracy/` | Offline replay, labeled WAV fixtures |

**V1 limits relevant to V2:**

- One fundamental per frame; harmonics collapse to single pitch.
- Chord checkpoints rely on **time-multiplexed** single notes, not simultaneity.
- 2048 @ 44.1 kHz ≈ 46 ms window — acceptable for monophonic, tight for low bass separation.
- CPU budget is low (~1 autocorrelation / frame); headroom exists but not unlimited on iPad.

---

## Problem definition

### In scope

- Detect **2–5 simultaneous piano pitches** (typical WFY chord sizes).
- Acoustic piano, digital piano through speakers, quiet home rooms.
- MacBook mic, USB condenser, iPad mic (realistic student setups).
- Latency perceived as “responsive” (&lt; 150–200 ms stable chord after attack).
- Output: notes + confidence + onset/release for WFY adapter.

### Out of scope (V2)

- Full score transcription without expected notes.
- Percussion / unpitched detection.
- Guitar polyphony (polyphonic fingerstyle) — design for compatibility but **piano-first** benchmarks.
- Replacing MIDI path.
- On-device training / user-specific ML fine-tuning (future).

### Score-informed vs blind

| Mode | When | Advantage |
|------|------|-----------|
| **Score-informed** | WFY checkpoint has `expectedMidis` | Test energy at predicted fundamentals/harmonics; reject spurious peaks; much higher precision |
| **Blind multi-pitch** | Diagnostics, mic test panel, future “free play” | Needed for completeness; harder; higher FP rate |

V2 architecture should run **both** and fuse scores.

---

## Approach comparison

Ratings: **High / Medium / Low** (relative within browser practice app context).  
**Piano chord** = 3–4 note tonal chord, beginner repertoire, moderate dynamics.

| Approach | Browser | WebAudio | Latency | CPU | Memory | iPad | Mac | Piano chords | Acoustic | Digital | Guitar | Complexity | License | Maintainability |
|----------|---------|----------|---------|-----|--------|------|-----|--------------|----------|---------|--------|------------|---------|-----------------|
| **Autocorrelation (V1)** | High | High | Low | Low | Low | High | High | Low | Low | Med | Med | Low | MIT | High |
| **Harmonic Product Spectrum** | High | High | Low | Low | Low | High | High | Low | Low | Med | Med | Low | — | High |
| **YIN** | High | High | Low | Low–Med | Low | High | High | Low | Med | Med | Med | Low | — | High |
| **pYIN** (iterative subtract) | High | High | Med | Med | Low | Med | High | Med | Med | Med | Low–Med | Med | AGPL (librosa) / reimplement MIT | Med |
| **CQT + peak picking** | High | High (FFT bank) | Med | Med–High | Med | Med | High | Med | Med | Med | Med | Med | — | High |
| **Chroma + template** | High | High | Med | Med | Low | Med | High | **High*** | Med | Med | Low | Med | — | High |
| **Multi-pitch (harmonic summation)** | High | High | Med | Med | Low | Med | High | Med | Med | Med | Med | Med | — | High |
| **NMF on magnitude spectrogram** | High | High | Med–High | High | Med | Low–Med | Med | Med | Med | Med | Med | High | — | Med |
| **CREPE (TF.js)** | Med | High | Med | **High** | **High** (~2–10 MB) | Low–Med | Med | Low (mono) | Med | Med | Med | Med | MIT | Med |
| **Basic Pitch (Spotify)** | Med | Med† | High | **High** | **High** | Low | Med | **High** | Med | Med | Med | High | Apache-2.0 | Med (model updates) |
| **ONNX Runtime Web + custom** | Med | Med | Med–High | High | High | Low–Med | Med | Med–High | Med | Med | Med | High | varies | Low–Med |
| **Web Audio worklet + WASM (Essentia)** | Med | High | Med | Med–High | Med | Med | High | Med | Med | Med | Med | High | AGPL (Essentia) | Med |
| **Existing JS libs (Meyda, pitchy, ml5)** | High | High | Low | Low | Low | High | High | Low | Low | Med | Med | Low | MIT | High (features only) |

\*Chroma + template is **High** when expected chord is known (WFY); **Low** blind.  
†Basic Pitch expects longer buffers; may need `AudioWorklet` + Worker, not raw AnalyserNode frames.

### Notes per approach

**CQT (Constant-Q Transform)**  
Log-frequency resolution matches musical pitch classes. Better bass/treble separation than linear STFT at equal bin count. Implementable as FFT filterbank in JS or WASM. Standard building block for chroma and multi-pitch.

**Chroma features**  
12-D (or 36-D tuned) pitch-class profile robust to timbre. **Template match** against expected chord (from score) is the highest-ROI V2 technique for Corranzo.

**Harmonic Product Spectrum**  
Enhances fundamental via multiplying harmonically spaced spectra. Monophonic; cheap; already marginal gain over autocorrelation for piano — not sufficient alone for chords.

**NMF**  
Factorize magnitude spectrogram into spectral templates × activations. Can separate overlapping partials with tuned basis (harmonic dictionaries). CPU-heavy for real-time 5+ notes on iPad; better in Worker with downsampled STFT.

**Multi-pitch estimation (classical)**  
Peak tracking in spectral domain + harmonic grouping (e.g. MIREX-style). Good middle ground; no ML dependency; explainable.

**YIN / pYIN**  
YIN: excellent monophonic, cheap. pYIN: sequential subtraction for polyphony — latency grows with polyphony; confusion when partials lock.

**CREPE**  
CNN pitch — monophonic per frame. TF.js inference 50–200 ms per frame on mobile if not batched; model load cost. Research extensions for multi-F0 exist but not production-ready in browser.

**Basic Pitch**  
State-of-art lightweight CNN for note events (onset, offset, pitch). **Best ML candidate** for polyphonic piano in browser if WASM/ONNX path is acceptable. Needs ~1–2 s context windows for best results — conflicts with ultra-low latency unless sliding window + tracking.

**TensorFlow.js**  
Mature on desktop; iPad Safari acceptable for small models; thermal throttling on long sessions. Prefer **ONNX Runtime Web** or **transformers.js** only if model ecosystem demands it.

**Browser libraries**  
- **Meyda**: chroma, spectral features — use, don’t rebuild.  
- **pitchy**: monophonic — V1 class.  
- **ml5 CREPE**: demo quality, not product.  
- **Essentia.js**: powerful, AGPL, WASM size — evaluate for offline benchmark only.  
- **aubio** (WASM ports): onset + pitch — worth spike for onset layer.

**Open-source reference (non-browser)**  
librosa (pYIN), Basic Pitch, sonic-annotator, MELODYNE-class proprietary — study algorithms, do not ship AGPL stacks without legal review.

---

## Recommended technical strategy

### Primary: Score-informed harmonic verification (Corranzo advantage)

At each WFY checkpoint:

1. Build expected fundamental set `F = { f(midi) for midi in expectedMidis }`.
2. Compute CQT or fine STFT magnitude in band around each expected fundamental (±1 semitone).
3. **Harmonic score** per expected note: weighted sum of energy at `k * f0` for k = 1..K.
4. **Chroma score**: project spectrum to pitch classes; cosine similarity to expected chroma vector.
5. Threshold + hysteresis → simultaneous active notes with confidence.

This detects **real chords** the user is *supposed* to play without full blind separation. Wrong-note detection: strong energy at unexpected chroma bins.

### Secondary: Blind multi-pitch (fill gaps)

For mic test UI and checkpoints without tight expectations:

- CQT peak find → harmonic grouping (max 6 simultaneous F0).
- Optional pYIN-style iterative cancellation on residual.

### Tertiary: ML fallback (optional Phase 5+)

- **Basic Pitch** ONNX in AudioWorklet, 2–4 Hz analysis rate, note events merged with classical tracker.
- Use only when classical confidence &lt; τ and device tier = desktop.

### Fusion

```
finalConfidence(note) = max(
  scoreInformed(note),
  blindMultiPitch(note) * blindWeight(device)
)
```

Desktop: `blindWeight` higher. iPad: rely more on score-informed + lighter blind path.

---

## Mic Engine V2 — Layered architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Microphone (getUserMedia → MediaStream → AudioContext)      │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Audio preprocessing                               │
│  • Ring buffer (50–200 ms hop, 2–4× overlap)                 │
│  • DC removal, gentle high-pass (rumble)                     │
│  • Optional: AGC normalization (careful with dynamics)     │
│  • Noise floor tracker (reuse V1 calibration concepts)       │
│  • Device profile hints (iPad / USB / built-in)              │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2 — Time–frequency analysis                         │
│  • STFT and/or CQT (configurable resolution)                 │
│  • Chroma extraction (Meyda or internal)                   │
│  • Onset strength (spectral flux / aubio-style)            │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3 — Polyphonic detector (pluggable backends)          │
│  • ScoreInformedHarmonicScorer (expected MIDIs from WFY)    │
│  • BlindMultiPitchEstimator (CQT peaks + harmonic groups)    │
│  • Optional: BasicPitchBackend (Worker, ONNX)              │
│  Output: raw partials per frame with coarse confidence       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — Note tracking & lifecycle                       │
│  • Per-pitch state machine: candidate → active → release     │
│  • Onset: attack + confidence rise                         │
│  • Release: energy decay + pedal heuristic                 │
│  • Octave disambiguation, duplicate partial merge            │
│  • Chord snapshot: stable set held ≥ N frames               │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — Confidence scoring & diagnostics                │
│  • Fuse score-informed + blind                             │
│  • Per-note confidence, chord-level confidence             │
│  • Map to existing MIC_DIAGNOSTIC codes                    │
│  • “Expected C+E+G, heard C+E” partial feedback            │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 6 — WFY adapter (only integration surface)          │
│  • MicEngineV2 → MicNoteEvent[] / chord snapshots            │
│  • Feeds waitForYouNoteMatch (replace collection hack)     │
│  • useWaitForYouMicInput: swap usePitchDetector → useMicV2   │
└─────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Input | Output | Reuses V1? |
|-------|-------|--------|------------|
| **1 Preprocessing** | Float32 PCM chunks | Normalized frames, gate open, RMS | Calibration math |
| **2 TF analysis** | PCM | CQT/STFT matrix, chroma, onset curve | New |
| **3 Polyphonic detector** | TF + optional `expectedMidis` | Partial list per hop | Replaces autocorrelation |
| **4 Note tracking** | Partials stream | Note events with onset/release | Conceptually replaces stabilizer |
| **5 Confidence** | Tracked notes | Scored `MicEngineFrame` | Extends diagnostics |
| **6 WFY adapter** | `MicEngineFrame` | Existing match API | Thin new module |

**Threading model:** AudioWorklet for ring buffer + STFT/CQT; Worker for NMF/ONNX if enabled. Main thread receives throttled frames (30–60 Hz UI, same as V1).

**Public API (proposed):**

```ts
interface MicEngineV2Config {
  sampleRate: number
  hopMs: number
  maxPolyphony: number
  expectedMidis?: number[] | null  // from WFY checkpoint; null = blind
  deviceTier: 'mobile' | 'tablet' | 'desktop'
}

interface MicEngineV2 {
  pushSamples(samples: Float32Array): void
  readFrame(): MicEngineFrame | null
  reset(): void
  calibrateQuietRoom(samples): CalibrationResult
}
```

---

## Benchmarking design

Extend `benchmarks/mic-accuracy/` → `benchmarks/mic-polyphony/` (parallel suite; V1 suite remains regression guard).

### Fixture categories

| Suite | Examples | Purpose |
|-------|----------|---------|
| **S1 Single notes** | C4, E4, G3, bass/treble | Regression vs V1; latency |
| **S2 Dyads** | C4+E4, thirds, octaves | Minimum polyphony |
| **S3 Triads** | C major, A minor, inversions | Core WFY |
| **S4 4–5 note chords** | Cmaj7, G7, dense voicings | Upper bound |
| **S5 Split register** | Bass C + treble CEG | Harmonic leakage stress |
| **S6 Repeated chords** | Same chord 4× @ 120 BPM | Tracking stability |
| **S7 Rolled chords** | Arpeggiated &lt; 150 ms stagger | Reject vs accept policy |
| **S8 Pedal** | Sustain pedal down, reattack | False sustain / retrigger |
| **S9 Noise** | HVAC, room, laptop fan | FP rate |
| **S10 Devices** | MacBook, iPad, USB AT2020, etc. | micDevice metadata |
| **S11 Source** | Acoustic upright, digital via speakers | instrument + source tags |
| **S12 Wrong chord** | Expected CEG, played CEF | Wrong-note detection |

### Manifest extensions

```json
{
  "id": "triad-c-major-acoustic-macbook",
  "label": "chord",
  "expectedMidis": [60, 64, 67],
  "chordType": "simultaneous",
  "rollMs": null,
  "pedal": false,
  "instrument": "piano",
  "source": "acoustic",
  "micDevice": "MacBook Pro 2024",
  "noiseCondition": "clean",
  "file": "clips/...",
  "startMs": 200,
  "endMs": 2500
}
```

### Objective metrics

| Metric | Definition |
|--------|------------|
| **Chord hit rate** | Expected pitch-class set ⊆ detected (within cents tol) with all members stable ≥ N ms |
| **Chord false negative rate** | Missed chord or missing member |
| **Chord false positive rate** | Extra pitch classes on silence/noise |
| **Partial chord rate** | Subset correct before timeout |
| **Precision / recall / F1** | Per-note and per-chord (set metrics) |
| **Mean onset latency** | First stable detection − expected attack |
| **Mean release error** | Pedal/off detection |
| **Rolled chord policy** | % classified as roll vs simultaneous (configurable) |
| **CPU ms / frame** | p50, p95 on M-series Mac, iPad A14+ |
| **Memory peak** | WASM + model + buffers |
| **Thermals** | Qualitative 10-min session (manual) |

### Replay harness V2

Mirror V1: offline `pushSamples` through full V2 stack; no browser required for CI. Browser QA script replays same WAVs through fake media for integration smoke.

**Gate for production:** Chord hit rate ≥ **85%** on S3 triads (acoustic + digital), FP ≤ **5%** on S9, iPad p95 CPU &lt; **8 ms/frame** (score-informed path).

---

## Migration plan

### Phase 0 — Design lock (this sprint)

- Approve API (`MicNoteEvent`, `MicEngineV2`).
- Approve score-informed-first strategy.
- Approve benchmark manifest schema.
- Legal review: Basic Pitch Apache-2.0, Essentia AGPL avoid in bundle.

### Phase 1 — Preprocessing & infrastructure (2–3 weeks)

- New package `src/features/microphone-input/v2/` (no V1 edits except adapter flag).
- Ring buffer, overlap-add STFT, port calibration.
- Benchmark harness skeleton + 10 real WAV chord recordings.
- **Success:** Offline preprocessing matches V1 noise gate behavior; zero WFY change.

### Phase 2 — CQT + score-informed scorer (3–4 weeks)

- Implement `ScoreInformedHarmonicScorer`.
- CQT filterbank (JS or small WASM).
- Chroma template unit tests.
- **Success:** S2–S3 hit rate &gt; 70% on recorded fixtures; beats V1 chord collection on simultaneous clips.

### Phase 3 — Blind multi-pitch prototype (3–4 weeks)

- CQT peak + harmonic grouping.
- Optional pYIN-style residual iteration (MIT clean-room).
- **Success:** Blind mode works on mic test panel; S3 without `expectedMidis` &gt; 50%.

### Phase 4 — Head-to-head vs V1 (1–2 weeks)

- Run full `mic-polyphony` + existing `mic-accuracy` suites.
- Document regression on monophonic (must not drop &gt; 2% hit rate).
- iPad/Mac CPU profiles.

### Phase 5 — ML spike (optional, 2–3 weeks)

- Basic Pitch ONNX in Worker; sliding window.
- Compare S4–S5 only; drop if iPad p95 &gt; 20 ms or model &gt; 5 MB without CDN cache.

### Phase 6 — Hybrid production rollout (2–3 weeks)

- Feature flag `micEngineV2: 'off' | 'score' | 'hybrid'`.
- Adapter replaces chord collection for simultaneous mode.
- Keep V1 fallback for monophonic-only / low-tier devices.
- Browser QA + manual piano sessions.

**Total estimate:** 14–20 weeks engineering (parallel benchmark collection throughout).

---

## Risk analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| iPad CPU insufficient for blind NMF/ML | High | High | Score-informed default on mobile; ML desktop-only |
| Digital piano speaker bleed / room EQ | High | Med | Chroma + harmonic ratios; per-source calibration |
| Pedal sustain false re-triggers | Med | Med | Release tracker; energy decay; WFY already has gap logic |
| Rolled chords scored as fail | Med | Med | Policy flag: `rollToleranceMs`; pedagogy setting |
| Bass notes weak on built-in mic | High | Med | CQT bass resolution; USB mic guidance |
| Guitar harmonics confuse piano model | Med | Low | Instrument-specific templates; guitar Phase 2+ |
| Model licensing / bundle size | Med | Med | Apache-only; lazy-load ONNX |
| WFY coupling creep | Med | High | Strict adapter boundary; no WFY file edits in Phases 1–4 |
| Overfitting to benchmark fixtures | Med | Med | Diverse recordists; hold-out device set |
| User expectation: “DAW accuracy” | High | Med | Copy: “best with USB mic”; show confidence |

---

## Device tier strategy

| Tier | Detection path | Max polyphony | ML |
|------|----------------|---------------|-----|
| **Mobile / iPad** | Score-informed + light chroma | 4 | Off |
| **Desktop** | Hybrid + blind multi-pitch | 6 | Optional Basic Pitch |
| **Low power** | V1 fallback | 1 | Off |

Detect tier via `navigator.hardwareConcurrency`, `deviceMemory`, user override in Advanced.

---

## Integration with existing Corranzo (unchanged systems)

| System | Touch in V2 |
|--------|-------------|
| **Wait For You** | Adapter only; same `evaluateMicNoteInput` |
| **Score Follow** | None |
| **Playback** | None |
| **OMR** | None |
| **MIDI input** | None |
| **Diagnostics UI** | Consume richer `MicEngineFrame` (optional labels) |
| **micReplayHarness** | V2 parallel runner |

Deprecate over time: `waitForYouMicChordCollection` sequential mode when simultaneous chord hit rate meets gate.

---

## Open decisions (for product/engineering sign-off)

1. **Rolled chords:** Fail, pass with delay, or separate pedagogy mode?
2. **Minimum hardware:** Is iPad A13+ required for V2, or V1 fallback below?
3. **Simultaneous-only vs partial credit:** Already in WFY chord modes — map to mic confidence thresholds.
4. **Recording consent:** Store user WAVs for benchmark contribution (opt-in)?
5. **Guitar polyphony:** Explicitly piano-first; guitar uses V1 until Phase 7?

---

## Success criteria (sprint complete)

After this design sprint, Corranzo should have:

- [x] Compared polyphonic approaches with browser/piano constraints  
- [x] Defined V2 output contract (`notes`, `confidence`, `onset`, `release`)  
- [x] Layered architecture preserving WFY/OMR/playback  
- [x] Benchmark suite design with objective metrics  
- [x] Phased migration with gates  
- [x] Risk register and recommended path (**score-informed CQT + blind hybrid**)

**Next actionable step (Phase 1):** Record 20 real simultaneous-chord WAV fixtures (S2–S4) and land `benchmarks/mic-polyphony/manifest.json` before writing detector code.

---

## References (external)

- Spotify Basic Pitch: [https://github.com/spotify/basic-pitch](https://github.com/spotify/basic-pitch) (Apache-2.0)  
- CREPE: Kim et al., ICCP 2018  
- pYIN: Mauch & Dixon, IEEE TASLP 2014  
- Benetos et al., automatic music transcription survey  
- Meyda audio features: [https://meyda.js.org](https://meyda.js.org)  
- ONNX Runtime Web for in-browser inference  
- MIREX Multi-F0 Evaluation methodology (metrics inspiration)

---

*Document only — no runtime changes in this sprint.*
