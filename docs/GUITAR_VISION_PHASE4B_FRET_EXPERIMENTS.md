# Guitar Vision — Phase 4b: fret-representation experiments

## Verdict

**All three experiments fail. The gate still fails. Do not scale the corpus.**

| Variant | fret memorisation | fret transfer | chance | pixel ablation | `object_type` / `string` |
|---|---|---|---|---|---|
| `shared` (current 26-way) | 9.8% | 12.1% | 8.6% | **+0.00%** | 65.7% / 85.7% |
| `roi26` (high-res ROI) | 10.3% | 5.2% | 8.6% | **+0.00%** | 63.4% / 86.6% |
| `roidigits` (digit-structured) | 3.6% | 5.2% | 8.6% | **+0.00%** | 64.9% / 83.0% |

24 pages train / 16 held out, 100–150 steps, 192–224px, MPS. Parameters 1.78M–2.06M.
None reaches the 98% memorisation gate. None regresses `object_type`/`string`
materially. None helps fret.

## The finding that reframes the earlier result

**The frozen gate's `fret` memorisation of 90.7% was substantially coordinate
memorisation, not digit reading.** It does not survive a change to the tiling.

Before the geometry fixes below, the loader produced 9 planes per page by cutting
a 13:1 TAB strip into 4 tiles and stretching each into a square. Two things
followed. Digits were squashed to ~30% of their width, and — the part that
mattered for the number — each plane's content was squashed to a narrow band, so
every object in a page had a distinctive, nearly unique position in a small
plane. A box-to-answer table solved the training pages.

Fixing the geometry (uniform resize, plane count = the view's aspect, full staff
bands) removed the squashing **and** the memorisation shortcut. Memorisation went
90.7% → ~10% with no change to the head, and the pixel ablation is now exactly
**0.00%**: blanking the image does not move the score at all, on train pages or
held out.

So the honest reading of the earlier gate is: `fret` never learned to read
digits. It learned coordinates. The gate's per-head control was right to require
pixel dependence and right to fail, and the fix is that the *representation*
cannot see the glyph well enough to learn from it.

## Why the ROI branch cannot work yet: the crop is 7.3% ink

The ROI branch samples an 8×8 grid over each box expanded 1.6×. Measured on the
rendered corpus, **7.3% of those sample points land on ink for fret digits.**

The box is not wrong — the digit is inside it (86.2% of fret boxes have ink). The
box is roughly **four times the glyph's height**: it is a string gap, not a glyph.
So a crop over the box spends ~93% of its samples on the blank staff above and
below the digit, and the encoder that reads it is reading mostly background.

This is the same defect the ink test has been reporting since Phase 3 (median ink
coverage inside a fret-digit box: 8.4%). It was known, it was attributed to the
renderer, and two attempts to fix it in the renderer made things worse:

- "calibrated against ink" produced a box whose ink landed 78px above its own
  staff line — the digit was outside its target entirely. Reverted.
- The SVG's own staff groups describe the *used* portion of the staff, not all
  six lines, so taking the band from them cut the top of the staff.

Engraving geometry is not to be fitted by eye. The correct fix is to derive the
digit's own cap height from the font metrics Verovio actually uses for TAB digits,
verified by an ink-extent test — not by tuning a constant against pixels.

## The staff-band bug, which was real and is fixed

Worth recording because it was the most consequential defect found:

A view's crop rectangle (the "band") was built from the notes on the staff — the
outermost note centres padded by a median note height. That cannot span a staff:

- a TAB staff spaces digits a full line gap apart, so half-a-note-height padding
  covers ~3 of 6 lines. Measured: **a TAB crop contained 3 staff lines.**
- a score played on strings 1–3 cannot reach the other three at all.

The engraver places digit boxes in page coordinates, so a band stopping above the
topmost digit puts that digit outside its own crop. Bands now come from the
engraver's `class="staff"` elements, scanned with a depth counter (a non-greedy
regex stops at the first `</g>` and returned a fragment — 8 staff elements exist
in a typical score and it found 1), taking the innermost complete span and
widening it to contain every TAB digit box.

## What each experiment actually tested

**1. Dedicated high-resolution ROI branch (`roi26`).** A 26-way head on a dense
8×8 crop from the stride-1 feature map, concatenated with the shared token.
Isolates resolution from output parameterisation. Result: no change, +0.00%
pixel ablation. Correctly *not* promising at this crop density, and it does not
regress the other heads — but it cannot help while the crop is 7.3% ink.

**2. Digit-structured prediction (`roidigits`).** Per-slot digit distributions
plus an occupancy head over 0–2 slots, decoded left-to-right by composition
rather than picked from a 26-way list. An exact fret-number metric is kept for
the gate, so a variant that reads digits and assembles them wrongly does not get
credit. Result: **worse** (3.6% memorisation), and its confusions are
`pred0->true1` and `pred24->true10` — the decoder is emitting "one digit, zero"
and "two digits, 4-0" patterns, i.e. it has learned the occupancy head's prior
and nothing about glyph shapes. Factorising the output does not help when the
input has no glyph content. This is a negative result and is kept as one: the
digit-structured decoder is not obviously better and was not assumed to be.

**3. Combined.** Not run. Experiment 2 is strictly worse and experiment 1 is
neutral, so there was no promising part to combine.

**4. Loss weighting / class balance.** Deliberately **not run.** The
instruction was to audit this only after confirming architecture behaviour, and
class weighting cannot fix an input that carries no information: it would move
the majority-class rate while leaving the pixel ablation at zero. Doing it now
would be exactly the "hiding under-capacity with extreme weighting" the brief
rules out.

## Why the pixel ablation being 0.00% is the load-bearing number

For `object_type` and `string` the gate measured real pixel dependence, and
`string` still reaches 83–87% here. Those heads answer partly from geometry —
glyph scale and vertical position — which is legitimate.

For `fret`, 0.00% means the blanked page scores *identically* to the real one.
Whatever it is predicting, it is not reading. Any accuracy it happens to hold is
coming from the proposals.

## Recommended next step (not taken, because it is not an architecture experiment)

1. **Fix the target box to the glyph.** Derive TAB digit cap height from Verovio's
   own font metrics, with an ink-extent test as the acceptance criterion. Target
   median ink coverage inside a fret-digit box ≥ 40% (from 8.4%). Until the input
   contains the glyph, no head can be evaluated.
2. **Re-run the three variants** unchanged. They are implemented and tested; only
   the geometry underneath them changes.
3. Only then revisit the digit decoder, which may well win once its input is a
   glyph rather than a mostly-blank crop.

Until step 1 lands, per the standing instruction, **no corpus scaling and no
long training run**, and the gate stays frozen and authoritative.
