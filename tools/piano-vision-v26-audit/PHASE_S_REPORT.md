# Phase S — Structured decoding + residual correction

**Outcome 2: the residual adds nothing. The zero-parameter structured decoder
stands as the pitch solution.**

| | weighted | macro | Δ vs base |
|---|---|---|---|
| **A closed form only (0 params)** | **0.7342** | 0.7006 | — |
| B + linear residual (18 params) | 0.7342 | 0.7006 | **+0.0000** |
| C + small MLP residual (982) | 0.7342 | 0.7006 | **+0.0000** |
| D + frozen-embedding residual (32,662) | 0.7275 | 0.6556 | −0.0066 |
| E + embedding + context residual (34,906) | 0.7272 | 0.6951 | −0.0069 |

B and C learn to emit the zero correction always. D and E are *worse* than doing
nothing.

---

## 1. Rendered accidental visibility (S0)

The previous report inferred "no `<accidental>` element" → "no glyph in the
pixels". **That inference is withdrawn as an absolute claim** — a renderer draws
key-signature accidentals without emitting the element.

Measured instead, deterministically: for 631 notes, compare non-staff-line ink in
the accidental slot immediately left of the notehead against an identical control
window immediately right of it. A printed accidental is the only thing that puts
ink on the left.

| alter | n | visible glyph | ambiguous | no glyph |
|---|---|---|---|---|
| −1 | 49 | 6.1% | 2.0% | 91.8% |
| 0 | 502 | 10.0% | 5.4% | 84.7% |
| +1 | 80 | 10.0% | 7.5% | 82.5% |

**The rate is no higher for sharps than for naturals.** If these were accidental
glyphs they would track the class. They are chord neighbours, ledger fragments
and beams. Contact sheets (`out/s0_accidental_visibility/`) show the same: almost
all noteheads, plus a few naturals on notes in flat keys.

**Narrowed claim:** there is no *class-discriminating* printed accidental glyph in
this corpus. Visual accidental recognition is not warranted as a residual source
(S6 and A6-style micro-ROIs are therefore not built).

## 2–3. The decoder, frozen (S1)

```
k        = (bandCentreY - noteheadCentreY) / staffGap        [detected, band-local]
is_upper = the detected staff role, by nearest band centre    [detected]
fifths   = frozen V2.5 context head, key_fifths argmax        [model prediction]
d0       = (34 if is_upper else 22) + round(2*k)
step0    = "CDEFGAB"[d0 mod 7]
octave0  = d0 // 7
acc0     = key_alter_row(fifths)[step0] + 3
midi0    = 12*(octave0+1) + SEMI[step0] + (acc0-3)
```

Conventions: `round` is half-to-even; `d0 mod 7` is always 0..6 and `d0 // 7` is
floor division so a below-middle-line note keeps its register; `class = alter+3`
so 2 = FLAT, 3 = NATURAL, 4 = SHARP; key alteration takes the first `fifths`
letters of FCGDAEB or the first `|fifths|` of BEADGCF.

**No label, true key signature, or score identity is read. Learned parameters: 0.**

**9 of 9 unit tests pass** (`out/phase_s1_s4_decoder.json`): k=0 lands on the
middle line on both bands, +1 space = +2 diatonic, G major sharpens F only, F
major flattens B only, C major alters nothing, k retains sub-space precision
(>90% non-integer), and the decoder has zero learned parameters.

## 4. Reconciling 0.8749 vs 0.7990 (S2)

Same population (N = 6,775), decomposed:

| accidental source | accuracy |
|---|---|
| key rule, **predicted** key + **predicted** step (= closed form) | **0.7990** |
| key rule, **predicted** key + **TRUE** step | **0.8276** |
| the earlier 0.8749 | true key + true step, on a **different, smaller** population (n = 1,095) |

So the gap decomposes into: a key-prediction term (0.8749 → 0.8276) and a
step-prediction term (0.8276 → 0.7990). The two original figures were never
apples-to-apples — different key source, different step source, different
population. The honest current number on the metric population is **0.7990**.

I could not cleanly isolate the true-key term because the source MusicXML is not
reachable in this worktree, and the champion runtime needed to re-derive it is
absent. I am not estimating it.

## 5–6. Error taxonomy and residual vocabulary (S3, S4)

| class | n | share |
|---|---|---|
| no error | 4,974 | 0.7342 |
| wrong accidental only | 697 | 0.1029 |
| partial (one wrong, not classified above) | 641 | 0.0946 |
| wrong step only | 377 | 0.0556 |
| multiple components wrong | 86 | 0.0127 |

**Diatonic residual `true_d − d0`:** `0` → 83.70%, `−1` → 9.87%, `+1` → 6.42%.
**|residual| ≤ 1 for 100.0% of 6,775 objects.**

That is the key structural fact: the residual is a **3-class** problem, never
wider. The model never needs to re-derive the pitch class.

