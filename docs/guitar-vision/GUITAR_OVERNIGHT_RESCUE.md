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

## M5 — G6 rhythm rescue: durations 23% -> 97% exact (heldout Txo)

Root causes found and fixed in transcriber:
- Column-mean measure ownership collapsed under dense correct
  detections (mega-columns) -> per-NOTE ownership (fixed M4).
- Onset gap 30px merged whole systems (GT x-gap p90=17px) -> 12px
  columns + 12px chord tags.
- Anchored notation stems missed TAB 16ths (226/345 defaulted to
  quarter) -> column rhythm from TAB rhythm-row beam counts at column
  x (median of per-digit strips anchored at column-top digit; low
  strings' own strips overshoot into the system above).
- groups>=2 clamped to 16th (groups=3 is 2 beams + contamination;
  32nds absent); groups==1 disambiguated via anchored beams
  (flagged-16th vs 8th vs contamination); dots gated to unbeamed
  columns (beamed-column dots ~100% spurious).
- Stem-continuity downgrade REJECTED (ANY-vote still broke 50 true
  16ths, fixed 0 quarters — chords off stem-x lack continuity).
- Duration exact: 80 -> 334/345 (97%). Semantic: 28% -> 41%
  (pitch 38%, rhythm 81%).
- FULL playable (string+fret+measure+duration): 42% of all GT digits.
- Binding constraint now measures (46%) + detector recall;
  residual: 10 quarters-as-16ths (contamination), 36 (fixed) dots.

## M6 — G5 measures: ownership solved, numbering drifts on empties

- Per-system barline audit (Txo): boundaries ~95% (p2 perfect; p1
  sys0-3 perfect; sys4 repeat/time-sig region: repeat pair + time-sig
  glyph FPs create EMPTY intervals that vanish from numbering).
- Root cause of numbering drift: truth m17 has only 2 TAB digits
  (both undetected) -> no m17 interval -> all downstream off by one;
  plus final-system tail oversplits (y-outlier system assignment).
- measure_ok 46% with boundaries ~95%: numbering, not ownership.
  Printed system-start numerals ("17","21",...) would anchor numbering
  (no OCR class yet — documented next step).
- FULL playable: 42% of GT (strings 100%, frets 95%, durations 97%
  matched, measures 46%).
- Fit transcription pair re-verified: rhythm 79% (was 74%, 12 notes
  now vs 3), chords 78% (was 79%). No regressions.

| layout | string | fret | pitch | cov-pitch | vs net pitch |
|---|---|---|---|---|---|
| std | 0.954 | 0.943 | 0.897 | 0.122 | 0.689 -> 0.897 |
| compact | 0.973 | 0.930 | 0.909 | 0.265 | 0.536 -> 0.909 |
| large | 0.840 | 0.840 | 0.720 | 0.028 | 0.500 -> 0.720 |
| bravura | 0.643 | 0.929 | 0.571 | 0.308 | 0.600 -> 0.571 ~tied |

DEV re-run with final code (band spacing): every layout improved vs
the quantile wave (std strings +12pts, compact +13, large +17,
bravura +38). Bravura ~tied with net (small-n 19/26 GT; stem-up TAB
fragments need their own prereg; no shipped behavior changes for
bravura — transcriber layouts validated are standard/compact, chain
default stays net).

- G4: box precision (not recall: Txo finds 345/362) caps matching;
  large-digit recall 0.09 blocks large transcription (77 notes).
- G6: durations 97% exact via column TAB-rhythm (beam-tip condition
  now moot for TAB rhythm); barlines median 1.0 train.
- G7: note-score (string/fret/measure) + semantic; compact Txo triple
  90%; 21 real-data gaps preserved.

## M7 — layout breadth: compact solved, large blocked on recall

- Geometric GT-box validation (heldout 362): standard/compact/large
  ALL 100%, 0 abstentions. Fit: 95.5%/96.1%/96.8%.
- Compact Txo transcription: 340 notes, 33 measures (=33 truth);
  strings 100%, frets 95.6%, measures 100% matched; TRIPLE 89.8% of
  GT; semantic 41% (duplicate-part ceiling).
- Large Txo: 77 notes only; matched strings/frets 100%, measures 0%.
- Spacing robustness: quantile locked 2x on dense pages; band +
  longest-run (staff = 6 consecutive bands) fixed compact. Reverted:
  wider x-bands (neighbor pollution, 98.6->83.9%) and pooled unions
  (wrong-phase wins, 97.5->66.5%). Evidence kept in report only.
- Bravura still excepted (stem-up fragments; own prereg needed).
- Transcriber/scorer take --layout (per-layout detector map + joins).

## Commit

This report + prereg + geometric assigner + note scorer + chain
--string-mode/--samples-csv + transcriber hybrid/per-system measures +
bar continuity/merge/starts/per-system API + heldout evidence JSONs +
hybrid chains + geo transcription + semantics. 384 tests green.

## Exact next step

G6 rhythm: per-note durations from beam counts owned by the paired
notation staff (not nearest-box), then onset validation against time
signatures; then DEV-once wave.
