# Audio Vision — the missed notes, and why they cannot be bought back cheaply

The calibrated extractor (`onset 0.65 / frame 0.50 / 3 frames`) raised precision
on real guitar from 0.719 to 0.844 and cut invented notes by 39 %, at the cost
of recall. This study asks whether the lost notes can be recovered on evidence
instead of by lowering the thresholds again, and answers: **not with this
model** — the misses are dominated by notes the model never heard, and every
candidate-recovery rule trades precision for recall at a losing rate.

Nothing in this document changed production. The extraction stays at
`0.65 / 0.50 / 3`; the measurements are here so the next attempt starts from
the evidence.

## How the misses were counted

`scripts/audio-vision-missed-notes.mjs` runs the model once per recording,
keeps its probability matrices, and for every reference note the calibrated
extractor does not report asks:

* did the model's own frame probability for that pitch reach 0.3 / 0.5?
* was the onset strong enough?
* is the missing note an octave/fifth from a note that *was* written (a real
  doubling lost to harmonic suppression)?
* what kind of note is it: quiet, short, soft attack, piano sustain,
  overlapping, weak bass, octave-ambiguous, inside a dense chord?

The Vienna piano clips carry a documented truth-origin offset; the δ values
from `benchmarks/audio-vision/align-probe.json` (derived from the audio alone,
fixed before any model scoring) are applied and the four clips the corpus
itself excludes are not evaluated. Without that alignment the piano looks
catastrophic (recall 0.075) and the conclusion would be wrong — with it,
piano recall is 0.472.

## What the misses are

51 recordings, 1810 reference notes (5 GuitarSet takes + 46 usable mic-real
clips):

| | all | GuitarSet guitar | acoustic guitar | electric guitar | piano |
|---|---|---|---|---|---|
| reference notes | 1810 | 1058 | 412 | 215 | 125 |
| calibrated recall | 0.681 | 0.710 | 0.663 | 0.698 | 0.472 |
| recall at the old, looser thresholds | 0.784 | 0.807 | 0.784 | 0.833 | 0.504 |
| **missed** | 577 | 307 | 139 | 65 | 66 |
| — the model never reached 0.3 (inference) | **335 (58 %)** | 208 | 59 | 35 | 33 |
| — frame 0.3–0.5 (borderline) | 89 (15 %) | 44 | 18 | 20 | 7 |
| — frame ≥ 0.5 but still not written | 153 (27 %) | 55 | 62 | 10 | 26 |
| — an octave/fifth from a written note (sibling) | 227 (39 %) | 162 | 31 | 26 | 8 |

Musical character of the 577 misses (categories overlap): quiet 355, short 220,
**soft attack 502**, overlapping 490, in a dense chord 411, octave-ambiguous
127, weak bass 48, piano sustain 9.

Two conclusions follow directly:

1. **Most misses are an inference limit.** 58 % of the missing notes never
   reached a 0.3 frame probability. No extractor, threshold or post-filter can
   recover a note the model did not hear.
2. **The recoverable ceiling is small.** Only 93 of the 577 misses (5 % of the
   reference notes, ~5 points of recall) could be added "safely" — meaning the
   looser thresholds produce them and they are not harmonic siblings.

## What was tried, and rejected on the numbers

All variants were scored on the same five development takes, then checked on
the five unseen takes, with the same arrangement path.

| variant | what it does | result | verdict |
|---|---|---|---|
| **spectral-aware harmonic suppression** (`suppressHarmonicDoubles({ samples })`) | before deleting a harmonic double, keep it if the audio has real harmonic energy at its own pitch | dev note F1 0.769 → 0.770, arrangement 0.724 → 0.723, genuine notes deleted 7 → 5; mic-real identical | **neutral** — 2 notes out of 1810, not worth shipping |
| **verified second pass, salience rule** | add relaxed-onset candidates only when the audio's harmonic salience supports them | candidate precision 0.20–0.50; arrangement 0.724 → 0.706…0.709 | **rejected** |
| **verified second pass, frame-confidence rule** | add candidates only when the model's own frame probability is ≥ 0.6…0.85 | ss3 0.672 → 0.659, bn2 0.663 → 0.658, jazz2 0.850 → 0.840; one dense take gained (+0.008) | **rejected** — the onset threshold is rejecting mostly false notes |
| **shorter minimum note (2 or 1 frame)** | recover very short notes | dev 0.724 → 0.717 / 0.716 | **rejected** |
| **instrument-specific thresholds** | different triples per instrument | the input cannot be classified without labels or a fragile audio heuristic; the gain would come from one corpus (electric guitar, 12 % of notes) and could not be validated on a second electric corpus | **not shipped** (see below) |

The second-pass failure is the important one: the notes the onset rule rejects
are **not** mostly real. At every verification strength the added notes were
60–80 % false, and the score got worse. The onset threshold is doing real
work, not arbitrarily discarding music.

## Why instrument-specific calibration was not shipped

The diagnosis does show that the looser thresholds would help every instrument
differently (electric guitar +13.5 points of recall, acoustic +12.1, guitar
+9.7, piano +3.2). But:

* the classification has to be made from the audio, without labels;
* the mic-real corpus has 18 electric clips from one source, so an
  electric-specific setting would be fitted and validated on the same
  recordings — exactly the overfitting this branch has been rejecting;
* a misroute (a clean electric guitar treated as acoustic, or a bright
  acoustic treated as electric) would silently apply the wrong precision
  trade-off to the user's music.

Shipping that would be the fragile heuristic the mission forbids.

## What would actually move this

The misses are an inference limit, so the next real gain needs a model that
hears more, not an extractor that guesses more. The measured requirements:

* recall on real guitar: the current model reaches 0.710 at the calibrated
  settings and 0.807 at the looser ones — a stronger model must beat 0.807
  *at* precision ≥ 0.84, which nothing measured here does;
* it must run in the worker (no server), on a phone (≤ ~5 MB), with clear
  commercial rights — the hFT-Transformer (F1 0.842 on a synthesized piano
  reference) fails all three (20.5 MB, PyTorch-only, non-commercial training
  corpus);
* it must be evaluated on this same split: five GuitarSet dev takes, five
  unseen takes, and the 46 usable mic-real clips with the piano δ alignment.

Until then, the honest product answer for a missed note is the review panel's
per-note correction, and the honest answer for a dense take is the Easy
difficulty — both already shipped.

## Reproduce

```bash
node --expose-gc scripts/audio-vision-missed-notes.mjs      # the diagnosis
node --expose-gc scripts/audio-vision-spectral-suppression.mjs --set dev
node --expose-gc scripts/audio-vision-spectral-suppression.mjs --set micreal
node --expose-gc scripts/audio-vision-second-pass.mjs --set dev
SWEEP_THRESHOLDS='[[0.65,0.5,3],[0.65,0.5,2],[0.65,0.5,1]]' \
  SWEEP_BASELINE='0.65/0.5/3' node --expose-gc scripts/audio-vision-threshold-sweep.mjs
```

Artifacts: `benchmarks/audio-vision/missed-notes.json`,
`spectral-suppression-dev.json`, `spectral-suppression-micreal.json`,
`second-pass-dev.json`.
