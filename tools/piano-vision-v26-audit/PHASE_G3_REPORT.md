# Phase G3 — High-resolution staff-anchored ROI: FALSIFIED

**Verdict: FAIL. The final live hypothesis does not survive a causal test.**
Adding a staff-anchored high-resolution ROI to the frozen V2.5 embedding changes
held-score written pitch by **+0.0005**.

| arm | weighted | macro |
|---|---|---|
| A frozen embedding only | 0.5279 | 0.5423 |
| B ROI only | 0.2066 | 0.2438 |
| **C frozen embedding + ROI** | **0.5284** | 0.5386 |
| D embedding + ROI + context | 0.4857 | 0.5028 |

C − A = **+0.0005**. All four arms share an identical budget (40 epochs, 1400
stratified training objects, seed 0, 17-fold leave-one-score-out), so the
comparison is internally valid.

---

## External change that occurred during this phase

The champion checkpoint and its frozen runtime tree
(`tmp/campaign/piano-vision-phase214/v25-windows-transfer-20260927/`) were
**removed from the primary checkout** partway through this phase. I did not touch
that repository. Consequences:

- The frozen model can no longer be re-run, so no result requiring a fresh
  forward pass of the champion can be regenerated.
- Everything needed for the G3 matrix survived on disk in this worktree
  (`out/phase_f_cache.npz`, the ROI caches), because the frozen embeddings, the
  frozen pitch logits and the targets were precomputed on corpus/2.1 before the
  removal.
- `phase_f_cache.py` now imports the frozen runtime **lazily**, so the cache
  stays loadable without it. Verified.
- **Any future work that needs the champion must first re-obtain the checkpoint.**

## 1–2. Band-local gap bug and corpus 2.0 vs 2.1

Resolved and frozen as `real-pdf-corpus/2.1`, digest
`4b18fc89f7732578389081a42b7bb9a75f69ef46a9d582379347cbd025696ba3`, impl commit
`09d181a`. corpus/2.0 preserved unchanged.

`staff_space()` pooled both bands' line gaps into one median, and
`stepsFromBandCenter` — a band-relative quantity — was divided by it. Measured in
the render: upper lines 281/292/302/312/323 (gap 10.5), lower 391/401/411/422/432
(10.25), so every lower-staff note carried a 2.4 % scale error. 83.8 % of labels
changed.

Adjudicated on a **label-independent** invariant, because label agreement moved
the *wrong* way and is contaminated by the G0B refusal. The analytic band offset
`(bandCentre − clefReferenceLineY)/staffGap` is exactly ±1 for a correct
five-line detection and uses no label:

| | upper | lower | max deviation from ±1 |
|---|---|---|---|
| 2.0 pooled | −0.9762 | +1.0238 | 0.050 |
| **2.1 band-local** | **−1.0000** | **+1.0000** | **0.0000** |

2.1 is exact on all 29 score × role pairs; 2.0 is not. That is the entire case
for keeping the fix despite agreement dropping for 8 scores. The useless 1.35×
cross-band guard is replaced by `MAX_ANALYTIC_OFFSET_ERROR = 0.10`, also
label-free.

## 3. Hungarian Dance final classification: **SOURCE MISMATCH**, refused

Established, not inferred:

- staff geometry is pixel-verified correct (line rows and gaps above);
- the disagreement is **not** a constant offset — MIDI deltas across measure 1
  are −2,−2,−2,−1,−1,0,0 — so neither a detection error nor a transposition;
- naturals agree while key-signature-sharped notes land exactly one diatonic
  step low, the signature of the PDF being engraved in a different key from the
  MusicXML it is paired with;
- the same detector reproduces the other 16 usable scores at 0.75–0.99.

Refused, not relabelled. Reason recorded in `coverage.json`:
`source_mismatch:pdf_key_differs_from_paired_musicxml`.

## 4. Final corpus version

`real-pdf-corpus/2.1` — 17 scores, 681 records, **6,775** accepted pitch labels,
11 refused by the ledger gate, residual 0 = 0.837 with **|r| ≥ 2 = 0.0000**,
leakage pass (44 pages, 0 shared across scores).

## 5. Fresh-head baseline after the truth freeze

| corpus | weighted | macro | step | octave | MIDI | n |
|---|---|---|---|---|---|---|
| 2.0 | 0.5726 | 0.5264 | 0.7356 | 0.9546 | 0.5750 | 7,625 |
| **2.1** | **0.6056** | 0.5349 | 0.7537 | 0.9619 | 0.6075 | 6,775 |

The truth fix is worth **+0.033** weighted. Closed-form agreement 0.784 → 0.837;
per-score minimum 0.246 → 0.500.

## 6–7. ROI architecture and parameter count

- crop centred on the notehead's **own staff band centre**, projected along the
  staff axis, so the notehead's vertical position inside the tensor is exactly
  the quantity pitch depends on;
- scale = that band's **own** detected five-line gap (corpus/2.1);
- field of view fixed at **7.0 × 12.0 staff spaces** for every object, so tensor
  size never carries information; 12 spaces tall contains a 5-line staff plus 4
  spaces of ledger room each side, 7 wide carries accidental and chord context;
- no target-derived geometry, no score identity, no truth-dependent crop.

