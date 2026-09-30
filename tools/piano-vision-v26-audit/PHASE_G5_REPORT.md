# Phase G5 — Readout structure: the last live hypothesis

**Verdict: PARTIAL. Joint composition beats factorized composition by +0.048 at
matched budget (+0.072 at the 40-epoch budget, 3/3 seeds), but the gate is not
met: 0.6494 against the 0.70 line, +0.0362 against the 0.6132 reference.**

The oracles locate the ceiling exactly: **the accidental head caps written pitch
at 0.7604**, and octave is not a constraint at all.

---

## 1. Exact metric definitions

All scores are on **one shared population**: objects where the `written_step`,
`octave` and `accidental` masks are all true, intersected with `object_mask`.
**N = 6,775** on corpus/2.1.

| metric | target field | vocabulary | predicate | includes accidental |
|---|---|---|---|---|
| written_step | `targets.object.pitch_written_step` | CDEFGAB → 0..6 | argmax == target | no |
| octave | `targets.object.pitch_octave` | 0..10 | argmax == target | no |
| accidental | `targets.object.pitch_accidental` | alter − 3, 0..6 | argmax == target | yes |
| **written_pitch (joint)** | the same three targets | — | **step ∧ octave ∧ accidental** | **yes** |
| derived_midi | same three → MIDI | — | midi(pred) == midi(true) | yes |
| closed_form_staff_position | *not a model metric* | — | diatonic(formula) == diatonic(MusicXML) | **never** |

Masking is identical for all four, so step and octave are scored on the same N
and "joint" is literally their intersection **plus accidental**.

## 2. Reconciliation of .7566 / .9571 / .6015 — resolved, no bug

| structure | P(step) | P(octave) | P(step ∧ octave) | Fréchet bound | written_pitch |
|---|---|---|---|---|---|
| A factorized | 0.7516 | 0.9584 | 0.7427 | 0.7100 | 0.6015 |
| B direct joint | 0.7667 | 0.9609 | 0.7667 | 0.7276 | 0.6456 |
| D mlp joint | 0.7591 | 0.9622 | 0.7591 | 0.7213 | 0.6494 |

**The bound is respected in every structure.** The apparent anomaly — 0.7566 /
0.9571 / 0.6015 — is not a metric bug. The bound constrains P(step ∧ octave),
which is **0.7427**, comfortably above 0.7100. Written pitch is a *three*-way
intersection, so it is expected below the two-way bound, and the accidental
component costs exactly 0.7427 − 0.6015 = **0.1412**.

## 3. Metric-identity unit test

`phase_g5a_metrics.py` defines every metric, computes the intersection tables,
and exposes `identity_check()` and `intersection_table()` so any readout can be
tested against the same invariant. It is re-run for every structure in this
milestone and recorded in `out/phase_g5d_readout.json` under `G5A_identity`. The
bound is a hard assertion (`bound_respected`), so the definition cannot drift
silently.

**Result: RESPECTED for every structure, on both the frozen champion logits and
all five readouts.**

## 4. Component error-intersection table

D_mlp_joint, N = 6,775:

| step | octave | accidental | n | share |
|---|---|---|---|---|
| T | T | T | 519 | **0.6545** |
| T | T | F | 83 | 0.1047 |
| T | F | T | 0 | **0.0000** |
| T | F | F | 0 | **0.0000** |
| F | T | T | 65 | 0.0820 |
| F | T | F | 96 | 0.1211 |
| F | F | T | 19 | 0.0240 |
| F | F | F | 11 | 0.0139 |

**Octave is never wrong when step is right** (the two `step=T, oct=F` cells are
empty). Octave and step are perfectly nested, so they cannot be "incompatible
independent components" — the composition problem is entirely between the
{step, octave} group and **accidental**.

## 5. What 0.837 actually means

The Gate F0 closed form computes, from the detected geometry alone,
`middle_line_diatonic + round(2k)`, and compares it to the diatonic index of the
MusicXML written pitch. It therefore measures a **letter-and-register** match.

- It is **not** written pitch: it never tests an accidental.
- It runs on a **different population** — every `PITCH_STAFF` label in corpus
  2.1 that has both a `stepsFromBandCenter` and a `writtenPitch` — not the masked
  metric population.
