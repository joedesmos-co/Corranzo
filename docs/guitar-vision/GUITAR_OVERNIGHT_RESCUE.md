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

### R2-M8 — G3 large digits: ACCEPTED (1.3x Lanczos, no training)
- Large digits render SMALL (18.7px vs 24.2px); heat-dead natively.
  Downscale/bilinear-upscale kill heat; sharp 1.3x Lanczos recovers
  (21%->84% >=0.4). Wired as layout-default upscale (others unaffected
  by construction: default 1.0).
- Fit: R 0.124->0.310, P 0.156->0.324. Heldout: R 0.091->0.348,
  P 0.226->0.390. Transcription: 77->296 notes, 33/33 measures,
  triple 0%->81.2% (strings 100%, frets 99.3%, measures 100%).
- Compact arm measured and REJECTED (R 0.80->0.53; native kept).
- Digit-cluster fallback bar systems + tight spans + min_cover 0.5
  (band path untouched when TAB exists; Txo/Qmek/fit verified
  unchanged: 95.6%/87.5%/81%/73%).

### R2-M9 — Gate v0.7 + miss audit (close)
- v0.7 strictly dominates v0.8 (fit same, heldout +1TP/+0FP); Txo
  347->348 notes, triple 95.6%->95.9%, all matched 100%/99.7%.
- xclass-iou spare: implemented, measured no-op, fully reverted
  (one botched edit corrupted decode-eval; recovered via git checkout,
  keeper flags intact).
- 15 Txo miss decomposition: 11 strong-heat iou-metric misses
  (peaks ~8px off GT centers; captured @30px), 4 weak. Product recall
  loss ≈1%. Resolution (peak separation), not thresholds, is next.

### R2-M10 — G6 semantics audit (close)
- Txo truth (724 events = 2 identical parts): all voice 1, zero rests/
  ties/tuplets/dots/grace/techniques in TAB content. My XML: 348 notes,
  voice 1, 0 rests/ties, no clef/key/time. Content gap = closed except
  durations residual; attribute gap (clef/key/time) structural — no
  detector emits them, and G6 forbids assuming (Txo key is Bb, time
  changes 4/16->3/4 mid-piece). Not emitted tonight.
- Semantic 42% decomposes to: duplicate-part scoring (~halves pitch),
  missing attributes (~fixed cost), measure/duration residuals.
  Note-score triple 95.9% is the honest playable metric.

### R3-M1 — Phase 1 beam association: evidence kept, counter reverted
- Beam OBJECTS (staff-excluded (1,20) components) exist and are clean
  (393/page, double pairs resolved). Cross-system column merging found
  and FIXED (onsets cluster x WITHIN y-systems now; Txo FULL +4.4pts).
- Pair-bridge counting (bridges between adjacent same-system onsets):
  95%/87% on GT boxes, but collapses live (57%/8%): detection x-jitter
  merges/splits onset units (201 digits -> 52 columns on Txo p1), so
  pairs test wrong gaps. Median row-groups are robust to unit noise
  (Txo 96%) and stay. Verdict: beam OBJECTS validated; the counter is
  not the problem — ONSET UNITS are (need peak separation + sub-cell
  boxes before attribution can work). Pair code reverted; debug
  scaffolding removed.
- Key visuals: flagged/isolated 16ths have NO beams at digit-x (29
  Txo cols); beamed-pair beams are short (25px) and die in (5,60);
  beams+stems form tall Pi components (height caps kill them).

### R3-M3 — Step 5: peak fix re-validated DEV-wide
- DEV wave (final code): std digits 229->538 detected, pitch coverage
  0.129->0.316, pitch 97.1%; compact 525/0.328/97.7%; large 119/
  0.104/89.2%; bravura 17/0.346 (strings 52.9%: fit data still the
  blocker). Detection doubling = the half-cell anchor fix, not a model
  change (weights frozen).
- Txo duration residuals now diffuse (6 x "16th->quarter", 1 dotted
  misread): 97.7% duration accuracy, no dominant family failure.
- Qmek durations ~10%: isolated beam groups (no right-neighbor group
  to bridge to); stem-tip counting measured (muddled 0-5 for single
  beams). Documented, not forced.

### R3-M4 — Mission 3/4: MusicXML attributes + honest scoring
- Attributes (clef/key/time) NOT emittable: canonical.json carries no
  score metadata at all (only tuning/capo/events); truth's key -1 /
  time (1+3)/16 exist in stamped.musicxml but never reach the writer.
  No detector emits them. Per mandate, nothing assumed - no fabrica-
  tion. Real fix = attribute detectors (preregistered separately).
- Duplicate-part scoring correction (Mission 4): truth Txo = 2 parts
  (P1/P2, 362 notes each, 33 measures each = 66 measure elements).
  Our single part is musically complete but the evaluator counts the
  duplicate. Built truth-single-part-txo.musicxml (P2 dropped, origi-
  nal untouched) and report BOTH: historical 42%, corrected 53%
  (pitch R 89%, align 97%). Corrected artifact committed for reuse.

### R3-M5 — Final DEV wave (all layouts, this session's code)
std string/fret/pitch 99.1/99.1/98.1 (pitchCov 0.327); compact
98.6/99.1/97.7 (0.338); large 100/95.2/95.2 (0.124); bravura
100/100/100 (0.808). Every layout at or above its prior best.

### R4-M1 — Notation-to-TAB alignment: association is SOLVED (100%)
- Join structure discovery: notehead- and tab-text-joins are SEPARATE
  sid series (nh n002.., tab n535..) with same onsets; pairing only by
  nearest-x (median offset 17px, p95 19px). Audited via new tool
  proof-notation-audit.py (supervision for scoring only).
- Qmek: 319 GT pairs, noteheads detected 242 (76%), association
  CORRECT 242/242 (100% @45px). Txo: 350 pairs, 271 (77%),
  association 271/271 (100%).
- Conclusion: nearest-detected-tab-digit-x IS the correct partner
  whenever the notehead is found. The binding constraint is NOTEHEAD
  DETECTION (77%), not association. Qmek rhythm rescue therefore
  reduces to: detect more noteheads -> transfer notation-side durations
  -> the previously-missing dotted/isolated-8th/voice-2 durations.
- Next: notation-side duration/voice extraction for detected noteheads
  (Milestone 3), using detected boxes only.

### R4-M2 — Final session re-validation (no regressions)
Txo: 349 notes, strings 100% matched, frets 99.7%, measures 100%,
triple 96.1%. Qmek: 496 notes, strings 99.6%, frets 99.8%, measures
100%, triple 94.8%. 384 tests green. No code changes in R4 beyond the
association audit (rhythm transfer not shipped by design).

### R5-M1/M2 — Reproducible rendering + staff-gap normalization (M1/M2 FIXED)
Root cause chain established and fixed:
1. The committed page PNGs are LETTERBOXED (verovio renders at its natural
   `width="878px"` inside a 2100px canvas) -> content fills ~40% of the
   frame -> staff gap ~12px instead of the detector's trained 26px.
2. staff gap in the raster is therefore 2.2x off the trained geometry, and
   `normalize_scale`'s bilinear resample blurs the thin TAB glyphs, so the
   tab channel collapses (heat p50 0.006 at GT positions; 0 tab peaks).

Fix (proof-page-source.render_at_gap):
- Measure the staff gap from the re-framed raster (content fills the frame
  there, so the row profile is reliable; it drifts on the letterbox).
- Solve the RENDER WIDTH for a target gap: W = target_gap * viewBoxW / gap_units.
- Render the committed SVG with only the OUTER <svg width/height> overridden
  (the nested definition-scale svg has no width of its own, so it inherits
  and its viewBox scales the units to W). No content is rewritten.
- Crop to the ink bbox (gap-preserving) and return the affine
  x_px = x*fx - ox so layout units map exactly.

