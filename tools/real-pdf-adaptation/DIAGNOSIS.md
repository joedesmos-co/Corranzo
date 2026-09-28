# Why the qualified step-2100 checkpoint fails on rendered PDFs

This is the evidence the campaign design rests on. It is a measurement, not a
hypothesis, and it answers the one design question that matters: **does the low
pitch confidence come from the pitch head, or from the representation feeding
it?**

## The ablation

Take qualified corpus validation records and perturb **only the input geometry**,
keeping the pixels, the objects and the targets byte-identical. Then measure
`object.pitch_staff_step` on the step-2100 checkpoint.

3 validation scores, 177 supervised objects, CPU, fp32, no batching:

| perturbation | pitch_staff_step accuracy | mean max probability |
|---|---|---|
| none (qualified corpus record) | **0.9661** | 0.964 |
| `geometrySource` -> production raster value, `geometryConfidence` 0.75 -> 0.70 | 0.9661 | 0.964 |
| object box -> production raster shape (1.0 x 1.5 staff spaces) | **0.6723** | 0.872 |
| staff-band separation -> production ratio (0.519 -> 0.690 of scope height) | **0.7966** | 0.954 |
| both | **0.5763** | 0.872 |

## Reading

1. **The `glyph-font-bbox` / raster constant is not the problem.** Feature 18 of
   the 24-dim object vector is a constant 1.0 across the entire qualified corpus
   and 0.0 in production, and it costs exactly nothing. The `object_projection`
   LayerNorm absorbs it completely.

2. **The object box is the dominant cause.** The qualified corpus objects are
   1.18 x 1.84 staff spaces; production raster proposals are normalised to
   1.0 x 1.5. Swapping only that costs 29 accuracy points on identical pixels.
   The trained region sampler reads the object out of a 3x-expanded box, so a
   shorter box both shrinks the notehead inside the sampled grid and drops the
   staff lines out of it.

3. **The staff-band separation is the second cause.** It is 0.519 of the scope
   height in the corpus and 0.690 in production, so vertical geometry is
   stretched by 33% relative to the scope box that `_object_vector` normalises
   against.

4. **Together they land at 0.576**, which is the same regime as the reported
   0.3676 on the Minuet, and the remainder is explained by production
   `staff_space()` estimation error plus genuine raster/antialiasing shift.

## The conclusion that drives the campaign

The damage happens with identical pixels and identical targets. So it is **not**
in the pitch head's weights and **not** in the raster. It is in the
representation: the geometry the region sampler is handed.

Therefore freezing everything except the pitch head is the one intervention
guaranteed not to work. The visual trunk, `visual_projection`,
`object_projection` and `geometry_projection` all sit on the broken path and
must train. That is why `train_realpdf.py` puts those in the highest-LR group
and the pitch heads only in the second highest.

It also explains the reported symptom pattern. Duration depends mostly on
x-position and on relations, which the box change barely touches, so duration
survives at ~0.706 while pitch collapses. A vertical-geometry problem that
spares x and punishes y is exactly what this ablation shows.

## Two facts the label builder depends on

Both were verified from the qualified corpus itself, not assumed.

**The `stepsFromBandCenter` label is a closed-form geometric quantity.**
Recomputing `(staffBandCenter - objectCenterY) / staffGap` from 6,029 corpus
labels across 40 scores reproduces the stored value to a maximum absolute error
of **5e-4**, and the label's `sourceY` equals the object centre exactly. So the
label can be regenerated for a real PDF from the object's own geometry without
guessing.

**The band offset is analytic, not fitted.** For a correctly detected five-line
staff the offset `(bandCenter - clefReferenceLineY) / staffGap` is exactly
-1 for a G clef on line 2 and +1 for an F clef on line 4, whatever the
rasterization. Measured across the audited scores the medians are **-0.977** and
**+1.023** with an interquartile spread of **0.01** staff steps. So the
production staff-line detection is sound, the label offset is known, and nothing
has to be calibrated against the ground truth.

## Residual known gap

The confidence collapse on the real Minuet (0.0001-0.14) is sharper than the
0.87 mean max probability the box/bands ablation produces. The residual is most
likely production `staff_space()` returning a wrong median line gap on some
measures, which would distort the box far more than the fixed 1.0 x 1.5 the
ablation used. The adaptation corpus is built through the identical
`staff_space` / `proposal_bounds` path, so the training data carries that error
rather than hiding it, and `coverage.json` records the per-measure analytic
offset so the effect is auditable.
