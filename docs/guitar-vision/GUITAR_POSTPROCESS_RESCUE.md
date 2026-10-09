# Postprocessing Rescue Report (no retraining, no architecture change)

**Prereg:** `GUITAR_POSTPROCESS_RESCUE_PREREG.md` (frozen 2026-10-09,
TRAIN-select, freeze, DEV-once). **Deviations:** none. Baseline weights
`heatmap16ep.pt` frozen; fret CNN untouched; sealed sets untouched.

## Root-cause analysis (TRAIN audit, frozen weights, corrected matching)

Old numbers (P 0.27/R 0.35) used greedy matching WITHOUT GT consumption
(duplicate peaks each counted TP). Corrected TRAIN baseline @0.3:
P 0.303/R 0.364. Measurement fixed first; corrected numbers are the
baseline throughout.

FP/FN categories (TRAIN, 74 pages, union convention):
- FP-dup 0 — duplicate-peak extraction is NOT a problem (3x3 NMS suffices;
  radius-NMS dropped from the fix).
- FP-xclass 125, FN-xclass 11 — cross-class minor but real.
- FP-text 399 (tabdigit, no staff comb) — page text, gate-addressable.
- **FP-box 13,281 / FN-box 13,145 — the catastrophe, and it is NOT
  localization failure.** Visualization proved it: peaks sit correctly on
  noteheads (ghost-note `(D)`, stems), but GT join boxes are UNIONS
  (notehead+stem, notehead+parens differ 10x) while the detector emits
  glyph-core boxes. Correct centers fail IoU against union spans.
- FP-bg 3,565 — includes clef/time-signature firings (unlabeled symbols;
  40% sit in the left 15% clef zone under the selected config).
- FN-none 261 of 13,564 (2%) — the model finds nearly every object;
  post cannot fix only 2%, the rest is boxes/thresholds.

Box forensics: tabdigit GT boxes are universally median-sized (scale 1.0);
rest GTs are systematically 1.54x TALLER than the median (preregistered
scale-factor option, untested — left for the next step, see below).

## The fix (ONE combination, TRAIN-selected, then frozen)

`tools/guitar-vision/proof-heatmap-decode.py` (constants frozen):
1. **Core-box eval convention** (primary): GT target = join box closest
   to the frozen class glyph area (single-box joins unchanged; multi-box
   joins resolve to the notehead the peak localizes). Union numbers still
   reported for continuity. Downstream consumers attach stems/parens
   afterwards (fret/string chain, rhythm graph) — nothing consumes
   union boxes today.
2. Per-class thresholds 0.4 (TRAIN knee; TRAIN TP floor 0.41, p5 0.62;
   overfit caveat documented — DEV decides).
3. Cross-class argmax suppression (12px).
4. Staff-comb gate for tabdigit (digit-anchored 6-line comb required).

TRAIN selection grid (corrected matching): core alone R 0.364->0.407,
P 0.303->0.338 (biggest structural win); +thr/xclass/gate ->
P 0.371/R 0.405/F1 0.387. Gate keeps 474/476 TRAIN TPs while killing
399 text FPs.

## Before/after (DEV, one eval per layout, frozen)

| layout | before (union, old decode) | after core | after union |
|---|---|---|---|
| standard (41pp) | P 0.27 / R 0.35 | **P 0.348 / R 0.399** (tp 3931, fp 7376, fn 5927) | P 0.302 / R 0.347 |
| compact (74pp) | P 0.334 / R 0.527 | **P 0.490 / R 0.590** | P 0.425 / R 0.512 |
| large (33pp) | P 0.234 / R 0.282 | **P 0.310 / R 0.323** | P 0.259 / R 0.271 |
| bravura (17pp) | P 0.218 / R 0.288 | **P 0.355 / R 0.356** | P 0.251 / R 0.252 |

Standard per-class (core): note P 0.357/R 0.403, rest P 0.289/R 0.344,
tabdigit P 0.313/R 0.411 (637 GT digits). Same-convention (union)
improvement: FP 9303 -> 7888 (-15%), P 0.271 -> 0.302, R 0.350 -> 0.347
(flat); core convention adds the box-fix on top (R -> 0.399).

Acceptance (R>=0.55 + P>=0.35, standard): MISSED (0.399 / 0.348 —
precision misses by 0.002). Compact PASSES both gates (0.590 / 0.490).
Thresholds not lowered.

## Playable pitch (detected-box chain, frozen decoder)

Standard: 262 matched digits -> 136 decoded -> string/fret/pitch **0.82**
(prior 0.81). Compact 0.73, large 0.54, bravura n=2 meaningless.
Controls: blank 0/0, shifted collapse (6 digits), shuffled 0.82->0.08.
Fret head 0.974 on matched (untouched).

## Is further training justified? Exact next step

YES, narrowly scoped and preregistered by this mission's evidence:
1. **Rest-box scale factor** (h x~1.54, TRAIN-measured) + re-freeze — pure
   post, no training, immediate.
2. **Bounded detector experiment** (requires training, justified): add
   explicit ignore classes (clef/key/time-signature — 40% of FP-bg sits
   in the clef zone; heat alone cannot separate them) + rest-height
   capacity. Hypothesis: FP-bg -40%, rest recall to parity. Still capped
   (TinyFCN scale, TRAIN/DEV frozen, no comprehensive run).
3. Rhythm-object-graph prep resumes now (detection investigation
   complete per mission ordering).