- The like-for-like comparison is **P(step) = 0.7566–0.7844**.

**0.837 must not be cited as a written-pitch target.** The metric definition
carries this warning explicitly in code.

## 6. Frozen representation identity

`out/phase_f_cache.npz`, **sha256 `24d4ad8b3322eddfa9d07a62…`**, 681 records ×
132 objects × 480 dims, built on corpus/2.1. Input to every readout is exactly
the champion object embedding (480) + the 7 staff features = 487 columns. No
backbone, no ROI, no image, no score identity. Identical across all five
structures and both epoch budgets.

## 7–11. Readout structure ablation (60 epochs, matched trunk width 256)

| | structure | params | weighted | macro |
|---|---|---|---|---|
| A | factorized (3 independent heads) | 198,119 | 0.6015 | 0.6769 |
| B | direct joint (539-way) | 330,217 | 0.6456 | 0.6477 |
| C | hierarchical (position → octave) | 284,944 | 0.5763 | 0.6585 |
| **D** | **MLP joint** | 396,009 | **0.6494** | 0.6580 |
| E | factorized + compatibility | 198,273 | 0.6015 | 0.6769 |

**E is bit-identical to A.** The zero-initialised compatibility tables do not
change the argmax of a sum, and they received no useful gradient.

**Seed robustness (40 epochs, 3 seeds):** A = 0.5733 ± 0.0062, D = 0.6457 ±
0.0078, **paired delta +0.0723 ± 0.0070, separated in 3/3 seeds.** The joint effect
is real, not a fluctuation.

## 12. Parameter counts

198,119 / 330,217 / 284,944 / 396,009 / 198,273 — all ≤ 0.4 M, within the 0.5 M
ceiling, and the joint structures are *larger* than the factorized one, so the
gain is not a capacity artefact.

## 13. Oracle component substitution (evaluation only, no training from labels)

D_mlp_joint:

| substitution | written pitch | Δ |
|---|---|---|
| predicted all (no oracle) | 0.6545 | — |
| pred_step + **TRUE** octave | **0.6545** | **+0.0000** |
| **TRUE** step + pred_octave | 0.7364 | +0.0819 |
| pred_step + pred_oct + **TRUE** accidental | 0.7591 | +0.1046 |
| **TRUE** step + **TRUE** octave + pred_acc | **0.7604** | +0.1059 |

**Two decisive readings:**

1. **An octave oracle gains exactly nothing.** Octave is not the constraint.
2. **With perfect step and octave, the ceiling is 0.7604 — which is precisely
   P(accidental).** So written pitch cannot exceed ~0.76 on this representation
   no matter how good the readout becomes. The accidental head is a hard cap.

The best readout at 0.6494 is already **86 % of the accidental-limited ceiling**.

## 14. Calibration / composition audit

- For the joint structures (B, D) the score is a single softmax, so per-head
  temperature scaling cannot change its argmax. Calibration is not applicable.
- For the factorized structure (A) composition *is* applicable, and E tested
  exactly that with learned `b[step,oct]` and `c[oct,acc]` tables — and learned
  nothing (E ≡ A bit-identically).
- Conclusion: the factorized structure's deficit is **not** a calibration
  problem. The joint classifier wins because it can represent step/octave/
  accidental co-occurrence directly, not because it re-weights components.

## 15. Weighted + macro LOSO

Best (D_mlp_joint, 60 epochs): **weighted 0.6494, macro 0.6580**, N = 6,775,
17-fold leave-one-score-out. Four of 17 scores have no objects on the shared
metric population and are excluded from the macro (reported, not silently
dropped).

## 16. Per-score and engraving family

