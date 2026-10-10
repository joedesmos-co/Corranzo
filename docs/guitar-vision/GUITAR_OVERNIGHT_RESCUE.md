# Overnight Transcription Rescue Report (P0, autonomous)

**Prereg:** `GUITAR_GEOMETRIC_PREREG.md` (ONE bounded experiment).
Sealed TEST untouched. No training launched. Technique abstinent.
DO NOT MERGE.

## M1 — G1 line-relative representation: SUPPORTED, then SOLVED

- Supervision geometry degenerate (synthetic renders exact: resid 0,
  skew 0) — but image line detection feasible: 5-6/6 GT lines @~1px.
- Representation oracle: string-from-nearest-supervision-line = 100%
  on all 362 heldout digits (incl. s4/s5/s6 where StringNet collapses).

## M2 — G2 geometric string assigner: ACCEPTED (no training)

Deterministic comb fit (page-global spacing from full-width projection
+ local 6-line group + occlusion tolerance + 7th-line phase guard):
- Fit GT boxes: 96.6% acc, 99.1% coverage (StringNet fit: 56%).
- Heldout GT boxes: 100% (362/362, 0 abstentions).
- Heldout DETECTED boxes: 100% of 180 matched (49.7% of GT;
  rest = detector misses, G4).
- Prereg gates passed (overall 0.497>0.45, s4+5+6 0.44>0.30 of GT,
  coverage 1.0≥0.80, no s1 concentration).
- Heldout chains, identical filter — StringNet: 32/130 strings (24.6%),
  pitch coverage 0.088. Hybrid (geometric primary + net fallback):
  180/180 strings (100%), 174/180 pitch (96.7%), pitch coverage 0.481
  (5.5x). Integrated as primary in chain-eval (--string-mode) and
  transcriber (net fallback preserved).

## M3 — G3 join coverage: NOT a bottleneck (audit)

Rendered-group join coverage 99.9% train / 99.4% validation. The
"half" was (a) multi-part source duplication (Txo: 2 identical parts
x362) and (b) TAB events rendered as noteheads (technique etudes).
Denominators fixed; no action taken.

## M4 — G5 transcription: 29% -> 43% triple-correct playable notes

Heldout Txo (345/362 digits transcribed, 0 defaulted):
- string 100% matched (95.3% of GT), fret 94.5% (90.1% of GT),
  string+fret 90.1% of GT, +measure 43.4% of GT (semantic: 28%).
- Fixed along the way: per-note (not column-mean) measure ownership
  (dense detections merged onset columns -> 9 mega-measures); per-system
  2D ownership (global-x bisect mixed stacked systems -> soup).
- Barlines: extended-span hypothesis REFUTED visually (paired scores
  don't join barlines across staves); winners = own-span cover +
  non-staff-row continuity run (kills chord-digit stacks) + 12px merge
  + system-start injection. Txo p1 15, p2 12-13.
- Remaining: measure numbering drift (FP splits), durations/onsets,
  chord tags, attributes (clef/key/time undetected), duplicate-part
  scoring gap in semantic eval.

## G4/G6/G7 status

- G4: detector recall (50% heldout matched @iou0.5) is now the binding
  string-coverage constraint; large-digit recall 0.09 unchanged.
- G6: beam-tip skipped per condition (strings now solved — beam work
  unblocked next); barlines substantially rescued (median 1.0
  bars/measures train); durations still anchored-rule weak.
- G7: real-score playable metric = note-score tool (string/fret/measure
  vs GT digits); 21 real-data gaps preserved.

## Commit

This report + prereg + geometric assigner + note scorer + chain
--string-mode/--samples-csv + transcriber hybrid/per-system measures +
bar continuity/merge/starts/per-system API + heldout evidence JSONs +
hybrid chains + geo transcription + semantics. 384 tests green.

## Exact next step

G6 rhythm: per-note durations from beam counts owned by the paired
notation staff (not nearest-box), then onset validation against time
signatures; then DEV-once wave.
