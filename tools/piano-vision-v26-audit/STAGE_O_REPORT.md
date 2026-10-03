# Stage O — raster-only printed-onset detector: CASE D, now with measured evidence

Nothing mutated. Corpus 2.1 untouched, no labels created, no Corpus 2.2, no RTX,
no training. No MusicXML, Verovio, pitch, `d0`, `true_d`, residual or decoder output
was read at any point.

## What ran

`o_onset_detector.py` scanned the 42 frozen high-confidence mapped measures and found
**407 onset groups**. Truth bootstrap artifacts were then built candidate-first: a glyph
grid (one tile per candidate, so each false positive can be *named*) plus per-measure
staff strips (so missed noteheads are visible).

24 measures were selected spanning the required range, split **by score**:
DEV 8 measures / 5 scores, HELDOUT 16 measures / 11 scores.

A real bug was found and fixed en route: `detect()` returned candidate `y` relative to
the staff band while the renderer treated it as absolute, producing empty tiles. With
that fixed the adjudication became possible.

## O6/O7 — what the adjudication shows

**147 candidates adjudicated** from raster crops. The DEV upper grid alone holds 72.

DEV upper false-positive taxonomy:

| Class | Tiles |
|---|---|
| clef fragment | 20 |
| key-signature accidental | 16 |
| time signature | 9 |
| rest | 2 |
| other / uncertain | 9 |
| **true-positive noteheads** | **16** |

**DEV onset precision ≈ 0.22** (screening estimate, ±~4 tiles, single reader).

False negatives: staff strips show **unmarked noteheads**, concentrated in dense beamed
runs and stacked chords, where noteheads merge into one component or fall outside the
height window. **Recall is not quantified** — it was judged qualitatively, and I am not
going to present a number I did not measure.

## The mechanism — and why this is not a threshold problem

O3 staff-line suppression removes long horizontal runs. That necessarily **fragments any
glyph spanning the staff height**: a treble clef, a time signature and several accidentals
all cross multiple lines, so each breaks into 2–5 fragments whose bounding boxes land
squarely inside the notehead width/height/fill window. One clef yields several false
candidates, which is exactly what the grid shows.

This matters because it means **no choice of `W_MIN`, `H_MAX` or `FILL_MIN` fixes it**.
The fragments genuinely have notehead-sized bounding boxes; rejecting them requires
knowing they belong to a larger glyph, not tightening a size test.

The indicated correction is therefore structural, not numeric: **detect on
line-suppressed ink but validate shape on the ORIGINAL unstripped ink**, rejecting any
candidate whose connected component in the original mask is much larger than a notehead.
A clef fragment sits inside a component several staff gaps tall; a real notehead does
not.

## Why I stopped rather than applying it

I could have implemented that correction and reported a precision number. I did not,
for two reasons:

1. **No reliable truth.** The 0.22 figure is a single-reader visual tally with no
   pixel-level or second-reader verification. Using it to accept or reject a correction
   is fitting to an eyeball estimate, and the resulting "improvement" would be
   uninterpretable.
2. **The decisive failure is recall, and I cannot yet measure it.** Missed noteheads in
   dense beamed runs and chords are the reason Category B is unresolved. Tightening
   precision without measuring recall would move the failure rather than fix it.

## O15 decision

**CASE D** — the detector cannot reliably distinguish printed onset structure.

- Baseline onset precision: **≈0.22** (DEV, screening estimate)
- Baseline onset recall / F1: **not established**
- Notehead membership accuracy: **not established**
- Held-out precision / recall / F1: **not attempted** (O8 corrections were never frozen)
- Category B1/B2/B3/B4 split of the 365 noteheads: **not attempted**
- Safe missing-annotation pool: unchanged from Stage L — **62 noteheads / 7 measures**
- Reachable N~100 / N~250 / N~500: unchanged — ceiling **68**
- New Tier-1/Tier-2 priorities: unchanged from Stage L (Tier 1 = 3 systems / 3 measures /
  50 noteheads)
- Is labelling scientifically justified? **No.**

Applying this detector to Category B would have converted 365 ambiguous noteheads into
365 confident-looking findings. Given a measured precision near 0.22 and unmeasured
recall, that would have been actively harmful — the same class of unvalidated
correspondence that invalidated Stage C.

## Exact next step

Fix O3 structurally (detect suppressed, validate on original ink) and, in the same pass,
build a **recall-capable** truth artifact: per-measure strips with candidate boxes
enumerated so missed noteheads can be counted, not just noticed. Then re-adjudicate.
Precision near 0.22 is fixable; unmeasured recall is what blocks the B1/B2/B3 decision.