Verified on Txo p1: width 1822, measured gap 26.00, fx 0.08308,
ink@GT notehead = 0.794. Deterministic + cached under
/tmp/proof/gv-render (regenerable; nothing committed).

### R5-M3/M4 — Detection quality on the fixed pipeline (real inference)
No oracle boxes; GT from joins core boxes; both layouts rendered at gap 26.

- Txo (2 pages): P=0.858 R=0.610 F1=0.725. p1: preds 304, tp 263, fp 41,
  fn 159. Notes ~100% (212/211 detected); recall loss is tabdigit+rest.
- Qmek (3 pages): P=0.775 R=0.622 F1=0.690.
- Gate ablation (decode_page staff_gate on/off, same heat): Txo
  tp 263/264 fp 41/41; Qmek tp 663/666 fp 193/209. The TAB staff-comb
  gate is now ~NEUTRAL (costs 3 tp, saves 16 fp) - i.e. at the correct
  staff gap its fixed +-130px window (= 5*gap at gap=26) is calibrated by
  construction. Before the fix it was rejecting ~80% of real digits.
- tabdigit recall remains ~44% at peak level (92/211 on Txo p1) and the
  tab heat inside GT boxes only reaches p50 0.408 (vs notehead 0.800).
  Geometry is now ruled out: the residual is GLYPH APPEARANCE at the
  trained scale (this engraver punctuates TAB digits with dashes and
  prints the digit over the staff line), not scale or mapping.

### R6-M1/M2 — TAB digit recognition: font-dependent rasterization (FIXED)
M1 hypothesis "staff lines cross the digits" was TESTED AND REJECTED:
masking detected staff rows inside GT digit boxes LOWERS tabdigit
response (heat p50 0.408 -> 0.123; peaks 92 -> 54). The crossing lines
help rather than hurt.

Root cause found instead: TAB digits and fret numbers are `<text>`
elements in the document serif (`<text font-size="0px"><tspan
font-size="324px">3</tspan></text>` inside `<g class="tabGrp">`), so
their GLYPH SHAPES ARE FONT-DEPENDENT AT RASTER TIME. The detector was
trained against Palatino-shaped digits; Times-shaped glyphs roughly
halve the response (a contact sheet showed the model firing at 0.9+ on
"0" but 0.03-0.16 on "3"/"4" - a pure glyph-appearance mismatch).

Fix: render_at_gap takes a `font` override (documented; default
Palatino, TRAIN-selected over 10 candidate serif families).
- Txo: P 0.858->0.867, R 0.610->0.783, F1 0.713->0.823
- Qmek: P 0.775->0.744, R 0.622->0.743, F1 0.690->0.744

### R6-M2 — Dangerous assumptions found and fixed
1. LETTERBOXING (fixed): committed PNGs render at the SVG's natural
   878px inside a 2100px canvas -> 40% fill.
2. FONT-DEPENDENT RASTERIZATION (fixed, above): fixed-page-geometry
   users are not affected, but any re-render path is.
3. ROW-PROFILE STAFF GAP (fixed): the "<100px gaps, take the median"
   rule aliases inter-system gaps on dense layouts -> compact rendered
   at 13px gap instead of 26, clamp kicked in, and detection returned
   ZERO objects. Replaced with an exact read of the staff-line
   coordinates from the SVG (`svg_staff_gap`): 315 units for standard,
   compact AND large, with 193/56/325 samples. Compact F1 0.000 -> 0.674.
4. GATE WINDOW (resolved by construction): the TAB staff-comb gate's
   fixed +-130px window equals 5x the staff gap only at gap=26; once the
   gap is targeted, the gate is calibrated by construction and is
   ~neutral (3 tp / 16 fp) instead of rejecting ~80% of digits.

### R6-M3 — Cross-style detection matrix (reproducible, real inference)
All layouts rendered at targeted gap 26 with the corrected font and
scored against joins core boxes (no oracle):
- standard  Txo    P=0.867 R=0.783 F1=0.823
- Qmek      std    P=0.744 R=0.743 F1=0.744
- compact   Txo    P=0.820 R=0.573 F1=0.674   (was 0.000 before the fix)
- large     Txo    P=0.867 R=0.612 F1=0.717
- bravura   Ode    P=0.756 R=0.554 F1=0.639
Worst case: bravura F1=0.639. Bravura is still the weakest style and has
the least labelled data (28 TAB digits on the only carrier score).

### R7 — Full pipeline connected to the corrected render path
- make-pipeline-manifests.py emits chain-eval/transcribe manifests that
  point at the corrected renders (measured gap, selected font), retiring
  the obsolete /tmp/proof/hires staging. Chain models re-linked from the
  committed datasets/guitar-vision/proof/{proof-model.pt,proof-context/stringnet.pt}.
- RENDER BUG FOUND: the rasteriser clipped pages at ~1000px because
  `boundingBox()` was measured against a 100px viewport under
  `overflow:hidden`. Viewport is now sized from the SVG geometry first.
  Txo p1 went 1810x986 (clipped) -> 1810x2375 (full).
- Chain results (corrected pipeline, 3 real scores, no oracle):
  standard 733 det / 642 decoded, string .967 / fret .932 / pitch .901,
             coverage decoded .705 / pitch .623
  compact  700 det / 602 decoded, string .971 / fret .922 / pitch .896,
             coverage .731 / .637
  large    720 det / 688 decoded, string 1.000 / fret .947,
             coverage .756 / .705
  (vs the pre-fix DEV pitch coverage .129/.338/.124 -> 5.5x/2.2x/5.7x)
- Transcribe Txo (corrected pipeline): 181 notes, all matched;
  string 99.4% / fret 92.3% / measure 80.1% / triple 73.5% OF MATCHED,
  but only 181/362 GT digits = 50% coverage (old pipeline: 349 notes,
  96% coverage, triple 95.9% of GT). Semantic (corrected, single-part
  truth) 53% -> 48%.
  HONEST REGRESSION: per-note accuracy held up (string 99.4%) and
  detection coverage rose 5.5x, but the transcriber's own filters
  (TAB-span margin, TAU abstention, onset-column merging) discard most
  of the newly-detected digits, so end-to-end note count and semantic
  score fell. The transcriber's filters are now the bottleneck, not the
  detector.

### R8 — Filter attrition ledger (task 1) + true-loss fixes
proof-transcribe.py --ledger now records per-page: digits, lost at
TAB-span, lost at TAU, emitted, with x/y/confidence/geometry detail.

TXO LEDGER (corrected renders):
  page1: 181 digits -> 0 tabspan / 4 tau -> 177 emitted
  page2: 132 digits -> 124 TABSPAN / 0 tau -> 8 emitted
  TOTAL: 313 detected -> 124 lost at TAB-span (94% of page 2), 4 at TAU, 185 emitted
So the dominant loss is NOT confidence abstention - it is the TAB-span
filter, and only on page 2. Its spans came from the digit-cluster
fallback, which produced a SINGLE span [[1699,1830]] instead of one per
TAB system, so 124 digits 1300px from that span were dropped.

ROOT CAUSE: `page_spacing` (row-profile candidate/longest-run scoring)
mis-measured page 2's staff gap as 14 instead of 26, and Qmek's as 45.
Every margin and cluster threshold that scales with the spacing then
broke. Fixed: median of in-system gaps with the decoder's window
(0.2/0.8, >0.3, gaps <100) - matches decode.estimate_staff_gap.
Verified on ink-cropped rasters: Txo p1/p2 = 26.0/26.0. transcribe now
measures on the INK-CROPPED raster (raw render margins shifted the
profile window).

STILL BROKEN (not fixed): the digit-cluster fallback still emits one
span on page 2, so page 2 remains at 8/132 emitted. The uncropped render
is fed to the detector while the spacing is measured on the crop, and
the fallback's own clustering is untested at this detection volume.
Current Txo: 185 notes, all matched; string 100.0% / fret 92.4% /
measure 78.4% / triple 71.9% OF MATCHED; 51% of GT covered (was 50%).

