# Guitar Vision — Phase 4 qualification and the loader it forced

## What this gate is

`tools/guitar-vision/python/guitar_vision/qualify.py` answers one question with
a number: **can this representation learn the guitar target contract at all?**

It is not a benchmark and it does not claim the recogniser works. It exists to
separate two diagnoses that have opposite responses:

- *representational* — the architecture cannot express what a guitar score
  needs, so no quantity of data helps and the design has to change;
- *data* — the architecture is fine, the corpus is the binding constraint.

Those take days apart to distinguish once a real training run is underway, so the
gate is run first.

## The finding that shaped everything else

**The memorisation number is meaningless, and reporting it alone is a trap.**

On a corpus of ground-truth proposals, every object sits at a unique coordinate.
A box-to-answer lookup table is therefore a *complete* solution. The first version
of this gate measured 100% on all three heads and reported success.

It is wrong, and the only reason it was caught is that the gate was built to be
sceptical of its own result. Three separate leaks were found, each of which made
a run pass for the wrong reason:

| Leak | What it was | Caught by |
|---|---|---|
| Targets as pair features | `guitar_pairs` took `string` and `fret` — the target tensors — and built same-string / same-fret features | blank-image control: 100% on the fret head with the page whited out |
| Ground-truth view as input | the samplers were told which view each object was on; a TAB object is by definition a fret digit, so `view` answered `object_type` outright | blank-image control: 99% on `object_type` with the page whited out |
| Exact proposals | jitter during training did not help, because at evaluation the *true* boxes are still unique keys | per-head control: 0.00% of the fret head's score came from pixels |

Fixes, in order:

1. Pair features are computed from `boxes` alone. The signature is asserted in
   `test_pair_features_cannot_see_a_label`, because a target in that signature is
   the single easiest mistake in this codebase to make again.
2. Every tile is sampled for every object and the results summed. The model
   decides which tile carries the object, as it must at inference.
3. Proposals are jittered **during training and at evaluation, at the same
   scale**, so the coordinate key is equally useless in both arms of the
   comparison and the difference between them is the pixels and nothing else.

## The control

A 2×2, varying the two input paths independently:

| | jittered proposals | constant proposals |
|---|---|---|
| **real image** | **A** — the gate | **B** |
| **blank image** | **C** | **D** |

- `A − C` — what the **pixels** are worth.
- `A − B` — what the **positions** are worth.
- `D` — the floor, where neither path carries information.

The requirement is **per head, not averaged.** The heads are not equally
pixel-dependent and should not be. A fret digit is engraved at about half a
notehead's height, on a different staff, at a different scale, so "is this box a
notehead or a fret digit" is largely answerable from the box's own height and
aspect ratio without looking at anything. Averaging would let that head's 99%
cancel out the fret head's dependence and report a margin describing no head in
particular. The **fret head** is the one that must demonstrably read pixels; the
geometry-answerable heads are reported with their real numbers rather than
quietly excluded.

## The measurement that counts

Memorisation is recorded because it establishes that capacity is *sufficient* —
a necessary condition, explicitly not a sufficient one. The gate is decided on
**held-out pages**: pages whose coordinates were never paired with a label, so the
lookup table does not apply. Chance is re-measured per head on those pages, since
the majority-class rate differs by vocabulary (`fret` 26 classes, `string` 8).

A head passes only if it beats its own chance rate on an unseen page.

## Results

Run: 40 training pages, 20 held out, 10 pages/step, 700 steps, 256px, 3.26M
parameters, MPS, 3.45s/step, 40 minutes.

| Measure | Result |
|---|---|
| Memorisation `object_type` | 99.7% |
| Memorisation `string` | 100.0% |
| Memorisation `fret` | **90.7%** — below the 98% target |
| Transfer `object_type` | 88.7% vs 44.8% chance (+44.0%) |
| Transfer `string` | 92.5% vs 38.4% chance (+54.1%) |
| Transfer `fret` | **10.9% vs 8.4% chance (+2.5%)** |
| Fret pixels worth | +59.9% (79.6% → 19.7% blanked) |
| Fret positions worth | +73.0% (79.6% → 6.6% constant boxes) |

**GATE FAIL**, on two counts, and both are honest:

1. `fret` did not reach the memorisation target (90.7% vs 98%). The model has not
   even fully fitted the pages it trained on, so capacity for this head is
   **not established**. That is a real negative result and it is the first thing
   to fix — there is no point scaling the corpus while the model is still
   underfitting the one it has.
2. `fret` transfer is +2.5% over chance. Above chance, so not nothing, but
   nowhere near recognition.

