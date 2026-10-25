# Robust chord recognition — evaluation integrity, semitone physics, candidate screening

**Date:** 2026-10-25
**Start:** `1804dbd3cf` (+ current `main` merged). **End:** evaluation tooling and
this record only — **no production code change** (no candidate passed the
safety criteria).

## 1. Phase 1 — evaluation integrity

Added `scripts/benchmark-repeats.mjs`: runs the verified production harness N
times and reports per-clip true/false advance frequency plus latency
distributions. This answers "how often, how stable" instead of one run.

**The broader scenario matrix changes the picture.** The accepted baseline
counts only octave + semitone neighbours (1/12 false). Including
`wrong-chord-same-count` and per-tone octave families on the independent
eval split exposes **three reproducible false families at 2/3 runs**:

| clip | scenario | runs |
|---|---|---|
| acoustic-jazz-dyad | `wrong-chord-same-count` ([50,60] played, [52,62] expected) | 2/3 |
| electric-eg08-triad | `wrong-chord-same-count` ([47,58,72] → [49,60,74]) | 2/3 |
| electric-gtechs-mid | `neighbor+1-of-57` (57 played, 59 expected) | 2/3 |

Mechanism (measured): the score-informed detector occasionally detects a
non-played pitch in a **single frame** (jazz-dyad 52: 2 frames, 62: 3;
eg08 49: 1, 60: 34, 74: 0; gtechs-mid 59: 1). The guitar recogniser
accumulates matched tones over its 900 ms rolling window and, for ≥3-note
chords, accepts a quorum of 2 plus the bass anchor — so one-frame ghosts can
complete. True guitar chord tones are far more stable (anchor counts 10–54
frames across 21 true chords; single notes 20–140 frames).

Other Phase-1 results (3 repeats):

| matrix | result |
|---|---|
| mic-accuracy (6 clips, 24 scenarios) | **6/6 true and 0/24 false in every run**; p50 49–66 ms, p95 90 ms |
| mic-real eval true | 53/66 (0.803); fully stable 16/22 clips; unstable: jazz-single 1/3, eg11-dense 1/3; never: eg04-dyad, schubert-dense, schubert-triad |
| mic-real eval-fresh | 9/9 true; the `ss-single` neighbour FP in **3/3** runs (fully reproducible, not a flake) |

## 2. Phase 2 — the remaining semitone case (`ss-single`)

Fine-spectrum analysis (0.5 Hz Goertzel sweep, windows 2048–16384): with 56
(207.6 Hz) played, the expected 55 (196 Hz) is **never a local maximum** at
any window length — the peak sits at the played note. A three-point
parabolic vertex (frequency-proportional step, ±2 %) separates well:

| | truth | neighbours |
|---|---|---|
| \|vertex offset\| / f | p50 0.4 %, p90 **2.8 %** | p10 **3.1 %**, p50 8.3 % |

Batch rule (a semitone neighbour ≥1.8× stronger **and** vertex ≥3 %)
rejects **29/36** neighbour scenarios and loses **0** true completions
(the only true veto is `acoustic-rock-single`, ratio 0.74 — already
undetectable).

**Why it cannot ship:** the long-window comparison needs the played note
inside the window, so the evidence only settles **90–190 ms after the
attack**. V3's single-note acceptance commits on the attack frame (its
immediate-commit rule), so the veto arrives after the award. Deferring
single-note acceptance by that much would cost 2–3× the 50–63 ms baseline
latency to remove 1/21 false scenarios — an unjustified trade. Reverted.

## 3. Phase 3 — low E / open Em (five domains, all negative)

| domain | real E2 | controls (high-passed / harmonics-only / no-low-E) | verdict |
|---|---|---|---|
| local SNR (82 vs 70–96 Hz) | 1.2 | 1.1 / — / 1.1 | no |
| fundamental:2nd (82:165) | 1.57 / 1.24 | 1.02 / **0.00** / 1.13 | kills pure harmonic ghosts only |
| decay drop (500 ms) | 5.3 dB | 7.2 / — / 8.5 dB | no |
| phase coherence at 82.4 Hz | 0.35 | 0.51 / — / 0.41 | no |
| event-locked (post/pre onset 300 ms) | 0.95 | 0.94 / — / 0.92 | no |
| longer windows (8192) | ratio 0.64 (worse) | — | no |

The E2 fundamental is at the noise/leakage floor of these recordings; any
rule admitting it also admits a low-E-free partial strum (the high-passed
control has comparable 82 Hz energy at confidence ≈0.25). The bass-anchor
refusal remains the correct safe behaviour.

## 4. Phase 4 — candidates and screening

1. **Bass-anchor temporal stability** (anchor must appear in ≥2 frames;
   true anchors measured 10–54 vs the ghost's 1). Measured on eval ×3:
   the `eg08` false family went 2/3 → 0/3, **but** true completions fell
   0.803 → 0.742 (`eg06-dense`, a deep-bass chord, was lost). With a
   deep-bass exemption (≤43) the true rate was still 0.773 and the false
   rate rose to 0.106. **Rejected** (true loss exceeds the false gain).
   Reverted.
2. **Off-peak (vertex) semitone veto**: no browser effect (see §2);
   reverted.
3. **Global 8192 detection window / neighbour dominance / monophonic
   dominant** (earlier missions): rejected; unchanged.

## 5. Decision

Production unchanged. The committed artifact is the repeatable evaluation
tool and this measurement record. No regression: 41 recognition/browser
unit tests green.

## 6. Remaining limitations

* `ss-single` semitone false award: physically separable only after
  ~90–190 ms; the latency trade is refused.
* Two reproducible `wrong-chord-same-count` families and one whole-tone
  neighbour family on the eval split (single-frame ghost detections
  amplified by the guitar quorum).
* Low E2 masked in these fixtures (five domains).
* Dense piano: unstable completions (p95 seconds on borderline clips).

## 7. Recommended next experiments (ranked)

1. **Quorum evidence quality, not quantity**: require the quorum tones to
   be *simultaneously* present in at least one frame (or within one hop)
   instead of accumulated across 900 ms. The FP families rely on
   different tones appearing in different frames; true chords in this
   corpus show simultaneous frames for the upper tones. Measure the
   simultaneous-frame distribution for true vs FP chords before shipping.
2. **Bass-anchor evidence with attack-time alignment**: a real bass attack
   is followed by a decaying fundamental; require the anchor's first
   detection within the attack window (not anywhere in the roll). Test on
   the deep-bass true chords that the stability rule lost.
3. **Physical low-E check** (`docs/MIC_PHYSICAL_ACCEPTANCE.md`) to decide
   whether the fixtures or the algorithm are the limit.