### R9 — TAB-span fix: page 2 notes 8 -> 130 (M1)
ROOT CAUSE: `detect_barline_systems` found a SPURIOUS 6-line band group in
the notation on Txo page 2 and flagged it `tab=True`. That (a) blocked the
digit-cluster fallback (its guard is `if not any(s.get("tab"))`) and (b)
left a single span at y 1699-1830 while the real TAB staves sit at
283/729/1192/1656 - so 124 of 132 digits were ~1300px from the only span
and were dropped. Page 1 was unaffected (6 real spans, 0 losses).

FIX: validate the band-detected TAB spans against the actual digit
positions. When the band spans cover <50% of the detected digits, rebuild
one span per digit cluster (a TAB staff is 5 gaps tall; the cluster gap is
`max(6*page_sp, 120)`), i.e. one region per visible TAB system.

TXO (corrected renders, ledger per page):
  before: p1 181 det -> 177 emit | p2 132 det -> 124 LOST -> 8 emit (185 total)
  after:  p1 181 det -> 0 lost  -> 177 emit | p2 132 det -> 0 lost -> 130 emit (307 total)
Accuracy of matched: string 100.0%, fret 93.8%, measure 47.4%, triple 43.5%
Coverage 181/362=50% -> 306/362 = 84.8% of GT.
Corrected semantic 48% -> 52% (precision 22% -> 40%, recall 65%, align 89%).
Remaining: measure assignment (47.4% of matched) is now the largest loss.

### R9b — TAB-span fix verified on Qmek; measure numbering is the new blocker
Qmek (3 pages, corrected renders, same respan fix):
  458 notes emitted, 423 matched (81.3% of 520 GT), string 100.0% / fret
  92.0% of matched - BUT measure_ok = 0.0% (72 measures emitted vs 49 GT).

M3 (Qmek spacing) - diagnosed, not a bug: the band structure is
`26,26,26,26 | 280,108 | 46,46,46,46,46 | 311 | ...`. Qmek's TAB staves are
engraved with ~46px line spacing while its notation staves use ~26px, so
`page_spacing` correctly returns the TAB gap (46). That is the relevant
scale for TAB spans/margins, and the new digit-validated respan makes the
transcriber tolerant of it (Qmek recovers 81% of GT digits).

Measure numbering is now the single largest loss: Txo 47.4% of matched,
Qmek 0%. Cause (Qmek): the respan produces a different system count than
the GT's, so the per-(page,system,interval) monotonic numbering renumbers
measures against a different system partition.

### R10 — Measure error ledger (M1): the cause is system mis-clustering
Instrumented the respan so the ledger reports `bars_per_sys` (barlines per
rebuilt span) and `modal_bars`.

TXO p1 bars_per_sys = [1, 4, 4, 4, 6]; p2 = [4, 1, 4, 3]; modal = 4.
The GT has 5 TAB systems x 4 measures per page, so the expected pattern is
[4,4,4,4,4]. The first span having 1 barline and the last 6 means the
digit clusters do NOT align to real TAB systems - the y-clustering of
detected digits merges/splits real systems. Since measure numbers are a
monotonic count over (page, sys, interval), a wrong system partition
shifts every downstream measure: that is the 47.4% (Txo) / 0% (Qmek).

Tried and rejected: even-spacing barline completion (insert missing
boundaries when a system has fewer barlines than the page mode). It
cannot help because the deficit is not a missing barline inside a system
- it is the system partition itself (bars_per_sys is [1,4,4,4,6], not
[3,4,4,4,4]). No change: 47.4% both before and after.

Correct fix (next): derive TAB systems from detected STAFF LINES (a TAB
staff is a 6-line group with a measured gap), not from the y-clustering of
digit detections. Digit clusters are then only a fallback/validator.

### R11 — TAB systems now detected from STAFF LINES (M2)
Replaced the respan's digit-y clustering with 6-line staff-group
detection (row profile -> line bands -> consistent-gap runs of 6, thin
lines). Digits remain the fallback when no 6-line group is found.

TXO ledger, bars_per_sys (GT = 5 systems x 4 measures):
  before (digit clusters): p1 [1,4,4,4,6]   p2 [4,1,4,3]
  after  (staff groups):  p1 [5,4,4,4,6]   p2 [4,4,4]
Page 2 is now structurally exact. Page 1 still over-splits its first and
last systems (5 and 6 barlines): the row profile on page 1 admits extra
bands, so a 6-line run is chosen at a phase that mixes the notation
staff's tail with the TAB staff's head.

Measure accuracy 47.4% -> 48.7% of matched; Txo 299 notes emitted,
string 100% / fret 93.6% / triple 44.6% of matched, 82.6% of GT covered.
Page-2 recovery cost 8 digits (122 vs 130 emitted) because the tighter
staff-derived spans clip the outermost digits of each system - the span
margin (3 * page_sp) needs widening to the staff half-gap plus digit
height.

### R12 — Staff-group candidate-run scoring (tasks 1-3)
Diagnostic proof-staff-groups.py records, for EVERY candidate six-line
run, its spacing/CV/thickness and detected-digit support, plus the GT tab
systems derived independently from the joins. It showed the greedy
first-passing-run loop (step +6) SKIPS whole systems when the band phase
drifts.

FIX: candidates are now scored by digit support and a non-overlapping set
is taken greedily (regularity + thinness remain hard gates; zero-support
runs are rejected because notation staves never carry tabdigit peaks).

QMEK (3 pages): 423 notes emitted, 423 matched, 0 unmatched.
  measure accuracy 0% -> 100% (423/423 of GT; 81.3% reference coverage)
  string 100% / fret 92.0% / triple 92.0% OF MATCHED
  bars_per_sys p1 [6,4,5,6], p2 [4,5,5,5], p3 [4,4,6]
TXO (2 pages): 299 emitted, 298 matched, 1 unmatched.
  measure 48.7% of matched (unchanged) - its barrier is now a DIFFERENT
  one: bars_per_sys p1 [5,4,4,4,6] (one over-split + one extra barline),
  p2 [4,4,4] (structurally exact). Corrected semantic 51% (52% before).

NOT DONE: the eight previously-lost page-2 digits (Txo p2 emitted 122 of
130 candidates; tabspan losses 8) and Txo's barline over-split remain.

### R12b — sparse-system rescue TRIED AND REVERTED (regression)
Accepting 5-of-6-line staff groups (for a TAB staff whose 6th line is
faint) REGRESSED Qmek: measure accuracy 100% -> 45.9% of matched and 11
false spans (434 emitted, 423 matched, 11 unmatched). The relaxation
creates spurious groups in notation. Reverted; Qmek restored to 423/423
matched, measure 100%, 49 measures. Txo unchanged (299 emitted, 298
matched, 1 unmatched, measure 48.7%).

Residual defect (open, diagnosed exactly): the 8 Txо p2 digits lost to
the TAB-span filter sit at y 1696-1800, i.e. the 4th TAB system
(GT 1656-1786, only 9 digits). The row profile finds NO staff bands at
all there, so neither a 6-line nor a 5-line group can be formed - the
staff lines of that system do not span the middle 60% of the page width.
That is a line-detection failure, not a grouping one.

### R13 — Staff lines by contiguous run (M1): Txo p2 system recovered
ROOT CAUSE: Txo page 2's 4th TAB system is mostly empty, so its six staff
lines run 178-340px on a 1643px page. The row-profile detector (mean ink
over a window) read 0.11-0.21, below the 0.3 gate, so the ENTIRE system
vanished: no span, 9 digits dropped, and the monotonic numbering shifted
every later measure.

