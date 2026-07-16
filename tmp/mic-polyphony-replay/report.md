# Microphone polyphony — V1 vs V2 comparison

**Verdict:** v2-improves

Score-informed harmonic scoring improves chord detection on offline fixtures.

## Headline metrics

| Metric | V1 monophonic | V2 score-informed | Δ |
|--------|--------------:|------------------:|--:|
| Chord hit rate | 0.0% | 94.4% | 94.4 pp |
| Per-note hit rate | 5.5% | 98.2% | 92.7 pp |
| False positive rate | 0.0% | 0.0% | 0.0 pp |
| Missed notes | 52 | 1 | — |
| False positive notes | 13 | 0 | — |
| Mean confidence | 0.786 | 0.540 | — |

## V2 Phase 2 → Phase 2B

**Improved:** yes

| Metric | Phase 2 | Phase 2B | Δ |
|--------|--------:|---------:|--:|
| Chord hit rate | 50.0% | 94.4% | 44.4 pp |
| Per-note hit rate | 70.6% | 98.2% | 27.6 pp |
| False positive rate | 0.0% | 0.0% | 0.0 pp |
| Missed notes | 5 | 1 | -4 |

## V1 baseline

# Microphone polyphony replay report

Engine: **v1-monophonic-baseline** (baseline — not Mic Engine V2)
Clips: 21 measured · 0 skipped

## Chord detection rates
- Exact chord hit rate: 0.0% (0/18 chord clips)
- Chord hit rate: 0.0% (0/18 chord clips)
- Required tone recall: 5.5% (52 missed notes total)
- Wrong tone acceptance: 72.2%
- First-attempt success: 0.0%
- Time to confirmation (mean): — ms
- False advances: 0 (0.0%)
- Partial chords: 3
- False positive rate (silence/noise): 0.0%
- False positive notes (on chord clips): 13

## Quality
- Mean confidence (matched): 0.786
- Mean latency: 208 ms

## Tuning guidance
- Polyphony replay uses the V1 monophonic pipeline as a baseline — do not tune constants from chord metrics until Mic Engine V2 is integrated.

