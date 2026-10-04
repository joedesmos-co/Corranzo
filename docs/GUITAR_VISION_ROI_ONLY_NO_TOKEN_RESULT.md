# ROI_ONLY_NO_TOKEN: deleting `+ tokens` did not rescue transfer

## Verdict: CASE C — no rescue

The shared-token fusion that commit `38d6fa7111` identified as the collapse stage is
**not** the cause. Deleting it removed the last thing letting the fret head learn
anything at all.

| | frozen `shared` @1200 | `ROI_ONLY_NO_TOKEN` @1200 |
|---|---|---|
| train fret | 0.4172 | **0.0678** |
| score-disjoint fret | 0.0684 | **0.0582** (23/395) |
| lift vs chance | −0.0050 | **−0.0152** |
| lift vs `shared` | — | **−0.0102** |
| chance | 0.0734 | 0.0734 |

Wilson 95% interval on score-disjoint: **[0.0391, 0.0859]**, which **contains**
chance. 23 correct of 395 against 29 expected by chance. There is no rescue and no
regression on held-out — the head was already at chance and stayed there.

## The stronger finding: the fret head never trained

Held-out 0.0582 understates it. The model emitted **two distinct classes across 395
objects** — fret 13 for 371 of them, fret 1 for 24 — and that is a constant
predictor, not a mis-trained one.

    pixel-ablation control (held-out):  0.0582   <- identical to normal
      its 1-digit 0.0326 / 2-digit 0.0889    <- identical to normal, to 4 decimals

Removing only the pixels inside each fret box changes the score by nothing at all.
Every glyph-specific signal was already absent before the ablation.

Training loss, single batch:

| step | object_type | string | **fret** |
|---|---|---|---|
| 1 | 2.2704 | 2.1719 | 3.3097 |
| 200 | 0.4455 | 0.4985 | 3.0627 |
| 500 | 0.1788 | 0.2001 | 2.9789 |
| 1200 | 0.0979 | 0.1224 | **3.0189** |

The fret loss reached its minimum, **2.9241, at step 145** and then rose for the
remaining 1055 steps. `ln(26) = 3.2581` and `ln(20) = 2.9957`, so the fret term ended
*above* uniform-over-20. The other two heads trained normally. The fret loss held
**98.7% of the loss share**, so this was not starvation for gradient budget.

## Where the information went: CASE C localisation

The same fixed probe from `38d6fa7111` — same split, seed, optimiser, budget and
readouts — re-run on the *trained* model's own stages. Checkpoint frozen, no
gradients.

| stage | what it is | frozen `shared` | trained no-token |
|---|---|---|---|
| **B** | stride-1 feature ROI | 0.7899 (linear) | **0.8076** |
| **C** | encoder output | 0.6354 (*untrained* encoder) | **0.1975** |
| **P** | `roi_projection` output = what the head reads | 0.0684 (D, the token) | 0.1291 |

All three still fit the training set (MLP train-instance 0.9984, 0.9984, 0.9967), so
nothing here is a capacity limit. Score-disjoint is what collapsed.

**B is intact, even slightly better than the frozen model.** The backbone did not
destroy the glyph. **C is where it goes.** And the collapse is measurable as
degeneracy, not just as lower accuracy:

| stage | dim | mean per-dim sd | PC1 share of variance | effective rank | between/within class spread |
|---|---|---|---|---|---|
| B | 768 | 0.0079 | 20.6% | **28.47** | 8.86 |
| C | 256 | 0.0081 | **62.6%** | **3.14** | 5.20 |
| P | 192 | 0.0122 | 47.6% | 3.25 | 3.53 |

The trained `RoiEncoder` squashes a 768-dimensional, effectively rank-28
representation into 256 dimensions of **effective rank 3.1**, with a single direction
carrying 63% of the variance. That is why it predicts two classes.

For comparison, the same representation read through an *untrained* `RoiEncoder`
probed at **0.6354**. So the encoder's architecture preserves fret identity well
enough to be readable; **training it end to end destroyed that**.

The suspicious operation is in `RoiEncoder.forward`:

```python
features = features.mean(dim=2)   # collapse height, keep width
```

Height is averaged away before the head ever sees the crop. A digit's vertical extent
and stroke layout are exactly what separate shapes like 4 from 9 or 1 from 7, and the
diagnostic at `38d6fa7111` already showed the collapse hurts two-digit frets more than
one-digit ones. Combined with per-sample `GroupNorm`, which normalises away feature
scale, this is where the rank went.

## Causal pixel controls, held-out

| control | accuracy | 1-digit | 2-digit |
|---|---|---|---|
| normal | 0.0582 | 0.0326 | 0.0889 |
| blank page | 0.0734 | 0.1349 | 0.0000 |
| wrong ROI | 0.0456 | 0.0140 | 0.0833 |
| pixel ablation (box interior only) | 0.0582 | 0.0326 | 0.0889 |
| geometry neutralised (train) | 0.0678 | — | — |

Pixel ablation being *identical* to normal is the cleanest statement available: the
fret pixels carry no weight in the prediction. The geometry-neutralised control
matching real exactly is the prediction the test suite asserted before the run —
`tokens` no longer reach the fret head, so zeroing geometry provably cannot move it.

## Unrelated heads: no regression

Reference is the frozen `shared` @1200 checkpoint, re-measured here rather than
asserted.

| head | `shared` train | no-token train | `shared` held | no-token held |
|---|---|---|---|---|
| object_type | 0.9790 | 0.9889 | 0.8910 | **0.8933** |
| string | 1.0000 | 1.0000 | 0.9316 | **0.9316** |
| tile | 0.1225 | 0.0905 | 0.1220 | **0.0894** |

