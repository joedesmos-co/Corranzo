# Phase F — Minimal staff-relative architecture: gates F0–F5

**Verdict: FAIL. The hypothesis is falsified by Gate F3, and the pre-registered
F2 threshold is not met.** The adapter works (champion 0.120 → 0.573 held-score
written pitch with 0.21 M trainable parameters), but *not for the reason Phase A
proposed*. Adding the missing staff-relative coordinate contributes **+0.005**.
The failure is in the champion's **pitch heads**, not in the representation.

No RTX requested. No checkpoint written. Only the adapter ever trained.

---

## 1. Architecture change

An additive **logit correction on the five pitch heads only**, driven by the
frozen object's own embedding plus a 7-feature staff-relative vector. The frozen
model is never modified: it runs once in `eval` mode with `requires_grad_(False)`,
and the adapter is a separate module applied to its outputs.

The champion's pitch-path state is **precomputed once** for all 778 records
(`phase_f_cache.py`), which makes "only the adapter trains" structural rather
than a config claim, and makes LOSO cheap enough for many ablations on CPU.

### The new feature, exactly as specified

```
k = (bandCentreY − noteheadCenterY) / staffGap
```

per detected staff band, using the notehead centre associated with *that* staff
and that band's **actual** detected gap. No page-height normalisation. Not
clipped. Sign preserved (positive = above the band centre). Sub-space precision
preserved. Staff identity carried separately.

| # | feature | why |
|---|---|---|
| 0 | `k` | the missing coordinate, signed, unclipped |
| 1 | `k_half` = 2k | the diatonic step count, explicit sub-space |
| 2 | `is_upper` | staff-role identity, separate from k |
| 3 | `obj_height / gap` | notehead size in staff spaces |
| 4 | `obj_width / gap` | |
| 5 | `dist_nearest_line / gap` | distance to the nearest detected **staff** line (ledger lines deliberately excluded, so it cannot contradict k) |
| 6 | `gap / scope_height` | the scale instability the existing `object_features[10..11]` divides by |

Implemented in `v26_staff.py`; it **refuses** rather than emitting a coordinate
when there is no band, a degenerate band, or no scope height.

## 2. Added parameter count

| | |
|---|---|
| adapter total | **206,397** |
| trainable in any campaign | 206,397 |
| frozen champion | 26,332,539 |
| overhead | **+0.78%** |

Within the 0.1–0.5 M target. Two-layer MLP (480+7 → 256 → 256) over the five
pitch heads (33+7+11+7+3 = 61 classes). The output layer is **zero-initialised**,
so the adapter is exactly identity at step 0.

## 3. Gate F0 — closed-form sanity: **PASS**

| | |
|---|---|
| records unusable (refused, not invented) | 0 |
| n labels | 7,625 |
| analytic written-pitch agreement, pooled | **0.784** |
| residual 0 / ±1 / \|r\|≥2 | 78.4% / 21.6% / **0.0%** |
| per-score agreement median | 0.837 |
| scores above 0.75 | 13 / 18 |
| **score-specific transform required** | **none — 0 free parameters** |

One global closed form `k → middle-line diatonic index` is applied identically to
every score, with no per-score calibration, offset or scaling. The
no-score-specific-transform check that the previous broken instrument failed is
explicit here and passes.

## 4. Gate F1 — tiny memorisation: **PASS**

4 records, 64 labels, single score, 200 epochs. **Written pitch 1.0000**
(step 1.0, octave 1.0) against a 0.1875 majority. Threshold ≥ 0.98 met.

## 5–7. Gate F2 — LOSO cross-score: **FAIL** (threshold 0.70)

Leave-one-score-out, 18 folds, deterministic, identical protocol to Phase E.

| metric | value |
|---|---|
| **weighted written pitch** | **0.5726** |
| macro written pitch | 0.5264 |
| weighted written step | 0.7356 |
| weighted octave | 0.9546 |
| weighted MIDI | 0.5750 |
| n labels | 7,625 |
| **threshold** | **0.70 — NOT MET** |

Reference points: champion **0.1204**, majority 0.1776, detected-geometry
ceiling 0.7484, perfect-geometry ceiling 0.8054.

**Per score (written pitch):**

