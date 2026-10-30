# Low-E / open-Em diagnosis (research branch)

**Date:** 2026-10-24
**Start:** research `ca10d29879` + current `main` merged (`5d5ae10c36`
semitone-resolution integrated). **End:** docs/benchmark tooling only — no
production code change was justified by the measurements.

## 1. Baseline reproduced (current production, real browser path)

Real Chromium production hook (V3 + V2), MediaStream injection, mic-real
JAMS/MIDI truth, same scenarios as the accepted baseline.

| matrix | measurement | note |
|---|---|---|
| mic-real true (dev+eval+fresh, 46 clips) | **39–43 / 46** (eval alone 15–19 / 22 across runs) | dense-piano completions are timing-sensitive; the reported 39 sits at the low end |
| false — octave+neighbour (dev+fresh, 12 scenarios) | **1 / 12** (`acoustic-fresh-ss-single`) | matches the reported 1 / 21 on the broader matrix |
| single-note accuracy matrix | 6/6 true, 0–1/24 false | p50 50–66 ms |
| chord matrix (polyphony 11) | 7/11 true | **p50 193 ms, p95 258 ms** |
| p95 on dense material | up to ~14 s (a late completion on a borderline clip) | the engine keeps accumulating until a later attack; per-frame cost is unchanged |

Dropped windows: none — the engine is a per-frame 2048-sample FFT (tick cost
1.17–1.38 ms/frame), not a queued inference model.

## 2. Root cause of the open-Em refusal (measured)

The V3 guitar expectation needs `matched ≥ 3` **and** the bass anchor
(the lowest expected tone, E2 = MIDI 40) for a ≥3-note chord. In the real
strum (and the E2+E4 dyad) the E2 fundamental never reaches the detector:

| tone | detected frames | ratio range |
|---|---|---|
| E2 (82.4 Hz) | **0 %** | 0.39–0.87 (dyad 0.16–0.65) |
| A2 (45) | 3 % | ≤1.84 |
| D3/G3/B3 | 33–36 % | ≤4.1 |
| E4 (64) | 4 % | ≤1.88 |

The E2 band is 1.35× below the detection ratio in every frame, so the anchor
cannot be satisfied; five of six tones accumulate and the chord correctly
refuses. This is a **detector/acoustic** limit, not an expectation-logic bug:
the same expectation completes 7/11 other chord clips and all octave/rolled
composites.

## 3. Candidate evidence domains tested (all negative)

Every measurement compares a genuine (weak) E2 against three controls: the
same strum high-passed at 150 Hz (fundamental removed), a synthetic
harmonics-only E2 (no fundamental), and a guitar clip with no low E
(G3+B3).

| domain | real E2 | high-passed | harmonics-only | no-low-E | separates? |
|---|---|---|---|---|---|
| local SNR (82 vs 70–96 Hz, ±3 %) | 1.2 | 1.1 | — | 1.1 | no (neighbours sit in the main lobe) |
| fundamental : 2nd partial (82:165, gain-invariant) | 1.57 / 1.24 | 1.02 | **0.00** | 1.13 | kills harmonic-only ghosts, not noise |
| decay drop over 500 ms | 5.3 dB | 7.2 | — | 8.5 dB | no (the no-E2 control decays more) |
| phase coherence at 82.4 Hz | 0.35 | 0.51 | — | 0.41 | no (the real note is *less* coherent) |
| longer analysis window (8192) | ratio 0.64 (worse) | — | — | — | no |

The 82:165 test is the only one with a clean signal, and it proves the band
is not pure harmonics — but the *amplitude* of the fundamental is
indistinguishable from the leakage/noise floor of the same recording. A
rule that admits E2 on this evidence would also admit a **partial strum**
(high-passed control has comparable 82 Hz energy at confidence ≈0.25), which
is an explicit wrong-chord scenario. Lowering the bass threshold is
therefore unsafe; the current refusal is the correct behaviour for an
ambiguous input.

## 4. Decision

Retain the current implementation. No production code was changed: a
candidate that accepts the strum also accepts a low-E-free partial strum,
violating the safety requirement. The measurement record above is the
diagnosis.

## 5. Remaining acoustic limitations

* Low E2 under full strums (these recordings): fundamental at the noise
  floor, four independent domains fail to separate it.
* `acoustic-fresh-ss-single`: expected pitch 55 vs played 56 — the expected
  long-window ratio is 2.35 (above the floor); a safe veto would reject a
  true note elsewhere.
* Dense piano polyphony: timing-sensitive completions (p95 seconds on
  borderline clips).
* Real rooms additionally colour the low band (not measurable without
  physical recordings).

## 6. Next defensible experiment

1. **Physical low-E check first.** The open-Em strum is in
   `docs/MIC_PHYSICAL_ACCEPTANCE.md`. If a real close-miked guitar yields an
   E2 ratio above 1.35, these fixtures under-represent the low E and the
   algorithm is not the limit; if it also fails on hardware, the next
   algorithm experiment is justified.
2. **Attack-order evidence** (the only untested domain): in a down-strum the
   low E is struck first, and its broadband attack is stronger than its
   sustain. Measure the 60–100 Hz transient in the first 30 ms with a short
   window and require temporal order (bass attack before the upper strings)
   plus the upper-tone quorum. This needs per-string attack timing, which
   the V3 musical-timing layer already tracks — but it is a research change,
   not a threshold tweak, and must be validated against partial strums and
   wrong-bass scenarios.
