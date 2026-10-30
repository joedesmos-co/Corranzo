# Chord co-occurrence and false-advance safety (research)

**Date:** 2026-10-25
**Start:** `4d01840a82` (+ current `main` merged). **End:** analysis only — no
production code change (no candidate passed the safety criteria).

## 1. Phase 1 — co-occurrence and per-tone distributions

Measured on the production scorer (2048 frame, 60 Hz) for the two
reproducible wrong-chord families and five true chord controls. Columns:
detection frames per expected tone, and the maximum number of expected
tones co-occurring within W frames (W=0 = same frame).

| case | frames per tone | co-occurrence W=0 / 1 / 2 / 4 |
|---|---|---|
| TRUE acoustic-jazz-dyad [50,60] | 2 / 99 | **1 / 2 / 2 / 2** |
| FP acoustic-jazz-dyad [52,62] | 2 / 3 | **2 / 2 / 2 / 2** |
| TRUE electric-eg08-triad [47,58,72] | 149 / 39 / 143 | 3 / 3 / 3 / 3 |
| FP electric-eg08-triad [49,60,74] | **1** / 34 / **0** | 1 / 1 / **2** / 2 |
| TRUE piano triad [60,64,67] | 107 / 107 / 107 | 3 / 3 / 3 / 3 |
| TRUE guitar strum triad [50,55,59] | 32 / 139 / 110 | 3 / 3 / 3 / 3 |
| TRUE power dyad [49,56] | 131 / 121 | 2 / 2 / 2 / 2 |
| TRUE adjacent dyad [55,59] | 60 / 43 | 2 / 2 / 2 / 2 |

**The accumulation hypothesis is refuted.** The false chord does not rely on
long accumulation: the FP dyad has both tones **in the same frame** (W=0),
while the *true* dyad needs a ±1-frame window (its bass is detected in a
single frame at 1.6 s). The FP triad reaches the guitar quorum (2 of 3)
within 33 ms (W=2), via one frame of the bass (49, confidence 0.34,
long-window ratio) and a 34-frame ghost (60).

Mechanism: **harmonic ghosts of a played chord inherit its temporal
structure.** 60 (C4) is an octave below the played 72 (C5); overlapping
spectral lobes make the ghost co-occur with the played chord, so temporal
coherence favours the ghost, not the truth.

## 2. Candidates evaluated (all rejected)

| candidate | measurement | verdict |
|---|---|---|
| same-frame quorum (W=0), anchor included | FP triad 1/3 (rejected ✓) but **true dyad 1/2 (broken)** and FP dyad 2/2 (accepted) | unsafe both ways |
| short-window quorum W=1–2 | FP triad passes at W=2 (33 ms); only W=1 separates, and the FP anchor lands 2 frames from its quorum tone | razor-thin, fixture-fragile |
| bass-anchor persistence (≥2 frames) | removed the eg08 FP but lost genuine deep-bass chords (true 0.803 → 0.742; with a deep-bass exemption 0.773 and false rose to 0.106) | true loss > false gain (previous mission, re-confirmed) |
| bass-anchor minimum confidence (0.40) | FP anchor 0.34 vs the strum's legitimate explicit 5th-string anchor **0.37** | margin 0.03 — rejected |
| per-tone peak-shape (vertex) at the detection frame | true dyad bass vertex 0.137 vs FP bass 0.259 (overlap); true weak tones are noise-shaped too | no separation |
| off-peak semitone veto (single notes) | evidence settles 90–190 ms after attack; V3 commits at the attack frame | latency trade, rejected (previous mission) |

## 3. Phase 3 — the semitone case (`55 vs 56`)

Re-confirmed: 196 Hz is never a local maximum; the parabolic vertex
separates true from neighbour at settled frames (true p90 2.8 % vs neighbour
p10 3.1 %), but the comparison needs 90–190 ms of settled audio. A
conditional deferral only for ambiguous semitone frames would still add
that delay to every ambiguous single note; measured worst case 190 ms vs
the 50–66 ms baseline. No narrow rule was found that settles in < 60 ms
(the frequency resolution required is ~12 Hz, i.e. ≥ ~90 ms).

## 4. Phase 4 — controls and generalization

All true controls kept their co-occurrence behaviour (piano simultaneous,
guitar strum, power dyad, adjacent dyad, rolled piano octave), so the
rejections above are not caused by breaking legitimate chords — the true
dyad is the one case a same-frame rule would break, and the FP dyad passes
it. The two wrong-chord families were found on the independent eval split
(held out from the development fixtures) and reproduce at 2/3 runs; the
fresh semitone FP reproduces 3/3.

## 5. Decision

**Retain the production implementation.** The remaining wrong-chord
advances are spectrally and temporally indistinguishable from the true
chords in these recordings: the ghosts are harmonics of the played notes
and share their timing, while the true weak tones are themselves
marginal. No candidate reduced false advances without breaking legitimate
chords (or requiring a 2–3× latency increase).

## 6. Remaining limitations

* `wrong-chord-same-count` on acoustic-jazz-dyad (2/3) and electric-eg08-triad (2/3).
* `neighbor+1-of-57` on electric-gtechs-mid (2/3).
* `acoustic-fresh-ss-single` semitone FP (3/3).
* Low E2 masked (five domains, previous mission).
* Dense piano completions unstable (p95 seconds on borderline clips).

## 7. Recommended next experiments (ranked)

1. **Per-tone harmonic attribution against the played chord's fundamental
   set**: for each expected tone, test whether it is an integer partial of a
   *detected, stronger* chord tone (a ghost) versus a fundamental. The
   ghost dyad's 62 is exactly D3's 2nd harmonic; the true 60 is the
   fundamental of the played C4. Requires a per-frame "which detected tones
   are fundamentals" analysis — the only domain not yet measured.
2. **Score-aware voicing check** (product-side): the FP families are
   transposed chords; a score-aware transposition guard (reject a checkpoint
   whose every tone is exactly ±2 semitones from the concurrently detected
   chord) is a cheap safety net for WFY, but it is a product decision.
3. **Physical acceptance session** to decide whether the fixtures
   under-represent weak chord tones.
