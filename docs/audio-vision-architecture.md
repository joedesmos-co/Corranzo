# Corranzo Audio Vision — A0 Architecture & Feasibility (audio-to-solo-arrangement)

Base: `69d22d2e9b` (committed snapshot of `codex/unified-practice-audio-preview`, no uncommitted tmp/ work used).
Worktree: `/Users/ryland/Documents/scoreflow-audio-vision`, branch `codex/audio-to-solo-arrangement`.

## 1. What Corranzo already provides (reused, not reinvented)

| Need | Existing module | Reuse plan |
|---|---|---|
| Score truth | `features/score/activeScore.js` | Arranged MusicXML enters via `createMusicXmlSource` + `withActiveScoreMusicXml`; same practice path as OMR/uploads |
| MusicXML parse/timing | `features/musicxml/parseMusicXml.js`, `timingMapCache.js`, `performedTimeline.js` | Validation: parse our own output, assert note/measure/tempo counts |
| MusicXML emission pattern | `features/omr/buildOmrMusicXml.js` (+ `technicalXml` string/fret, divisions, beams, ties) | `arrangementMusicXml.js` follows same schema subset (no competing engine) |
| Guitar geometry | `features/instruments/fretboard.js` (`candidatePositionsForMidi`, `deriveTabPositions`, span ≤ 4, hand continuity) + `instruments.js` tuning E2–E6, fretCount 19 | Solo-guitar string/fret assignment delegates here |
| Playback/practice | `features/playback/scorePlaybackEngine.js`, `midiPlaybackEngine.js`, score-follow, WFY | Audio arrangements open as normal scores; no parallel player |
| Neural transcription | `@spotify/basic-pitch` (already in `package.json`, vendored weights `public/neural-model/`, lazy `micNeuralTfAdapter.js`) | Primary polyphonic pitch estimator for A2; spectral fallback when unavailable |
| Import validation pattern | `features/import/fileImportLimits.js`, `formatImportError.js` | Audio import mirrors caps + typed errors |

No MusicXML competitor, no new player, no new score store.

## 2. Model research (evidence, not assumption)

### Basic Pitch (Spotify, ICASSP-2022) — ADOPTED as primary pitch estimator
- Capability: polyphonic note events (onset 0.5 / frame 0.3 thresholds, 5-frame min) from mono 22050 Hz; proven in-repo on mic stream (`micNeuralTfAdapter.js`, `useNeuralMicInput.js`).
- License: code Apache-2.0; weights distributed inside the npm package under Apache-2.0 (vendored into `public/neural-model/`, served locally). No separate weight EULA found in package; attribution retained in NOTICE-adjacent comment. Commercial redistribution = same as current mic feature (already shipped) — no new rights introduced.
- Size/speed: model.json + 1 shard, few MB; 0.5 s window infers in < 750 ms budget on M-series (capability probe `checkNeuralCapability`, warmup-gated with spectral fallback). Apple Silicon: TF.js WebGL/WASM, works offline after first load.
- Limitation (verified by design): trained mostly on solo/ensemble pitched audio; **full band mixes degrade** (drums/vox confuse frames). Hence A3 separation + A4 arrangement, and A12 refusal — Basic Pitch alone is NOT claimed sufficient for mixes.

### Source separation
- Heavy neural separators (Demucs/HT-Demucs, Open-Unmix) investigated and REJECTED for V1 on-device: 30–150 MB+ weights, 16 GB shared RAM with sibling agents, multi-minute CPU inference on full songs, extra license/attribution surface. Documented as future optional backend (A13).
- V1 adopts **classical DSP separation**: STFT → magnitude HPSS (median-filter harmonic/percussive masks) + vocal-presence band energy + bass low-pass chroma. Zero downloads, < 50 MB RAM, deterministic, testable. It does not isolate stems; it produces *analysis-weighted views* (harmonic view, percussive view, bass view, presence view) that improve downstream pitch/chord/melody extraction. A3 measures whether each view helps and records it.

### Tempo/beat/chord
- Tempo: onset-envelope autocorrelation + comb filter over 60–200 BPM, octave-error correction; variable tempo via dynamic beat tracking window (sectional re-estimate), not fixed-BPM assumption.
- Chords: time-averaged chroma vs major/minor templates with bass-root disambiguation; reported with confidence, never as detected notes.
- Melody: salience-weighted highest stable contour in presence view; bass: lowest stable pitch in bass view.

## 3. Recommended architecture (built in this branch)

```
audio file → A1 audioImport (validate/decode/mono/22k/normalize, caps)
  → views: mix + HPSS harmonic/percussive + bass/presence (A3, DSP only)
  → A2 musicAnalysis (tempo/beats/onsets/chroma/chords/melody/bass/sections,
     every item tagged detected|predicted|inferred — never inferred-as-detected)
  → Basic Pitch note events (predicted) mapped onto beats (A2)
  → TranscribedContent (what the recording appears to contain)
  → A4 arrangementModel (parts[] future-proof; V1 fills ONE part: solo-piano| solo-guitar)
       → texture select → conflict resolve → difficulty simplify → playability gate
  → A8 arrangementMusicXml (grand staff piano / treble+technical guitar TAB)
  → createMusicXmlSource → activeScore → Score Preview / Playback / WFY / Play-Along
  → confidence report or honest refusal (A12)
```

Provenance vocabulary enforced in types: `detected` (DSP evidence), `predicted` (model output),
`inferred` (musical inference from evidence), `arranged` (human-playable decision).

## 4. Resource & licensing posture (A13/A14)

- Dev Mac M4/16 GB shared: no giant-model downloads, no training, no sweeps; single Basic Pitch instance shared and disposed; temp buffers released; eval uses short excerpts + synthesized fixtures (original, no copyrighted audio scraped, no redistribution feature).
- No mandatory paid API. Offline/on-device is the V1 path; a heavier backend remains an optional future.
- Eval audio: synthesized originals + public-domain-style simples only. No copyrighted songs, no dataset scraping.