FIX: detect staff lines by longest CONTIGUOUS horizontal run (>= 4*page_sp
px, min 100px) instead of row ink fraction. A line is a line regardless of
what share of the page width it covers. All 6 lines of that system are
recovered at y 1656/1682/1708/1734/1760/1786 (runs 178-340).

TXO: emitted 299 -> 307, matched 298 -> 306, unmatched 1.
  reference coverage 306/362 = 82.6% -> 84.5%
  page 2 tabspan losses 8 -> 0; bars_per_sys [4,1,4,3] -> [4,4,4,3]
  page 1 bars_per_sys still [5,4,4,4,6] (open, M2)
  corrected semantic 51% -> 52%
QMek unchanged: 423/423 matched, measure 100%, triple 389/423 = 92.0%.

### R14 — barline merge (M2/M3 partial)
A repeat/final double barline prints two verticals 13px apart and was
counted as two measure boundaries (Txo p1 system 5: [254,267,343,...]),
splitting one measure. Barlines closer than 1.5 staff gaps are now
merged (measures here are ~3-5 gaps wide, so this is staff-relative).

Txo p1 bars_per_sys [5,4,4,4,6] -> [5,4,4,4,4]; emitted 307, matched 306,
coverage 84.5%; corrected semantic 52%.
Qmek unchanged: 423/423 matched, measure 100%, triple 92.0%.

Residual (exactly located): the TOTAL interval count must equal the
measure count for the monotonic numbering to stay aligned. Qmek's totals
match its GT (49), which is why Qmek is 100%. Txо's totals are
p1 5+4+4+4+4=21, p2 4+4+4+2=14 -> 35 vs a GT of 33: two surplus
intervals remain, one on p1 system 1 and one on p2 system 4 (the sparse
system). They are the last cause of the 47.4% measure accuracy.
No even-spacing completion was revived, and no GT measure count is used
at inference.

### R15 — GENUINE RASTER BASELINE RUN (M1/M2) — poor quality, path proven
`proof-raster-baseline.py` PDF/page -> raster -> pixels -> detection,
with geometry inferred from PIXELS ONLY:
  - staff lines by contiguous horizontal run (no viewBox)
  - canonical units-per-pixel = measured_staff_gap / 315 (no page dims)
  - NO font override: the document's own embedded font is used
  - NO fixture manifest, no GT staff coordinates, no GT at inference
  - the raster is produced at an arbitrary width unrelated to the
    controlled renders; a real PDF is emitted via chromium page.pdf()

HELDOUT score pdmx-QmTJRwrHUET3 p1 (never tuned on), raster 1700x2306,
measured gap 26.0, fx 0.08254:
  note     preds 246 gt 263 tp 108 fp 138  P 0.439 R 0.411 F1 0.424
  rest     preds 4   gt 6   tp 0   fp 4    P 0.000 R 0.000 F1 0.000
  tabdigit preds 118 gt 255 tp 57  fp 61   P 0.483 R 0.224 F1 0.306

This is the first genuine end-to-end raster evidence: the path WORKS
mechanically (geometry derived, detection executed, scoring ran), but
native-font quality is far below the controlled Palatino renders
(tabdigit F1 0.306 vs 0.823; recall 0.224 vs 0.94). The gap is
font/glyph-shape driven, NOT geometry: the raster path's own geometry
pipeline is the same one that produces the controlled results.
Rests are entirely unrecalled (0/6, all 4 predictions false).

### R15b — FONT-ISOLATION CONTROL (M2)
Same heldout page (pdmx-QmTJRwrHUET3 p1), same rasterizer, same measured
staff gap (26.0 -> no scale difference), ONLY the font differs:

  native document font  : aggregate tp 165 fp 203 fn 359
                          P 0.448 R 0.315 F1 0.371
                          tabdigit P 0.483 R 0.224 F1 0.306
  forced Palatino render: aggregate P 0.836 R 0.603 F1 0.700

So the raster/geometry pipeline is NOT the limiting factor - the embedded
font's digit glyph shapes are. The raster path's own geometry (staff
lines by contiguous run, measured gap, derived units-per-px) works; what
fails is TAB glyph recognition under an unseen font. Rests are entirely
unrecalled (0/6 gt, 0 true positives). A bounded TRAIN-only font
augmentation is the justified next experiment and must be preregistered
before running.

### R16 — system-index mismatch FIXED: Txo measures 47.4% -> 77.8%
DEFECT: the respan block set `_tabspans` (used by the span filter) but
never replaced `sys_bars`, while measure-numbering indexes sys_bars by the
`own` system index attached to each note. On a page where the band
detector found a spurious TAB (blocking the earlier fallback), notes were
numbered against the BAND list's intervals, which collapse to interval 0 -
discarding every internal barline. Evidence: p2 systems 1/3/5 each put all
36-45 notes in interval 0 spanning the full 1400px page.

FIX: `sys_bars = _fb` in the respan, so numbering uses the respanned spans.

TXO: measures 145/306=47.4% -> 238/306=77.8% of matched (238/362=65.7% of
reference); triple 133/362=36.7% -> 224/362=61.9%; measures emitted 24 -> 33
(GT has 33); string 100% / fret 93.8% of matched unchanged; corrected
semantic 52% -> 51% but precision 40% -> 71%, recall 65% -> 70%, align
89% -> 93%, defects 496 -> 371.
QMek PRESERVED: 423/423 matched, measure 423/423=100%, triple 389/423=92.0%,
49 measures (GT 49). No regression.

### R17 — raster scale normalization; page-2/3 + second heldout score
The raster baseline now normalizes to the detector's trained staff gap
before inference (measured gap -> scale, boxes mapped back), so page
width/DPI no longer changes the scale the detector sees. Verified
non-regressing: the width-1700 page (gap already 26) gives identical
numbers at scale 1.0.

Multi-page / multi-score raster evidence (native fonts, no overrides):
  QmTJRwrHUET3 p1 (w1700, gap 26.0, scale 1.0):
    note P 0.439 R 0.411 | rest P 0 R 0 | tabdigit P 0.483 R 0.224
  QmTJRwrHUET3 p2 (w1400, gap 21.5, scale 1.209):
    note P 0.055 R 0.049 | rest P 0 R 0 | tabdigit P 0 R 0
  QmTJRwrHUET3 p3 (w1400, gap 22.0, scale 1.182):
    note P 0.023 R 0.022 | rest P 0 R 0 | tabdigit P 0 R 0
  QmZ5K3BV9FDR p1/2 (w1900, gap 15.5, scale 1.6, clamp-hit):
    note P 0.005 R 0.005 | tabdigit P 0 R 0 (p2: no preds at all)

Rest recognition is separately measured and ZERO on every raster page
(0/32, 0/12, 0/6 true positives; all predictions false).

CONCLUSION: geometry normalization is now in place and harmless, but it
does not by itself recover accuracy. Because p1 (gap 26) still reaches
tabdigit R 0.224 while p2/p3 (gap 21.5/22 after normalization to 26)
reach 0, the difference is NOT scale — it is glyph appearance. This is
consistent with the R15b font-isolation control (same page, same gap,
only font differs: aggregate F1 0.371 vs 0.700).

### R18 — FROZEN native-font eval set + baseline (M1)
`docs/guitar-vision/NATIVE_EVAL_SET.md` freezes 4 score-disjoint heldout
scores (QmTJRwrHUET3, QmZ5K3BV9FDR, QmVDaX5YmZCx, ode-to-joy; all
`heldout` split, none used for tuning). `proof-native-eval.py` runs them:
each score rasterised at a documented width with its OWN embedded font,
geometry from pixels (contiguous-run staff lines, gap/315 units-per-px,
scale-normalised to the trained 26px), no SVG/viewBox/metadata/GT at
inference. Baseline (frozen detector, native fonts), committed:
  note     tp 192 fp 896 fn 909  P 0.176 R 0.174 F1 0.175
  rest     tp 3   fp 56  fn 63   P 0.051 R 0.045 F1 0.048
  tabdigit tp 72  fp 275 fn 879  P 0.207 R 0.076 F1 0.111
