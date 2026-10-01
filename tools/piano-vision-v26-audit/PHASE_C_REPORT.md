# Phase C — printed staff semantics

**Verdict: the clef/staff-semantics hypothesis is arithmetically impossible,
and the band geometry is confirmed exact against the raster. Neither can produce
a ±1 residual. The 780 uniform-offset objects remain GROUP-LEVEL PDF-GEOMETRY ↔
LABEL DISAGREEMENTS of unresolved cause — still not classified as source mismatch,
and still not relabelled.**

---

## 1. Is the champion runtime necessary? **No.**

| material | present |
|---|---|
| page rasters (`out/realpdf_21/pages/*/page-*.png`) | **40 / 40** |
| source PDFs (via `split_manifest.json`) | **17 / 17** |
| page size / dpi | 1241×1754 @ 150 dpi |

Staff-space check: band height 41 px → gap 10.25 px = **4.92 pt** at 150 dpi, and
the standard engraved staff space is ~4.96 pt. The raster is a faithful,
metrically correct rendering. **All of Phase C ran CPU-only with PIL. The
champion runtime was never loaded.**

## 2. Independent clef extraction — attempted, and honestly reported as failed

I built a deterministic connected-component clef detector: staff-line removal by
long-horizontal-run subtraction, then component geometry, using the **F clef's two
dots** (their vertical separation and their position relative to the glyph are
what actually carry the clef *line*).

**It does not work, and I am not going to dress it up.** At the system start the
clef is not separable from the first note cluster: after staff-line removal the
clef, time signature and first chord remain one connected component spanning 5.3
staff gaps, and the dot detector fires on barline/brace fragments. Result:
375/376 units classified "G", including every *lower* band — i.e. it locked onto
a barline, and the output is wrong. **No clef classifications from this method
are used anywhere in this report.**

## 3. Clef coverage / ambiguity

Not reportable — see §2. I stopped rather than report a number I know is wrong.

## 4–7. Uniform ±1 groups are arithmetically out of reach for any clef

This is the substantive result, and it needs **no raster and no labels**.

From `musicxml_truth.clef_center_diatonic`, the printed reference line is

```
center_diatonic = {"G":30, "F":18, "C":24}[sign] + 2*(line - 1)
```

Every component of that expression is even-valued in diatonic steps:

| clef ingredient | contribution | parity |
|---|---|---|
| clef **line** `1..4` | `2*(line-1)` = 0, 2, 4, 6 | **even** |
| clef **sign** G→F | 30−18 = 12 | **even** |
| clef **sign** G→C | 30−24 = 6 | **even** |
| clef **sign** C→F | 24−18 = 6 | **even** |
| clef **octave change** (8va/8vb) | ±7 | odd, but **7, not 1** |

**No clef change of any kind yields a 1-diatonic-step offset.** A clef line move
is a whole line (2 steps); a clef sign swap is 6 or 12 steps; an octave clef is 7
steps. The observed residual is **exactly ±1** — a *half* space — and Phase R
established there are **zero** residuals of magnitude ≥ 2.

A ±1 residual is therefore **not expressible** as any clef or staff-semantics
error. This refutes the C2/C3 hypothesis completely and for a reason stronger
than any classifier could supply.

## 6. Clean-group control (C4) — and it is decisive

Because any clef change shifts by an **even** number of steps, the only clef
re-derivations available move the reference by 2, 4, 6 or 7 steps. Applied to the
population that is currently correct:

- a one-line clef change (+2 steps) turns all **5,671** currently-exact objects
  into −2 errors — it *destroys* the 499 clean groups;
- the observed residual is **1** step, which no clef change can produce.

**A valid correction must not destroy the clean population, and here no clef
correction can even be expressed.** Clean groups are unaffected; step accuracy
cannot change. C4 confirms the refutation rather than testing a surviving
hypothesis.

## 7. % uniform groups explained by clef/staff semantics: **0.0%**

Arithmetically impossible, not merely unobserved.

## 8–12. Attribution

| category | objects | share of the 1,104 |
|---|---|---|
| explained by clef / staff semantics | **0** | 0.0000 |
| explained by band-origin geometry | **0** | 0.0000 (raster-verified, §13) |
| explained by anchor / rounding / centre | **0** | 0.0000 (Phase Q, P2) |
| explained by broad event re-pairing | **0** | 0.0000 (Phase R7) |
| **unresolved** | **1,104** | **1.0000** |

