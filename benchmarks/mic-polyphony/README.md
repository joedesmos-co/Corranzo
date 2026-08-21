# Microphone polyphony benchmarks

Offline labeled **chord** clips for measuring polyphonic mic recognition.

The baseline harness replays audio through V1 and V2. `mic:v3-replay` then sends V2 spectral frames through the production V3 expectation, timing, and instrument decision layers.

## Quick start

```bash
npm run mic:generate-polyphony-clips   # optional — rebuild in-repo WAV fixtures
npm run mic:import-uiowa-fixtures      # UIowa MIS → real-timbre chord WAVs + manifest
npm run mic:polyphony-replay
npm run mic:v3-replay
```

Reports: `tmp/mic-polyphony-replay/report.json` and `report.md` (includes V1 vs V2 comparison).

Live captures (developer machine only):

```bash
CORRANZO_DEVELOPER_MODE=1 npm run mic:capture-real-fixture -- \
  --target polyphony --id macbook-piano-c-major --expected-midis 60,64,67 \
  --instrument piano --tone acoustic-piano --device macbook-mic --seconds 3 \
  --performance-onset-ms 500
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
| `performanceOnsetMs` | V3 metrics | Attack onset in the trimmed clip; measured against FFT-window completion |
| `provenance` | recommended | Fixture class and whether this is an uninterrupted natural performance |

The external `provenance.json` classifies every shipped clip. A real-instrument
sample used to construct a chord is `isolated-sample-composite`, not a natural
performance. The legacy `real-*` generated placeholders are called out explicitly.

Imported WAVs must provide `--fixture-class` and `--natural-performance true|false`.
Live developer microphone captures are marked natural performances and retain their
capture device and onset annotation.

Missing `file` entries are **skipped** (not scored as misses).

## Metrics

| Metric | Definition |
|--------|------------|
| Exact chord hit rate | Every expected tone matched and no wrong tones accepted |
| Required tone recall | Matched expected notes ÷ total expected notes |
| Wrong tone acceptance | Chord clips that accepted one or more unexpected tones |
| Time to confirmation | V3 decision availability (FFT window end) − `performanceOnsetMs` |
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

## Sequence corpus

`../mic-performance-sequences/manifest.json` covers staggered double-stops,
six-string quorum, rolled piano chords, ringing transitions, repeated attacks,
wrong chords, and non-musical input. These are deterministic IR scenarios and
are never reported as recordings.

## Tuning policy

V1/V2 metrics remain historical baselines. V3 changes must preserve the control
and real-timbre gates; benchmark gains never justify weakening speech/noise rejection.