| score | written pitch | step | octave | acc | n | family |
|---|---|---|---|---|---|---|
| pl-handel-gavotte | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 5 | emmentaler |
| pl-bach-prelude-bwv846 | 0.9444 | 1.0000 | 1.0000 | 0.9444 | 18 | emmentaler |
| pl-beethoven-fur-elise | 0.8750 | 0.9167 | 1.0000 | 0.9167 | 24 | emmentaler |
| std-demo-minuet-in-g | 0.8333 | 0.8333 | 1.0000 | 0.9167 | 12 | emmentaler |
| bc-bach-fugue-bwv846 | 0.7742 | 0.8495 | 0.9677 | 0.8817 | 93 | emmentaler |
| bc-chopin-nocturne-op9-n2 | 0.7013 | 0.7987 | 0.9416 | 0.7857 | 154 | feta |
| bc-mozart-k153 | 0.6667 | 0.7333 | 0.9556 | 0.7111 | 45 | emmentaler |
| bc-beethoven-sonata-op2-m1 | 0.6567 | 0.7761 | 0.9552 | 0.7313 | 134 | emmentaler |
| bc-chopin-etude-op10-01 | 0.6111 | 0.7556 | 0.9667 | 0.7667 | 90 | feta |
| bc-chopin-etude-op10-12 | 0.5506 | 0.6709 | 0.9684 | 0.7152 | 158 | emmentaler |
| pl-mozart-turkish-march | 0.3913 | 0.6957 | 1.0000 | 0.5435 | 46 | emmentaler |
| omf-piano-grand-voices-vector | 0.3000 | 0.4000 | 0.8000 | 0.8000 | 10 | corranzo |
| pl-chopin-mazurka-op6-1 | 0.2500 | 0.5000 | 0.5000 | 0.5000 | 4 | feta |

By family: musescore4-emmentaler **0.7436** (9 scores), musescore-feta **0.5208**
(3), corranzo-benchmark **0.3000** (1).

The spread is governed almost entirely by the **accidental** column: Mozart's
Turkish March has step 0.696 and octave 1.000 but accidental 0.544.

## 17. Train-vs-LOSO gap

| structure | in-sample | LOSO | gap |
|---|---|---|---|
| A factorized | 0.7637 | 0.6015 | 0.1622 |
| B direct joint | 0.8178 | 0.6456 | 0.1722 |
| C hierarchical | 0.7311 | 0.5763 | 0.1548 |
| D mlp joint | 0.7997 | 0.6494 | 0.1503 |
| E compatible | 0.7637 | 0.6015 | 0.1622 |

A ~0.15 gap on every structure. The readouts do memorise, and the gap is not
closed by joint composition. The strongest structure has the *smallest* gap.

## 18. Best readout

**D_mlp_joint — 0.6494 weighted / 0.6580 macro, 396,009 parameters.**

## 19. Exact improvement over the ~0.61 baseline

- over the recorded 0.6132 reference: **+0.0362**
- over A_factorized at the **same** 60-epoch budget: **+0.0479**
- over A_factorized at the 40-epoch budget, 3 seeds: **+0.0723 ± 0.0070 (3/3)**

## 20. PASS / FAIL

**FAIL on the gate as specified.** Two lines are not met: 0.6494 < 0.70, and
+0.0362 < the +0.05 I pre-registered over the reference. I am not moving either
line.

**But the readout hypothesis is not falsified — it is bounded.** A reproducible
structural effect exists (+0.048 matched, +0.072 at the lower budget, 3/3 seeds,
3–5× the seed noise), and the oracles show exactly why it cannot go further: the
**accidental head is a hard ceiling at 0.7604**, octave contributes nothing, and
the remaining 0.106 is split between step (0.759) and accidental (0.760).

## 21. Is any RTX experiment justified next? **No.**

An RTX run would train the same 0.4 M-parameter readout on the same 6,775 frozen
rows. It cannot exceed ~0.76, because that limit is set by P(accidental) in the
frozen representation, which no amount of compute on this input changes. GPU time
would be spent scaling a number whose ceiling is already measured.

**The binding constraint is now named precisely: the frozen embedding does not
resolve the accidental glyph.** That is a *targeted* question, not a broad one,
and it is a different object from everything falsified so far — those were
raster identity, `k`, context, and ROI-as-a-whole. A specific test would be
whether the accidental head's errors correlate with accidental-glyph visibility
in the embedding, which is answerable on CPU from the existing cache.

## Champion asset

`v25-windows-transfer-20260927` (checkpoint + frozen runtime) remains **absent**
from the primary checkout following external storage cleanup. Nothing in this
milestone needed it — the representation is the committed cache, whose sha256 is
recorded above, and the population is unchanged. **Before any future
champion-dependent benchmark, the exact frozen champion/runtime must be restored
from the RTX/Windows copy and its identity verified.** No substitute was used.