`object_type` and `string` are unchanged (`string` identical to four decimals).
`tile` drops 0.1220 → 0.0894. Reported rather than buried: `tile` is near-useless in
*both* models — the frozen `shared` only reaches 0.1220 — so this is a weak head going
slightly weaker, not a working head breaking. It is not evidence of fret-locality
failing.

## Same-score unseen instances

The first pass computed this per **page**, which flagged 767 of 1162 objects instead
of the intended 20%: a page straddling the 80% cut was taken whole, so 66% of objects
were selected and the number was not comparable to anything. Recomputed per object it
gives 153 objects, matching the `38d6fa7111` probe split exactly.

    ROI_ONLY_NO_TOKEN same-score unseen:  0.0523  (8/153)
    frozen stage D, same split:           0.1765

Below the token's own figure. Even on instances of scores it trained on, the head is
at chance — the same signature that identified stage D, now reproduced by a model that
does not use the token at all.

## Per-fret and per-string, held-out

Every class is at zero except two:

| fret | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| acc | .0000 | **.2414** | .0000 | .0000 | .0000 | .0000 | .0000 | .0000 | .0000 | .0000 |

| fret | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|
| acc | .0000 | .0000 | .0000 | **.9412** | .0000 | .0000 | .0000 | .0000 | .0000 | .0000 |

Fret 13 at 16/17 is the constant prediction leaking through, not a learned class.

Per-string is uniformly flat — 0.0339 to 0.2500 across all seven strings, no string
structure whatsoever. Top confusions are all `pred13->trueX`, spread evenly across
classes (24, 23, 22, 22, 22, 21, 20, 20, 19, 19), which is what a constant predictor
produces and is the opposite of the structured digit confusion a learning model shows.

## Why this does not exonerate the token

`38d6fa7111` measured D at 0.0633 score-disjoint and 0.1765 same-score, and concluded
CASE 2. That conclusion was about *where information was lost along the frozen forward
pass*, and it stands: the token demonstrably does not carry transferable fret identity.
This run refutes the *remedy* that followed from it — routing around the token does
not help, because the dedicated branch is not independently trainable either. Both can
be true, and the second was not measurable until the branch was trained on its own.

The diagnostic probe read stage C through a **random, untrained** encoder and an
external probe on standardised features. Production trains that encoder end to end
against a loss it never fits, and the encoder degenerates to effective rank 3. The
0.6354 figure was a property of an untrained module, not a promise about a trained one.

## Next experiment — specified, not run

Not architecture #2, and not a tuning sweep. The single discriminator between the two
live explanations is whether the encoder's **architecture** or its **training** is at
fault, and it costs one run:

> Freeze the `RoiEncoder` at its random initialisation (exactly the configuration that
> probed at 0.6354) and train only `roi_projection` and `fret_classifier`.

If a head trained on a frozen random encoder transfers, the encoder *training* is the
culprit and the fix is a stop-gradient or a much smaller encoder learning rate. If it
still collapses, the height-collapse `mean(dim=2)` plus `GroupNorm` is the culprit and
the fix is representational, not optimisation.

Deliberately not run: `G12` forbids inventing or training a second architecture, and
this would be a training experiment. The CASE C mandate was to localise, and all four
of its targets are measured above — trained `RoiEncoder` (0.1975, effective rank 3.1),
`roi_projection` (0.1291), fret loss routing (98.7% of loss share, largest gradient
group at 0.217), and representation collapse (768-d rank 28.5 → 256-d rank 3.1).

## Recommendation

**Do not merge.** `ROI_ONLY_NO_TOKEN` is worse than `shared` on held-out and
catastrophically worse on train. Production is unchanged: `shared`, `roi26` and
`roidigits` behave exactly as before, and the variant is not selectable from the
production CLI.

The useful output of this campaign is the localisation, not the variant: the stride-1
crop is healthy at 0.8076, and the trained `RoiEncoder` is where 0.81 becomes 0.20.

## Method notes

Fresh initialisation, never warm-started from `shared`. Full-scale configuration
imported from `fret_experiments` rather than re-derived: 40 train scores, 20
score-disjoint held-out, 256px, 128 objects, hidden 192, 4 layers, AdamW lr 3e-3,
cosine with 25% warmup built for the 1200-step terminal budget, grad clip 1.0, jitter
0.35, roi grid 8, context 1.6, seed 11, CPU. Training 5.5 h, one `nice`d process, no
MPS. Checkpoints at 200/400/700/1200. Resume validated bit-identical for this variant
before the long run: `identical=True max|delta|=0.0`.

Held-out evaluated at the terminal checkpoint only; intermediate checkpoints got
train-side diagnostics exclusively. No post-hoc tuning of any kind.

### Bugs found while reporting

The same-score split was computed per page rather than per object, selecting 66% of
objects instead of 20% and making the number incomparable to `38d6fa7111`'s. Caught
because 767 objects cannot be a 20% tail of 1162; recomputed per object to 153, which
matches the earlier probe split exactly. A page-index shadowing bug in the
re-measurement path (`pages[start]` returns a sample, not an index) surfaced
immediately and was fixed.

## Reproduce

```bash
python3 -u tools/guitar-vision/h74_roi_only_no_token.py \
  --steps 1200 --checkpoints 200,400,700,1200 --log-every 50 \
  --ckpt-root tmp/gvprobe/roi-only-ckpt \
  --out tmp/gvprobe/roi-only-no-token.json

python3 -u tools/guitar-vision/h75_no_token_localize.py
```