# Stage O — raster-only printed-onset detector (STOPPED at O1, CASE D)

Nothing mutated. Corpus 2.1 untouched, no labels created, no Corpus 2.2, no RTX,
no training.

## What was built

`o_onset_detector.py` — decides whether a printed onset/notehead group exists using
**only** the page raster plus already-frozen PDF geometry (validated staff rectangles,
validated printed measure boundaries from the frozen barline detector).

It never reads MusicXML pitch, MusicXML/Verovio onset counts, Verovio notehead
positions, `d0`, `true_d`, residual sign, decoder output, or the absence of a corpus
annotation as evidence that nothing is printed. Pitch classification is not attempted.

Method:
- **O2** connected-component notehead candidates on ink with staff-line runs removed;
  shape filters on width, height and fill ratio, all expressed in staff gaps so they
  are resolution- and scale-free. No stem is required, so whole notes survive.
- **O3** staff-line suppression erases only horizontal runs longer than 3 staff gaps,
  so a notehead overlapping a line survives as a slotted blob and is still detected.
- **O4** onset groups by clustering candidate x with a geometry-relative tolerance
  (1.35 staff gaps).
- **O5** cardinality from vertically distinct candidates; **no voice assignment**.

Scan of the 42 frozen high-confidence mapped measures found **407 onset groups**
across both staves (`out/O_detect_raw.json`).

One bug worth recording: the montage renderer scaled by `scale/3`, which silently
*downscaled* the inspection images and made adjudication unreliable until fixed.

## O1 — truth adjudication: 2 of the required 30–50 measures

Two measures were adjudicated visually at 3× from numbered overlays
(`out/o_montages/hires.png`), recorded verbatim in `out/O1_adjudication.json`.

**bach-fugue p1 s0 ord 0, upper staff, 9 detected — verdict: sparse regions work.**
Six onset markers land on real noteheads. Three false positives are clearly visible,
all at the measure start: a **treble clef**, a **common-time signature**, and an
**eighth rest**. At least one notehead left of the first beamed group was not marked.

**chopin-etude-op10-01 p1 s0 ord 0, upper staff, 9 detected — verdict: unresolved.**
The detector emitted a packed cluster of onset markers inside a 32nd-note beamed
group. Whether that reflects correct 32nd-note density or over-detection could not be
decided at the available resolution.

## Why this stops here — CASE D

O1 asks for a representative PDF-only truth set of at least 30–50 mapped measures
spanning sparse notation, dense polyphony, chords, multiple voices, beamed notes,
accidentals, ledger-line regions, upper/lower staves, and Bach/Beethoven/Chopin/
Handel/Mozart. **Two measures were adjudicated.**

That is not enough to compute, and it would be fabrication to report:

| Item | Status |
|---|---|
| baseline onset precision / recall / F1 (O6) | **not established** |
| notehead membership accuracy (O6) | **not established** |
| FP / FN taxonomy over a real sample (O7) | 3 FP classes from 1 measure only |
| the three allowed corrections (O8) | **not attempted** — no dev metrics to target |
| held-out onset precision / recall / F1 (O9) | **not attempted** |
| Category B1/B2/B3/B4 split of the 365 noteheads (O10–O12) | **not attempted** |
| reachable N~100 / N~250 / N~500 (O12) | unchanged from Stage L: ceiling 68 |
| new Tier-1/Tier-2 schedule (O13) | unchanged from Stage L |

Making corrections now, without dev metrics, would be tuning to an anecdote. Applying
the detector to Category B now would convert an unvalidated measurement into 365
apparent findings, which is precisely the failure mode the campaign has avoided so far
— Stage C was invalidated by exactly this kind of unvalidated correspondence.

## What the two adjudications do establish

1. The approach is **not** hopeless: in sparse notation it finds real printed onsets
   from the raster alone, which is the precondition for splitting Category B.
2. There are at least two concrete, principled, correctable failure modes already
   visible without tuning: **measure-start non-notehead glyphs** (clef, time
   signature) and **rest glyphs**, both of which are positional/shape cues, not
   thresholds to be fitted.
3. The unresolved case is **dense beamed polyphony**, which is precisely where most of
   the 365 Category-B noteheads live. So the hard part is confirmed to be the hard part.

## Exact next step

Adjudicate the remaining truth measures at adequate resolution, prioritising the dense
beamed cases first, because that is where Category B lives and therefore where the
B1/B2/B3 decision is actually made. Only once O6/O9 give real dev and held-out numbers
should O8 corrections be applied and the frozen detector be run over Category B.

This is CASE D in the O15 taxonomy: detector reliability is not yet adequate for
structural use, and the immediate requirement is a stronger, *adjudicated* PDF onset
measurement — not more detector engineering and not annotation.
