# Phase 2 — deterministic low-note microphone baseline

Corpus version: 1. Signal path: production V2 score-informed detector → musical/confidence gates → attack latch → exact score matcher → checkpoint advance. Generated piano-like signals are deterministic and contain no user or copyrighted recordings.

## Configuration

- Sample rate: 44100 Hz
- Frame/window: 2048 samples (46.44 ms)
- Hop: 735 samples (16.6667 ms)
- Base fixtures: 20; amplitude/tempo variants: 2; total runs: 40

## Baseline results

- Expected score advances: 74
- Matched advances: 62
- False negatives: 12
- False positives: 0
- Passing runs: 32/40
- Median recognition latency: 82.17 ms
- Maximum measured latency: 816.44 ms

| Run | Expected | Matched | FN | FP | Median latency ms | Release/re-arm |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 01-same-low-clear-release--nominal | 2 | 2 | 0 | 0 | 83.11 | release, release |
| 01-same-low-clear-release--quiet-fast | 2 | 2 | 0 | 0 | 81.64 | release, release |
| 02-same-low-short-dip--nominal | 2 | 2 | 0 | 0 | 546.44 | energy-rise, release |
| 02-same-low-short-dip--quiet-fast | 2 | 2 | 0 | 0 | 90.57 | energy-rise, release |
| 03-same-low-over-decay--nominal | 2 | 1 | 1 | 0 | 43.11 | none |
| 03-same-low-over-decay--quiet-fast | 2 | 1 | 1 | 0 | 90.57 | none |
| 04-neighboring-low-notes--nominal | 2 | 2 | 0 | 0 | 79.77 | score-informed-transition |
| 04-neighboring-low-notes--quiet-fast | 2 | 2 | 0 | 0 | 90.57 | score-informed-transition |
| 05-low-then-octave--nominal | 2 | 1 | 1 | 0 | 43.11 | none |
| 05-low-then-octave--quiet-fast | 2 | 2 | 0 | 0 | 96.11 | energy-rise |
| 06-low-then-middle--nominal | 2 | 2 | 0 | 0 | 83.11 | energy-rise |
| 06-low-then-middle--quiet-fast | 2 | 2 | 0 | 0 | 91.11 | energy-rise |
| 07-middle-then-low--nominal | 2 | 2 | 0 | 0 | 816.44 | different-note-dominance |
| 07-middle-then-low--quiet-fast | 2 | 1 | 1 | 0 | 57.77 | different-note-dominance |
| 08-staccato-repeated-low--nominal | 3 | 3 | 0 | 0 | 83.11 | release, release, release |
| 08-staccato-repeated-low--quiet-fast | 3 | 3 | 0 | 0 | 82.17 | release, release, release |
| 09-slow-repeated-low--nominal | 2 | 2 | 0 | 0 | 83.11 | release, release |
| 09-slow-repeated-low--quiet-fast | 2 | 2 | 0 | 0 | 90.57 | release, release |
| 10-fast-repeated-low--nominal | 4 | 1 | 3 | 0 | 79.77 | none |
| 10-fast-repeated-low--quiet-fast | 4 | 1 | 3 | 0 | 41.11 | none |
| 11-weak-fundamental-strong-h2--nominal | 1 | 1 | 0 | 0 | 76.44 | none |
| 11-weak-fundamental-strong-h2--quiet-fast | 1 | 1 | 0 | 0 | 73.91 | none |
| 12-low-with-hum-noise--nominal | 1 | 1 | 0 | 0 | 86.44 | none |
| 12-low-with-hum-noise--quiet-fast | 1 | 1 | 0 | 0 | 89.51 | none |
| 13-quiet-low-note--nominal | 1 | 1 | 0 | 0 | 89.77 | none |
| 13-quiet-low-note--quiet-fast | 1 | 1 | 0 | 0 | 56.71 | release |
| 14-loud-low-compressed-clipped--nominal | 1 | 1 | 0 | 0 | 76.44 | none |
| 14-loud-low-compressed-clipped--quiet-fast | 1 | 1 | 0 | 0 | 73.91 | none |
| 15-single-sustained-low--nominal | 1 | 1 | 0 | 0 | 79.77 | none |
| 15-single-sustained-low--quiet-fast | 1 | 1 | 0 | 0 | 91.11 | none |
| 16-low-trill--nominal | 4 | 4 | 0 | 0 | 136.44 | score-informed-transition, score-informed-transition, score-informed-transition |
| 16-low-trill--quiet-fast | 4 | 4 | 0 | 0 | 213.24 | score-informed-transition, score-informed-transition, score-informed-transition |
| 17-low-chord-specific-tone--nominal | 1 | 1 | 0 | 0 | 56.44 | none |
| 17-low-chord-specific-tone--quiet-fast | 1 | 1 | 0 | 0 | 56.71 | none |
| 18-wrong-octave-harmonic--nominal | 0 | 0 | 0 | 0 | n/a | none |
| 18-wrong-octave-harmonic--quiet-fast | 0 | 0 | 0 | 0 | n/a | none |
| 19-silence-between-repeats--nominal | 2 | 2 | 0 | 0 | 89.77 | release, release |
| 19-silence-between-repeats--quiet-fast | 2 | 2 | 0 | 0 | 91.11 | release, release |
| 20-no-silence-clear-attack--nominal | 2 | 1 | 1 | 0 | 79.77 | none |
| 20-no-silence-clear-attack--quiet-fast | 2 | 1 | 1 | 0 | 41.11 | none |

## First divergence in failing runs

- 03-same-low-over-decay--nominal: awaiting-release, first observed at 279.77 ms; detected candidates [36]; gate true; confidence 0.9184; RMS 0.105487.
- 03-same-low-over-decay--quiet-fast: awaiting-release, first observed at 296.44 ms; detected candidates [36]; gate true; confidence 0.91881; RMS 0.069977.
- 05-low-then-octave--nominal: awaiting-release, first observed at 279.77 ms; detected candidates [48]; gate true; confidence 0.62359; RMS 0.084289.
- 07-middle-then-low--quiet-fast: awaiting-release, first observed at 246.44 ms; detected candidates []; gate true; confidence 0; RMS 0.061359.
- 10-fast-repeated-low--nominal: awaiting-release, first observed at 296.44 ms; detected candidates [36]; gate true; confidence 0.92335; RMS 0.208507.
- 10-fast-repeated-low--quiet-fast: awaiting-release, first observed at 229.77 ms; detected candidates [36]; gate true; confidence 0.92021; RMS 0.153235.
- 20-no-silence-clear-attack--nominal: awaiting-release, first observed at 296.44 ms; detected candidates [36]; gate true; confidence 0.92346; RMS 0.215545.
- 20-no-silence-clear-attack--quiet-fast: awaiting-release, first observed at 229.77 ms; detected candidates [36]; gate true; confidence 0.92039; RMS 0.157806.

The JSON artifact contains every expected note-on, per-frame pitch candidates, autocorrelation fundamental, strongest expected-note harmonic, confidence, RMS/gate state, attack/release timestamp, matched score event, false positive/negative count, and recognition latency.