Per-page spread is extreme and correlates with measured gap/scale:
  ode-to-joy  gap 25.0 scale 1.0   tabdigit P 0.857 R 0.214
  QmTJ p1     gap 26.0 scale 1.0   tabdigit P 0.483 R 0.224
  QmTJ p2     gap 26.0 scale 1.0   tabdigit P 0.007 R 0.004
  QmTJ p3     gap 27.0 scale 1.0   tabdigit P 0.119 R 0.062
  QmVDaX5     gap 24.0 scale 1.083 tabdigit P 0.000 R 0.000
  QmZ5K3B     gap 15.5 scale 1.6   tabdigit P 0.000 R 0.000  (clamp-hit)
Pages at the same normalised scale still differ 0.857 vs 0.007 precision,
so scale is NOT the discriminator - per-score/per-page glyph appearance
is. This quantifies M2's target: the per-PAGE spread, not just the mean.

### R19 — PDF text-layer feasibility (M2)
proof-pdf-text.py extracts text spans + bboxes via PyMuPDF and
classifies digit-like spans (pure int 0-19, small). On a real user
PDF (canon-in-d-pachelbel-guitar-tab.pdf, 595x842pt, 1 page):
  text_spans=882  digit_like_spans=802  fonts={FreeSans}
  96 digit-like spans sit on a detected staff line.

Feasibility verdict:
- Text-bearing PDFs: YES. fret digits appear as individual text spans with
  precise bboxes in a standard font (FreeSans/Helvetica/etc.), and the
  font is readable. A hybrid path (PDF text -> TAB recognition, raster
  -> fallback) is viable and bypasses the font-dependence problem entirely.
- Scanned/image PDFs: must fall back to visual recognition (one of the
  sampled fixtures has textlen=0).
- The probe's "digit_like_spans=802" over-counts (measure numbers,
  fingerings, chord frets); "digits_on_staff_line=96" under-counts
  because the naive row-profile (>0.3 over full width) misses sparse
  TAB staves. A better filter (staff-line proximity per system) is the
  natural next step in the hybrid implementation.

### R20 — PDF text-layer hybrid prototype (M2-M4)
proof-pdf-hybrid.py: PyMuPDF text spans + raster TAB staff detection.
Digit-like spans (pure int 0-19, small) kept only if on a detected TAB
staff line (contiguous run, minrun 40).

Per-PDF results:
  canon-in-d-pachelbel (A4, 1 page): 882 spans, 802 digit-like, 0 on staff
    (staff detection failed: minrun 40 too high for this DPI). font FreeSans
  save-me-bts p0: 357 spans, 311 digit-like, 0 on staff (no staves)
  save-me-bts p1: 350 spans, 312 digit-like, 66 on staff (2 staves)
  guitar-paired-chords-vector: 217 spans, 124 digit-like, 116 on staff (93.5%)
  guitar-tab-sparse-vector: 59 spans, 40 digit-like, 36 on staff (90%)

Feasibility: text-bearing PDFs DO expose fret digits as individual
spans with precise bboxes in standard fonts. The hybrid correctly
distinguishes text-bearing from scanned PDFs (guitar-paired-scan: 0
text spans, 3 staves still detected -> raster fallback path triggers).

Licensing: PyMuPDF is AGPL/commercial. The repo already bundles
pdfjs-dist (Apache 2.0) via react-pdf. Production integration should
use pdfjs-dist; this probe uses PyMuPDF for research only.

Remaining: staff-line detection minrun needs to be staff-relative
(not fixed 40); digit-to-staff assignment needs fret-to-string logic;
rest detection needs a separate path.

### R21 — PDF text-layer hybrid (M2-M4, genuine prototype)
proof-pdf-hybrid.py now uses pdfjs-dist (Apache 2.0, already in the repo
via react-pdf) for BOTH text extraction and page rasterization. No
PyMuPDF, no SVG metadata, no viewBox, no fixture manifests, no GT at
inference. Geometry (staff lines, TAB staves) from pixels only.

Results on genuine PDFs:
  guitar-paired-chords-vector: 217 text items -> 124 digit-like -> 116 on TAB staff (93.5%)
  guitar-tab-sparse-vector: 59 -> 40 -> 36 (90%)
  guitar-paired-scan (scanned, textlen=0): 0 digit spans, 3 staves detected
    -> raster fallback triggers cleanly
  guitar-standard-chords-vector (notation-only, no TAB): 134 spans, 8 digit-like, 0 on staff
    -> correctly abstains (no TAB staves)

Licensing: PyMuPDF (AGPL/commercial) was useful for research but is NOT
needed for production. pdfjs-dist (Apache 2.0) is already bundled via
react-pdf and provides both text extraction and rasterization. The
production hybrid should use pdfjs-dist exclusively.

Remaining: fret-to-string assignment needs the actual notehead/staff
geometry; measure/rhythm reconstruction needs the TAB system's barlines;
multi-page and chord handling need testing on real multi-page scores.

### R22 — COMPLETE PDF -> TAB -> MusicXML, reference-scored (M1-M5)
tools/guitar-vision/proof-pdf-tab.py: end-to-end pipeline using
pdfjs-dist only (Apache 2.0, no PyMuPDF):
  extract (pdfjs text + raster) -> 6-line TAB staff geometry -> string/
  fret assignment -> measure ownership from visible barlines -> MusicXML
  (explicit TAB clef + 6 staff lines).
No SVG metadata, viewBox, fixture manifests, reference MusicXML or GT
coordinates at inference. Only the PDF's own text layer + pixels.

REFERENCE-SCORED RESULTS (exact string+fret events vs reference MusicXML):
  guitar-paired-chords-vector : 116/116  P 1.00 R 1.00 F1 1.00  8/8 measures
  guitar-tab-sparse-vector    :  32/32   P 1.00 R 1.00 F1 1.00  8/8 measures
  guitar-techniques-paired    :  32/32   P 1.00 R 1.00 F1 1.00  8/8 measures
  guitar-standard-chords      :   0 pred / 0 ref -> correctly abstains (no TAB)
  guitar-paired-scan (scanned):   0 pred / 116 ref -> abstains; raster
                                fallback required (text layer absent)

Key discriminators that made this work (all data-driven):
1. Isolated 6-line groups are ambiguous by one line; choose the group
   with the LOWEST total digit-to-line residual (a one-line shift still
   "aligns" but with larger residuals).
2. Measure numbers are engraved in a different font/size from fret
   digits; keep the dominant (font, size) cluster of digit spans.
3. Barlines: cover >= 0.75 of the staff span, merged within 15px (repeat
   barlines print as two verticals); the LAST barline closes the final
   measure, so measures = bars - 1.
4. Measures are numbered per staff from its own barlines then offset by
   the measures spent on earlier staves (reading order).

RHYTHM: the text layer carries no durations. Every note is emitted with
an explicit default duration and the summary records
`rhythm_recovered: false`. We do NOT claim rhythmic accuracy.

Remaining blockers: canon-in-d style PDFs (stock-photo header, segmented
staff lines, chord symbols) defeat contiguous-run line detection; raster
fallback still has the native-font detector gap.

### R23 — Segmented/grey staff lines fixed; canon-in-D now transcribes
ROOT CAUSE: canon-in-d renders its staff lines in mid-grey (pixel
128-160), so the fixed `<128` ink threshold erased every staff line
(1 band detected, 0 staves, 0 events). Verified: at threshold 160 the
TAB staff resolves to exactly 6 rows (319/334/348/363/377/392).

