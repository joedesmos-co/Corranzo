# Why transfer fails — ROI-only diagnostics

Follows [`GUITAR_VISION_LEARNING_CURVE_SHARED.md`](GUITAR_VISION_LEARNING_CURVE_SHARED.md).

## Verdict

**CASE A. The ROI pixels support score-disjoint classification. The shared
multi-task model is the bottleneck.**

The same `FINAL_ROI` crops the fret head receives, fed to nothing but a small CNN,
score **93.16%** on the same score-disjoint split the production model scores
**6.84%** on. A **parameter-free** nearest-neighbour baseline on those same raw
pixels scores **93.16%** too.

| condition | fret accuracy (score-disjoint) |
|---|---|
| production `shared`, 1200 steps, 40 scores | **6.84%** (chance 7.34%) |
| ROI-only CNN, 3000 steps, 614 crops | **93.16%** (chance 5.00%) |
| ROI-only CNN, class-balanced | 92.91% |
| template nearest neighbour, **no parameters** | **93.16%** |

Nothing was added to the data, the geometry or the labels. The crops, the split
and the labels are the production ones.

## 1–6. D1/D2 data support

| | |
|---|---|
| train / held-out fret objects | 767 / 395, over 40 / 20 scores |
| classes | **20, all present in both splits**; none absent from train or held |
| classes by train-score support | **all 20 in the "4+" band**; none at 1, 2 or 3 scores |
| median distinct train scores per class | **25.5** (range 19–33) |
| median objects per class | 39.5 |
| class imbalance, max:median | **1.27** (mild) |
| majority class | fret 13 at **6.5%** train; fret 1 at **7.3%** held |
| held-out objects in a thin-support class | **0 / 395** |

Every class also appears on **5–6 of the 6 strings**, spread over 5–6
`(fret, string)` cells, with **1–6 distinct train scores in every occupied cell**.
Objects per class per score is 1.3–2.0, so within a score the instances of one
fret are distinct objects at distinct positions, not copies.

**Pages equal scores**: every record in this corpus is `page: 1`, so the two counts
coincide and are reported as such. The record carries **no measure identifier**, so
"independent instances" is reported as objects-within-score with that caveat stated
rather than a measure count invented to fill the column.

**Is score-disjoint generalisation learnable from this split? Yes.** Support is
ample on every axis: 20 classes, ~25 independent renderings each, all six strings,
near-uniform class balance.

## 7–10. D3/D4 ROI-only probes

Probe: `3 × (conv3×3 → BN → ReLU)` with 32/64/128 channels → **global average
pooling** → linear → 20. Global pooling is deliberate — it deletes *where* the ink
is, forcing the probe to answer *what shape* it is. Inputs are the 32×32 greyscale
production ROI and an integer label. No coordinates, no string, no score, no
context, no backbone features.

Config: seed **11**, Adam lr **1e-3**, batch **64**, **3000** steps, fit on the
**614** crops remaining after the within-score holdout. Two sampling modes, held
out untouched throughout.

| probe | A train-instance | B same-score unseen-instance | C score-disjoint |
|---|---|---|---|
| CNN, natural | **1.0000** | **1.0000** | **0.9316** |
| CNN, class-balanced | 1.0000 | 1.0000 | 0.9291 |
| template NN (no parameters) | 0.9857 | 0.9281 | 0.9316 |

Split sizes: A = 767, B = 153, C = 395, fit = 614. **Zero crop overlap** between
fit and B (verified: instances are distinct objects with distinct boxes, split by
a deterministic per-score stride).

### The leak this probe could have had, and does not

The crop contains the TAB staff lines, and their vertical positions encode the
*string* — a coordinate the probe is forbidden to see. So "saw only pixels" is only
meaningful if the fret label is not recoverable from string position:

| | |
|---|---|
| fret recoverable from string alone (majority) | **8.09%** |
| uniform chance over 20 classes | **5.00%** |
| distinct frets per string | 20 of 20 on every well-populated string |
| majority fret share within a string | 7.0% – 10.0% |

String carries essentially no fret information, so a probe reaching 93% could not
have got there by reading staff-line position. **The D3 result stands.**

### Balancing does nothing

Class-weighted loss moves score-disjoint from 0.9316 to 0.9291 — within noise. The
corpus is close to balanced (max:median 1.27) so there was little for it to fix.
**CASE D excluded.**

## 11. D7 two-digit

| | 1-digit | 2-digit |
|---|---|---|
| production box width | 23.3 plane px | 44.8 plane px |
| box share of ROI width | 62.5% | 62.5% |
| **plane px per ROI sample** | **1.16** | **2.24** |
| ROI samples across one glyph | ~20 | **~10** |
| glyph height in ROI | 18 px median | 18 px median |
| ROI-only CNN, score-disjoint | 0.9349 | 0.9278 |
| template NN, score-disjoint | 0.9488 | 0.9111 |

