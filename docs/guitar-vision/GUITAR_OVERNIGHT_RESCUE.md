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
- Fit transcription pair: rhythm 81% (12 notes), chords 73%.
  (The 78% chords figure came from an intermediate uncommitted state;
  committed baselines reproduce 73%. Delta = 1 note off-by-one from a
  glyph-stroke comb: digit glyph's own horizontal strokes outscore the
  staff with conf 0.8. Fix identified for next: weight comb peaks by
  horizontal support (staff lines span the band; glyph strokes don't),
  or page-level band assignment with comb fallback. Not attempted
  tonight — needs its own prereg.)

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

## ROUND 2 (this session)

### R2-M1 — G2 OCR census + verdict: DO NOT BUILD
- Joins contain only notehead/rest/tab-text: ZERO supervision for
  printed numerals. Fret-head zero-shot on 4 hand crops ("5","9","13",
  "17" @system starts): all -> "0" (confidently wrong); multi-digit
  numerals need segmentation; fingerings/frets/time-sigs/rehearsal
  marks all confusable. Numerals are abundant (every system start on
  real scores) but unrecognizable without labeled crops. Geometry-first
  path resolves the observed drift without OCR. No OCR model built.

### R2-M2 — G1 staff-gate rescue: ACCEPTED (heat-gated retry)
- Prereg `GUITAR_GATE_PREREG.md` + amendments. Root cause: gate at
  quantized peak centers is hypersensitive (GT digit heat 0.99 dropped
  at decoded cell, passing 4px away). Txo m17's digit was the victim;
  its absence erased the truth-17 interval, shifting 16 measures.
- Blanket retry REJECTED (fit +0TP/+45FP; heldout +2TP/+22FP, F1 down).
- Heat-gated retry (v>=0.8): heldout tp 180, fp 209->211 (F1 noise);
  end-to-end Txo: measure_ok 46%->95%, triple 43%->90%,
  FULL (+duration) 87.6% of GT, semantic 41%->48%. ACCEPTED on
  end-to-end grounds (+46pts triple). Blanket stays rejected.
- Truth-17 audit footnote: 2nd "digit" is the P1 duplicate part, not
  a missing visual. Sys4 truth boundaries 487/1011/1433 all detected
  (455/1004/1423); 352/367 = time-sig glyph FPs (empty, vanish).

### R2-M3 — G3 large digits: heat-dead (no fix tonight)
- Txo-large GT heat: median 0.18, only 21% >= 0.4 (native); normed
  pass worse (3.6%; scale 1.13 upscales). Detector is scale-blind to
  large glyphs (no FPN); postprocessing cannot recover absent heat.
  Large viz: digits large vs spacing (bravura-like). Downscale-0.6
  probe + per-layout digit-scale handling deferred (needs prereg;
  detector work banned without new evidence beyond this audit).

### R2 DEV re-wave (gated code): no regression (std 95.5/89.9,
compact 97.3/90.9, large 84.0/72.0, bravura 64.3/57.1; +2 digits).

### R2 validation state
- Txo std: 347 notes, triple 89.5%, FULL 87.6%, semantic 48%.
- Txo compact: unchanged path (rerun pending if time).
- Fit: rhythm 81%, chords 73% (1-note glyph-comb wobble, documented).
- 384 guitar tests green (re-run at commit).

### R2-M4 — G1 TAB validation + fragment merge (measure ownership)
- Rhythm-row impostor (6 beam bands) defused via _is_tab thinness +
  regularity (th<=4, gap-range<=0.3med). Faint-line 5-band TAB promoted
  via double-gap signature + targeted fragment post-merge (3+2 bands,
  63px gap; global 75px reverted — merged whole staves).
- Transcribe TAB-span filter (0.75sp margin): fingering-FP strays in
  notation systems/gaps dropped -> phantom measures gone.
- Qmek: measures 0%->95.6% of GT (49/49!), triple 8.5%->87.5%.
- Txo: bottom staff (m33, 9 digits) recovered; measures 100% matched;
  triple 90.6%, FULL 87.6%, semantic 41%->48%.
- Fit rhythm etude: 12->6 notes with FEWER string hallucinations
  (GT has 2 lines; old s3/s4 assigns were hallucinations; 81% kept).

### R2-M5 — G5 rhythm: audited, partially reverted (honest gap)
- Column estimator does NOT generalize: Qmek durations 5-13% (single
  beams misread 0/2+; dotted/long notes fail; bare-vs-rhythm-row
  confusion). Txo 97% stands (validated).
- Root causes measured: (a) beam rows can't attribute to onsets
  (beams span beats); (b) 1px inter-beam gaps merged by morphology;
  (c) 29/104 Txo columns are FLAG-less bare stems (isolated 16ths
  engraved without beams at digit-x!); (d) page/stem-gate variants
  thrashed (Txo 97->68) — reverted to M7 estimator.
- Tried and reverted this session: staffless beam mask, gap>1
  counting, per-column/page stem gates, TAB-top zones, stem-anchored
  counting (dead code removed). Evidence + flagged-stem visuals kept
  for the beam-object-association follow-up (associate onsets to beam
  OBJECTS by x-overlap + stem intersection, not row counting).
- G5 claim restated: 97% exact on beamed TAB-rhythm (Txo-like);
  ~5-15% on dense/flagged/bare textures (Qmek). Flag class stays
  abstinent (P 0.022). Triple/FULL metrics exclude duration where
  noted; Txo FULL 87.6% includes 97% durations.

### R2-M6 — Fret 1-vs-4 width override (no training)
- Txo fret audit: 16/19 errors are 1<->4 confusion (11x 1->4, 5x 4->1).
  Glyph ink widths (staff rows excluded): '1' 8-10px vs '4' 14-22px
  (sp=32) — cleanly separable; '0' overlaps '4' so rule fires only on
  head∈{1,4}. Sp-normalized split 0.375sp (layout-robust).
- Wired into transcriber + chain-eval (shared const FRET_WIDTH_SPLIT).
- Txo: fret 19->2 errors (!), triple 90.6%->95.3%, FULL ~95%.
- Compact: fret +5, triple 89.8%->91.2% (generalizes).
- Qmek: 37->22 fret errors; remaining (0,3)x9 needs hole-count rule
  (documented next; '0' has hole, '3' doesn't).
- Fit stable (81%/73%). DEV: std fret 95.5%/pitch 91.0%, compact
  95.7%/93.5% (both up); large/bravura unchanged.

### R2-M7 — Fret geometry overrides (no training)
- Txo fret audit: 16/19 errors are 1<->4 confusion. Glyph widths
  (staff-excluded): '1' 0.28sp vs '4' 0.47sp; split 0.375sp.
- Minmax-column width cut wide '4's (false flips on Qmek): replaced
  by center-component width (flood fill; neighbor-immune, offset
  tolerant). Narrow-0->1 rule added (fixed Qmek (1,0)x3).
- 0-vs-3 hole rule: perfect on GT boxes (297x1-hole '0', 218x0-hole
  '3') butLive boxes ~9px off cut the glyph (hole opens to border):
  widened +-15->+-20 with centroid guard. Fixed Qmek (0,3)x9.
- Results: Txo fret 19->1 (99.7% matched), triple 95.6%; compact
  fret 99.1%, triple 93.1%; Qmek fret 37->9 (~98% matched).
  Remaining Qmek fret errors diffuse (no pattern >=3).
- DEV final: std 95.5/96.6/92.1, compact 97.3/98.9/96.2
  (string/fret/pitch), large 84/84/72, bravura 64/93/57.
- Fit stable (81%/73%).
