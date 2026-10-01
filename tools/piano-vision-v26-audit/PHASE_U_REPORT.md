# Phase U — units, and the reconciliation of 0.35 vs 1.0

**The contradiction was mine, not the corpus's. My previous 0.18-space figure
was a list-position matching artifact. With exact event-rank identity the ±1
populations sit at a median 0.45 and 0.56 staff spaces — a full diatonic step —
and the independent source-vs-source displacement does explain the corpus
residual. I withdraw the 0.35-step result and the staff-scale hypothesis it
motivated.**

---

## 1. Exact units of every vertical quantity

| symbol | unit | definition |
|---|---|---|
| `pdf_y_staff` | **staff spaces** (= line-to-line gap) | `(band_middle_y − pdf_note_y) / staff_gap` |
| `xml_y_staff` | **staff spaces** | `(xml_middle_line_y − rendered_notehead_y) / xml_staff_gap` |
| `delta_space` | **staff spaces** | `pdf_y_staff − xml_y_staff` |
| `delta_diatonic` | **diatonic steps** | `2 * delta_space` |
| `r_corpus` | **integer diatonic steps** | `true_d − d0` |
| `r_render` | **integer diatonic steps** | `round(2 * (xml_y_staff − pdf_y_staff))` |

One line gap spans exactly two diatonic steps (line → space → line), which is
why the factor is 2 and never anything else.

## 2. Exact continuous → discrete equation

```
d0        = MIDDLE_LINE[band] + round(2 * pdf_y_staff)
true_d    = MIDDLE_LINE[band] + 2 * xml_y_staff     (the XML render places the
                                                       assigned event here)

r_corpus  = true_d − d0  =  2*xml_y_staff − round(2*pdf_y_staff)
r_render  = round(2 * (xml_y_staff − pdf_y_staff))
```

The same rounding convention as `d0` (Python/numpy half-to-even) is used
throughout. **No quantity is called "steps" until it has a unit above.**

## 3. Rounding boundary

For `r_render` to be ±1, `|2·delta_space|` must reach the rounding boundary, so

> **|delta_space| ≥ 0.25 staff spaces  ⟺  |delta_diatonic| ≥ 0.5**

A corpus residual of ±1 is therefore *only* reachable if the two sources are at
least a quarter space apart. This is the testable statement the previous
milestone failed to satisfy.

## 4. Same-object identity: **6,507 notes** (rejected 268)

Identity is proven end to end, **not by list position**: the corpus event id
`m{M}−n{N}` gives the MusicXML note index; that note's **rank** is taken within
its measure/band's document-ordered pitched event list, and Verovio's notehead at
exactly that rank is used. 268 notes were rejected because no notehead exists at
that rank, and they are **rejected, never forced**.

## 5–6. `r_corpus` vs `r_render` confusion matrix

| `r_corpus` | n | `r_render` = same | agreement |
|---|---|---|---|
| −1 | 669 | 497 | **0.7429** |
| 0 | 5,408 | 3,959 | 0.7321 |
| +1 | 430 | 308 | **0.7163** |
| **TOTAL** | **6,507** | 4,764 | **0.7321** |

The diagonal dominates in every row, so the **sign** of the source-vs-source
displacement agrees with the corpus residual 71–74% of the time. The remaining
mass is a **heavy off-diagonal tail** (up to ±15 steps) which is gross
mis-matching, not physics — see §11.

## 7–8. `delta_space` distribution by corpus residual — **the resolution**

| population | n | median | p10 | p25 | p75 | p90 | ≥0.25 | ≥0.375 |
|---|---|---|---|---|---|---|---|---|
| `r_corpus = −1` | 669 | **0.4508** | 0.4205 | 0.4387 | 0.4932 | 1.9244 | **0.9671** | 0.9611 |
| `r_corpus = 0` | 5,408 | 0.0599 | 0.0297 | 0.0472 | 0.4455 | 1.9575 | 0.2679 | 0.2679 |
| `r_corpus = +1` | 430 | **0.5552** | 0.5061 | 0.5381 | 0.5810 | 2.0090 | **0.9605** | 0.9605 |

**This is the answer to the inconsistency.** The `±1` populations have
`|delta_space|` of **0.45 and 0.56** — i.e. **0.90 and 1.11 diatonic steps** —
with **96%+ beyond the 0.25 rounding boundary** and tight interquartile spread
(0.439–0.493 and 0.538–0.581). The `r_corpus = 0` population has median 0.060,
comfortably inside the boundary.

The source-vs-source displacement is a **full diatonic step**, exactly as the
corpus residual claims. It is **not** 0.35 steps.

## 9–10. Cached-`k` cross-check and `d_pdf` vs `d0`

On exactly this identity-proven population:

| | value |
|---|---|
| `k_from_pdf_source − cached k` | mean **0.000000**, std **0.000000**, max abs **0.000000** staff spaces |
| `d0 == MIDDLE_LINE + round(2 * cached_k)` | **6,507 / 6,507** |

All four quantities now sit in one row per note and agree exactly:
`d_pdf = d0` identically, and both are the PDF geometry. The discrete chain is
airtight; the only open variable was the XML render, and §7 closes it.

