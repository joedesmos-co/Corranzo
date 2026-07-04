# Microphone accuracy replay report

Clips: 18 measured · 0 skipped (missing files)

## Detection rates
- Hit rate: 100.0% (14/14 note clips)
- False negative rate: 0.0% (0/14)
- False positive rate: 0.0% (0/4 silence/noise clips)

## Quality (matched note clips)
- Mean clarity: 0.990
- Mean |cents error|: 8.8
- Mean stabilizer latency: -16 ms
- Mean pitch frames / clip: 38.5
- Mean unstable pitch frames / clip: 0.0

## Fixture mix
- Real-file note clips: 3 (hit rate 100.0%)
- Synthetic note clips: 11 (hit rate 100.0%)

## Tuning guidance
- Real WAV fixtures present — compare before/after when tuning constants.

## False negative causes
- none

## Breakdowns
### By register
- **bass** (3 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.995, mean |cents| 3.0, mean latency -22 ms
- **mid** (11 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.989, mean |cents| 10.5, mean latency -14 ms
### By instrument
- **guitar** (7 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.988, mean |cents| 7.3, mean latency -10 ms
- **piano** (11 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.993, mean |cents| 10.4, mean latency -22 ms
### By noise condition
- **clean** (12 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.988, mean |cents| 11.2, mean latency -10 ms
- **distorted** (1 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.996, mean |cents| 0.5, mean latency -17 ms
- **loud** (1 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.998, mean |cents| 2.7, mean latency -37 ms
- **noisy** (2 clips): hit —, false negative —, false positive 0.0%, mean clarity —, mean |cents| —, mean latency — ms
- **quiet** (2 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.993, mean |cents| 4.3, mean latency -35 ms
### By source
- **file** (5 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.966, mean |cents| 27.0, mean latency 42 ms
- **synthetic** (13 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.997, mean |cents| 3.9, mean latency -32 ms

## Per clip
- **synth-a4-clean** (note) → hit · detected 69 · 34 pitch frames · max clarity 1.000 · clarity 1.000 · latency -37 ms · first pitch 0 ms
- **synth-a3-harmonic** (note) → hit · detected 57 · 34 pitch frames · max clarity 1.000 · clarity 0.998 · latency -37 ms · first pitch 0 ms
- **synth-digital-piano-speaker-c4** (note) → hit · detected 60 · 40 pitch frames · max clarity 1.000 · clarity 1.000 · latency -37 ms · first pitch 0 ms
- **synth-piano-quiet-c4** (note) → hit · detected 60 · 40 pitch frames · max clarity 0.994 · clarity 0.994 · latency -37 ms · first pitch 0 ms
- **synth-piano-loud-e4** (note) → hit · detected 64 · 40 pitch frames · max clarity 1.000 · clarity 0.998 · latency -37 ms · first pitch 0 ms
- **synth-guitar-open-e2** (note) → hit · detected 40 · 52 pitch frames · max clarity 1.000 · clarity 0.995 · latency -17 ms · first pitch 0 ms
- **synth-guitar-open-a2** (note) → hit · detected 45 · 52 pitch frames · max clarity 1.000 · clarity 0.994 · latency -33 ms · first pitch 0 ms
- **synth-guitar-fretted-c4** (note) → hit · detected 60 · 46 pitch frames · max clarity 1.000 · clarity 0.998 · latency -33 ms · first pitch 0 ms
- **synth-electric-clean-a3** (note) → hit · detected 57 · 46 pitch frames · max clarity 1.000 · clarity 0.999 · latency -33 ms · first pitch 0 ms
- **synth-electric-distorted-e2** (note) → hit · detected 40 · 46 pitch frames · max clarity 1.000 · clarity 0.996 · latency -17 ms · first pitch 0 ms
- **synth-guitar-quiet-e3** (note) → hit · detected 52 · 32 pitch frames · max clarity 1.000 · clarity 0.991 · latency -33 ms · first pitch 0 ms
- **synth-silence** (silence) → correct-reject
- **synth-noise** (noise) → correct-reject
- **real-piano-c4** (note) → hit · detected 60 · 89 pitch frames · max clarity 0.984 · clarity 0.979 · latency -3 ms · first pitch 0 ms
- **real-piano-e4** (note) → hit · detected 64 · 79 pitch frames · max clarity 0.980 · clarity 0.979 · latency 30 ms · first pitch 0 ms
- **real-guitar-g3** (note) → hit · detected 55 · 63 pitch frames · max clarity 0.945 · clarity 0.940 · latency 100 ms · first pitch 17 ms
- **real-room-quiet** (silence) → correct-reject
- **real-room-noisy** (silence) → correct-reject
