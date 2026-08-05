# Phase 2 — deterministic full-range microphone baseline

Baseline HEAD: `c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4`

Corpus: `extreme_mic_baseline.json` (corpus version 1). All signals are deterministic test-only piano-like synthesis; no private, physical-device, or copyrighted recordings are included.

## Coverage and execution

- Claimed piano range: MIDI 21 (A0) through MIDI 108 (C8).
- 131 fixtures and 158 played note-on events.
- Every semitone 21..108 is exercised individually, which includes chromatic coverage across the lowest and highest two octaves.
- Special cases cover soft/loud, short/staccato, sustained, repeated, neighboring, octave transitions, weak h1 with dominant h2/h3, lower room resonance, 50 Hz and 60 Hz hum, broadband noise, compression, clipping, reverberation, fast/slow passages, correct expected notes, wrong octaves, harmonically related wrong notes, sustained-note single-trigger, same-note reattack, and low/high transitions.
- Post-calibration production path: 44,100 Hz, 2,048-sample frames (46.44 ms), 735-sample hop (16.67 ms).
- Each signal is run through the blind autocorrelation detector, the production V2 expected-note scorer, the production musical/confidence gates, attack latch, exact score matcher, and separate Wait For You and Follow Along state-machine simulations.
- A valid positive match must occur causally, 0..300 ms after its intended attack. An advance before the corresponding attack is counted as both a false positive and a missed intended event; this prevents expected-score leakage from being mislabeled as success.

## Overall baseline

| Path | Expected | Matched | False negatives | False positives | Octave errors | Median latency | Maximum latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Raw autocorrelation | 158 played notes | 61 | 97 | 0 | 40 | 23.11 ms | n/a |
| Wait For You | 154 advances | 135 | 19 | 11 | 2 | 63.11 ms | 273.11 ms |
| Follow Along | 154 lane outcomes | 141 | 13 | 3 | 2 | 59.77 ms | 273.11 ms |

Raw autocorrelation is diagnostic rather than the final score matcher. Its extreme failure rate is expected from the hard 55..1,400 Hz search range, but it also means those registers lack independent contradiction evidence.

## Register-binned Wait For You baseline

| Register | Cases | Expected | Matched | FN | FP | Octave errors | Median | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Extreme low (21..32) | 37 | 52 | 43 | 9 | 10 | 1 | 56.44 ms | 108.11 ms |
| Low (33..47) | 15 | 15 | 15 | 0 | 0 | 0 | 73.11 ms | 89.77 ms |
| Middle (48..72) | 25 | 25 | 25 | 0 | 0 | 0 | 56.44 ms | 56.44 ms |
| High (73..95) | 23 | 23 | 21 | 2 | 0 | 0 | 89.77 ms | 273.11 ms |
| Extreme high (96..108) | 33 | 43 | 35 | 8 | 1 | 1 | 89.77 ms | 149.77 ms |

## Register-binned Follow Along baseline

| Register | Cases | Expected | Matched | FN | FP | Octave errors | Median | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Extreme low (21..32) | 37 | 52 | 49 | 3 | 2 | 1 | 56.44 ms | 103.11 ms |
| Low (33..47) | 15 | 15 | 15 | 0 | 0 | 0 | 73.11 ms | 89.77 ms |
| Middle (48..72) | 25 | 25 | 25 | 0 | 0 | 0 | 56.44 ms | 56.44 ms |
| High (73..95) | 23 | 23 | 21 | 2 | 0 | 0 | 89.77 ms | 273.11 ms |
| Extreme high (96..108) | 33 | 43 | 35 | 8 | 1 | 1 | 89.77 ms | 149.77 ms |

Case tags overlap for low↔high transition fixtures, so the register tables are diagnostic bins rather than values intended to be summed into the aggregate.

## Register-binned raw detector baseline

| Register | Played | Exact detections | FN | FP | Raw octave errors | Median first exact detection |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Extreme low | 54 | 3 | 51 | 0 | 3 | 53.11 ms |
| Low | 15 | 15 | 0 | 0 | 0 | 39.77 ms |
| Middle | 25 | 25 | 0 | 0 | 0 | 23.11 ms |
| High | 23 | 17 | 6 | 0 | 6 | 6.44 ms |
| Extreme high | 45 | 1 | 44 | 0 | 33 | 16.44 ms |

## First divergent stages demonstrated

| Failure group | Representative cases | First divergent stage |
| --- | --- | --- |
| Deep-bass chromatic/fast WFY sequences | `neighboring-extreme-low`, `fast-extreme-low-passage`, `very-fast-extreme-low-passage`, `slow-extreme-low-passage` | The short expected-note scorer can accept the next deep-bass target from the previous ringing spectrum before its real attack. That premature match consumes/changes the latch and causes later events to diverge at onset/rearm. Follow Along changes target from playback time, so it has fewer premature WFY advances but still loses fast events at the latch. |
| Low wrong octave | `wrong-octave-for-a0` | Candidate/harmonic-family octave disambiguation. A1 supplies A0 h2/h4/h6, the score-informed detector selects expected A0, and the independent tracker is deliberately ignored because A0 is below 55 Hz. Both modes falsely accept the wrong octave. |
| High ordinary individual notes | MIDI 78 and MIDI 89 | MIDI 78 produces intermittent/conflicting candidate confirmation; MIDI 89 is contradicted by an unstable boundary autocorrelation estimate. These begin in temporal confirmation and octave/subharmonic disambiguation, not exact score matching. |
| High weak fundamental / compressed spectrum | `high-weak-fundamental`, `compressed-extreme-high` | Harmonic/fundamental selection. V2 can hear the expected family, but non-bass musical acceptance rejects frames whose h2/h3 is stronger than h1. |
| Repeated/fast high notes | `repeated-extreme-high`, `fast-extreme-high-passage` | Attack/rearm. High repeats have no register-specific guarded transient rearm and depend on a full release or broad 1.6x RMS rise; five of six fast high attacks are missed. |
| High wrong lower octave | `wrong-octave-for-c8` | Candidate/harmonic-family octave disambiguation. C7 h2 is scored as expected C8 h1, blind autocorrelation is outside its upper band, and both modes falsely accept C8. |

## Safety controls

- Silence/broadband-noise controls produce zero stable raw false positives and zero score advances.
- A pure 60 Hz hum does not advance A0.
- Sustained A0 and C8 each advance only once; no sustained-note duplicate trigger appears.
- Exact low, middle, and ordinary high controls stay octave-specific in the score matcher.
- Wait For You and Follow Along run the same detector/matcher code, but their target timing exposes different deep-bass state behavior at baseline. This difference is measured rather than hidden in an aggregate.

The JSON artifact records every expected and played note-on, raw frequency/MIDI estimate, expected-note harmonic magnitudes and strongest partial, selected MIDI, confidence, gate/noise state, attack/rearm event, match result, advancement action, latency, false positive, false negative, and octave-error flag.
