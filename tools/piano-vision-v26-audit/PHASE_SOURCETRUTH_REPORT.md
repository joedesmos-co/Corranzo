# SOURCETRUTH — independent PDF ↔ Verovio-rendered MusicXML comparison

**I withdraw my Phase R3 reasoning.** I said Verovio "renders `true_d` by
construction so it cannot arbitrate." That was wrong. The purpose was never to
validate `true_d` against itself — it was to compare **two independent source
documents**. The original PDF and a fresh render of the paired MusicXML are
genuinely independent, and this is the first measurement in the whole campaign
that does not touch `d0`, `true_d`, a pitch label, clef semantics or the decoder.

**Result: the method validates cleanly, and the affected groups do carry a real,
symmetric, reproducible source-vs-source displacement — but it is ~0.35 diatonic
steps, not the ±1 the integer corpus residual asserts. No group is certified
under SOURTECRUTH-9, nothing is relabelled, and no capability number is claimed.**

---

## 1. PDF↔XML-render alignment method

1. **Render** each paired MusicXML with Verovio (17/17 scores, 1,851
   (measure, staff) blocks). No corpus data involved.
2. **Read the five staff lines** directly from the Verovio SVG
   (`<g class="staff">` → five horizontal `<path d="M x y L x y">`, e.g.
   y = 1622/1802/1982/2162/2342, gap 180.0).
3. **Read every notehead centre** from the SVG
   (`<g class="notehead">` → `<use transform="translate(x, y)">`).
4. **Normalise both sources to staff space**:
   `y_staff = (middle_line_y − notehead_y) / staff_gap`, with
   `middle_line = lines[2]`. This is invariant to DPI, renderer scale, page
   margins, clef and absolute y — the PDF side uses the corpus band centre and
   band-local gap, both raster-verified in Phase C.
5. **Pair by order, never by pitch.** Where cardinalities are equal, pair by
   printed/document order. Where they differ, align **monotonically on the
   continuous staff position** (Needleman–Wunsch on `|Δy|`, gap penalty 1.2,
   tolerance 0.30) and reject the group if fewer than 60% of the shorter
   sequence can be matched. No pitch, no clef, no residual enters the cost.
6. `delta_steps = round(2 * (pdf_y_staff − xml_y_staff))`.

**Coverage: 974 of 976 measure-bands matched, 6,367 notes, 2 rejected.**

## 2–3. Matched / rejected

| | count |
|---|---|
| matched measure-bands | **974** |
| rejected (insufficient monotone match) | 2 |

## 4. Clean-control delta distribution — the method is valid

| control | notes | delta_steps |
|---|---|---|
| **clean groups** | **2,136** | **+0 : 1.0000** |

**Every single clean-control note agrees exactly**, with **within-group offset
variance 0.00011** and **0.0%** of clean groups exceeding 0.3 spaces of offset.
Had the normalisation, the staff-line extraction, or the order matching been
wrong, this control would have shown a spread. It does not. **The method is
sound.**

## 5–6. Uniform groups: delta distribution

Note the sign relation: `d0 = MIDDLE + round(2·pdf_y)` and
`true_d = MIDDLE + 2·xml_y`, so **`delta_steps ≈ −residual`**. A corpus residual
of `−1` therefore appears here as `delta_steps = +1`.

| class | groups | mean offset (spaces) | mean offset (steps) | within-group var | \|off\|>0.3 |
|---|---|---|---|---|---|
| clean | 398 | −0.0524 | −0.1047 | **0.00011** | 0.0000 |
| mixed | 253 | −0.0281 | −0.0563 | 0.58368 | 0.2055 |
| uniform **+1** | 187 | +0.1211 | +0.2422 | 0.04390 | 0.0802 |
| uniform **−1** | 103 | −0.2335 | −0.4670 | 0.04744 | 0.2524 |

**Stability check.** Repeating the whole run at `tol` = 0.30 / 0.60 / 0.90 gives
identical offsets to 4 decimals (clean −0.1051 / −0.1047 / −0.1047 steps;
uniform−1 −0.4689 / −0.4670 / −0.4670). The measurement is **not** an artifact
of the alignment tolerance absorbing a shift.

**Baseline-corrected against the clean population** (subtracting the clean mean
of −0.0524 spaces):

| class | corrected offset (spaces) | corrected offset (steps) |
|---|---|---|
| uniform **+1** | +0.1735 | **+0.347** |
| uniform **−1** | −0.1811 | **−0.362** |

**A clean, symmetric, reproducible displacement of ≈ ±0.35 diatonic steps
(≈ 0.18 staff spaces) in the two opposite directions.**

## 7–8. Relative contour and within-group variance

