# Phase P — Error source reduction

**Verdict: neither track improves the decoder. Stop and re-audit target
semantics before any further model work.**

| track | lever tested | result |
|---|---|---|
| A — diatonic residual | 4 notehead-centre definitions | **production box centre is already the best** (0.8370 vs 0.7151 / 0.6996 / 0.6996) |
| A | geometric signature of the ±1 cases | **none** — chords, ledgers, staff, size, \|k\| all indistinguishable from the exact cases |
| A | label-concentration test | **spread, not concentrated** — worst 3 scores hold 3.5% of the −1 errors |
| B — accidental state | measure-local state machine | **not implementable legitimately**; oracle worth **+0.0023** written pitch |

Combined structured decoder: **0.7342 weighted / 0.7006 macro** — unchanged.

---

## 1. ±1 residual taxonomy (P1)

Collected for all 6,775 objects: bbox, centre y, band centre, staff gap, `k`,
`round(2k)`, true diatonic, residual sign, chord size, ledger extent, staff role,
page/system, engraving, score. Distribution unchanged:

| residual | n | share |
|---|---|---|
| 0 | 5,671 | 0.8370 |
| −1 | 669 | 0.0987 |
| +1 | 435 | 0.0642 |
| \|r\| > 1 | 0 | 0.0000 |

## 2–3. Centre-definition comparison (P2)

All four are legitimate; none is target-derived.

| centre definition | step accuracy |
|---|---|
| **A object-box centre (today)** | **0.8370** |
| B ink centroid in the object box | 0.7151 |
| C largest dark-component centroid | 0.6996 |
| D component centroid, eroded | 0.6996 |

**The production object-box centre is the best of the four.** Pixel-derived
centres are worse because the box often contains a stem fragment, beam sliver or
ledger line, and pulling towards those biases the centre. **Lever closed.**

## 4. Error signature (P3)

| feature | res = +1 (435) | res = −1 (669) | res = 0 (5,671) |
|---|---|---|---|
| in a chord | 0.586 | 0.647 | 0.546 |
| beyond a ledger line | 0.345 | 0.383 | 0.410 |
| upper staff | 0.632 | 0.525 | 0.525 |
| mean bbox height / gap | 1.511 | 1.513 | 1.511 |
| mean \|k\| | 1.62 | 1.96 | — |

**No discriminating signature.** The exact population has *more* ledger notes
than the error populations. The residual is not chords, not ledgers, not staff,
not size, not distance from the middle line.

**Concentration test:** per-score −1 rate has median 0.0823 (IQR 0.0077–0.1249),
and the three worst scores contain only **3.5%** of all −1 errors. So it is
**spread localisation noise**, not a per-score label or alignment defect of the
kind found in Phase D. Best score 0.0077 (Bach prelude), worst 0.5000 (a 12-object
score).

## 5. Accidental-error taxonomy (P4)

697 accidental-only failures (step and octave correct, accidental wrong):

| class | n | share |
|---|---|---|
| other alteration mismatch | 391 | 0.5610 |
| **natural cancelling a predicted alteration** | 306 | **0.4390** |

So 43.9% are the cancellation case, which looked like a clean target for a
measure-local state machine.

## 6–8. Measure-state prevalence, and why the state machine cannot be built (P5, P6)

**P5 is not implementable under the stated constraint, and the reason is
structural.** A notation state machine advances its state when it *observes* an
accidental. Phase S0 established that this corpus has **no class-discriminating
printed accidental glyph** — the ink left of the notehead is no more common for
sharps than for naturals. So there is no inference-time observation that can
advance the state. The only alternative is to advance it with the true
alteration, which is exactly the forbidden label leak. A state machine fed the
key and its own predictions is constant, i.e. identical to the key rule.

**P6, the oracle diagnostic, quantifies what is on the table anyway:**

| | accidental | written pitch |
|---|---|---|
| key rule only | 0.7990 | **0.7342** |
| oracle measure state (advances with the TRUE alteration) | **0.8373** | **0.7365** |

Accidental improves by **+0.0383**, but written pitch by only **+0.0023**.

**Why:** ~94% of the accidentals the oracle fixes sit on objects whose *step* is
already wrong. Fixing the accidental on an object whose step is wrong buys
nothing on the conjunction, and step is correct on only 83.7% of objects. **The
accidental track is shadowed by the step track.**

This is reported as a diagnostic upper bound, explicitly not as a method.

## 9–12. Combined structured decoder (P7)

| component | change |
|---|---|
| notehead centre | none available (P2) |
| `d0` decoder | unchanged |
| accidental | none available legitimately (P5); oracle worth +0.0023 (P6) |

**weighted 0.7342 / macro 0.7006** — identical to the current frozen result.
Per-score and per-engraving figures are unchanged from
`out/phase_a3_closed_form.json`; there is no new winner to report.

**Improvement over 0.7342: +0.0000.**

## 13. Remaining failure modes

1. **±1 diatonic notehead-centre localisation (16.3% of objects).** The band
   geometry is exact; the object centre is the noisy input. No centre definition
   improves it, no measured geometric feature predicts it, and it is not
   score-concentrated. It is irreducible with the levers available in the
   representation as it currently stands.
2. **Accidental state (10.3% of objects, 697).** 43.9% cancellations. Not
   observable from the inputs, and worth at most +0.0023 on the conjunction
   because it is shadowed by (1).

Neither is addressable by a pitch head, and neither is a learned-residual problem
— Phase S already showed the residual returns +0.0000 from any of linear, MLP,
embedding or context inputs.

## 14. Champion runtime restore status — **NOT DONE, blocked externally**

`tmp/campaign/piano-vision-phase214/v25-windows-transfer-20260927/` (checkpoint
+ frozen runtime) is still absent from the primary checkout after the external
storage cleanup. I have no access to the RTX/Windows copy from here, so **I have
not restored it and have not substituted anything.**

Blocker for anyone continuing: the expected checkpoint is
`sha256 10fe90b9…7373e1` (26,332,539 params) and the contract records
`implementation_sha256` for the runtime files. **Verify both before use.** Any
benchmark that needs the champion must wait for that restore; cached-embedding
diagnostics can continue.

## 15. Is any RTX work justified? **No.**

Neither track moved the number, and the honest reason is that the accidental
track is shadowed by the step track. Training a larger head on a representation
whose residual is worth +0.0000 is spending compute below a zero-parameter
baseline.

---

## Decision

The stated rule was: *"If neither improves: stop and re-audit target semantics
before any model work."* **That is where this ends.**

The next audit should question the target semantics, not the model. Concretely,
the one thing this milestone did **not** settle is whether `true_d` (MusicXML
written pitch mapped through the lane's `center_diatonic`) is the right
reference for the detector's `d0`. Both are diatonic, but they are anchored
differently — `d0` uses the band **middle line** (34/22) while the corpus truth
uses the **clef reference line** (32/24). The agreement is 83.7%, and the failures
are a clean ±1 with no geometric signature, which is exactly the signature of a
**systematic anchoring difference between two conventions**, not of noise.

That is a testable, CPU-only question about the corpus contract, and it is the
right next step. It is not a model question and it does not need a GPU.