| score | pitch | step | octave | engraving |
|---|---|---|---|---|
| std-demo-minuet-in-g | 0.8644 | 0.9831 | 1.0000 | emmentaler |
| pl-bach-prelude-bwv846 | 0.8218 | 0.9100 | 0.9828 | emmentaler |
| bc-bach-fugue-bwv846 | 0.7712 | 0.8401 | 0.9843 | emmentaler |
| pl-beethoven-fur-elise | 0.7439 | 0.8118 | 0.9739 | emmentaler |
| pl-handel-gavotte | 0.6667 | 0.7863 | 0.9487 | emmentaler |
| bc-chopin-etude-op10-01 | 0.6368 | 0.7632 | 0.9517 | feta |
| bc-chopin-nocturne-op9-n2 | 0.5919 | 0.7782 | 0.9544 | feta |
| bc-mozart-k153 | 0.5601 | 0.8056 | 0.9757 | emmentaler |
| pl-mozart-turkish-march | 0.5459 | 0.7569 | 0.9592 | emmentaler |
| bc-beethoven-sonata-op2-m1 | 0.5447 | 0.7478 | 0.9798 | emmentaler |
| pl-brahms-waltz-op39-3 | 0.5333 | 0.6000 | 0.8667 | emmentaler (n=15) |
| bc-chopin-etude-op10-12 | 0.5120 | 0.6371 | 0.9562 | emmentaler |
| omf-piano-rhythm-tuplets-vector | 0.4118 | 0.4412 | 0.9412 | corranzo (n=34) |
| pl-chopin-mazurka-op6-1 | 0.3884 | 0.6607 | 0.9062 | feta |
| omf-piano-grand-voices-vector | 0.3750 | 0.4792 | 0.9583 | corranzo |
| std-hungarian-dance-no5 | 0.2675 | 0.4952 | 0.8831 | legacy-mscore |
| omf-piano-dense-advanced-vector | 0.1194 | 0.3881 | 0.7761 | corranzo |
| pl-tchaikovsky-old-french-song | 0.1212 | 0.2424 | 0.7879 | emmentaler (n=33) |

**By engraving family:** musescore4-emmentaler 0.608 (11 scores), musescore-feta
0.539 (3), corranzo-benchmark 0.302 (3), musescore-legacy-mscore 0.268 (1).

The spread tracks the Gate F0 closed-form agreement almost exactly: the three
weakest scores are the same scores where the geometry itself is least
self-consistent. That is a **detector/geometry** residual, not a head problem.

**Octave/MIDI:** octave 0.9546 and MIDI 0.5750. Note written *step* reaches 0.736
while the strict conjunction reaches 0.573 — the accidental head costs ~0.16, and
`k` cannot determine an accidental. The adapter was not given key/clef context,
which the brief permits but which I did not use.

## 8. Gate F3 — causal ablation: **hypothesis FALSIFIED**

| arm | held-score written pitch |
|---|---|
| A — existing V2.5 heads only (frozen logits) | 0.1204 |
| B — staff-relative k only, embedding withheld | 0.5617 |
| C — existing embedding + k | 0.5726 |
| D — existing embedding + **shuffled** k | 0.5650 |
| E — existing embedding + **wrong-band** k | 0.5806 |
| F — **existing embedding only, k withheld entirely** | 0.5673 |
| **k's contribution (C − F)** | **+0.0053** |

Shuffling `k` across records costs 0.008. Removing it entirely costs 0.005. The
staff-relative coordinate is **causally inert**. The gate's own criterion
(`C` must exceed `D`/`E`/`F` by 0.10) fails by a factor of ~20.

**What the arms actually show:** a *freshly trained* head on the champion's
**unchanged** frozen object embedding reaches **0.567** — versus **0.120** from
the champion's own pitch heads on that same embedding. The representation
carries the information; the heads do not use it.

This falsifies Phase A's inference that the model "lacks a gap-normalised
staff-relative channel". The channel is real and it is cheap, but it is
redundant with what the frozen embedding already encodes. Phase A inferred this
from reading the object-vector code plus a box-size ablation; Phase F tests it
causally, and causality wins.

## 9. Gate F4 — staff-role / clef

Not run to completion: Gate F3 falsified the hypothesis the gate was designed to
protect, so further clef work on this adapter would be measuring a module
already shown to be unnecessary. Legitimate context only was used throughout —
the adapter never receives a label's `staffRole`; it receives the role the
**detector** assigned, computed from the same nearest-band rule production uses.
F0 already shows the grand-staff ambiguity is resolved analytically (0.784
pooled agreement with a closed form that uses only k and the role), and the
frozen `context` heads are perfect on production (clef 1.0000, clef_line 1.0000,
key_fifths 0.9804). **This gate is deferred, not passed.**

## 10. Leakage

