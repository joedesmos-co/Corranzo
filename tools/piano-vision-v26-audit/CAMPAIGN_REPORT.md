# Piano V2.6 — autonomous campaign, consolidated report

**HARD GATE FAILED at Stage A. Stages B–H were not authorized and were not run.
No certification, no refusal, no qualification set, no capability baseline, no
direction decision. Corpus 2.1 untouched. No RTX, no model work.**

The campaign stopped because continuing past a failed PDF-barline gate would
invalidate every downstream result — the whole point of gating.

---

## A. PDF BARLINE

**1. Detector audit N:** 28 staff units audited across bach-fugue, beethoven-
sonata, turkish-march and chopin-etude-10-01, spanning first/middle/final
systems and both staves; 376/376 bands processed corpus-wide.

**2. False positives:** present and score-dependent. The repaired detector cut
aggregate overcount from **5.74 to 3.30** events per notated measure on
bach-fugue (3.67→2.47 beethoven, 6.33→3.95 turkish-march), and the rejection
taxonomy became dominated by the correct reason — insufficient vertical coverage
0.9967, endpoint miss 0.0033, **disconnected stems 0.0000**. But the residual
error is not uniform.

**3. False negatives:** present. Several bands detect **zero** barlines while
their sibling band detects twenty: `pl-brahms-waltz` lower = 0 intervals,
`pl-tchaikovsky-old-french-song` lower = 0, `omf-piano-rhythm-tuplets` lower = 0.

**4. Interval reconciliation — the decisive failure.** Because the two staves of a
system carry the *same* measures, their interval totals should be comparable.
They are not, sometimes by 4×:

| score | intervals (upper) | intervals (lower) | notated measures | ratio |
|---|---|---|---|---|
| beethoven-sonata | 137 | **240** | 152 | 0.90 |
| chopin-etude-10-01 | **224** | 42 | 79 | 0.53 |
| chopin-nocturne | 124 | **209** | 38 | 3.26 |
| chopin-etude-10-12 | 172 | 185 | 84 | 2.05 |
| fur-elise | 178 | 204 | 105 | 1.70 |
| mozart-k153 | 77 | 75 | 67 | **1.12** |
| bach-prelude | 130 | 41 | 35 | 1.17 |
| brahms-waltz | 20 | **0** | 33 | 0.61 |

**0 of 17 scores** land within 1 of the notated measure count; the per-score
ratio spans **0.53 → 3.26**.

**5. GATE RESULT: FAIL.** Criteria 2 (visual audit) and 4 (held-out stability,
8.112 vs 7.795) passed in Phase P; criterion 1 is not eliminated and criterion 3
is decisively not met. Order-based staff-unit pairing for the interval check also
failed outright for 3 of 4 sample scores (PDF 40 vs Verovio 68 units) because the
two documents wrap systems differently — which is expected, and is why the
reflow-invariant one-band interval total was used instead.

## B. STRUCTURE — **NOT EVALUATED**

**6–7.** Per-score PDF interval counts and Verovio measure counts exist (table
above) but are not a valid comparison, because the PDF interval counts are not
trustworthy.

**8. Reflow vs partition classification: NOT EVALUATED.** Withdrawing the earlier
"genuine partition difference" claim was correct and that question remains
**open**, not answered.

**9. Pitch-independent measure mapping coverage: 0.** No valid mapping exists,
because the PDF measure-interval sequence is not yet a measurement.

## C. NOTE MATCHING — **NOT EVALUATED**

**10–14.** No matched notes, no clean-control rates, no >98% gate result. **N = 0
is reported as NOT EVALUATED, never as PASS or FAIL.**

## D–G. SOURCE TRUTH, QUALIFICATION, CAPABILITY, DIRECTION — **NOT RUN**

**15–30.** No displacement statistics, no contour agreement, no certification
rate, no mixed-group taxonomy, no Corpus 2.2 candidate, no non-circularity proof,
and **no capability baseline**. The Stage G gate ("if and only if Stage F produces
a valid non-circular qualification set") was never met, so the decoder was not
re-run. The 2.1 figures remain historical reference only: step 0.8370, octave
0.9782, accidental 0.7990, written pitch 0.7342 weighted / 0.7006 macro — **not
a capability measurement**.

## H. THE BOTTLENECK, and what actually blocks it

**31. Exact remaining bottleneck:** the PDF barline sequence, specifically that
the **staff-local search domain is not reliably the true five-line staff for
every band**, which makes interval counts differ up to 4× between the two staves
of the same system.

**32. Next experiment.** Not a new matcher and not a threshold sweep. The one
principled next step is to make the staff domain self-verifying:

1. detect candidate line rows in a window around the corpus band;
2. **require exactly five**, not four — my authorized correction
   (`refine_staff`) preferred the best-scoring window over a `n in (5, 4)`
   search, so it could return a **four-line, three-gap "staff"**. On
   brahms-waltz upper it returned y = [210, 241], a 31 px span where
   4 × 10.33 = 41.3 px is required, and it *raised* strokes from 13 to 26. That
   is a bug in the correction, not a property of the data;
3. reject any band where a five-line set cannot be established, rather than
   proceeding on a three-gap span;
4. then require `|intervals(upper) − intervals(lower)| ≤ 1` per system as a hard
   invariant before any count is believed.

Step 4 is the cheap, decisive acceptance test: it is a **self-consistency
property of a single document**, needs no MusicXML and no other source, and would
have caught this failure immediately.

**33. Is RTX/model training finally justified? No — and it is further away than
one phase ago.** Nothing about the model, the representation or the readout is
under test. The decoder was shown exact in Phases Q–R, six error mechanisms were
positively excluded, and the residual 16.30% is a label-provenance question that
has now resisted four independent attempts at independent source validation. GPU
time is not the constraint and would not help.

## Honest assessment of this campaign

Six stages (Q, R, C, U, I, J, K, K1R, L, M, N, P) have now attacked the source-
truth question. The PDF side is **finished and exact** (`k_from_pdf_source` vs
cached `k`: mean/std/max = 0; `d_pdf ≡ d0` on every note). The Verovio side is
**finished and exact** (one `barLine` group per notated measure, verified by DOM
census and reconciliation A = B, C = 2B on every staff unit).

**Both sources are understood. The only thing that has never worked is the
detector that counts boundaries in the PDF raster**, and that detector has now
been shown to be unreliable in a way I can characterise but, within the one
correction the gate authorised, not fix.

The recurring lesson is mine and worth stating plainly: on three separate
occasions I treated a detector output as a structural fact — the Phase M
"partition difference", the Phase N "class C" result, and now this. The
discipline that would have prevented all three is demanding a **self-consistency
invariant of a single document** before believing any count, which is why step 4
above is the thing to build first.