FIX (principled, no fixture constants): strict threshold first, Otsu
fallback only when strict finds no TAB staff. Crisp vector PDFs keep
their 2-3px line centres (raising the threshold thickens strokes and
shifts string alignment); grey/lightly-stroked PDFs get Otsu.

RESULTS:
  canon-in-d (real user PDF, no GT): 49 staff bands, 5 TAB staves
    (y 319/500/863/1224/1586, gap 14.6), 739 events across 22 measures.
    String spread 1-6 = 128/200/148/106/82/75; frets 0/3/1/2/5 dominant
    - consistent with Canon in D (D-A-Bm-F#m-G) harmony.
  Three reference fixtures PRESERVED exactly:
    paired-chords 116/116 P1.00 R1.00 F1 1.00 8/8 measures
    tab-sparse     32/32  P1.00 R1.00 F1 1.00 8/8 measures
    techniques     32/32  P1.00 R1.00 F1 1.00 8/8 measures

RHYTHM: still not recovered. The PDF text layer carries fret digits
only; durations must come from the notation staff (noteheads/stems/
beams) which is a separate detector. Output marks rhythm_recovered=false.
No rhythm is invented.

### R24 — Rhythm recovered from notation evidence; reference-scored
ARCHITECTURE (modular, five stages):
  extract (pdfjs text+raster) -> TAB geometry -> string/fret events ->
  rhythm layer -> MusicXML serializer.

EVIDENCE CHAIN (no spacing guesses, no default durations):
  1. Standard-notation noteheads are SMuFL text glyphs (U+E0A4 filled,
     U+E0A2/E0A3 half, U+E0A0 whole), so their positions are EXACT.
     They are assigned to the TAB staff they belong to by vertical
     distance to the staff span (works for notation above or below).
  2. Simultaneous noteheads are grouped into chord columns by glyph
     width (0.6 x notehead width). A chord shares one stem, so every
     tone is probed and the longest stem run wins.
  3. Stems use a SINGLE-PIXEL column probe: the old detector required
     25% ink in a 5px window, so genuine 1px stems (20%) were invisible.
     Minimum stem length is staff-relative (1.6 x staff gap), not a
     DPI-specific pixel constant.
  4. Beams come from the beam mask along the stem column (0 beams =
     quarter). Dots are accepted only when the dotted reading makes the
     measure sum to the time signature; otherwise the plain reading wins.
  5. Time signature is read from SMuFL timeSig0-9 glyphs (U+E080-E089),
     rows forming numerator/denominator. No hardcoded 4/4.
  6. Measure validation: each measure's recovered quarters must equal
     beats x 4 / beat-type. Failure marks every onset in that measure
     unconfident.
  7. Strict pairing gate: rhythm is trusted only when notehead columns
     and TAB onsets correspond 1:1 on a staff. Unequal counts (extra
     voices, second notation staff) are matched greedily but EVERY
     duration is marked unconfident - never presented as measured.

REFERENCE-SCORED (string/fret + timing vs fixture MusicXML):
  paired-chords : 116/116 SF F1 1.00 | onsets 32/32 F1 1.00 |
                  durations 32/32 F1 1.00 | complete events 32/32 F1 1.00 |
                  measures valid 8/8 | rests 0 | ties 0
  techniques    :  32/32  SF F1 1.00 | onsets 32/32 F1 1.00 |
                  durations 32/32 F1 1.00 | complete events 32/32 F1 1.00 |
                  measures valid 8/8 | rests 0 | ties emitted 0 (ref 2)
  tab-sparse    :  32/32  SF F1 1.00 | timing 0/32 (HONEST ABSTENTION:
                  this PDF has NO notation noteheads at all, only a time
                  signature, so no duration evidence exists)
TOTAL string/fret preserved: 180/180, 24/24 measures.

HONEST OUTPUT WHEN RHYTHM IS UNKNOWN:
  - per note: placeholder <duration>, NO <type>, <footnote> "duration
    not recovered (declared placeholder, not measured rhythm)"
  - score metadata: rhythm-source = unrecovered-placeholder
  - summary: rhythm_recovered=false, playable=false
  When rhythm IS recovered, durations are real and <type>/<dot> are
  emitted (score metadata rhythm-source = smufl-notehead+stem/beam).

REAL / UNSEEN PDFs (no independent reference; structural only):
  canon-in-d (739 events, 22 measures): 0 SMuFL noteheads -> rhythm
    abstains (rhythm_recovered=false, 0/197 onsets confident).
  gravity-falls-theme-tab (99 events), save-me-bts (290 events): 0
    noteheads -> abstain.
  home-undertale (139 events, 159 noteheads): multiple notation voices
    per system (35 columns vs 24 onsets on staff 0) -> strict pairing
    gate refuses; 0/129 confident. Correct behaviour, not a silent guess.
  guitar-paired-scan: 0 text items -> 0 events, abstains.
  guitar-standard-chords (notation only): 0 TAB staves -> 0 events,
    correctly refuses (no TAB).

REMAINING / NOT CLAIMED:
  - rests: glyphs are detected (1 eighth rest in canon) but not yet
    associated to measures or emitted; missing_rests is reported.
  - ties: not detected. The techniques reference contains 2 tie markers
    between DIFFERENT pitches (D4 -> A4) across a system break, so it is
    not a same-pitch tie; we report missing ties rather than fake them.
  - beams: detector wired but the three fixtures contain 0 beams, so
    eighth/16th recovery is implemented but NOT reference-verified.
  - dotted values: gated by measure validation, not exercised by any
    reference fixture (all quarter).
  - multi-voice real scores: refused by the pairing gate.

### R25 — Eighth-note (flag) recovery verified; stem attribution hardened
R24's fixtures are quarter-only, so beams/flags were unverified. Two
stem-attribution bugs also surfaced when the classifier was applied to
denser notation, and both are fixed:

1. STEM SIDE CONVENTION. The detector searched up and down at both
   notehead edges. On tight eighth-note chords this lets a chord borrow
   the neighbour's stem (measured: a left-edge up-run 3.8px away), and
   with it the neighbour's flag evidence. Engraving convention is
   right-edge = up-stem, left-edge = down-stem; enforcing that removes
   the borrow.
2. SPACING-BOUNDED SEARCH. The +/-16px stem window exceeded half the
   spacing between eighth-note chords (~17px). The window is now
   min(16px, 0.45 x nearest column gap), so a stem can only belong to
   its own onset.
3. FLAGS. A flag is ink immediately beside the stem tip (10x12px strip,
   staff-line rows removed). Whole-component tests failed because tight
   engraving lets a flag touch the next stem; the near-tip strip is
   robust to that. Beams and flags are mutually exclusive on one note;
   if both appear the duration uses the subdivision but is marked
   unconfident (beam_flag_conflict).

NEW REFERENCE EVALUATION (independent, notation-only fixture with real
eighths; tool: proof-notation-duration-score.py):
  guitar-standard-chords-vector: 40 onsets, 40 correct, accuracy 1.00
    confusion: eighth->eighth 16, quarter->quarter 24
    ambiguous 0, beam_flag_conflicts 0, confident 40/40
  guitar-paired-chords-vector  : 32/32 quarter, accuracy 1.00
  guitar-techniques-paired     : 32/32 quarter, accuracy 1.00
  TOTAL duration classification: 104/104 onsets across 3 references.

The three TAB reference fixtures are unchanged by these fixes:
  SF 116/116, 32/32, 32/32 (180/180); complete events 32/32, 0/32
  (sparse abstains), 32/32; measures valid 8/8, 0/8, 8/8.

### R26 — Font-independent raster notation; reference-scored on a scan
MOTIVATION: SMuFL noteheads are a text-layer luxury. Real PDFs either
rasterise notation as paths/bitmaps or contain no notation staff at all.
R26 adds a raster path that runs when the SMuFL path finds no noteheads.

RASTER NOTEHEAD RECOGNITION (font independent, no fixture constants):
  1. 3x3 erosion removes staff lines and stems (1-3px strokes) while
     filled noteheads survive as solid cores.
  2. Size filters are RELATIVE TO THE STAFF GAP (width 0.35-1.45 gap,
     height 0.30-1.30 gap, area 0.10-3.0 gap^2, aspect 0.9-2.4,
     fill >= 0.45), so DPI does not matter.
  3. Two chord tones a second apart can TOUCH. Oversized blobs are split
     at the valley of their row profile; the scan's two missed heads
     were exactly this case (17x16 blobs, valley value 2 vs peaks 10-11).
  4. The search region is the notation staff group immediately above
     each TAB staff, clamped so it never enters the TAB digits. Low
     ledger notes keep a staff_hint so they are not reassigned to the
     TAB staff below.
  5. Stem search is bounded by column spacing and, for raster heads, to
     9px (their boxes are the ink). Staff lines are rejected inside the
     flag strip by dropping near-full rows - scanned lines are often too
     broken for a page-wide row mask.

REFERENCE-SCORED RESULT ON A NON-SMuFL PDF (real scan, no text layer):
  guitar-paired-scan:
    noteheads 116/116 (32 columns; per-measure chord sizes match exactly)
    onsets 32/32, durations 32/32, accuracy 1.00
    measures 8/8 valid, meter INFERRED as 4/4 (not read from the ref)
    source: raster-fallback
  This is the first reference-scored rhythm result from a PDF with no
  musical text glyphs at all.

DURATION-CHANNEL TOTAL across four independent references:
  paired-chords 32/32, techniques 32/32, standard 40/40 (16 eighths),
  scan 32/32  ->  136/136 onsets, 0 ambiguous, 0 beam/flag conflicts.

SMuFL FAST PATH PRESERVED (all three TAB fixtures unchanged):
  SF 116/116, 32/32, 32/32 (180/180)
  complete events 32/32, 0/32 (sparse abstains), 32/32
  measures valid 8/8, 0/8, 8/8

REAL-WORLD PDF TAXONOMY (no independent reference; structural only):
  canon-in-d (739 events, 22 measures): TAB-only. No notation staff;
    rhythm is drawn as beamed rhythm slashes above the TAB. The raster
    notehead path correctly finds 0 notation heads. BLOCKER: rhythm-slash
    recognition (not implemented). No rhythm claimed.
  save-me-bts (290 events), gravity-falls (99 events): same TAB-only
    layout with rhythm slashes. Same blocker.
  home-undertale (139 events, 159 SMuFL heads): single-note melody
    columns 27-31 vs TAB chord onsets 24-28 per system -> genuine
    multi-voice. Exact-pairing gate refuses every system
    (voice_ownership=unresolved-multi-voice). No durations claimed.
  guitar-paired-scan: no text layer -> 0 TAB events; notation rhythm is
    scored separately (above). BLOCKER for complete events: raster TAB
    digit recognition (frozen detector unchanged).
  guitar-standard-chords: no TAB -> 0 events, correctly refuses.

NEW REPORTING: rhythm_blockers states the precise cause per file;
voice_ownership is single-voice / unresolved-multi-voice / unknown.

NOT CLAIMED: rhythm slashes, multi-voice pairing, rests (detected but
not emitted), ties, half/whole raster heads (filled heads only).

### R27 — Full scanned-PDF transcription, reference-verified
TARGET: the scan had 32/32 rhythm (R26) but 0 fret events. R27 adds
raster TAB digit recognition and combines it with the raster notation
rhythm path, producing a COMPLETE transcription of a scanned PDF.

RASTER TAB DIGITS (font-independent pipeline, font-dependent templates):
  1. Pages with no text layer are re-rendered at 300dpi (OCR needs
     resolution; the text fast path is untouched).
  2. Digits are strongly dark ink; a threshold at 0.62 x Otsu isolates
     them from grey staff lines. A long horizontal opening removes the
     black 1px line core; components are filtered with limits RELATIVE
     TO THE STAFF GAP.
  3. Templates 0-9 are rendered at runtime from the best available
     font: Arial/Helvetica/Liberation first, bundled OFL Arimo as the
     fallback (tools/guitar-vision/fonts/Arimo.ttf + OFL). No
     proprietary font file is redistributed.
  4. Components on the same string line within 0.55 gap are one
     multi-digit fret (10/12/14/...). String = nearest line; measures
     from raster barlines (double opening bars merged).
  5. The system-opening TAB clef (T/A/B) is excluded from measure 1.
  6. A damaged 3 can read as 2; the lower-right bowl (a 3 has right-side
     ink low in the glyph, a 2 does not) disambiguates 2 vs 3 only when
     their template scores are within 0.15. It fired exactly once on
     this scan and was correct.

SCALED PROBES: at 300dpi stems are 2-3px and noteheads lost to a 3x3
erosion, so the morphology kernel and the stem/flag windows scale with
the staff gap. Flag strips start beyond the measured stem width and
ignore ink exactly at the stem tip (annotations/brackets there are not
flags). This kept the 150dpi SMuFL flag result at 40/40 while removing
all false flags at 300dpi.

REFERENCE-SCORED RESULT — guitar-paired-scan (no text layer, no SMuFL):
  string+fret   116/116  P 1.00 R 1.00 F1 1.00
  onsets         32/32   P 1.00 R 1.00 F1 1.00
  durations      32/32   P 1.00 R 1.00 F1 1.00
  complete events 32/32  P 1.00 R 1.00 F1 1.00
  measures        8/8 exact; every measure sums to 4.0 quarters
  rests 0/0, ties 0/0
  MusicXML: all 116 notes <type>quarter</type>, 4 notes carry
  "duration unverified" footnotes (29-31/32 onsets have stem evidence).

TEXT FAST PATH PRESERVED: 180/180 string+fret; complete events 32/32,
0/32 (sparse abstains), 32/32; measures 8/8, 0/8, 8/8. 384 tests green.

TAB-ONLY SLASHES (Priority 1) — NOT IMPLEMENTED, blocker stated:
  canon-in-d (739 events), save-me-bts (290), gravity-falls (99) have
  no notation staff at all; their rhythm is drawn as beamed rhythm
  slashes above the TAB. Raster TAB frets could recover their strings/
  frets, and the text path already does for canon, but the slash groups
  are not parsed, so rhythm remains abstained. Implementing slash
  grouping (beam count + stroke count per measure) is the remaining
  capability for these layouts.

PORTABILITY: digit templates prefer Arial/Helvetica (macOS); with the
bundled Arimo fallback the same scan scores 82/116, because the scan's
glyphs are Arial-metric. The architecture is font-agnostic; accuracy
depends on the available font matching the document's engraving font.

### R28 — Cross-font scanned TAB: multi-font templates, held-out benchmark
PROBLEM: the scanned result (116/116) used one Arial-family scan. The
Arimo-only fallback scored 82/116, so font independence was unproven.

BENCHMARK (tools/guitar-vision/proof-font-bench.py):
  Same score/layout as guitar-paired-scan, rendered as image-only PDFs
  with 8 digit fonts: Arial, Times New Roman, Courier New, Georgia,
  Verdana, DejaVu Sans, DejaVu Serif, STIXGeneral. The reference
  MusicXML is the unchanged independent truth; only the typeface varies.
  Pages include a 5-line notation staff and a 6-line TAB staff, blur,
  rotation and JPEG compression (scan-like).

CLASSIFIER CHANGE: digit templates are no longer "first available font".
The raster path builds templates from every available face (sans, serif,
monospace, bold) and classifies against the union. `GV_DIGIT_FONTS`
overrides the list for leave-one-font-out evaluation.

LEAVE-ONE-FONT-OUT STRING/FRET (test font excluded from templates):
  font            Arial-only   multi-font LOO
  Arial             109/116        110/116
  Times New Roman    57/116         78/116
  Courier New        15/116         36/116
  Georgia            63/116         99/116
  Verdana            78/116        116/116
  DejaVu Sans        72/116        106/116
  DejaVu Serif       72/116        106/116
  STIXGeneral        55/116         86/116
  mean               65.1           92.1  (+27.0)

COMPLETE TIMED EVENTS also improve on held-out fonts, e.g. Verdana
15 -> 30/32, Georgia 4 -> 13/32, DejaVu Serif 10 -> 25/32. Serif/mono
complete-event coverage is still limited by digit segmentation and
measure grouping, not only classification.

REAL SCAN PRESERVED with the multi-font default:
  116/116 string+fret, 32/32 onsets, 32/32 durations,
  32/32 complete events, 8/8 measures.

DIGITAL FAST PATH PRESERVED: 180/180 string+fret; 64/64 complete events;
measures 8/8, 0/8, 8/8. 384 tests green.

RHYTHM SLASHES (TAB-only layouts): investigated on canon-in-d. Vertical
stroke rows above the TAB are detectable, but the same band contains
fret digits, chord symbols and technique marks; naive stroke grouping
produced 9-33 groups per system with unstable sizes. There is no
independent reference for these pages, so durations are NOT claimed and
the parser is not wired in. This remains the blocker for TAB-only
commercial layouts.

CAVEATS: the font benchmark is synthetic (same score, varied typeface);
it measures classifier robustness, not a new real publisher. Arial-metric
system fonts still give the best same-font result; the bundled OFL Arimo
remains a fallback. Rest/ties emission is unchanged.

### R29 — Browser-compatible JS pipeline; no Python at runtime
The research pipeline is now ported for the browser in
tools/guitar-vision/browser/guitar-vision.mjs. It uses pdfjs-dist for
text and raster, implements TAB geometry, string/fret assignment,
SMuFL rhythm, measure validation and MusicXML, and runs unchanged in
Node (validation) and Chromium (demo).

REFERENCE RESULTS (JS implementation, not the Python pipeline):
  paired-chords  116/116 string+fret, 32/32 complete timed, 8/8 measures
  techniques      32/32 string+fret, 32/32 complete timed, 8/8 measures
  sparse          32/32 string+fret, 0/32 timed (honest abstention)
  total          180/180 string+fret, 64/64 complete timed
  Node runtime   22-88 ms per page
  Browser        204 ms (paired fixture, headless Chromium + OSMD)

BROWSER EVIDENCE: upload -> recognition -> MusicXML -> OSMD engraving in
headless Chromium; screenshot /tmp/proof/browser-evidence.png. The
engraved TAB matches the fixture frets (0/3/5/12/7/10/2/0 ...).

RHYTHM SCOPE: the JS port does not yet include the Python stem/beam/flag
evidence. Filled noteheads are read as quarters and validated against
the time signature; every such duration is footnoted "unverified" and
the score metadata states the method. With no notation noteheads the
duration is null (no <type>), so sparse abstains rather than inventing
quarters. This limitation is why the 32/32 timed results should be read
as quarter-only fixtures, not general rhythm capability.

RUNTIME ASSETS: pdfjs-dist 5.4.296 Apache-2.0; OSMD 2.2.0 BSD-3-Clause
(demo only); @napi-rs/canvas MIT (Node only); Playwright Apache-2.0
(test only). No neural weights. The Python raster path uses ordinary
glyph templates from fonts (Arimo OFL fallback); the browser text path
uses no templates. Provenance: tools/guitar-vision/browser/ASSETS.md.

NOT PORTED: image-only scans (Python research remains 116/116 on its
reference), beam/flag verification, TAB-only rhythm slashes, rest/tie
emission, multi-voice matching. These are reported as unsupported rather
than approximated.

### R30 — Real browser-side rhythm recovered; engraving count audit
ROOT CAUSE of the browser placeholder quarters: the JS stem probe computed
a fractional side tolerance; the pixel loop then indexed arrays with
fractional x, producing `undefined` -> every stem read as absent. The
earlier simplified beam/flag probe was also unreliable, so the port fell
back to measure-validated quarters.

FIX:
- Integer stem-search bounds; bridged 1px run, right=up / left=down.
- Beam mask: horizontal ink runs >=60px, components 3..25px thick
  (mirrors the verified Python 5x60 opening).
- Flags: strip beyond the measured stem width, rows beyond the tip,
  reject near-full rows; ink threshold 128 (not 200).
- Durations: notehead glyph + beams/flags; measure validation; no
  notation counterpart -> null duration (sparse still abstains).

REFERENCE-VERIFIED BROWSER RHYTHM:
  guitar-standard-chords-vector (mixed values, notation only):
    40/40 onsets, 16 eighth + 24 quarter, all confident (exact).
  paired-chords: 116/116 SF, 32/32 onsets, 32/32 durations,
    32/32 complete timed, 8/8 measures.
  techniques: 32/32 SF, 32/32 complete timed, 8/8 measures.
  sparse: 32/32 SF, 0/32 timed (no notation -> no <type>).
  TOTAL: 180/180 SF, 64/64 complete timed.
  Browser (headless Chromium): 32/32 confident onsets, 8/8 measures,
  219 ms including PDF render + OSMD engraving; XML 26,591 bytes.

ENGRAVING COUNT AUDIT (232 / 232 / 32):
  main's emitGuitarMeasure writes each event on staff 1 (notation) and
  then staff 2 (TAB) after a <backup>, both with <technical>.
  232 pitches = 116 events x 2 staff representations.
  232 technical entries = 2 x 116.
  32 = chord onsets on the TAB staff (OSMD collapses chord members).
  No note is lost or attached to a wrong string; the pitch/technical
  counts double because of the two-staff representation. Distinct
  musical events remain 116 (32 onsets).

UNFAMILIAR DIGITAL PDFs (JS, page 1 only, no reference):
  canon-in-d 739 events / 197 onsets; save-me 290/284; gravity 99/99;
  home-undertale 139/129. Rhythm abstains (TAB-only slashes or
  multi-voice), matching the Python classification. No accuracy claim.

MULTI-PAGE: the browser path still processes page 1 only. Page order,
staff identity and tuning across pages are NOT yet handled; these
unfamiliar results are single-page.

PRACTICE: the experimental flag remains off. The paired/techniques
fixtures now have verified rhythm, but production eligibility must be
driven by the integration assessment; the research `playable` flag is
not a production gate.

### R31 — Mixed-rhythm paired TAB benchmark (reference-backed)
Created tools/guitar-vision/proof-mixed-rhythm-fixture.py and
benchmarks/omr-fixtures/guitar-mixed-rhythm-vector/ (PDF + MusicXML):
4/4, 4 measures, chords, quarter/eighth/sixteenth notes, beamed groups,
SMuFL noteheads/time signature, text TAB digits. Reference and PDF come
from the same event model.

RESULT (browser JS pipeline, page 1):
  string/fret 60/60, P 1.00 R 1.00; 4/4 measures exact.
  rhythm: 21 predicted onsets, 21 reference onsets, but only 7 onset
  positions match; complete events 1/21; valid measures 0/4.

EXACT BLOCKER: only 18/21 notation noteheads are extracted. The three
sixteenth-note glyphs in measure 3 are drawn ~33px apart and pdfjs
merges adjacent identical SMuFL glyphs into one text item; the JS takes
the first character of each item, losing the rest. With 10/10 columns on
system 1 but 8/11 on system 2, the exact-pairing gate refuses and the
measure validation cannot recover timing.

NEXT: (a) split merged SMuFL text runs into one notehead per glyph
(expose character offsets), or space the fixture's sixteenths further;
(b) then re-test beam levels for sixteenths and the dotted/tie/rest
extensions. String/fret evidence on the mixed fixture is already exact,
so the attachment problem is isolated to rhythm-column extraction.
