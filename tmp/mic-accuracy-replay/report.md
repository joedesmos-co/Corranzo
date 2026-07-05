# Microphone accuracy replay report

Clips: 23 measured · 0 skipped (missing files)

## Detection rates
- Hit rate: 100.0% (19/19 note clips)
- False negative rate: 0.0% (0/19)
- False positive rate: 0.0% (0/4 silence/noise clips)

## Quality (matched note clips)
- Mean clarity: 0.982
- Mean |cents error|: 7.5
- Mean stabilizer latency: -18 ms
- Mean pitch frames / clip: 39.3
- Mean unstable pitch frames / clip: 0.0

## Fixture mix
- Real-file note clips: 3 (hit rate 100.0%)
- Synthetic note clips: 16 (hit rate 100.0%)

## Tuning guidance
- Real WAV fixtures present — compare before/after when tuning constants.

## False negative causes
- none

## Breakdowns
### By register
- **bass** (5 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.996, mean |cents| 3.0, mean latency -28 ms
- **mid** (14 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.977, mean |cents| 9.2, mean latency -14 ms
### By instrument
- **guitar** (9 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.980, mean |cents| 6.5, mean latency -11 ms
- **piano** (14 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.985, mean |cents| 8.5, mean latency -23 ms
### By noise condition
- **clean** (14 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.990, mean |cents| 9.9, mean latency -14 ms
- **distorted** (1 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.996, mean |cents| 0.5, mean latency -17 ms
- **loud** (1 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.998, mean |cents| 2.7, mean latency -37 ms
- **noisy** (2 clips): hit —, false negative —, false positive 0.0%, mean clarity —, mean |cents| —, mean latency — ms
- **quiet** (5 clips): hit 100.0%, false negative 0.0%, false positive —, mean clarity 0.959, mean |cents| 4.3, mean latency -21 ms
### By source
- **file** (5 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.966, mean |cents| 27.0, mean latency 42 ms
- **synthetic** (18 clips): hit 100.0%, false negative 0.0%, false positive 0.0%, mean clarity 0.985, mean |cents| 3.9, mean latency -29 ms

## Per clip
- **synth-a4-clean** (note) → hit · detected 69 · 34 pitch frames · max clarity 1.000 · clarity 1.000 · latency -37 ms · first pitch 0 ms
- **synth-a3-harmonic** (note) → hit · detected 57 · 34 pitch frames · max clarity 1.000 · clarity 0.998 · latency -37 ms · first pitch 0 ms
- **synth-digital-piano-speaker-c4** (note) → hit · detected 60 · 40 pitch frames · max clarity 1.000 · clarity 1.000 · latency -37 ms · first pitch 0 ms
- **synth-piano-quiet-c4** (note) → hit · detected 60 · 40 pitch frames · max clarity 0.994 · clarity 0.994 · latency -37 ms · first pitch 0 ms
- **synth-piano-soft-c4** (note) → hit · detected 60 · 40 pitch frames · max clarity 0.911 · clarity 0.902 · latency -3 ms · first pitch 0 ms
- **synth-piano-loud-e4** (note) → hit · detected 64 · 40 pitch frames · max clarity 1.000 · clarity 0.998 · latency -37 ms · first pitch 0 ms
- **synth-guitar-open-e2** (note) → hit · detected 40 · 52 pitch frames · max clarity 1.000 · clarity 0.995 · latency -17 ms · first pitch 0 ms
- **synth-guitar-open-a2** (note) → hit · detected 45 · 52 pitch frames · max clarity 1.000 · clarity 0.994 · latency -33 ms · first pitch 0 ms
- **synth-guitar-fretted-c4** (note) → hit · detected 60 · 46 pitch frames · max clarity 1.000 · clarity 0.998 · latency -33 ms · first pitch 0 ms
- **synth-electric-clean-a3** (note) → hit · detected 57 · 46 pitch frames · max clarity 1.000 · clarity 0.999 · latency -33 ms · first pitch 0 ms
- **synth-electric-distorted-e2** (note) → hit · detected 40 · 46 pitch frames · max clarity 1.000 · clarity 0.996 · latency -17 ms · first pitch 0 ms
- **synth-guitar-quiet-e3** (note) → hit · detected 52 · 32 pitch frames · max clarity 1.000 · clarity 0.991 · latency -33 ms · first pitch 0 ms
- **synth-guitar-soft-e3** (note) → hit · detected 52 · 8 pitch frames · max clarity 0.966 · clarity 0.947 · latency -17 ms · first pitch 0 ms
- **synth-electric-soft-e3** (note) → hit · detected 52 · 46 pitch frames · max clarity 0.958 · clarity 0.958 · latency -17 ms · first pitch 0 ms
- **synth-piano-low-c2** (note) → hit · detected 36 · 58 pitch frames · max clarity 1.000 · clarity 0.994 · latency -37 ms · first pitch 0 ms
- **synth-piano-low-a1** (note) → hit · detected 33 · 58 pitch frames · max clarity 1.000 · clarity 1.000 · latency -37 ms · first pitch 0 ms
- **synth-silence** (silence) → correct-reject
- **synth-noise** (noise) → correct-reject
- **real-piano-c4** (note) → hit · detected 60 · 89 pitch frames · max clarity 0.984 · clarity 0.979 · latency -3 ms · first pitch 0 ms
- **real-piano-e4** (note) → hit · detected 64 · 79 pitch frames · max clarity 0.980 · clarity 0.979 · latency 30 ms · first pitch 0 ms
- **real-guitar-g3** (note) → hit · detected 55 · 63 pitch frames · max clarity 0.945 · clarity 0.940 · latency 100 ms · first pitch 17 ms
- **real-room-quiet** (silence) → correct-reject
- **real-room-noisy** (silence) → correct-reject
