# Phase 3 — low-note root-cause analysis

Baseline: `46bbec75306dc032ec6aaf042ee904f8b62bf9ea`. Corpus: 20 deterministic cases × 2 tempo/amplitude variants, 44.1 kHz, 2048-sample window, 735-sample hop. No production code had been changed when these traces were captured.

## Result

The campaign reproduced two independent failures. The primary user-reported repeated-note miss begins at the attack/re-arm latch, not at pitch detection or score matching. A secondary low-after-middle failure begins at the musical harmonic-shape rejection after the latch has already re-armed.

Baseline totals: 74 expected advances, 62 matched, 12 false negatives, 0 false positives, 32/40 passing runs, 82.17 ms median measured recognition latency.

## Primary root cause — new low attack represented only by whole-window RMS

`micAttackLatch.js` blocks after a completed checkpoint until either four gate-closed frames occur or the current 2048-sample filtered RMS reaches 1.6× the running minimum of the ringing envelope. The latch does not track an attack/transient feature. Low piano decay keeps the gate open, and microphone compression plus overlap can make a real second hammer attack change the short-time spectral/first-difference energy strongly while changing whole-window RMS only modestly.

| Reproduced run | Correct candidate during second attack | V2 confidence | Peak RMS / decay envelope | Peak spectral-energy / recent baseline | Baseline result |
| --- | --- | ---: | ---: | ---: | --- |
| same low over decay, nominal | MIDI 36 | 0.93–0.95 | 1.12× | 1.69× | second attack blocked |
| fast repeated low, nominal | MIDI 36 | 0.92–0.94 | 1.42× | 1.72× | three later attacks blocked |
| no silence, clear attack, nominal | MIDI 36 | 0.92–0.95 | 1.20× | 2.60× | second attack blocked |
| low then octave, nominal | MIDI 48 after onset | about 0.62 | 1.25× | 1.75× | real octave attack blocked |

In all same-note failures the raw gate remains open, the expected score-informed pitch candidate is present, confidence remains strong, and exact score matching would complete. The first divergent stage is therefore `getMicAttackRearmReason`: it returns no reason and `useWaitForYouMicInput` exits before musical acceptance or score matching.

The sustained-low controls show why simply lowering the 1.6× RMS threshold is unsafe. Their noise/decay envelope can fluctuate by about 1.10×–1.13× in RMS with up to roughly 1.47× spectral-energy variation. A focused onset rule must require both a genuine transient rise and at least a small energy rise, plus existing expected-note evidence; it must not turn steady low-frequency energy into note-ons.

## Secondary root cause — valid low fundamental rejected when an old middle note occupies an upper partial

In the quiet/fast middle-C4 → low-C2 control, the latch re-arms at 779.77 ms via independent different-note dominance. The V2 detector then reports MIDI 36 with confidence 0.76–0.81, and the independent autocorrelation tracker reports MIDI 36.006–36.032. `isMusicalMicFrame` nevertheless rejects every frame: the decaying C4 is exactly the fourth harmonic of C2, pushing `(h4+h5+h6)/(h1+h2)` above the general 0.45 formant cap. The first divergent stage is the musical harmonic-profile filter, after correct pitch detection and re-arm and before confirmation/matching.

The nominal variant eventually advances only after the old middle note decays, at 1,696 ms—816 ms after the low attack. The quieter variant never advances. A safe exception must require a score-informed bass candidate plus an independently corroborated bass fundamental; merely seeing a harmonic family is insufficient and would violate wrong-note rejection.

## Hypotheses evaluated

1. **Insufficient low-frequency resolution:** not the first failure for the reproduced MIDI-36 cases. Goertzel and autocorrelation both identify the target. Deep piano MIDI 21–32 remains outside independent autocorrelation and is retained as a hardware/algorithm limitation.
2. **Harmonic confusion:** weak-fundamental/strong-H2 fixtures pass, and the wrong-octave harmonic control does not advance. Harmonic leakage does appear before the real low→octave attack, but the attack latch correctly blocks it; a real transient is the missing disambiguator.
3. **Repeated-note latch failure:** confirmed primary cause. Pitch need not change in the design, but same-pitch re-arm has only the overly coarse 1.6× RMS route.
4. **Missing onset evidence:** confirmed. Per-frame `spectralEnergy` and crest/RMS features are computed upstream but are not carried into latch baseline state.
5. **Noise floor:** hum/noise and quiet-low fixtures pass both variants. The gate is not the first divergence in the key failures.
6. **Score-follow matching:** exact matching would accept the detected MIDI in the failed repeated-note frames. Checkpoint ids and V2 tracks reset correctly across identical consecutive pitches; score identity is not shared incorrectly.

## Planned evidence-backed sequence

1. Add a conservative attack-transient re-arm path to the existing latch: expected low-note spectral evidence, transient-energy rise above the ringing baseline, and a smaller but nonzero RMS rise. Keep full release, 1.6× RMS re-arm, different-note dominance, and score mapping unchanged. Rerun all 40 corpus runs and sustained/wrong-octave controls.
2. Only if the low-after-middle control remains, add an independently corroborated bass-fundamental exception to the harmonic-shape rejection and rerun the entire corpus again.
3. Do not change the 2048 window, broad confidence thresholds, cents tolerance, score semantics, OMR, or UI.
