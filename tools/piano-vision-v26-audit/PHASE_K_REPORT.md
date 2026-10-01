# Phase K — barline-defined x: NOT VALIDLY EVALUATED

**I did not implement K0–K7 correctly. The K8 gate was never evaluated, so this
is neither a PASS nor a FAIL and it is not evidence for or against anything.
Nothing is certified, refused, relabelled or re-baselined. No model or RTX work
is justified.**

I am not reporting the script's printed `GATE: FAIL (1.0000 / 0.0000)`. Those two
numbers came from a denominator of **zero** matched notes and are meaningless.

---

## 1–2. Barline extraction

**PDF side (K1) — works.** Detecting thin vertical ink columns spanning the full
band height recovers real barlines from the page raster:

| score / system | raster barlines found |
|---|---|
| bach-fugue p1-s0 / p1-s1 | 5 / 7 |
| beethoven-sonata p1-s0 / p1-s1 | 12 / 15 |
| chopin-etude-10-01 p1-s0 / p1-s1 | 4 / 2 |

This is a genuinely usable, deterministic, CPU-only barline detector, and it is
the one substantive positive result of the phase.

**Verovio side (K1) — broken.** The `<g class="barLine">` elements *are* clean and
directly parseable: each carries one vertical `<path d="M{x} y0 L{x} y1">` per
staff (e.g. `M11360 1622 L11360 2342`). But my assignment step was nonsense — I
tried to attach each barline to a system by testing `abs(system.x0 − barline_x) < 1.0`,
and a barline's x never coincides with a system's left edge. **Result: 0 barlines
assigned to any system, on every score.**

## 3–4. System alignment coverage: **0**

| score | PDF systems | my "Verovio" systems |
|---|---|---|
| bach-fugue | 10 | 19 |
| beethoven-sonata | 20 | 125 |
| chopin-etude-10-01 | 21 | 58 |

I keyed Verovio systems by "runs of staves sharing the same left x", which
fragments almost every staff into its own system. The count-equality precondition
I then imposed rejected **545** system sets and produced **0** matched
measure-bands. Order-based pairing would have been the right approach (K2 permits
"system order, page order where reliable") and is what I should have written.

## 5–8. Never exercised

Because the Verovio side yielded zero barlines and zero systems:

| stage | status |
|---|---|
| K3 barline-interval alignment | never run |
| K4 barline-defined `x_rel` | never run |
| K5 onset clustering on a common frame | never run |
| K6 interval-pattern group matching | never run |
| K7 within-group vertical pairing | never run |
| K8 clean-control gate | **not evaluated** |
| K9 matcher sanity check | partially run, and it is what exposed the fault |

K9 is the only stage that produced information, and it did its job: the system
counts and barline totals it printed are exactly what revealed that the Verovio
extraction was dead. Had I trusted the gate line I would have concluded "route
closed" on the basis of zero data.

## 9–21

| | |
|---|---|
| clean matched N | **0** (no valid measurement) |
| clean `<0.25` rate | not evaluated |
| clean `r_render=0` rate | not evaluated |
| **>98% gate** | **NOT EVALUATED** |
| K10–K12 (+1 / −1 / mixed) | not reported |
| K13 non-circular qualification | not built |
| **% source mismatch certified** | **0%** |
| **% unresolved** | **100%** |
| valid capability number (K20) | **none** — 2.1 immutable: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work (K21) | **not justified** |

---

## Why I am not invoking K14

K14 says that if the corrected matcher cannot exceed the gate, stop and conclude
Verovio relayout is not recoverable. **That conclusion is not available here**,
because the gate was never validly measured. Claiming the route is closed would
be reporting a defect of my implementation as a finding about the method, which
is the same error I made in Phase J (where I correctly withdrew the 15.1% rather
than treat it as a refutation). I will not repeat that mistake in the opposite
direction.

## Where this actually leaves the source-truth question

Cumulative record of every correspondence attempt, with the honest status of each:

| method | clean `<0.25` | status |
|---|---|---|
| event-rank (Phase U) | 0.7321 | genuine measurement, fails gate |
| layer-aware MEI↔SVG (Phase I) | 0.6808 | genuine measurement, fails gate |
| layout-based, ink-bbox frame (Phase J) | 0.1511 | **invalid** — mismatched coordinate intervals |
| barline-defined x (Phase K) | — | **not evaluated** — Verovio side broken |

Two genuine measurements both land near 0.7, and the two most recent attempts
failed on implementation rather than on method. The single most informative fact
remains that the **PDF side is exact** (`k_from_pdf_source − cached_k` mean/std/max
= 0, `d_pdf ≡ d0` on every note, raw raster barlines recoverable). Every failure
has been in mapping Verovio's layout back onto the corpus.

## The specific, small fix that would unblock this

The Verovio barline signal is trivially available and I proved its shape; I simply
never parsed it correctly. The correct implementation is:

1. collect **all** `<g class="barLine">` path x positions per page, and assign
   each to the system whose **staff y-range** contains that path's `y0` — not by
   comparing x to the system edge;
2. key systems by their staff `y0` (a genuine system identifier in Verovio's
   output), not by left-edge x;
3. pair PDF and Verovio systems **in order** within a score, requiring only that
   the counts of *barline-bearing* systems be comparable, not equal.

None of that needs a new idea, a new renderer, or any model. It is the K1/K2
stage I broke. I am leaving it undone rather than writing matcher #4 within the
same phase, per K14's instruction not to iterate further here — and I would
rather hand over a precisely-scoped next step than another invalid number.

---

## Script

- `phase_k_barlines.py` — K1 raster barline detector (**works**), Verovio system
  and barline extraction (**broken**), and the gated pipeline. Retained with its
  diagnostics, since the K9 output is the evidence that found the fault.