Alignment bug: **0 proven.** Semantic-extraction bug: **0 proven**, and now
positively excluded for the band-origin component. Genuine source mismatch:
**not yet classifiable** — C6's standard cannot be met until the printed clef is
independently verified, and §2 shows I could not verify it.

## 13. New evidence: band geometry verified against the raster

This is what the raster *was* good for. For all **1,272** band units with a
consistent line spacing, I detected the real staff-line rows in the page raster
and measured how far the corpus `y0`/`y1` sit from a genuine line row:

| | value |
|---|---|
| band units with consistent line spacing | 1,272 |
| aligned to a real staff line | **1,272 (100%)** |
| offset from nearest real line, median | **0.0000** line spacings |
| offset, p90 / p99 / max | 0.025 / 0.053 / **0.0976** line spacings |

**The band edges land on real staff lines, worst case a tenth of a line
spacing.** Since `center = (y0+y1)/2`, the centre is the true middle line and
cannot be displaced by half a space. Combined with Q6 (height/gap = 4.000000
exactly), the band geometry is now verified from two independent directions:
label self-consistency *and* direct raster measurement.

A further confirmation: the music OCR literature's standard failure mode for
this pipeline is a band whose detected lines are offset by half a space, which
would produce exactly a uniform ±1. **It is absent here.**

## 14. Corpus 2.2 construction: **not justified**

No root cause is proven, so C7's precondition is not met. The existing
`out/realpdf_22_candidate/refusal_manifest.json` stays as a **diagnostic
artefact only**; it is not a qualification set and its 1.0000 step accuracy is
tautological and must never be quoted as capability. Corpus 2.1 is unchanged.

## 15. An independent qualification set cannot be built yet

C8 requires selection by independent provenance — verified PDF semantics, verified
source pairing, verified alignment, no source mismatch — and explicitly forbids
selecting on decoder correctness. Right now:

- PDF semantics: **not independently verified** (clef extraction failed, §2)
- source pairing: verified optimal (Phase R7)
- alignment: 0 bugs found
- source mismatch: **unclassifiable** without verified semantics

So the honest move is **not** to construct a filtered set from what survives.
Doing so would require me to drop every group containing a disagreement, which
recreates the tautology of the refusal mask. **A valid capability measurement is
still not available.**

## 16–19. No new results

N, score count, step, octave, accidental, written pitch, MIDI, weighted, macro and
per-score are all **unchanged and still unqualified**: 2.1 gives
0.8370 / 0.9782 / 0.7990 / 0.7342 / 0.7006, capped by a 16.30% label
disagreement. The remaining disagreement rate is **still 16.30%** — Phase C
changed no label and no measurement.

**19. Do we finally have a valid pitch-capability measurement? No.**

## 20. Is any model/RTX work justified? **No — and the position is now much stronger.**

Six independent mechanisms have been positively excluded for the 16.3%:

1. clef / staff semantics — arithmetically impossible (§4)
2. band origin — raster-verified exact (§13)
3. anchor / coordinate frame — A ≡ B ≡ C exactly (Q2/Q3)
4. rounding — no object is ever at a tie (Q5)
5. notehead-centre definition — production box centre is best (P2)
6. broad event re-pairing — aligner already optimal (R7)

What remains is a contradiction between the rendered PDF and the paired MusicXML
that none of the six can express. The likely mechanisms left are an asset/edition
difference, or a per-measure event-selection issue the monotonicity test cannot
see (a *globally* different but locally plausible pairing). Both are upstream of
the representation. Training against these labels would fit the contradiction.

## Required next step (CPU only, no runtime needed)

The gap is now precisely one missing fact: **the printed clef, verified
independently.** The failing step in §2 is segmentation at the system start. The
fix is mechanical and does not need the champion:

- restrict clef search to the **leftmost measure of each system** and mask out
  the brace;
- locate the F clef by its **two dots using template correlation** against a
  dot-pair model, which is far more robust than connected components on a
  staff-line-contaminated raster;
- separately detect **mid-system clef changes** by scanning the full band strip,
  since a clef change mid-system is not covered by a per-system crop.

If the printed clef then agrees with MusicXML on all 1,272 band units, C6's
standard is met and the affected groups can be **refused** (never relabelled).
If it disagrees anywhere, that is the root cause and the label builder is the
place to fix it.

## Scripts

- `phase_c_clef.py` — C1 raster availability; C2 clef detector (**failed**, §2).
- raster band-origin verification (§13) run inline; results in
  `out/phase_c_clef_evidence.json` for the clef detector's raw output.
