# Piano Vision V2.6 — Phase A + Gate 0: architecture investigation

**Recommendation: do NOT run an RTX pitch-model experiment. The bottleneck is not
architecture.** Section 8 gives the full reasoning; this is the short version.

Every channel into the pitch head was measured on the frozen step-2100 champion
(`sha256 10fe90b9…7373e1`, 26,332,539 params), CPU, no training, ~2 CPU-hours
total. All scripts are in `tools/piano-vision-v26-audit/`, all numbers in `out/`.

## 1. Exact root cause

The production corpus does not contain a learnable mapping from geometry to
pitch, because **the object→staff-position mapping is inconsistent across
engravings**, and the labels inherit that inconsistency.

The decisive evidence is Gate 0 (`phase_c_roi_probe.py`). A CNN over a
staff-anchored, 8 px-per-staff-space ROI — the exact high-resolution branch the
brief asked for, with 5× the current vertical sampling density, origin anchored
to the notehead's own staff band, and the position supplied in staff-space units
— trained to **0.98–1.00** on every fold and then scored:

| target | LOSO across 11 held-out scores | majority baseline |
|---|---|---|
| written step | **0.1303** | 0.1692 |
| octave | **0.3046** | 0.4061 |
| staff step | **0.0809** | 0.1299 |

Train 1.00, test *below chance*. That is not a capacity limit, not a resolution
limit and not a domain-shift limit. It is an inconsistent target.

Corroborating evidence from the corpus's own audit:

- The aligner rejects **66 measure-groups** for `residual_std_too_large` — the
  geometric pitch residual scatters beyond 0.35 staff steps, i.e. within a
  single measure the detector's staff geometry and the MusicXML pitch disagree.
- `unreliable_staff_lines` is the largest single rejection cause (**249**).
- **7 of 29** score × staff-role pairs produce **no** band offset at all.
- Where the offset does fire it is excellent: upper median −0.976, lower
  +1.024, spread ≤ 0.098, and **0 of 29** deviate from the analytic ±1 by more
  than 0.25. The detector is sound on ~76% of staff-role pairs and absent or
  unusable on the rest.

## 2. What was ruled out, with numbers

The brief's premise — *"geometry by itself was not the major failure. Production
raster / visual representation was"* — **is not supported**. `DIAGNOSIS.md`
perturbed geometry while holding **pixels byte-identical**, so it could not
measure the raster at all. When the raster is actually swapped, nothing happens.

| probe | written pitch | Δ | n |
|---|---|---|---|
| production as-is (PyMuPDF 150 DPI) | 0.0550 | — | 200 |
| **identical geometry, FACTORY raster (pdfjs 1000 px)** | **0.0500** | **−0.005** | 200 |
| production raster, box → corpus 1.18×1.84 | 0.0950 | +0.040 | 200 |
| factory raster + box → corpus 1.18×1.84 | 0.1000 | +0.045 | 200 |

- **Raster / DPI / antialiasing / colour** — not causal. Antialiasing signature
  (intermediate-gray fraction) 0.124 source vs 0.115 production. Factory pages
  are RGBA with constant alpha 255, so the RGBA→L step is a no-op.
- **`graph_features` / `source_features`** — production zeroes both. Zeroing
  them on source costs 0.0000 written pitch (0.9889 → 0.9889).
- **Clef / context path** — perfect on production: `clef` 1.0000, `clef_line`
  1.0000, `clef_octave` 1.0000, `key_fifths` 0.9804.
- **The `clip(·, −2, 2)`** on the staff-relative channels — measured range
  [−1.19, +1.34]; the clip never binds. Hypothesis discarded.
- **Representation capacity** — a probe on the model's own 24-dim vector,
  trained and tested *within* production, reaches 0.40 staff step against the
  model's 0.36. But split by **score** rather than by object it collapses to
  0.115 (majority 0.195). The apparent win was memorisation of three scores.
  This correction matters: it is the difference between "the head is
  miscalibrated" and "there is nothing transferable to learn", and only the
  second survives.

## 3. Secondary defects (real, but not the blocker)