Two-digit frets are sampled at **half the density** of one-digit ones — the same 32
samples must span twice the width, so each digit gets ~10 samples instead of ~20.
That is a real, measured asymmetry and it is the most likely explanation for the
production model's own 2-digit deficit (0.3150 vs 0.5286).

But it is **not** a hard limit: the ROI-only probe still reaches 92.78% on
two-digit score-disjoint crops at that density. Ten samples per digit suffices.

Structural checks: digit order is stable in **580/580** two-digit crops (first
digit left of second). Glyph height is identical across digit counts. **13 of 1162**
glyphs touch the edge of the box band. No crop defect was found, and geometry was
not touched.

## 12. D6 simple visual baseline

Included above. Nearest neighbour on mean-removed, L2-normalised raw pixels:

| | A | B | C |
|---|---|---|---|
| template NN | 0.9857 | 0.9281 | **0.9316** |

It matches the trained CNN to four decimal places on score-disjoint. The task is
close to solvable by raw-pixel template matching, which is the sharpest statement
of how much headroom the production model is leaving.

Two bugs were found and fixed in this probe rather than reported as results:
`template_nn` originally returned neighbour *indices* and compared them to labels
(scoring 0.4% on training data, below chance — the tell), and the leakage check
compared a subset against its own superset. Both were caught by assertions that a
working method must satisfy.

## 13. Instance vs same-score vs score-disjoint gap

| | ROI-only CNN | production `shared` |
|---|---|---|
| A train-instance | 1.0000 | 0.4172 |
| B same-score unseen-instance | 1.0000 | not measured |
| C score-disjoint | **0.9316** | **0.0684** |
| **A → C gap** | **−0.068** | **−0.349** |

The ROI probe's train-to-score-disjoint gap is **6.8 points**. The production
model's is **34.9 points**, and its held-out result sits at chance. Sharing the
score costs the ROI probe nothing at all (A and B are both 100%).

## 14. Classification: **CASE A**

| case | verdict | evidence |
|---|---|---|
| **A** ROI-only strong on both | **APPLIES** | C = 0.9316, B = 1.0000 |
| B score diversity bottleneck | excluded | score-disjoint ROI-only is 0.9316, not near chance |
| C fret representation inadequate | excluded | same-score is 1.0000 and a parameter-free NN reaches 0.9316 |
| D class imbalance | excluded | balanced loss changes nothing (0.9316 → 0.9291) |
| E insufficient dataset support | excluded | 20/20 classes, median 25.5 train scores each, 0/395 held-out objects thin |

The bottleneck is the **shared multi-task representation and its training**, not
data, not pixels, not imbalance, and not geometry — the last of which is closed by
`FINAL_ROI` carrying the glyph at max 1.0 across 209 samples.

## 15. Is more data required? **No.**

Support is ample on every axis measured: 20 classes present in both splits, median
25.5 independent train scores per class, all six strings, max:median imbalance
1.27. Adding data would not address the measured deficit.

The one diversity axis that is thin is **`(fret, string)` cell support** — several
occupied cells have only 1 independent train score. That is worth watching but it is
not what is blocking transfer, since the ROI probe transfers at 93% from the same
crops.

## 16. Is an architecture change justified? **Yes — and this is the first evidence that says so.**

Not as tuning. The diagnostic is specific: the fret information is present in the
`FINAL_ROI` and is decodable from those exact pixels by a 0.1M-parameter CNN and
by nothing at all, while the production model's shared token path delivers 6.84%.

One thing the probe does **not** settle, and which the next experiment must: the
ROI-only probe consumes **raw plane pixels**. The production `shared` variant reads
its ROI from the **stride-1 feature map** through `RoiEncoder`. So the deficit is
either in how that path routes information, or in the feature-space crop itself.
The probe cannot distinguish those, and neither can any number already on the
board.

## 17. Exact next experiment

**Re-run `roi26` at the probe's budget, unchanged otherwise** — 3000 steps, the same
614-row fit split, the same seed 11, the same 40/20 score-disjoint split. That
variant feeds a high-resolution ROI encoding into the head rather than relying on
the shared token, so it is the minimal discriminator between "the shared token
path discards fret information" and "the ROI read is fine and the head routing is
not".

It is deliberately **not** run here. The standing instruction for this milestone
excludes re-running `roi26`/`roidigits`, and a run launched now would also be
uncontrolled against held-out: the probe budget was chosen to answer a
falsification question, and reusing it for an architecture comparison without a
fresh preregistration would be exactly the selection this project has been burned
by.

Nothing else should move first. In particular: not more steps on `shared` (its
train accuracy was still rising while held-out sat at chance), not more data, not
loss reweighting (D4), and not geometry (closed).
