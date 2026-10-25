# Harmonic attribution and wrong-chord discrimination (research)

**Date:** 2026-10-25
**Start:** `c849537524` (+ current `main` merged). **End:** analysis only — no
production change (no candidate passed the negative controls).

## 1. Phase 1 — harmonic evidence maps (measured)

For each expected tone E at its first detection frame: own fundamental energy
(`own`), energy at E-12 (`sub`, the lower octave that would explain E as its
2nd harmonic), E-24 (`sub2`), E's 2nd harmonic (`p2`), and `sub/own`.
Windows 2048 (the detector) and 8192 (resolution).

| case | tone | sub/own @2048 | sub/own @8192 |
|---|---|---|---|
| **FP** jazz-dyad [52,62] | 52 | 0.21 | 0.70 |
| | **62** (D4 = played D3's 2nd harmonic) | **1.06** | **0.51** |
| **TRUE** jazz-dyad [50,60] | 50 | 0.18 | 1.13 |
| | 60 (C4, its own fundamental) | 0.20 | 1.57 |
| **FP** eg08-triad [49,60,74] | **49** (1 frame) | **1.01** | 2.58 |
| | 60 (34 frames) | 0.13 | 0.83 |
| **TRUE** eg08-triad [47,58,72] | 47 / 58 / 72 | 0.55 / 0.07 / 0.06 | 0.36 / 0.16 / — |
| **FP** fresh-semitone [55] | 55 | 0.38 | 1.55 |
| **FP** gtechs-mid [59] | 59 | 0.74 | 0.34 |
| **TRUE** piano triad [60,64,67] | 60/64/67 | 0.01 / 0.02 / 0.05 | — |
| **TRUE** power dyad [49,56] | 49 | 0.02 | — |
| | **56** (the fifth) | **1.37** | — |
| **TRUE** guitar strum [50,55,59] | 50 / 55 / **59** | 0.05 / 0.54 / **1.22** | — |
| **TRUE** octave chord [60,72] | 72 | 0.47 | — |
| **TRUE** rolled octave [60,72] | 72 | **0.81** | — |
| **TRUE** adjacent dyad [55,59] | 55 / 59 | 0.12 / 0.04 | — |

**Result: no separation.** The false families' ratios (0.38–1.06 at 2048)
sit inside the true distribution (0.01–1.37), and two legitimate controls are
*higher* than every false case: the power chord's fifth (1.37) and the
strum's fifth (1.22). The 8192 window does not help (FP 0.51 vs true dyad
1.57; the sub-band energy is contaminated by guitar body resonances — the
power chord's "sub" at G#2 is a body resonance, not a harmonic of the root,
because a fifth is 1.5× the root, not an integer partial).

The documented relationship is real — the FP dyad's 62 is exactly the played
D3's 2nd harmonic — but the *energy* evidence for it is not distinguishable
from a legitimate fifth's sub-band resonance or a rolled octave's lower note.

## 2. Phase 2 — negative controls (the blockers)

* **Power chord (fifth)**: the fifth is 1.5× the root — not an integer
  partial, yet its sub-band (E-12) is lit by body resonance (1.37, the
  highest in the study). Any sub-band veto kills it.
* **Guitar strum fifth**: 1.22 — same.
* **Rolled octave (piano)**: 0.81 — a genuine octave doubling, above the FP
  dyad's 0.51 at 8192.
* **Octave chord**: 0.47 (2048) — inside the FP range.
* **True weak tone with a strong lower note** (jazz-dyad 50): 0.18–1.13
  depending on window — the same tone reads across the whole range.

A rule strict enough to reject the FPs rejects at least one of these
legitimate cases; a rule loose enough to keep them accepts the FPs.

## 3. Phase 3 — targeted families

* **Acoustic jazz wrong-dyad**: the rejectable-looking tone (62) is
  indistinguishable from a genuine octave/fifth sub-band (see above).
* **Electric eg08 wrong-triad**: the anchor (49) is a one-frame detection at
  confidence 0.34; but the strum's legitimate 5th-string anchor is 0.37 —
  the anchor-confidence margin (0.03) is too thin.
* **Fresh semitone**: spectral separation exists only after 90–190 ms; V3
  commits at the attack frame (previous mission).
* **Octave substitutions**: the existing single-note octave guard covers
  them (measured 0-of-24 on the focused matrix).

## 4. Phase 4 — browser performance

No candidate reached the browser stage: every candidate failed the
negative-control screening above. The verified baseline remains (repeat
harness): mic-accuracy 6/6 true / 0-of-24 false (p50 49–66 ms, p95 90 ms),
mic-real eval 0.803 true with three 2/3 false families, eval-fresh 9/9 true
with the semitone FP 3/3. Per-frame cost and dropped windows unchanged.

## 5. Phase 5 — product-level transposition guard (audit)

The two wrong-chord families are the expected chord transposed +2 semitones
from the played chord. A score-aware guard would need to know what was
actually played — the live engine is score-informed and does not run blind
chord detection, so the pattern cannot be identified from the expected
evidence alone. Audited legitimate cases that must not be rejected:
* the user playing a checkpoint in a different key (a real transposition),
* chord inversions (same pitch classes, different bass),
* octave doublings (+12, not +2),
* partial strums,
* ambiguous pitch evidence.
A blanket "detected chord is 2 semitones above the expectation" rejection
would misfire on a genuinely transposed performance and cannot be computed
without blind detection. **Not implemented.**

## 6. Decision

**Retain production.** Harmonic attribution by sub-band energy, integer
partials, or anchor confidence does not separate the remaining false
families from legitimate fifths, octaves and rolled chords — the negative
controls fail first. This is a measured negative, consistent with the
earlier octave/neighbour studies.

## 7. Recommended next experiments (ranked)

1. **Blind chord detection in the live path** (a cheap 88-pitch Goertzel
   scan over the expected range, ~1 ms/frame) to know what was actually
   played; then the transposition pattern becomes computable. This is the
   only route that could support the +2 guard safely.
2. **Per-tone independent-excitation test with blind fundamentals**: find the
   strongest blind fundamentals, then test whether E is an integer partial
   of one of them *and* lacks its own attack transient. Requires the blind
   scan (above) plus flux evidence (already available in the research
   modules).
3. **Physical acceptance** to see whether real microphones produce the same
   ghost structure as these fixtures.