- LOSO is by score: 18 folds, each score held out exactly once, 0 duplicates.
- The adapter sees only per-object features and the frozen embedding. The target
  is the MusicXML written pitch. `k` is detector geometry, not a target.
- 44 pages, 44 distinct, 0 shared across scores (corpus contract).
- The falsification in F3 is itself evidence against leakage: arms that destroy
  the staff coordinate do not degrade, which is not what a leaking setup looks
  like.

## 11. Gate F5 — original-retention smoke: **PASS**

| | |
|---|---|
| max abs logit delta at initialisation | **0.0** |
| outputs bit-identical to the frozen champion | **True** |

The zero-initialised output layer makes the adapter exactly identity at step 0,
verified numerically on 32 records. The adapter is a pure function of the
embedding, so the frozen champion's own path is preserved on **every** domain,
including the original factory distribution, without needing to re-run it. No
original-distribution number changed: no weight outside the adapter was touched.

## 12. Runtime / memory profile

| | |
|---|---|
| frozen-model cache (778 records) | built once, 1 forward pass each |
| adapter parameters | 206,397 |
| adapter optimiser state | ~2.5 MB (AdamW, fp32) |
| F1 (200 epochs, 4 records) | seconds |
| F2 (18-fold LOSO) | ~9 min CPU |
| F3 (5 additional LOSO-style arms) | ~45 min CPU |
| **entire Phase F on CPU** | **~1.5 h, no GPU** |

Peak host memory is the cache: 778 × 132 × 480 fp16 embeddings ≈ 100 MB, plus
the ROI-free design means no image tensors are retained.

## 13. PASS / FAIL

**FAIL.** F0 PASS, F1 PASS, F5 PASS. **F2 FAIL** (0.573 weighted / 0.526 macro
against a pre-registered 0.70; step 0.736, octave 0.955). **F3 FAILS to support
the hypothesis.** F4 deferred.

I am not lowering the 0.70 threshold. It was set in advance against the 0.7484
detected-geometry ceiling, and the honest result is 0.573.

## 14. Is an RTX run justified? **No.**

Not one of the ten preconditions is met: F2 failed, F3 did not establish
causality, and F4 is outstanding. Per the brief, this stops here rather than
sending an expensive request.

### The corrected diagnosis

Phase A blamed the *representation* (a missing scale-free staff channel). Phase F
shows the representation already holds the signal and the **pitch heads** do not
read it. The revised ordering of what is broken, with evidence:

| component | state | evidence |
|---|---|---|
| staff-line detection | sound where it fires | 0/29 analytic-offset violations |
| label↔object binding | fixed | `\|k\|>8` 40.0% → 0.0% |
| raster / visual domain | not causal | factory-raster swap −0.005 |
| clef & key context heads | perfect | clef 1.0000, key 0.9804 |
| **object embedding** | **adequate** | fresh head on it: 0.120 → 0.567 |
| **pitch heads** | **primary failure** | same embedding, champion's own heads 0.120 |
| staff-relative `k` | redundant | C − F = **+0.005** |
| notehead localisation | remaining gap | the three weakest scores are the three with the lowest F0 closed-form agreement |

### What the next architecture step should be

**Retrain the pitch heads on a higher-resolution staff-anchored ROI branch** —
not add a coordinate. The evidence for this specific choice:

- the champion's object embedding is a **3×3 bilinear sample of a 3×-expanded
  box**, i.e. fewer samples than the five staff lines it must resolve;
- Phase D's probe on a **staff-anchored 8 px/staff-space ROI** reached **0.7484**
  with the same detector geometry;
- the frozen embedding + fresh head reaches 0.567.

The ~0.18 between 0.567 and 0.748 is the resolution the region sampler throws
away, and it is the only remaining headroom that is not a geometry problem.

Concretely, the next candidate should be: keep the frozen core, add a small conv
over a staff-anchored ROI (origin = the notehead's own staff band centre, extent
in staff-space units so it is scope-invariant), and train **only** the new ROI
branch plus the five pitch heads. That is still a small adapter, and it is the
first change with a causal mechanism behind it.

Two smaller, cheap follow-ups worth bundling: give the adapter the frozen
`context` key/clef outputs (legitimate — they are 0.98–1.00 accurate — and worth
~0.16 on the accidental head, which `k` can never determine), and investigate
`std-hungarian-dance-no5`, where the closed form is only 0.246 self-consistent.

**No training campaign is proposed in this report.** Phase F falsified its own
hypothesis; proposing an RTX plan on top of a falsified design would repeat the
error this whole investigation was assembled to prevent.
