# Phase E — Clean truth + frozen champion rebaseline

**Conclusion: C. V2.5 is still poor despite clean geometry. Resume V2.6
representation investigation.**

The frozen champion scores **0.081 / 0.126 / 0.144 / 0.088** written pitch on
the corrected corpus (validation / adaptation / heldout / diagnostic) against a
detected-geometry ceiling of **0.748**. It is **below the majority baseline
(0.178)** on every split. The corpus is now clean; the model is the bottleneck.

No training, no weight changes, no RTX. CPU evaluation only.

---

## 1. The ±6 tail: it does not exist

The suspected clef / staff-role failure **is disproved**. The ±6 tail was a
**reporting artefact**: the D4 probe compared a *step index mod 7* against what
I described as a *diatonic* residual. ±6 ≡ ∓1 (mod 7), so those rows were the
ordinary ±1 errors, counted twice under a different name.

Measured on the corrected corpus itself (n = 7,625 pitch labels, full diatonic
residual of detected geometry against MusicXML written pitch):

| residual (diatonic steps) | count | share |
|---|---|---|
| 0 | 6,135 | 80.5% |
| −1 | 791 | 10.4% |
| +1 | 699 | 9.2% |
| **\|r\| ≥ 2** | **0** | **0.0%** |

Audited and cleared as causes: clef state, staff-role identity, clef changes,
octave transposition, score-level staff pairing, band selection, written vs
sounding contract, part/staff mapping. `staffRole` equals the nearest detected
band centre on **100.0%** of labels (source control: 100.0%). Every label
residual is at most one half-space — ordinary detector/localisation error, not
a classification failure. No label was "corrected" by any heuristic; none needed
it.

---

## 2. Corrected corpus contract

`out/phase_e2_corpus_contract.json`, full detail. Versioned, not overwritten.

| field | value |
|---|---|
| contract version | `real-pdf-corpus/2.0` |
| corpus digest | `c7897bb2217a2999a6af5bfba5c6ac2655065bb5276b75ecb492d535642d2f9b` |
| implementation commit | `da7b7814432eb7c7610658c5a6532a4de0f9138a` |
| implementation sha256 | recorded for all 8 pipeline files (build_corpus, align_objects, staff_geometry_verify, realpdf_data, evaluate_realpdf, v25_adapter, omr_staff_geometry, v25_canonical_features) |
| render dpi | 150 |
| supersedes | `real-pdf-corpus/1.0` (local `out/realpdf`) — **INVALIDATED: pitch labels were attached to the wrong object** |

Per score the contract records the source PDF sha256, every rendered page
sha256, the shard sha256, band offsets, refusal counts and group rejections.
All four splits are preserved with their manifest digests:
`adaptation` `a4f462c5…`, `validation` `ad1a9acc…`, `heldout-test` `f551d178…`,
`diagnostic` `c0498e19…`.

The superseded corpus is retained on disk and named explicitly, so the old
0.055 number stays reproducible as historical evidence.

---

## 3. Leakage

`pass`.

- **44** rendered pages hashed, **44** distinct, **0** shared across scores.
- Grouping is by score; a score belongs to exactly one split, enforced by
  `realpdf_data.SPLIT_GUARD` and re-checked by `make_manifests.py`.
- Phase D's LOSO audit (L1–L4) also passed and stands.

---

## 4. Final label counts and refusals

| | value |
|---|---|
| scores | 18 |
| records | 778 |
| **accepted pitch labels** | **7,625** |
| **refused pitch labels** | **18** |
| dependent labels dropped (tied to a refused object) | 39 |
| refusal rate | 0.24% of emitted pitch labels |

Refusal reasons: `object_outside_ledger_envelope` 17,
`staff_step_outside_ledger_envelope` 1. Pre-existing aligner group rejections,
unchanged: `unreliable_staff_lines` 249, `no_xml_measure_partner` 230,
`too_few_objects_or_events` 188, `too_few_accepted_matches` 142,
`event_coverage_too_low` 80, `residual_std_too_large` 66.

---

## 5–8. Frozen champion on the corrected corpus

`evaluate_realpdf.py`, unmodified, `--skip-original`, CPU, no training. Metric
block `real-pdf-metric-v1` read from the frozen report and re-asserted.

| split | written pitch | derived MIDI | duration | n pitch |
|---|---|---|---|---|
| adaptation † | 0.1261 (95% CI 0.1170–0.1358) | 0.1292 | 0.5751 | 4,766 |
| **validation** | **0.0806** | 0.1191 | 0.5046 | — |
| **heldout-test** | **0.1441** | 0.1770 | 0.4974 | — |
| **diagnostic** | **0.0879** | 0.0919 | 0.6124 | — |

† the frozen evaluator deliberately refuses to *gate* on adaptation, because it
is the only split an optimizer may see. Those numbers are computed with the same
canonical formulas, quoted from the frozen report, and labelled as a diagnostic.

**The previously reported ~0.055 written pitch is INVALIDATED BY THE CORPUS BUG
and is not used as a baseline anywhere above.** The champion's number did not
move because the labels were fixed — it is essentially unchanged, which is
itself the finding: the old number was not measuring label corruption, it was
measuring a model that cannot use production geometry.

### Per score

