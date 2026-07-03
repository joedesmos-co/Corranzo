# Microphone accuracy replay report

Clips: 9 measured · 0 skipped (missing files)

## Detection rates
- Hit rate: 80.0% (4/5 note clips)
- False negative rate: 20.0% (1/5)
- False positive rate: 0.0% (0/4 silence/noise clips)

## Quality (matched note clips)
- Mean clarity: 0.974
- Mean |cents error|: 21.4
- Mean stabilizer latency: 56 ms
- Mean pitch frames / clip: 12.8
- Mean unstable pitch frames / clip: 0.0

## Fixture mix
- Real-file note clips: 3 (hit rate 100.0%)
- Synthetic note clips: 2 (hit rate 50.0%)

## Tuning guidance
- Real WAV fixtures present — compare before/after when tuning constants.

## Breakdowns
### By register
- **mid** (5 clips): hit 80.0%, false negative 20.0%, false positive —, mean clarity 0.974, mean |cents| 21.4, mean latency 56 ms
### By instrument
- **guitar** (1 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.943, mean |cents| 31.1, mean latency 133 ms
- **piano** (8 clips): hit 75.0%, false negative 25.0%, false positive 0.0%, mean clarity 0.984, mean |cents| 18.2, mean latency 30 ms
### By noise condition
- **clean** (7 clips): hit 80.0%, false negative 20.0%, false positive 0.0%, mean clarity 0.974, mean |cents| 21.4, mean latency 56 ms
- **noisy** (2 clips): hit —, false negative —, false positive 0.0%, mean clarity —, mean |cents| —, mean latency — ms
### By source
- **file** (5 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.966, mean |cents| 27.0, mean latency 87 ms
- **synthetic** (4 clips): hit 50.0%, false negative 50.0%, false positive 0.0%, mean clarity 0.998, mean |cents| 4.7, mean latency -37 ms

## Per clip
- **synth-a4-clean** (note) → miss · wrong 35 · 34 pitch frames · max clarity 1.000 · first pitch 17 ms
- **synth-a3-harmonic** (note) → hit · detected 57 · 34 pitch frames · max clarity 1.000 · clarity 0.998 · latency -37 ms · first pitch 0 ms
- **synth-silence** (silence) → correct-reject
- **synth-noise** (noise) → correct-reject
- **real-piano-c4** (note) → hit · detected 60 · 13 pitch frames · max clarity 0.981 · clarity 0.977 · latency 63 ms · first pitch 67 ms
- **real-piano-e4** (note) → hit · detected 64 · 11 pitch frames · max clarity 0.980 · clarity 0.978 · latency 63 ms · first pitch 67 ms
- **real-guitar-g3** (note) → hit · detected 55 · 23 pitch frames · max clarity 0.944 · clarity 0.943 · latency 133 ms · first pitch 17 ms
- **real-room-quiet** (silence) → correct-reject
- **real-room-noisy** (silence) → correct-reject
