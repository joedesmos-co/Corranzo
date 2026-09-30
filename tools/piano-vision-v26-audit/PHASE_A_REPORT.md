# Phase A — Accidental semantics, and the finding that reframes everything

**Verdict: the readout is the bottleneck, and the fix is already-computed
geometry. A closed form with ZERO training scores 0.7342 weighted / 0.7006 macro
written pitch, beating the best trained readout (0.6494) by +0.085 and clearing
the 0.70 gate.**

---

## 1. Exact accidental target definition

`align_objects.build_targets` writes:

```python
"accidentalState": {"printed": event.alter, "writtenAlter": event.alter,
                     "keyContext": {"fifths": measure.key_fifths, ...}}
```

and `musicxml_truth` fills `event.alter` from MusicXML `<pitch><alter>`. Despite
the key name `printed`, **this is not the printed accidental glyph.** In MusicXML
`<alter>` is the *effective* alteration that turns the step into the sounding
pitch, and it is set for key-signature notes with no `<accidental>` element at
all.

Measured on the evaluation population: **0 of 1,095** matched objects have a
printed `<accidental>` element in the paired MusicXML. So **no printed accidental
exists in the corpus at all**, and the target is key-signature state plus any
alteration the encoder wrote into `<pitch>`.

## 2. Accidental vocabulary and classes

`pitch_accidental = max(0, min(6, alter + 3))` — **class = alter + 3**.

| class | meaning | N | share |
|---|---|---|---|
| 2 | FLAT (−1) | 969 | 0.1430 |
| 3 | NATURAL (0) | 4,915 | 0.7255 |
| 4 | SHARP (+1) | 891 | 0.1315 |

(An earlier run of this script mislabelled these as natural/sharp/double-sharp —
an off-by-one in my own display table, since class = alter + 3. Corrected here.)

## 3. The frozen accidental head is below the majority baseline

| | value |
|---|---|
| P(accidental), frozen head | **0.6874** |
| majority baseline (always NATURAL) | **0.7255** |

| class | N | precision | recall | F1 |
|---|---|---|---|---|
| 2 FLAT | 969 | 0.2804 | 0.1311 | 0.1786 |
| 3 NATURAL | 4,915 | 0.7469 | 0.8983 | 0.8156 |
| 4 SHARP | 891 | 0.2798 | 0.1291 | 0.1767 |

The head is near-useless on both altered classes (F1 ≈ 0.18) and only learns to
say NATURAL.

## 4. Confusion matrix (frozen head, rows true / cols predicted)

| | pred 2 | pred 3 | pred 4 |
|---|---|---|---|
| **true 2** FLAT | 127 | 814 | 28 |
| **true 3** NATURAL | 232 | 4,415 | 268 |
| **true 4** SHARP | 94 | 682 | 115 |

## 5. A pure key-signature rule scores 0.8749

Using only the key signature in force and the step letter — no pixels, no model:

| predictor | accuracy on matched rows |
|---|---|
| key signature alone | **0.8749** |
| key signature or printed glyph | 0.8749 (identical — there are no printed glyphs) |
| frozen champion accidental head | 0.6874 |

**The accidental component is a semantic, key-derived quantity, and a trivial
rule beats the model by +0.19.** Calling this "accidental glyph recognition"
would have been wrong.

## 6–9. The closed form, and the bug I hit on the way

`phase_a3_closed_form.py` computes, with **no labels and no training**:

```
d             = middle-line diatonic (34 upper / 22 lower) + round(2k)
step          = "CDEFGAB"[d mod 7]
octave        = d // 7
accidental    = key_alter(frozen_context_key_fifths, step) + 3
```

`k` is the detector's own staff-relative position; `fifths` is the **frozen
context head's** key prediction (0.9804 accurate on production). Both legitimate
at inference.

**A bug I introduced and fixed:** the first run cast `k` to `int64` *before*
computing `2*k`, truncating −3.0263 to −3 and destroying the sub-space precision
the calculation depends on. That produced a spurious 0.2487 and briefly looked
like a contradiction of Gate F0's 0.837. A record-level check isolated it. The
cast is now done *after* `2*k`.

Result on the identical population, N = 6,775:

