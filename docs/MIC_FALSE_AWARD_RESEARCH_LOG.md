# Neural Mic — False-Award Research Log & Stop Decision (Step 5 Free)

Status: **research stopped on false-award discrimination** — 4 remaining
scenario-level false completions are model-bound acoustic ambiguity with no
safe discriminator demonstrated in seven measured feature domains. This log
records every domain tried, its population measurements, and why each was
rejected. It is the evidence base for the stop decision and for any future
revival.

## The four remaining false completions (4/199 scenarios)

| Scenario | Clip | Ghost | Mechanism |
|---|---|---|---|
| `octave-up-of-48` | uiowa-piano-mf-split-c3-e4-g4 (C3+E4+G4) | C4 (2 emissions: 0.13, 0.95) | Co-attack octave harmonic: C4's band energy IS C3's 2nd partial, at the same attack |
| `octave-up-of-55` | uiowa-guitar-mf-adjacent-g3-b3 (G3+B3) | G4 | Same mechanism (guitar) |
| `neighbor-1-of-64` | uiowa-guitar-mf-low-high-e2-e4 (E2+E4) | Eb4 @1.63 | Decay-phase semitone confabulation (flux 0.115, no attack) |
| `neighbor-1-of-60` | electric-gtechs-quiet (60) | 59 (single emission) | Decay-phase semitone confabulation |

Both mechanisms share one property: the model emits pitches that are
acoustically present as *another* note's partial or as decay residue, and the
emitted pitch is within a few cents of equal temperament.

## Rejected feature domains (each measured across frozen corpora)

1. **Static spectral energy** (energy ghost/parent ratio): ghosts +12.8 dB /
   −11.0 dB vs true co-onset doublings −27.7…+15.8 dB — full overlap.
2. **Stream span ratios**: ghosts 1.0–2.2 vs true 0.29–3.0 — the stream
   fragments spans differently per note.
3. **Union-persistence**: transient ghosts 4.2–6.2 vs true short-uppers over
   ringing lowers 5.4–8.5 — overlap.
4. **Attack-flux admission** (generic): true strum-interior/chord-top notes
   are transient-less too (power-dyad 61 @0.118, cmaj7 71 @0.044).
5. **Comb presence**: non-dominant true pitches score BELOW ghosts
   (split-clip true E4 0.34 vs low-high ghost 0.76) — inversion.
6. **Semitone-neighbor flux/presence veto** (Step 5 Free): 263 true vs 28
   ghost semitone-adjacent pool notes; flux spans 0.015–1.0 on BOTH sides.
7. **Sub-semitone pitch / inharmonicity** (this round, `scripts/analyze-fine-pitch.mjs`):
   - centsDev: ghosts +2.6 / −15.9 / −12.5 / +87.5 vs trues −30.5…+87.5 — every
     ghost inside the true range. Piano stretch is too small (~2–3 cents) and
     sampler tuning bias (±20 cents) exceeds the signal.
   - prominence (peak/sweep-mean coherence): ghosts 1.66–3.27 vs trues 1.25–4.09.
   - relLevel (gain-invariant): ghosts 0.59–1.05 vs trues 0.29–1.12.
   - 3f/f series ratio: ghost 0.58 vs true E4 0.28 vs true G4 0.04 — no ordering.

The ONLY partial success shipped is the **attack-conditioned octave gate**
(`octaveAttackKeepFlux: 0.3` in `micNeuralStream.js`), which *admits* true
late octaves the gate was over-killing (3 recovered eval misses). It does not
suppress the remaining ghosts: co-attack ghosts share the parent's attack and
read flux 1.0.

## Why the co-attack octave ghosts are not separable

A ghost upper octave is the parent's own 2nd partial: identical onset, identical
attack transient, frequency within ~3 cents of the ET octave, and a harmonic
series that is the parent's even partials. Every time-domain feature therefore
matches a genuinely struck note; every frequency-domain feature lands within
sampler tuning bias of the ET pitch. Only evidence the model does not emit
(e.g. per-string attack attribution from a source-separated signal) could
separate them — that is a research project, not a threshold.

## What was shipped instead (safety wins)

- Silence floor 0.001 → 0.003 + frozen pre-play adaptive ambient (kills the
  quiet-room C4 hallucination; verified live).
- Spectral-flatness gate 0.48 (kills the loud-room hallucination; verified
  live at 44.1/48 kHz and at ±12 dB gain, mono/stereo).
- Attack-conditioned octave gate 0.3 (recovers 3 true octave misses).
- Single-pitch octave veto at confirm (R0).
Net: 4 FP/199 with 66/70 true completions, versus the pre-mission 4 FP/199 with
63/70 — every shipped change improved recall or blocked a noise hallucination
without adding false awards.

## Real-instrument testing required (the only path to close the gap)

1. Physical piano and guitar through a real mic, played as octaves 200–400 ms
   apart, to characterize how often the model emits octave ghosts with a REAL
   instrument's inharmonicity and room acoustics (sampler recordings may
   under-represent the effect).
2. Physical decay-phase observation: do real strings/pedal genuinely produce
   semitone confabulation in the model, or only at specific decay rates?
3. Measure the false-award rate per hour of real playing, not per scenario.

## Decision

STOP false-award discrimination research. The remaining 4 FPs (2.0% of
scenarios) require either new model output (per-note attack attribution) or
hardware evidence. Any threshold shipped against these populations was
measured to cost true-completion recall at least equal to the FPs it removes.