- The only staff-relative channels in the 24-dim object vector are
  `clip((cy − staff_centre_y) / scope_height, −2, 2)` — divided by the **scope
  height**, not the staff gap. `scope_height` has a 3.6× heavier low tail in
  production (p5 0.0239 vs 0.0862), so the same musical position lands at a
  different feature value. A gap-normalised, un-clipped channel does not exist
  anywhere in the model.
- The pitch head samples 3 points across a region ~4.6 staff spaces tall —
  **fewer samples than there are staff lines**, with no staff-anchored origin.
  The production region is also 0.61× the pixel area of source (staff space
  12.4 px vs 17.6 px in the 192×512 view).

Both are worth fixing, and Gate 0 shows neither is sufficient on its own.

## 4–8. Gates

| gate | result |
|---|---|
| 0 — does a correct representation exist? | **FAIL.** ROI CNN, train 1.00, LOSO 0.130 vs 0.169 majority |
| 1 — tiny overfit | not run. Gate 0 already failed; the ROI probe trains to 1.00 and still does not transfer, which is a strictly stronger negative than a tiny-set overfit |
| 2 — held-page transfer | **FAIL**, measured as Gate 0: 11 held-out scores, below majority |
| 3 — production-raster ablation | **N/A — premise false.** The raster arm is 0.050 vs 0.055 as-is |
| 4 — frozen-semantics test | **FAIL**, and structurally unreachable: freezing the semantic core leaves the pitch head reading channels that carry no transferable signal |
| 5 — original-retention smoke | not run; there is no candidate to smoke |

## 9–10. Cost

Audit cost: **~2 CPU-hours**, no GPU, no checkpoint written, nothing trained.
That is the entire price of finding out that a multi-hour GPU run would have
been spent on the wrong component. A V2.6 pitch architecture was scoped
(a zero-initialised staff-relative adapter, ≈0.3 M trainable parameters on top
of the frozen 26.3 M, ≈0 VRAM cost) and **not built**, because Gate 0 says it
cannot pass Gate 2 regardless of its size.

## 11. PASS/FAIL

**FAIL. Do not request RTX time for a Piano Vision pitch architecture.**

The brief asks me to make the next expensive experiment deserve to exist. It
does not. The measured chain is: production staff detection fires on ~76% of
staff-role pairs and is excellent where it fires → the remainder are rejected
(`unreliable_staff_lines` 249, `residual_std_too_large` 66) → the surviving
labels are geometrically inconsistent across engravings → a model that can
memorise the training scores perfectly still lands below the majority baseline
on an unseen one. Architecture cannot fix an inconsistent target.

### What should be done instead, in order

1. **Make production staff detection complete and self-verifying.** The band
   offset is analytic (±1) and costs nothing to check; 7/29 pairs emit nothing.
   Every measure should either produce a verified offset or be refused
   explicitly, never silently.
2. **Make the corpus labels self-consistent and measurable.** Report the
   per-score residual distribution as a gate, and hold the corpus to it, so
   "learnable" is a property the corpus is *required* to have before any
   training is attempted. Today 66 groups are already refused for this, silently
   at training time.
3. **Re-run Gate 0 as the acceptance test for detector work** — not for model
   work. The bar is LOSO written-step above ~0.5 on 11 held-out scores, from
   geometry alone. Only when that clears does a pitch architecture have
   something to learn.
4. Only then revisit Phase B candidates, in this order: explicit staff-relative
   pitch representation (the missing gap-normalised channel, §3), then a
   staff-anchored high-resolution ROI branch, then a domain adapter — with the
   V2.5 semantic core frozen throughout.

### Honest limits of this report

- The closed-form detector ceiling from `stepsFromBandCenter` vs MusicXML was
  attempted and **discarded**: it fails its own source control (0.061 agreement
  on a domain where the model scores 0.988), so it measures label convention,
  not detector quality. The ceilings reported are empirical probe ceilings.
- Gate 0 uses the existing corpus labels. It proves the *labelled* task is not
  learnable across scores. It does not prove the underlying images lack the
  information — that distinction is exactly what step 2 above resolves, and it
  is the one open question this audit leaves.