| split | score | pitch | midi | duration |
|---|---|---|---|---|
| validation | bc-mozart-k153 | 0.0831 | 0.1240 | 0.5252 |
| validation | omf-piano-rhythm-tuplets-vector | 0.0588 | 0.0588 | 0.1667 |
| validation | pl-brahms-waltz-op39-3 | 0.0000 | 0.0000 | 0.2353 |
| heldout | bc-beethoven-sonata-op2-m1 | 0.1700 | 0.2161 | 0.5583 |
| heldout | bc-chopin-etude-op10-01 | 0.1448 | 0.1586 | 0.5078 |
| heldout | omf-piano-dense-advanced-vector | 0.0299 | 0.0597 | 0.0746 |
| heldout | omf-piano-grand-voices-vector | 0.0000 | 0.0000 | 0.1250 |
| heldout | pl-tchaikovsky-old-french-song | 0.0303 | 0.0909 | 0.3333 |
| diagnostic | pl-beethoven-fur-elide | 0.0662 | 0.0697 | 0.5754 |
| diagnostic | std-demo-minuet-in-g | 0.1582 | 0.1638 | 0.7528 |

Adaptation per-score 95% CIs are in `out/phase_e3_adaptation.json`
(0.0497–0.1398 up to 0.1459–0.1969; the two smallest, at n=34 and n=15, are
the widest).

---

## 9–11. Ceilings and the gap

| reference | written step |
|---|---|
| majority baseline | 0.1776 |
| **frozen V2.5 champion** (best split, heldout) | **0.1441** |
| **perfect-geometry ceiling** (MusicXML-derived staff position) | **0.8054** |
| **detected-geometry ceiling** (staff-anchored ROI + detected k + role) | **0.7484** |
| pixels only (ROI raster, no geometry, no clef) | 0.1883 |

| split | champion | gap to detected ceiling | ratio |
|---|---|---|---|
| adaptation | 0.1261 | **0.6223** | 5.9× below |
| validation | 0.0806 | **0.6678** | 9.3× below |
| heldout-test | 0.1441 | **0.6043** | 5.2× below |
| diagnostic | 0.0879 | 0.6605 | 8.5× below |

**Where the error lives.** Geometry is *not* the constraint: a probe that
receives the same detector geometry the model already gets reaches 0.748 on a
held-out score. The remaining ~0.60 is the model's failure to use the geometry
it is handed. Notably the champion (0.144) sits *below* the pixels-only arm
(0.188) and well below the majority baseline — consistent with Phase A's
finding that it scores below chance, i.e. a systematic displacement rather than
noise.

---

## 12. Per-score breakdown

See §5. Adaptation per-score with CIs in `out/phase_e3_adaptation.json`; the
engraving-family breakdown is in `out/phase_d3_corpus_consistency.json`
(musescore4-emmentaler 11 scores, musescore-feta 3, musescore-legacy-mscore 1,
corranzo-benchmark 3; LilyPond has no usable score).

---

## 13. Conclusion

### **C. V2.5 IS STILL POOR DESPITE CLEAN GEOMETRY.**

The Phase B test in the brief was explicit: *"If perfect ~0.81, detected ~0.75,
V2.5 ~0.30 then architecture may already be mostly fine."* V2.5 is 0.081–0.144,
far below 0.30, and below the majority baseline. The geometry contract is now
demonstrably usable and the model still does not use it. The representation
investigation is justified.

### What this milestone changed about the diagnosis

Phase A blamed the visual representation. That is now ruled out by measurement
in both directions: swapping to the factory raster was worth −0.005, and giving
a probe the same inputs the model gets yields 0.748. The real-PDF failure is
that the champion's pitch path does not exploit the scale-free staff-relative
quantity the detector already computes. Phase A did identify that quantity as
missing from the model — `object_features[10..11]` normalise by **scope height**
rather than the staff gap, and no gap-normalised un-clipped channel exists
anywhere. The corpus bug had been hiding that finding behind an unmeasurable
baseline. It is now measurable, and it is the whole gap.

## 14. Recommendation

**Resume the V2.6 representation investigation, and the Phase B candidate that
now has evidence behind it: an explicit, scale-free staff-relative pitch
channel** (`(bandCentre − cy) / staffGap`, per band, un-clipped) plus a
staff-anchored ROI branch, with the V2.5 semantic core frozen.

Pre-registered acceptance threshold before any expensive run: **held-score
written-step ≥ 0.70** from a frozen script, against a now-valid baseline of
0.144 and a ceiling of 0.748. That threshold is the same one Phase D proposed;
it now has a trustworthy baseline under it.

No RTX time is requested by this milestone and none should be granted until a
candidate clears that gate on CPU.

### Not done, and why

- **E5, the old step-150 adapted checkpoint.** Not evaluated. No
  `checkpoint-step-150` exists anywhere under the campaign tree, and its
  real-PDF numbers would be measured against corrupted supervision. The brief
  marks this optional and explicitly not a candidate; with the champion
  baseline complete there is no decision it informs. Its original-distribution
  regression evidence (−0.028 written pitch, −0.060 tie F1) remains valid and
  unchanged, and still shows the adaptation damaged the clean task.
- **Original-distribution re-qualification of the champion** was not re-run; the
  champion's original numbers (0.926178 written pitch, 63,086 examples) are
  untouched by this work, which changed no weights.