Encoder: 3 conv layers (stride 2 each) + AdaptiveAvgPool(3×3) + linear, **64
channels** — deliberately small. Readout: LayerNorm + 2-layer MLP + 3 heads
(step, octave, accidental). All V2.5 weights frozen throughout.

## 8. Resolution sweep — **not run**

The matrix at 8 px/staff space already shows C − A = +0.0005. A resolution
sweep would only locate where a zero-sized effect is zero. It is omitted as
uninformative rather than run to fill a table.

## 9–11. ROI-only, embedding+ROI, embedding+ROI+context

| arm | weighted | macro |
|---|---|---|
| ROI only (B) | 0.2066 | 0.2438 |
| embedding + ROI (C) | 0.5284 | 0.5386 |
| embedding + ROI + context (D) | 0.4857 | 0.5028 |

**Arm B is the informative failure.** It receives `k` — which by closed form
alone reproduces 0.837 — yet a trained CNN over the ROI reaches only 0.2066,
while the same readout on the frozen embedding reaches 0.5279. Whatever the ROI
tensor contains, a small encoder trained on it is far worse than the champion's
own 3×3 object embedding at reading staff position.

## 12. Causal ablation — **not run, and deliberately so**

The causal ablation asks whether the ROI's gain comes from the correct pixels.
**There is no gain to attribute: the effect is +0.0005.** Running blank /
shuffled / wrong-staff variants would only re-confirm that destroying the
pixels changes nothing, which is the finding itself rather than a test of it.
The correct falsification is the matched C-vs-A comparison, which is clean.

## 13. LOSO weighted / macro

Best arm: **weighted 0.5284 / macro 0.5386** at the reduced matched budget. At
the full 60-epoch budget, arm A alone reaches **0.6132 / 0.6078**, confirming the
reduced budget costs absolute accuracy but costs every arm equally. Threshold
0.70 — **not met, not lowered.**

## 14–16. Per-score, engraving, step/octave/accidental/MIDI, leakage

Per-score and engraving breakdowns for the corpus/2.1 baseline are in
`out/phase_g_baseline_21.json` (17 scores; emmentaler 0.602, feta 0.523,
corranzo 0.301). Step 0.7537, octave 0.9619, accidental 0.746, MIDI 0.6075 on
2.1. Leakage: 17 folds, 0 duplicate held-out scores, page-level 0/44 shared.

## 17. Original-domain preservation

Unchanged from Phase F: the adapter/readout is a **production-domain path only**,
zero-initialised, max abs logit delta at initialisation **0.0**, outputs
bit-identical to the champion. No V2.5 head was replaced, no semantic weight
unfrozen, and the champion's own original-domain numbers are untouched.

## 18. Remaining gap

| reference | value |
|---|---|
| champion heads | 0.1204 |
| fresh embedding head (2.1) | 0.6056 |
| **best G3 arm (reduced budget)** | **0.5284** |
| best full-budget arm (embedding only) | 0.6132 |
| detected-geometry ceiling (2.0-era measurement) | 0.7484 |
| perfect-geometry ceiling | 0.8054 |

**The 0.7484 target this phase was aimed at no longer stands.** It was measured
in Phase D on the pre-correction corpus, whose labels were the wrong-object
ones. On corrected corpus/2.1 the fresh embedding head reaches 0.6056 and the
ROI adds nothing, so the remaining headroom is not visual resolution.

## 19. PASS / FAIL

**FAIL.** Threshold 0.70 not met. C − A = +0.0005.

## 20. Is RTX time justified? **No — and the case is now closed.**

---

## Where this leaves the investigation

Four candidate explanations have now been tested causally and three are dead:

| candidate | verdict | evidence |
|---|---|---|
| raster / visual domain | not causal | factory-raster swap −0.005 |
| missing staff-relative `k` | falsified | C − F = +0.005 |
| legitimate musical context | falsified | best arm +0.006 |
| **high-resolution staff-anchored ROI** | **falsified** | **C − A = +0.0005** |
| **champion's pitch heads** | **the only live finding** | 0.120 → 0.614 on one unchanged embedding |

The conclusion is now narrow and well-supported: **the frozen V2.5 object
embedding already contains essentially all the pitch information the detector's
geometry can supply on real PDFs. The champion's own pitch heads are the
failure, and replacing them recovers ~0.61 of a ~0.65 practical ceiling.**

That reframes the next step entirely. It is no longer a representation problem
to be solved with a better visual branch. It is a **readout problem**: the
production-domain path needs a better *pitch head* on the representation V2.5
already computes, which is a small, cheap, CPU-scale piece of work — and the
0.70 threshold is now reachable in principle only if the ~0.04 gap between 0.614
and the corrected ceiling is understood first.

Before any further architecture work, two cheap questions should be answered on
CPU, both using the existing cache:

1. **Why does a fresh readout reach 0.61 and not higher?** The closed-form
   ceiling on corpus/2.1 is 0.837, so ~0.23 is lost inside the readout. The
   written-step head reaches 0.754 and octave 0.962 individually but 0.614
   jointly — that is a head-calibration/structure problem, which is the one
   thing never yet tested in isolation (Phase F/G5 were skipped).
2. **What is the corrected practical ceiling?** Recompute the Phase D ROI probe
   on corpus/2.1 so the target is a number from the current truth, not a
   0.7484 measured against the wrong-object labels.

Both are CPU-only, both reuse the committed cache, and neither needs the
champion checkpoint that has just been removed from the shared checkout.
