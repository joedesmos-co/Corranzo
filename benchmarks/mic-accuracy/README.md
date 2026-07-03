# Microphone accuracy fixtures

Offline labeled clips for measuring Wait For You **pitch detection** before tuning constants.

This folder does **not** change the live mic algorithm or Wait For You matching — it replays audio through the same `analyzeMicFrame` → `noteStabilizer` pipeline used in the app.

## Quick start

```bash
npm run mic:generate-clips   # (re)build in-repo WAV fixtures under clips/
npm run mic:accuracy-replay
```

Reports are written to `tmp/mic-accuracy-replay/report.json` and `report.md`.

In-repo fixtures under `clips/` are deterministic piano/guitar/room tones for CI. Replace them with **live mic captures** when you can — update `micDevice` and notes in the manifest.

## Add a real recording

1. Record a short clip (0.5–2 s) with your practice mic setup:
   - **Note clip:** one clear note, minimal pedal/reverb.
   - **Silence clip:** quiet room, no playing.
   - **Noise clip:** optional HVAC / room noise sample.

2. Export **mono or stereo WAV**, PCM **16-bit**, 44.1 kHz preferred.

3. Save under `benchmarks/mic-accuracy/clips/`, e.g. `clips/my-guitar-g3.wav`.

4. Add an entry to `manifest.json`:

```json
{
  "id": "my-guitar-g3",
  "label": "note",
  "expectedMidi": 55,
  "file": "clips/my-guitar-g3.wav",
  "instrument": "guitar",
  "micDevice": "MacBook Pro mic",
  "noiseCondition": "clean",
  "startMs": 120,
  "endMs": 1800,
  "expectedOnsetMs": 150,
  "notes": "Steel-string G3, 15 cm from mic"
}
```

### Manifest fields

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable clip id for reports |
| `label` | yes | `note`, `silence`, or `noise` |
| `expectedMidi` | note clips | Target MIDI note (null for silence/noise) |
| `file` | file clips | Path under `benchmarks/mic-accuracy/` |
| `synthetic` | synthetic clips | In-memory tone spec (see below) |
| `instrument` | recommended | `piano` or `guitar` |
| `micDevice` | optional | Mic label for breakdowns |
| `noiseCondition` | optional | e.g. `clean`, `noisy`, `room` |
| `startMs` / `endMs` | optional | Trim window inside the WAV |
| `expectedOnsetMs` | optional | Expected note onset for latency |

Missing `file` entries are **skipped** in replay (not scored as misses).

### Label values

| `label`   | Meaning |
|-----------|---------|
| `note`    | Expect a stable detection matching `expectedMidi` |
| `silence` | Expect **no** stable detection |
| `noise`   | Expect **no** stable detection (unstable broadband) |

### Metrics reported

| Metric | Definition |
|--------|------------|
| Hit rate | Note clips with a matching stable detection |
| False negative rate | Note clips with no matching detection |
| False positive rate | Silence/noise clips with any stable detection |
| Mean clarity | Average clarity on matched detections |
| Mean \|cents error\| | Average absolute cents offset on matches |
| Mean latency | Stable detection time minus `expectedOnsetMs` (or first pitch frame) |
| Unstable pitch frames | Frames with pitch but clarity below stabilizer-friendly range |
| By register | Bass (&lt; C3), mid, treble breakdown |
| By instrument / noise | Grouped hit rates when manifest metadata is present |

## Synthetic placeholders

Entries with a `"synthetic"` block ship in-repo for CI and regression. They exercise the replay harness end-to-end but are **not** the primary source for tuning — use the `clips/real-*.wav` fixtures (or your own recordings).

## Tuning workflow

1. Add or regenerate real WAV clips (`npm run mic:generate-clips` or record your own).
2. Run `npm run mic:accuracy-replay` and inspect hit rate, false positives, clarity, and latency.
3. Tune `pitchDetection.js`, `noteStabilizer.js`, or gate thresholds only when real-file metrics justify a change.
4. Re-run replay and `npm test` before merging.