### What the numbers do say

**The fret head is genuinely reading pixels.** Blanking the page takes it from
79.6% to 19.7% — a 60-point swing. The leak-hunting work succeeded: this is no
longer a model answering from coordinates, which is what the same metric
reported at +0.16% before the loader was fixed.

**Transfer is monotonic in corpus size for the other two heads.** `object_type`
went 78.1% → 88.7% and `string` 81.3% → 92.5% going from 6 pages to 40. They are
learning, and they are learning from the page.

**The bottleneck is a single head reading 26 classes of small glyph.** Everything
else about the pipeline is now measured and correct: boxes land on ink, the two
input paths are independently load-bearing, the gates resist memorisation, and
held-out measurement is in place. `fret` is where the remaining capacity and data
questions live, and it is where the next work belongs.

### The next three things, in order

1. **Establish `fret` capacity** before anything else. It underfits at 90.7% while
   every other head is at ~100%, and the cause is not yet identified. Candidates
   to test, cheapest first: the digit is ~11px tall in a 256px plane and the
   deepest backbone scale is stride 16, where a digit is 0.7px; the relative
   sampler spreads ±2.6 staff gaps and may be sampling mostly off-glyph; the
   26-way vocabulary may be too coarse for a 40-step-up.
2. **Only then** scale the corpus. Growing data while underfitting trains the
   model to underfit more pages.
3. **Predicted proposals** remain untested and are a separate gate.

## The loader, and four bugs that all looked like success

Building the gate exposed a chain of errors in how rendered views and record
boxes are related. **Every one of them was silent** — no exception, no NaN, a
loss that decreased, a plausible-looking report — and every one is now a test in
`tests/test_dataset.py`. This is the most important thing in this phase.

**A wide view cannot be one plane.** A TAB crop is ~12:1. Letterboxed into a
square, a 3980×318 strip becomes 256×20: six staff lines collapse into 20 rows
and a fret digit into **0.8 pixels**. The model is asked to read a glyph that is
not there, and the answer is not "hard", it is arbitrary. Fixed by tiling each
view into a fixed number of planes at full height — median fret digit height is
now ~11px.

**A view is a crop, and the boxes are page-normalised.** The rasteriser crops to
the union of a kind's bands, so the PNG's origin is the band's top-left, not the
page's. A digit genuinely at page y 0.73 landed at crop y 0.21 — the sampler was
pointed at the measure *above* the digits. An ink test over 710 objects found ink
on only 14.5% of them.

**The tile span was in the wrong units.** Tile bounds index the *scaled* array
but were divided by the *source* width, off by the scale factor (~0.8 for a TAB
strip). Ink on 0 of 21 fret digits before the fix.

**Tiles were pasted, not resized.** A 12:1 strip scaled to a 256px height is
3200px wide; pasted into four 256px planes, only the first 1024px survived and
three quarters of every TAB object pointed at white.

**Also fixed:** white margins are trimmed before tiling (a band is a rectangle of
engraved space that includes the indent before the first system, and paying for
that in tiles costs resolution where the glyphs are); and tiles **overlap** by a
tenth, because a box straddling a boundary has to be dropped rather than clipped
and dropping it cost a quarter of the fret digits.

The invariant that catches all of them: **put a known box on the image and ask
whether the ink is there.** Currently 87.6% of noteheads and 87.9% of fret digits
land on ink; the residue is glyphs partly outside their crop at a system
boundary.

`marking` is at 5.5% and is **not** yet a target. Marking boxes are `artic` group
extents, which for many techniques are far larger than the glyph itself, so they
name a region rather than a mark. It is called out here rather than left to be
discovered as a bad training signal.

## What passing this gate would mean, and what it would not

A pass would mean: the representation can use pixels, can localise, and survives
a page it has not seen. It would **not** mean the recogniser works. Nothing here
touches the two things that dominate the real work:

- **Predicted proposals.** This gate is proposal-conditioned. Finding the objects
  is a separate gate and is not claimed.
- **Real data.** All of this is Verovio's engraving of synthetic MusicXML. It
  says the architecture can learn clean vector glyphs. Real printed guitar scores
  differ in font, spacing, scan noise, paper skew, and 83 notation families rather
  than 2 — none of which this corpus contains.

Per the acquisition plan, 9 of 83 families are currently claimable, 64 have zero
labelable data, and 1,785 real labelled instances are still required. No training
run should be launched to "just see what happens"; the honest next step is
acquiring the real annotated data, and the predicted-proposal path.
