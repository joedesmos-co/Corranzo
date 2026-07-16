# Microphone polyphony benchmarks

Offline labeled **chord** clips for measuring polyphonic mic recognition before Mic Engine V2 ships.

This harness replays audio through the **V1 monophonic** pipeline (`micReplayHarness` → autocorrelation → stabilizer) and the **V2 score-informed prototype** (`v2/micPolyphonyV2ReplayHarness`). It establishes a baseline and does **not** change live mic behavior.

## Quick start

```bash
npm run mic:generate-polyphony-clips   # optional — rebuild in-repo WAV fixtures
npm run mic:import-uiowa-fixtures      # UIowa MIS → real-timbre chord WAVs + manifest
npm run mic:polyphony-replay
```

Reports: `tmp/mic-polyphony-replay/report.json` and `report.md` (includes V1 vs V2 comparison).

Live captures (developer machine only):

```bash
CORRANZO_DEVELOPER_MODE=1 npm run mic:capture-real-fixture -- \
  --target polyphony --id macbook-piano-c-major --expected-midis 60,64,67 \
  --instrument piano --tone acoustic-piano --device macbook-mic --seconds 3
```

## Manifest fields

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable clip id |
| `label` | yes | `chord`, `silence`, or `noise` |
| `expectedMidis` | chord clips | Array of MIDI note numbers |
| `file` | file clips | Path under `benchmarks/mic-polyphony/` |
| `synthetic` | synthetic clips | See `micSyntheticChordClips.js` |
| `instrument` | recommended | `piano` or `guitar` |
| `micDevice` | optional | Mic label for breakdowns |
| `noiseCondition` | optional | e.g. `clean`, `noisy` |
| `chordType` | recommended | `simultaneous`, `rolled`, `split-register` |
| `rollMs` | optional | Stagger for rolled chords |
| `pedal` | optional | Sustain pedal held |
| `startMs` / `endMs` | optional | Trim window inside WAV |
| `expectedOnsetMs` | optional | Expected attack for latency |

Missing `file` entries are **skipped** (not scored as misses).

## Metrics

| Metric | Definition |
|--------|------------|
| Exact chord hit rate | Every expected tone matched and no wrong tones accepted |
| Required tone recall | Matched expected notes ÷ total expected notes |
| Wrong tone acceptance | Chord clips that accepted one or more unexpected tones |
| Time to confirmation | Last required-tone stable time − `expectedOnsetMs` |
| First-attempt success | Exact chord hit (no wrong tones) |
| False advances | Silence/noise detections, or chord hits with wrong tones |
| Chord hit rate | Chord clips where every `expectedMidi` has a matching stable detection |
| False positive rate | Silence/noise clips with any stable detection |
| Mean confidence | Average clarity/confidence on matched detections |
| Mean latency | Detection time minus `expectedOnsetMs` |

## Synthetic types

| `synthetic.type` | Meaning |
|------------------|---------|
| `chord-simultaneous` | All midis sound together |
| `chord-rolled` | Staggered midis (`staggerMs`) |
| `silence` | Digital silence |
| `noise` | Broadband noise |

## Do not tune yet

Chord metrics from the V1 monophonic replay are **baseline measurements only**. Do not tune `pitchDetection.js` or `noteStabilizer.js` from polyphony replay until Mic Engine V2 is integrated and compared.
