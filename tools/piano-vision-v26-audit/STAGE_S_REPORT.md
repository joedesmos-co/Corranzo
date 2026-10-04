# Stage S — restricted SIMPLE-notation falsification experiment: CASE C

Nothing mutated. Corpus 2.1 immutable, no labels added, no Corpus 2.2, no RTX, no
training. All structural assets were used frozen: staff geometry, barline detector,
measure map, MusicXML fingerprints, corpus records. Nothing was re-tuned from residual.

## S0/S1 — the SIMPLE rule (frozen, pre-residual)

Complexity is measured from the raster and frozen geometry only. Per (measure × staff):

| Feature | Meaning |
|---|---|
| `ink_density` | ink fraction of the staff band inside the measure window |
| `n_morph_per_gap` | notehead-shaped components per staff gap |
| `beam_runs` | horizontal runs ≥ 4 gaps long outside staff-line rows |
| `n_stem` | components ≥ 3 gaps tall and ≤ 2.5 px wide |
| `n_text` | components ≥ 2.2 gaps tall (clef / timesig / text scale) |
| `max_x_overlap` | most noteheads sharing an x neighbourhood (chord / voice density) |

**SIMPLE** = all of: `ink_density` ≤ median, `n_morph_per_gap` ≤ median,
`beam_runs` ≤ floor(median), `n_text` = 0, `max_x_overlap` ≤ max(2, floor(median)).

Every threshold is the **unsupervised corpus-wide median** of that feature. No
threshold was chosen to make the PDF agree with MusicXML, and the rule was frozen
before any residual was inspected. Forbidden inputs (pitch, `d0`, `true_d`, residual,
decoder correctness, PDF-vs-source agreement) were not read.

Result: **33 SIMPLE staff-regions** of 84, containing **156 notehead-shaped
components**. All 33 have `beam_runs = 0`; `max_x_overlap` ≤ 3.

Score-disjoint split (Handel+Minuet held out, because they hold 121 of 156
candidates, so the gate is measured on the largest population):

- **SIMPLE_DEV** — 12 regions, 37 candidates, 9 scores
- **SIMPLE_HELDOUT** — 21 regions, 119 candidates, 2 scores

## S4 — measured accuracy (raster-only truth, adjudicated from overlays)

37 DEV candidates adjudicated tile-by-tile: **24 noteheads**, 13 false positives
(clef ×5, time signature ×5, rest ×2, sharp ×1). Recall was read from staff strips,
which showed roughly 10 further unmarked noteheads (hollow noteheads and chord
members), so true visible noteheads ≈ 34 and baseline recall ≈ 0.71.

| Variant | kept | TP | FP | precision | recall |
|---|---|---|---|---|---|
| baseline | 37 | 24 | 13 | **0.649** | ~0.71 |
| **correction 1** (system-start prelude) | 18 | 17 | 1 | **0.944** | ~0.50–0.71 |
| correction 2 (glyph stack) | 12 | 10 | 2 | 0.833 | ~0.42 |
| both | 10 | 9 | 1 | 0.900 | ~0.38 |

**Correction 1** excludes candidates in the first 8 staff gaps, because a clef
(~2.5 gaps) and time signature (~2 gaps) are printed only at a system start. It removes
**every** clef and time-signature false positive, confirmed visually.

**Correction 2** rejects a candidate when other suppressed components stack directly
above or below it, on the reasoning that staff-line suppression fragments a clef into
vertically stacked pieces while a notehead is isolated. **It failed by measurement**:
90 of 156 candidates were rejected because a chord's noteheads legitimately stack
within 1.4 gaps. It cannot separate a chord from a fragmented glyph.

An earlier idea — rejecting candidates whose *original-ink* vertical extent exceeds
2.0 gaps — was also tried and **rejected by measurement**: it killed 136 of 156
candidates, because a notehead's own columns also contain its stem. A stem is
indistinguishable from a clef fragment by that test.

## S5 — gate result: FAILED

Required ≥ 0.95 precision **and** ≥ 0.95 recall on score-disjoint held-out SIMPLE
measures. Best DEV variant reaches precision **0.944** and recall **≈0.50–0.71**.

Both allowed corrections are spent, both were targeted at measured failures, and the
gate is **not** loosened. Per S5 the sparse-detector route stops here.

S6–S13 are therefore **not executed**: there is no frozen detector to apply to
Category B, no correspondence manifest, and no clean gate. Reporting numbers for
those stages would require having applied an unfrozen detector to 365 ambiguous
noteheads — the exact failure that invalidated Stage C.

## S13/S15 — was the sparse route even aimed at the right part of B?

| Quantity | Total | In SIMPLE regions |
|---|---|---|
| Category B ambiguous noteheads | 365 | **131 (35.9%)** |
| Category A missing annotations | 62 | 10 (16.1%) |
| Tier 1 + Tier 2 missing noteheads | 54 | 10 |

So even a *perfect* simple-notation detector would have addressed at most 131 of the
365 ambiguous noteheads, and 64.1% of Category B lies in complex regions where beams
and dense polyphony make onset recovery a full OMR problem. The restricted route was
aimed at a minority of B, and it still could not reach a usable gate.

## S14 decision: CASE C

**The SIMPLE detector itself fails ≥ 0.95/0.95.** Best measured is 0.944 precision with
recall around half. The detector route stops. Per the decision tree, the recommended
next step is **external / manual / source-assisted ground-truth creation rather than
more thresholds** — three independent attempts (original-ink extent, fixed prelude,
vertical stack) each failed for a structural reason that no threshold fixes.

Carried forward unchanged from Stage L: safe missing-annotation pool **62 noteheads /
7 measures**, annotation ceiling **≈68 matched notes**, reachable N~100/250/500 all
**out of reach**, labelling **not** scientifically justified.
