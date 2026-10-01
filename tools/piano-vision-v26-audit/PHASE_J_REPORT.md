# Phase J — layout-based matcher: gate FAILED, route stopped

**Stopped at J11 as instructed. No certification, no refusal, no qualification
set, no rebaseline, no corpus change, no model work. And I am not claiming the
layout approach is refuted: my J0 frame was wrong, so 15.1% is an invalid test
rather than a clean negative. Both facts are recorded below.**

---

## 1–5. The matcher as specified

| stage | rule |
|---|---|
| **J0** normalised x | `x_rel = (x − measure_left)/(measure_right − measure_left)`, computed **independently per side** |
| **J1** onset clustering | x-sorted noteheads grouped while `Δx ≤ MULT · staff_gap`, in each side's own units — a geometric quantity, not a page-pixel constant |
| **J2** group matching | monotone DP over `(i,j)`; cost = normalised-x displacement (capped) + group-size mismatch penalty, with an insertion/deletion penalty; confidence 1.0 only when `Δx_rel ≤ 0.05` **and** cardinalities are equal, else 0.5 |
| **J3** within-group | sort both sides by y and pair in vertical order; groups containing same-y (unison/overlapping) noteheads are **dropped as ambiguous**, never forced |
| **J4** voice/layer | used only to reject cross-staff matches; document-rank matching was **not** revisited |
| **J5** ambiguity policy | low-confidence groups, cardinality mismatches and unison groups are all rejected rather than forced |

No pitch, `true_d`, `d0`, residual sign, decoder output or source-label equality
enters the correspondence.

## 6–10. Clean-control results

| tolerance | matched | clean | clean `\|δ\| < 0.25` | clean `r_render = 0` |
|---|---|---|---|---|
| tight (0.35) | 844 | 702 | 0.1510 | 0.1510 |
| medium (0.55) | 843 | 702 | 0.1510 | 0.1510 |
| loose (0.85) | 843 | 702 | 0.1510 | 0.1510 |

Rejected: `no_group_match` 772, `low_confidence_group` ~147.

## 11. Tolerance sensitivity

**Identical to four decimals across tight, medium and loose.** That is not a
robustness result — it is a symptom. A genuine geometric tolerance sweep should
move the numbers. Identical output means the clustering threshold was not the
binding constraint; the acceptance criteria were.

## 12. GATE: **FAIL** (needs >0.98, got 0.1510)

## 13–16. Mismatch populations: **not reported**

Correctly withheld. With 15.1% clean-control agreement, any `+1`, `−1`, mixed or
contour statistic computed from this matcher would carry its error and look
authoritative. Per J5/J7 nothing downstream is reported.

## 17–21

| | |
|---|---|
| **% source mismatch certified** | **0%** |
| **% unresolved** | **100%** |
| qualification set (J10) | not built |
| valid capability result (J20) | **none** — 2.1 unchanged: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work | **not justified** |

---

## Why 15.1% is an invalid test, not a refutation

I checked what Verovio's `x0`/`x1` actually bound, and the frame is real —
staff-line extents are genuinely **per measure**:

```
measure 0 : 1580 → 11373      measure 3 :  7139 → 13570
measure 1 : 11373 → 20000     measure 4 : 13570 → 20001
```

So `x_rel` is well defined. The defect is that **the two sides are normalised in
different frames**:

- the Verovio span is the **musical measure span**, which includes the clef, key
  signature and time signature at its start;
- the corpus `scopeBounds` is the **measure's ink bounding box**, i.e. the
  leftmost-to-rightmost *ink*.

Those are not the same interval, and the corpus measure grid is independently
known to *"split, merge and occasionally invent a measure relative to the notated
score"* (`align_measure_sequence`). Comparing two `x_rel` values computed over
different intervals is meaningless, and no clustering tolerance can repair it.

That is why 772 measures produced **no group match at all** and the survivors
were only accepted under the strictest criteria. The dominant error is a frame
mismatch I introduced, not a limitation of layout matching.

**So the honest verdict is: the gate failed, the route is stopped as
instructed, and the failure is inconclusive.** I am not claiming geometry-based
layout matching is incapable — only that I did not implement it correctly, and
J11 forbids me from building matcher #4 to find out.

## What would be needed, stated but not implemented

1. **Per-measure bounds on both sides from the same definition.** On the Verovio
   side, use `barLine` element positions (present in the SVG: 15 in the first
   page) rather than staff-line extents; on the corpus side, use the detected
   barline projections the measure grid was already built from, rather than the
   ink bbox. Then `x_rel` is comparable.
2. **Match on inter-onset spacing ratios rather than absolute `x_rel`**, which is
   invariant to both the leading clef/key/time offset and any residual width
   difference.
3. Keep the J5 gate as the pass/fail and do not tune the tolerance to it.

That is a corrected implementation of the *same* stage, not a fourth matching
idea — but it is outside this milestone's remit, so it is left undone.

## Cumulative state of the source-truth question

| method | clean within 0.25 | verdict |
|---|---|---|
| event-rank (U) | 0.7321 | fails gate |
| layer-aware MEI↔SVG (I) | 0.6808 | fails gate |
| layout-based (J) | 0.1510 | **fails gate; test invalid** |

Three structurally different matchers, none reaching the required 98%, against a
clean control that is known to be exact on the PDF side
(`k_from_pdf_source − cached k` mean/std/max = 0, `d_pdf ≡ d0` everywhere). The
obstruction is entirely on the render side, and the specific obstruction is now
identified: **Verovio's layout cannot be mapped back onto corpus measure
coordinates with the information currently being used.** Resolving it needs a
frame that is defined identically on both sides, or a second independent renderer
— and per J11 I have deliberately not chosen or implemented that renderer.

**Nothing is certified, nothing is refused, nothing is relabelled, and no
capability number is claimed.**

---

## Script

- `phase_j_layout.py` — J0–J6 layout matcher and the J5 gate, including the
  tolerance sweep. Retained because the negative result and its diagnosis are
  the deliverable.