## Breakdowns
### By chord shape
- **dyad** (7 clips): chord hit 0.0%, per-note 14.3%, false positive —, confidence 0.744, latency 272 ms
- **rolled** (2 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **simultaneous-4plus** (3 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **triad** (6 clips): chord hit 0.0%, per-note 5.6%, false positive —, confidence 0.870, latency 80 ms
### By chord type
- **rolled** (2 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **simultaneous** (14 clips): chord hit 0.0%, per-note 2.4%, false positive —, confidence 0.512, latency 430 ms
- **split-register** (2 clips): chord hit 0.0%, per-note 40.0%, false positive —, confidence 0.923, latency 97 ms
### By instrument
- **guitar** (6 clips): chord hit 0.0%, per-note 10.0%, false positive —, confidence 0.744, latency 272 ms
- **piano** (15 clips): chord hit 0.0%, per-note 2.9%, false positive 0.0%, confidence 0.870, latency 80 ms
### By noise condition
- **clean** (19 clips): chord hit 0.0%, per-note 5.7%, false positive 0.0%, confidence 0.786, latency 208 ms
- **distorted** (1 clips): chord hit 0.0%, per-note 0.0%, false positive —, confidence —, latency — ms
- **noisy** (1 clips): chord hit —, per-note —, false positive 0.0%, confidence —, latency — ms
### By source
- **file** (12 clips): chord hit 0.0%, per-note 9.1%, false positive 0.0%, confidence 0.786, latency 208 ms
- **synthetic** (9 clips): chord hit 0.0%, per-note 0.0%, false positive 0.0%, confidence —, latency — ms

## Bass register
- Bass notes expected: 20
- Bass notes matched: 2
- Bass notes missed: 18
- Bass hit rate: 10.0%

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
- **uiowa-piano-mf-c4-e4-dyad** (chord) → miss · expected [60, 64] · missed [60, 64] · extra [36]
- **uiowa-piano-mf-c-major-triad** (chord) → miss · expected [60, 64, 67] · missed [60, 64, 67] · extra [48]
- **uiowa-piano-mf-cmaj7** (chord) → miss · expected [60, 64, 67, 71] · missed [60, 64, 67, 71] · extra [48]
- **uiowa-piano-mf-ringing-c-major** (chord) → miss · expected [60, 64, 67] · missed [60, 64, 67] · extra [48]
- **uiowa-piano-pp-c-major-triad** (chord) → miss · expected [60, 64, 67] · missed [60, 64, 67] · extra [36]
- **uiowa-piano-mf-split-c3-e4-g4** (chord) → partial · expected [48, 64, 67] · matched [48] · missed [64, 67] · confidence 0.870 · latency 80 ms
- **uiowa-guitar-mf-adjacent-g3-b3** (chord) → partial · expected [55, 59] · matched [55] · missed [59] · confidence 0.512 · latency 430 ms
- **uiowa-guitar-mf-low-high-e2-e4** (chord) → partial · expected [40, 64] · matched [64] · missed [40] · confidence 0.975 · latency 113 ms
- **uiowa-guitar-mf-open-em-strum** (chord) → miss · expected [40, 45, 50, 55, 59, 64] · missed [40, 45, 50, 55, 59, 64]
- **synth-electric-clean-dyad-a2-e3** (chord) → miss · expected [45, 52] · missed [45, 52] · extra [33]
- **synth-electric-distorted-power-e2-b2** (chord) → miss · expected [40, 47] · missed [40, 47] · extra [89]
- **synth-electric-clean-open-em** (chord) → miss · expected [40, 45, 50, 55, 59, 64] · missed [40, 45, 50, 55, 59, 64] · extra [89]

## V2 score-informed prototype

# Microphone polyphony replay report

Engine: **v2-score-informed-phase-2b** (baseline — not Mic Engine V2)
Clips: 21 measured · 0 skipped

## Chord detection rates
- Exact chord hit rate: 94.4% (17/18 chord clips)
- Chord hit rate: 94.4% (17/18 chord clips)
- Required tone recall: 98.2% (1 missed notes total)
- Wrong tone acceptance: 0.0%
- First-attempt success: 94.4%
- Time to confirmation (mean): -120 ms
- False advances: 0 (0.0%)
- Partial chords: 1
- False positive rate (silence/noise): 0.0%
- False positive notes (on chord clips): 0

## Quality
- Mean confidence (matched): 0.540
- Mean latency: -120 ms

## Tuning guidance
- V2 score-informed prototype — offline only; do not promote to live mic until browser QA and WFY adapter land.

## Breakdowns
### By chord shape
- **dyad** (7 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.628, latency -120 ms
- **rolled** (2 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.531, latency -120 ms
- **simultaneous-4plus** (3 clips): chord hit 66.7%, per-note 92.9%, false positive —, confidence 0.571, latency -120 ms
- **triad** (6 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.424, latency -120 ms
### By chord type
- **rolled** (2 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.531, latency -120 ms
- **simultaneous** (14 clips): chord hit 92.9%, per-note 97.6%, false positive —, confidence 0.550, latency -120 ms
- **split-register** (2 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.473, latency -120 ms
### By instrument
- **guitar** (6 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.671, latency -120 ms
- **piano** (15 clips): chord hit 91.7%, per-note 97.1%, false positive 0.0%, confidence 0.474, latency -120 ms
### By noise condition
- **clean** (19 clips): chord hit 94.1%, per-note 98.1%, false positive 0.0%, confidence 0.524, latency -120 ms
- **distorted** (1 clips): chord hit 100.0%, per-note 100.0%, false positive —, confidence 0.810, latency -120 ms
- **noisy** (1 clips): chord hit —, per-note —, false positive 0.0%, confidence —, latency — ms
### By source
- **file** (12 clips): chord hit 90.9%, per-note 97.0%, false positive 0.0%, confidence 0.496, latency -120 ms
- **synthetic** (9 clips): chord hit 100.0%, per-note 100.0%, false positive 0.0%, confidence 0.609, latency -120 ms

## Bass register
- Bass notes expected: 20
- Bass notes matched: 20
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
- **uiowa-piano-mf-c4-e4-dyad** (chord) → chord-hit · expected [60, 64] · matched [60, 64] · confidence 0.449 · latency -120 ms
- **uiowa-piano-mf-c-major-triad** (chord) → chord-hit · expected [60, 64, 67] · matched [60, 64, 67] · confidence 0.402 · latency -120 ms
- **uiowa-piano-mf-cmaj7** (chord) → partial · expected [60, 64, 67, 71] · matched [60, 67, 71] · missed [64] · confidence 0.576 · latency -120 ms
- **uiowa-piano-mf-ringing-c-major** (chord) → chord-hit · expected [60, 64, 67] · matched [60, 64, 67] · confidence 0.403 · latency -120 ms
- **uiowa-piano-pp-c-major-triad** (chord) → chord-hit · expected [60, 64, 67] · matched [60, 64, 67] · confidence 0.434 · latency -120 ms
- **uiowa-piano-mf-split-c3-e4-g4** (chord) → chord-hit · expected [48, 64, 67] · matched [48, 64, 67] · confidence 0.420 · latency -120 ms
- **uiowa-guitar-mf-adjacent-g3-b3** (chord) → chord-hit · expected [55, 59] · matched [55, 59] · confidence 0.751 · latency -120 ms
- **uiowa-guitar-mf-low-high-e2-e4** (chord) → chord-hit · expected [40, 64] · matched [40, 64] · confidence 0.525 · latency -120 ms
- **uiowa-guitar-mf-open-em-strum** (chord) → chord-hit · expected [40, 45, 50, 55, 59, 64] · matched [40, 45, 50, 55, 59, 64] · confidence 0.511 · latency -120 ms
- **synth-electric-clean-dyad-a2-e3** (chord) → chord-hit · expected [45, 52] · matched [45, 52] · confidence 0.794 · latency -120 ms
- **synth-electric-distorted-power-e2-b2** (chord) → chord-hit · expected [40, 47] · matched [40, 47] · confidence 0.810 · latency -120 ms
- **synth-electric-clean-open-em** (chord) → chord-hit · expected [40, 45, 50, 55, 59, 64] · matched [40, 45, 50, 55, 59, 64] · confidence 0.634 · latency -120 ms