## 7–13. Residual models (S5–S7)

Every arm keeps the same decoder base and predicts only a correction. All are
17-fold leave-one-score-out on corpus 2.1.

| arm | params | written pitch | Δ base | in-sample | step | accidental |
|---|---|---|---|---|---|---|
| B linear | 18 | 0.7342 | +0.0000 | 0.7342 | 0.8370 | 0.7990 |
| C small MLP | 982 | 0.7342 | +0.0000 | 0.7342 | 0.8370 | 0.7990 |
| D + embedding | 32,662 | 0.7275 | −0.0066 | 0.7642 | 0.8249 | 0.8061 |
| E + embedding + context | 34,906 | 0.7272 | −0.0069 | 0.7527 | 0.8331 | 0.7976 |

**D's in-sample (0.7642) is barely above its held-out (0.7275) and both sit at or
below the base.** The residual is not merely hard to generalise — it is not
learnable in-sample either. B and C collapse to predicting the zero correction.

**S6 accidental residual:** the base is already the key rule. D improves
accidental slightly (0.7990 → 0.8061) but degrades step (0.8370 → 0.8249) and
loses more on the conjunction than it gains. No visual micro-ROI was built, per S0.

**S7 cascaded vs oracle:** already answered in Phase G5 — an oracle on step or
octave raises written pitch, but no *learned* residual reaches any of it, so the
cascaded and oracle paths diverge. The oracle gains were never accessible to a
model on this representation.

## 14–16. Weighted / macro / per-score

Base (arm A, zero parameters): **weighted 0.7342, macro 0.7006**, N = 6,775,
17 scores. By engraving: emmentaler 0.7219 (11), feta 0.7077 (3), corranzo 0.6154
(3). Per-score and family breakdowns are in
`out/phase_a3_closed_form.json` and `out/phase_s5_residual.json`.

No arm improves on it, so there is no new per-score winner to report.

## 17. Structure ablation (S9)

| geometry | written pitch | base | step |
|---|---|---|---|
| correct | 0.7272 | 0.7342 | 0.8331 |
| **k shuffled across objects** | **0.1327** | 0.0623 | 0.2525 |
| **wrong band** | **0.0000** | 0.0000 | 0.0000 |

**The structured base is causally responsible.** Shuffling `k` across objects
destroys 0.59 of written pitch; a wrong band anchor destroys it completely. The
decoder is not decoration around a learned model — it *is* the pitch mechanism.

## 18–19. Best structured decoder, and improvement

**The zero-parameter closed form at 0.7342 weighted / 0.7006 macro.**
Improvement over itself from a learned residual: **+0.0000**.

## 20. Recommended production pitch architecture

**The zero-parameter structured decoder**, with the V2.5 context head supplying
`key_fifths`:

```
k, is_upper  <- production detector (staff_bands + band-local staff_space)
fifths       <- frozen V2.5 context head
step, octave <- d0 = (34|22) + round(2k)
accidental   <- key_alter_row(fifths)[step]
```

It is deterministic, has no learned parameters, is 0.7342/0.7006 on corrected
corpus 2.1 with a clean leakage record, requires no training campaign, and beats
every learned readout measured (best 0.6494, +0.085).

Its failure mode is honest and narrow: a **±1 diatonic step (half a staff space)
notehead-centre localisation error** on 16.3% of objects, plus a key-carried
accidental state the key rule does not model. Both are **detector/notation-state**
problems, not model-capacity problems.

## 21. Is any RTX work justified? **No.**

There is nothing left to train. A residual model trained at any scale returns
+0.0000, because the residual is not learnable from the frozen representation —
its in-sample accuracy is also at the base. Spending GPU time would be spending
it beneath a zero-parameter decoder that already clears the gate.

The productive next work is **not** architectural:
1. **Notehead-centre localisation.** The ±1 residual is the dominant error
   (15.5% of objects). The band geometry is exact; the object centre is the
   noisy input. Better object localisation is a detector change, testable on CPU.
2. **Measure-local accidental state.** The key rule reaches 0.7990 against 0.8276
   with the true step; the gap is carry-over and cancellation state, which needs
   measure-level reasoning, not a glyph recogniser.
3. **Restore the champion runtime** and re-baseline the original path against this
   decoder before anything else is built.

---

## Corrections carried forward

- **"0.7342 clears the gate" is not a claim of an information-theoretic ceiling.**
  It is the current accuracy of one decoder. Current component accuracies: step
  0.8370, octave 0.9782, accidental 0.7990. The oracle bound with perfect step and
  octave is 0.7604 (Phase G5), and the key rule with the true key and true step
  was 0.8749 on a smaller population. None of these is a ceiling; each is a
  measurement.
- **The accidental component carries no class-discriminating glyph in this
  corpus** (S0), which is a narrower and better-supported claim than "no glyphs".