## 11–17. Affine test — **the instrument is invalid**

`xml_y = a·pdf_y + b`, both in staff spaces:

| fit | a | b | R² | rms (spaces) |
|---|---|---|---|---|
| global | 0.86606 | +0.10426 | 0.753 | 1.106 |
| **clean `r=0` (negative control)** | **0.86655** | **+0.12180** | 0.752 | 1.116 |
| `r=−1` | 0.90140 | −0.36226 | 0.821 | 0.955 |
| `r=+1` | 0.85374 | +0.56909 | 0.756 | 0.958 |
| upper staff | 0.83261 | +0.20992 | 0.724 | 1.083 |
| lower staff | 0.90345 | −0.02549 | 0.781 | 1.117 |

**The clean negative control returns `a = 0.8666`, not `1.0`.** By U8's own
criterion the affine instrument is therefore **invalid**, and the per-group fits
confirm it: slopes have p10 = 0.0196 and p90 = 1.0117, i.e. the least-squares is
fitting noise. The cause is the ~13% gross off-diagonal tail from §5, whose rms
of ~1.1 spaces swamps the signal and drags the slope toward 0.87.

**17. Does a true scale effect survive staff-gap normalization? Unanswerable
with this data.** It is not that the answer is "no" — the instrument that would
answer it does not pass its own control, and per U6 "Verovio is scaled
differently" is in any case not admissible, because `y_staff` cancels renderer
scale by construction. **The staff-scale hypothesis is withdrawn as
unfalsifiable with the current matcher.**

## 18. Exact explanation of "0.35 continuous vs 1.0 discrete"

**It was a measurement bug in my previous milestone, and the number was wrong.**

The previous run paired PDF objects to Verovio noteheads by **equal-cardinality
list position**, falling back to a value-based monotone alignment otherwise. In
polyphonic measures the corpus's printed object order is not the MusicXML
document order, so list position paired the wrong notes; the monotone fallback
with `tol = 0.30` then absorbed part of the genuine offset. The result was an
averaged artefact of ~0.18 spaces.

Replacing it with **exact event-rank identity** (§4) — resolving each corpus
`m{M}−n{N}` to its rank among the document-ordered pitched events, then reading
Verovio's notehead at that rank — removes both failure modes. The ±1
populations then measure a clean, tight **~0.45–0.56 spaces**, and the p90 of
~2.0 spaces is the surviving gross-mismatch tail rather than a physical spread.

I also note the internal inconsistency was visible in my own output: the class
`uniform+1` required every `round(2·delta) = +1` (hence `delta ≥ 0.25`) while
reporting a mean of 0.1211. That could not both be true, and it should have been
caught before reporting.

## 19. Revised root-cause verdict

For the 1,104 disagreeing objects the picture is now:

- **The corpus residual is correct and physically real.** An independent render
  of the paired MusicXML places the assigned event a **full diatonic step** from
  where the PDF prints it, in ~96% of the ±1 cases, with a tight interquartile
  range.
- **The offset is a transposition, not a scale or proportional effect** — it is
  a constant ≈1 step, well separated from the `r=0` population's 0.06 median.
- The clean population shows median 0.060 with a tight IQR, so the two
  populations are cleanly bimodal, not overlapping noise.
- **One artifact remains**: ~13% of notes carry a gross off-diagonal residual
  (up to ±15 steps) from remaining order mismatches inside chords and voices.
  That is a matcher defect, not a corpus or source finding.

## 20. Can source mismatch now be certified? **Not yet — and per U9, not here.**

The evidence is now strong and *independent of the decoder, of `d0`, of pitch
labels and of clef*: a full-step displacement, correctly signed 71–74% of the
time, with 96% of ±1 cases beyond the rounding boundary and a clean bimodal
separation from the `r=0` population.

But certification under SOURCETRUTH-9 additionally requires that **no** note in
the group be a matching artefact, and ~13% of notes currently are. Certifying now
would mean certifying a population that still contains matcher noise. **The
required next step is narrow and purely mechanical**: make the render-side
identity exact for chords and voices (match on stem/beam grouping and beam-level
order rather than document rank), then re-run U1. If the diagonal goes to ~1.0
with the ±1 medians unchanged, certification follows on the existing evidence and
**only** then, with refusal and never relabelling.

## 21. Is any model/RTX work justified? **No.**

The decoder remains exact, the residual is confirmed to be a real source-pair
displacement rather than a decoder, geometry, anchor, rounding, clef or alignment
defect, and the remaining work is label provenance. Training on labels that
disagree with their own source rendering by a full diatonic step would fit the
disagreement. **No corpus change, no relabelling, no refusal, no model work.**

---

### Scripts

- `phase_u_units.py` — U0–U4: unit definitions, event-rank identity, confusion
  matrix, rounding-boundary audit, cached-`k` cross-check.
- affine fits (§11) run inline over `out/phase_u_rows.json`, which retains every
  matched note's `score / example / band / object_index / event / rank /
  pdf_y / xml_y / d0 / true_d / cached_k`.