| | closed form | best trained readout (D_mlp_joint) |
|---|---|---|
| step | **0.8370** | 0.7591 |
| octave | **0.9782** | 0.9596 |
| accidental | **0.7990** | 0.7629 |
| **written pitch** | **0.7342** | 0.6494 |

**written pitch +0.0848, macro 0.7006, zero training, zero learned parameters.**

Per engraving: emmentaler 0.7219 (11 scores), feta 0.7077 (3), corranzo 0.6154
(3). Per score it beats the trained readout on **9 of 13** comparable scores, mean
paired delta **+0.0743**, with the largest wins on the largest scores
(Turkish March +0.3415, mazurka +0.3734, etude op10-12 +0.1033, fugue +0.0875).

## 10. Explicit vs contextual separability

Not applicable in the form the brief anticipated, and the reason is decisive:
**there are no explicit accidental glyphs in this corpus.** Every one of the
6,775 accidental targets is key-derived. So "explicit-glyph subset vs
non-explicit semantic-state subset" has an empty first arm. A6 (accidental
micro-ROI) and A5 (pixel separability) are therefore **not warranted** — there
is no printed accidental in the pixels to find, by construction.

## 11–13. Micro-ROI and targeted context

- **A6 (accidental micro-ROI): not run, and not warranted.** With 0 printed
  accidentals in the paired source, a crop of "the region left of the notehead"
  would be testing pixels that carry no target information.
- **A7 (targeted context): run implicitly and decisively.** The closed form uses
  the frozen key head and reaches accidental 0.7990 / key-rule-given-true-step
  0.8276, against the trained head's 0.7629. The broad Phase G2 context arm
  looked inert because it was measured on *overall* written pitch, where the
  accidental is one of three components and a +0.03 accidental gain is diluted
  threefold. Measured directly, context is decisive.

## 14. Bottleneck verdict

**READOUT — conclusion 1.** Not visual, not label/source, not representation.

The frozen representation and the detector's geometry already contain the
information: a deterministic function of the staff-relative position and the
frozen key head reaches 0.7342. The learned readout reaches only 0.6494 because
it is asked to *rediscover* that coordinate from a 480-d embedding instead of
being given it.

This also explains the earlier "k is inert (+0.005)" result honestly: in Phase F
the adapter was **additive on frozen logits**, so it could not restructure the
decision. A readout *built around* the closed-form coordinate is a different
object and behaves differently.

## 15. Written-pitch ceiling estimate

Written pitch is bounded by P(step). The closed form gives:

| bound | value |
|---|---|
| P(step) from detected geometry | 0.8370 |
| octave given step | ~0.9782 |
| accidental from key rule given true step | 0.8276 |
| **current closed-form written pitch** | **0.7342** |
| ceiling if the accidental used the key rule with the closed-form step | ~0.75–0.78 |

So the realistic ceiling for the labelled task is **~0.80**, not the 0.7484
quoted from Phase D — that number was measured against the wrong-object labels
and is superseded.

## 16. Is any RTX experiment justified? **No — but the next step is now cheap and specific.**

A 0.4M-parameter readout on a 6,775-row CPU cache cannot beat a closed form that
already scores 0.7342. Scaling GPU time on it would be spent beneath a baseline
that needs no training at all.

The concrete next step, which is CPU-scale and does not need the missing
champion: **a readout that consumes the closed-form diatonic coordinate
explicitly** — feed `d` (or `k` and the role) as a conditioning input and let the
network predict only the residual. The floor is already 0.7342; the ceiling is
~0.80. Expected gain is bounded and knowable before any training is launched.

---

## Corrections to earlier reports

1. **The 0.837 closed form is not a written-pitch number.** It is a
   letter-and-register match on a different population. On the metric population
   it is P(step) = 0.8370, and the corresponding written pitch is **0.7342**.
2. **The "detected-geometry ceiling 0.7484" is superseded** by 0.7342 measured on
   corrected corpus 2.1. The old figure used the wrong-object labels.
3. **`accidental` is not a glyph target.** It is key-signature-derived, with zero
   printed accidentals in the corpus. Any future work describing it as glyph
   recognition would be aiming at the wrong thing.
