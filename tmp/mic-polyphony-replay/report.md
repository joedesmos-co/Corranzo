# Microphone polyphony — V1 vs V2 comparison

**Verdict:** v2-improves

Score-informed harmonic scoring improves chord detection on offline fixtures.

## Headline metrics

| Metric | V1 monophonic | V2 score-informed | Δ |
|--------|--------------:|------------------:|--:|
| Chord hit rate | 0.0% | 100.0% | 100.0 pp |
| Per-note hit rate | 0.0% | 100.0% | 100.0 pp |
| False positive rate | 0.0% | 0.0% | 0.0 pp |
| Missed notes | 17 | 0 | — |
| False positive notes | 5 | 0 | — |
| Mean confidence | — | 0.501 | — |

## V2 Phase 2 → Phase 2B

**Improved:** yes

| Metric | Phase 2 | Phase 2B | Δ |
|--------|--------:|---------:|--:|
| Chord hit rate | 50.0% | 100.0% | 50.0 pp |
| Per-note hit rate | 70.6% | 100.0% | 29.4 pp |
| False positive rate | 0.0% | 0.0% | 0.0 pp |
| Missed notes | 5 | 0 | -5 |

## V1 baseline

# Microphone polyphony replay report

Engine: **v1-monophonic-baseline** (baseline — not Mic Engine V2)
Clips: 9 measured · 0 skipped

## Chord detection rates
- Chord hit rate: 0.0% (0/6 chord clips)
- Per-note hit rate: 0.0% (0 full chords; 17 missed notes total)
- Partial chords: 0
- False positive rate (silence/noise): 0.0%
- False positive notes (on chord clips): 5

## Quality
- Mean confidence (matched): —
- Mean latency: — ms

## Tuning guidance
- Polyphony replay uses the V1 monophonic pipeline as a baseline — do not tune constants from chord metrics until Mic Engine V2 is integrated.

## Breakdowns
### By chord shape
- **dyad** (2 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **rolled** (1 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **simultaneous-4plus** (1 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **triad** (2 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
### By chord type
- **rolled** (1 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **simultaneous** (5 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
### By instrument
- **piano** (9 clips): chord hit 0.0%, per-note 0.0%, false positive 0.0%, confidence —, latency — ms
### By noise condition
- **clean** (8 clips): chord hit 0.0%, per-note 0.0%, false positive 0.0%, confidence —, latency — ms
- **noisy** (1 clips): chord hit —, per-note —, false positive 0.0%, confidence —, latency — ms
### By source
- **file** (3 clips): chord hit 0.0%, per-note 0.0%, false positive 0.0%, confidence —, latency — ms
- **synthetic** (6 clips): chord hit 0.0%, per-note 0.0%, false positive 0.0%, confidence —, latency — ms

## Bass register
- Bass notes expected: 2
- Bass notes matched: 0
- Bass notes missed: 2
- Bass hit rate: 0.0%

## Per clip
- **synth-dyad-c4-e4** (chord) → miss · expected [60, 64] · missed [60, 64] · extra [36]
- **synth-c-major-triad** (chord) → miss · expected [60, 64, 67] · missed [60, 64, 67] · extra [36]
- **synth-g7-tetrad** (chord) → miss · expected [55, 59, 62, 65] · missed [55, 59, 62, 65]
- **synth-rolled-c-major** (chord) → miss · expected [60, 64, 67] · missed [60, 64, 67] · extra [36]
- **synth-silence** (silence) → correct-reject
- **synth-noise** (noise) → correct-reject
- **real-c-major-triad** (chord) → miss · expected [60, 64, 67] · missed [60, 64, 67] · extra [36]
- **real-dyad-c4-g4** (chord) → miss · expected [60, 67] · missed [60, 67] · extra [48]
- **real-room-quiet** (silence) → correct-reject

## V2 score-informed prototype

# Microphone polyphony replay report

Engine: **v2-score-informed-phase-2b** (baseline — not Mic Engine V2)
Clips: 9 measured · 0 skipped

## Chord detection rates
- Chord hit rate: 100.0% (6/6 chord clips)
- Per-note hit rate: 100.0% (6 full chords; 0 missed notes total)
- Partial chords: 0
- False positive rate (silence/noise): 0.0%
- False positive notes (on chord clips): 0

## Quality
- Mean confidence (matched): 0.501
- Mean latency: -120 ms

## Tuning guidance
- V2 score-informed prototype — offline only; do not promote to live mic until browser QA and WFY adapter land.

## Breakdowns
### By chord shape
- **dyad** (2 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.534, latency -120 ms
- **rolled** (1 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.552, latency -120 ms
- **simultaneous-4plus** (1 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.502, latency -120 ms
- **triad** (2 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.442, latency -120 ms
### By chord type
- **rolled** (1 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.552, latency -120 ms
- **simultaneous** (5 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.491, latency -120 ms
### By instrument
- **piano** (9 clips): chord hit 100.0%, per-note 100.0%, false positive 0.0%, confidence 0.501, latency -120 ms
### By noise condition
- **clean** (8 clips): chord hit 100.0%, per-note 100.0%, false positive 0.0%, confidence 0.501, latency -120 ms
- **noisy** (1 clips): chord hit —, per-note —, false positive 0.0%, confidence —, latency — ms
### By source
- **file** (3 clips): chord hit 100.0%, per-note 100.0%, false positive 0.0%, confidence 0.491, latency -120 ms
- **synthetic** (6 clips): chord hit 100.0%, per-note 100.0%, false positive 0.0%, confidence 0.506, latency -120 ms

## Bass register
- Bass notes expected: 2
- Bass notes matched: 2
- Bass notes missed: 0
- Bass hit rate: 100.0%

## Per clip
- **synth-dyad-c4-e4** (chord) → chord-hit · expected [60, 64] · matched [60, 64] · confidence 0.526 · latency -120 ms
- **synth-c-major-triad** (chord) → chord-hit · expected [60, 64, 67] · matched [60, 64, 67] · confidence 0.443 · latency -120 ms
- **synth-g7-tetrad** (chord) → chord-hit · expected [55, 59, 62, 65] · matched [55, 59, 62, 65] · confidence 0.502 · latency -120 ms
- **synth-rolled-c-major** (chord) → chord-hit · expected [60, 64, 67] · matched [60, 64, 67] · confidence 0.552 · latency -120 ms
- **synth-silence** (silence) → correct-reject
- **synth-noise** (noise) → correct-reject
- **real-c-major-triad** (chord) → chord-hit · expected [60, 64, 67] · matched [60, 64, 67] · confidence 0.441 · latency -120 ms
- **real-dyad-c4-g4** (chord) → chord-hit · expected [60, 67] · matched [60, 67] · confidence 0.541 · latency -120 ms
- **real-room-quiet** (silence) → correct-reject