Within-group offset variance is **0.044 / 0.047** for the uniform populations
against **0.00011** for clean — three orders of magnitude larger than the clean
baseline, i.e. the offset is a tight per-group constant rather than scatter, which
is what a systematic displacement looks like. Absolute contour agreement is
**401/974 = 0.4117** overall; the clean population carries essentially all of the
well-behaved cases, and the uniform populations add many small-|Δ| step roundings
that fail a strict 0.12-space interval tolerance.

## 9–11. Certification outcome

| | |
|---|---|
| **% uniform groups proven genuine source mismatch** | **0%** |
| % proven corpus/object-extraction issue | 0% |
| **% unresolved** | **100%** of the 1,104 |

SOURTECRUTH-9 requires the PDF and the XML-rendered noteheads to differ by *the
same ±1 offset*. They do not: the independent measurement gives **≈0.35 steps**,
not 1.0. The corpus asserts ±1 because it quantises the position to the nearest
diatonic step, and ≈0.18 spaces sits just past the 0.25-step rounding boundary —
so the integer residual overstates the physical displacement by roughly 3×.

**So the honest verdict is (C) partial, not (A) proven.** I have established that
a real, reproducible, source-vs-source displacement exists and that the corpus
residual is a *rounded* consequence of it, but I cannot certify a group as
genuine source mismatch without explaining why the physical offset is a third of
a step rather than half a space. No group is certified. **Nothing is relabelled
and no PDF object is rewritten from geometry.**

## 12. Mixed-group taxonomy

The 253 matched mixed groups show mean offset −0.056 steps with within-group
variance **0.584** — 13× the uniform populations and 5,000× the clean baseline.
So the mixed groups are **not** a uniform displacement with noise; they are
genuinely irregular, consistent with local per-note disagreement. Given the
±1-only residual and the near-zero group mean, the most probable morphology is
**local per-note source disagreement** rather than any group-level shift. I am
not splitting them further: the absolute offsets cluster at 0, which means the
±1 integer residuals there are the same rounding-boundary effect, not a distinct
mechanism. **Unresolved, and explicitly not assumed to share the uniform cause.**

## 13. Refusal policy

**Unchanged and conservative.** Nothing is refused as "source mismatch" yet,
because C6/SOURTECRUTH-9 is not met. `out/realpdf_22_candidate/refusal_manifest.json`
remains a **diagnostic artefact only**; its 1.0000 step accuracy is tautological
and is never quoted as capability. Corpus 2.1 is untouched and immutable.

## 14–15. Qualification set: not constructed

C8/SOURCETRUTH-11 forbids selecting on decoder correctness, `d0 == true_d`, or
residual == 0. Every provenance rule available to me right now is either
unverified (PDF semantics) or would require discarding exactly the groups whose
status is unknown — which recreates the refusal tautology. **No qualification
set is built.**

## 16–19. No rebaseline

No new numbers. 2.1 remains 6,775 labels, 16.30% disagreement, step 0.8370,
octave 0.9782, accidental 0.7990, written pitch 0.7342 / 0.7006 — all still
capped by label disagreement and still **not** a capability measurement.

## 20. Do we have a valid pitch-capability measurement? **No.**

## 21. Is any model/RTX work justified? **No.**

Stronger than before. The decoder is exact, six mechanisms are excluded, and now
two *independent* source documents are shown to disagree by a real, reproducible
amount. Training on these labels would fit that disagreement.

---

### What this milestone actually established

1. **A valid, independent measurement instrument.** Source-vs-source staff-space
   comparison, validated at 2,136/2,136 on the clean control, stable across
   alignment tolerance. This is reusable and did not exist before.
2. **The corpus residual is a rounded proxy, not a physical displacement.** The
   true source disagreement is ≈0.35 diatonic steps; the integer label records
   ±1. Any downstream reasoning that treated ±1 as "one staff position" was wrong
   by ~3×.
3. **The disagreement is real and systematic**, symmetric in both directions,
   with per-group constant offsets — not scatter, and not a clef, anchor, band,
   rounding, centre or re-pairing artifact.

### The one fact now blocking certification

Why is the physical offset ≈0.18 spaces rather than 0.5? A ±1 residual demands a
half-space. Three candidates remain, and they are testable CPU-only without the
champion runtime and without another clef milestone:

- **different staff scale between the two renderers** — MuseScore's staff space
  vs Verovio's `gap` may differ by a constant factor, which would produce exactly
  a proportional sub-step offset that grows with distance from the middle line.
  **This is directly testable:** regress the per-note offset against
  `pdf_y_staff` and check whether it is linear in distance from the middle line.
  A scale mismatch predicts a slope; a transposition predicts a flat intercept.
- **PDF glyph vertical quantisation** — notehead centres landing on a sub-pixel
  grid in the source PDF.
- **genuine partial source difference** in specific measures.

That regression is the next step, and it is one cheap CPU computation.
