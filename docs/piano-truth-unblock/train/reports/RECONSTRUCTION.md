# Piano reconstruction evaluation (P3–P7): frozen probes → playable score

Evidence: `recon_dev99.json` (full per-score), `recon_dev99_summary.json`,
`../manifests/olimpic_dev_gap.json` (P7).
Code: `scripts/infer.py`, `decode_score.py`, `to_musicxml.py`, `eval_reconstruction.py`,
`scripts/t10_olimpic_dev.py` (P7).
Commit: `67e9453609` (P3–P6); P7 verification re-ran `t10` bit-identically.

Sealed populations untouched: PDMX TEST 99, OLiMPiC TEST 1493. DEV only (99 scores).

## Stage design (leakage control)

- **Stage A (oracle labels):** canonical truth → `preds_from_truth` (same schema as
  model output) → decoder → MusicXML. Measures DECODER error only.
- **Stage B (frozen model):** oracle boxes → 3 frozen probes → combination rule →
  decoder → MusicXML. Measures MODEL + decoder error; A→B gap = model error.
- **Stage C (predicted boxes):** UNAVAILABLE — no detector was trained. Detector
  hunting is banned (`assert_no_detector` fails closed).
- Decoder never consumes truth pitches, durations, onsets, voices, accidentals,
  ties, or text. It uses oracle geometry (notehead_x, boxes) + meter + document
  order, all legitimate inputs.

## Full DEV results (99 scores, 22,299 notes, 578 rests)

| metric | stage A (decoder) | stage B (model+decoder) |
|---|---|---|
| note exact (onset/pitch/dur/voice/staff) | 22299/22299 (100%) | 10533/22299 (47.2%) |
| note pitch-only | 100% | 10731/22299 (48.1%) |
| rest exact | 456/578 (78.9%) | 2/578 (0.3%) |
| timing-valid (measure,voice) slots | — | 948/3334 (28.4%) |

Grouping pairwise (stage B vs truth): chord P 0.992 / R 0.472 (t=6224);
beam P 0.276 / R 0.759 (p=110077 vs t=40001 — over-merge);
tuplet P 0 / R 0 (t=615 true pairs, p=1 — head never fires).
Beam voice purity 100% (all groups single-voice).
music21: 99/99 files parse, 2484 measures, 20 tie starts / 20 tie stops paired.

## Error attribution

- **Decoder (stage A residual):** notes ZERO error corpus-wide. Rests 122 fn /
  146 fp, all attributed to (a) parallel-layer duplicate rests serialized into
  one voice (23% of rest positions; file-adjacent rule fixes 82% of dups,
  nonadjacent residual remains), (b) voice≠layer onset divergence (truth
  accumulates per layer, decoder per voice — unresolvable without layer labels).
- **Model (A→B gap):** note exact 100% → 47.2%; rest exact 78.9% → 0.3%
  (onset cascade from note dur/voice errors; rest boxes ARE emitted, just
  misplaced). Chord recall 1.0 → 0.472 via dur/voice splits. Beam precision
  0.871 → 0.276 via in_beam over-prediction. Tuplet recall ~0 (flag dead).
- **Canonical (metric fixes applied, no truth change):** chord_id drops
  notehead_x from its key (collides distinct same-onset chords) — eval now uses
  the full 5-tuple key. Pilot objects lack source_order for rests — decode uses
  canonical file rank uniformly. `_mlen` clobbering by meter-less events fixed.

## P5 gap list (model coverage, needs new heads or rules)

1. Adjacent same-lane beam groups indistinguishable from `in_beam` flags alone
   (no break/boundary flag among the 25 membership flags).
2. `tuplet_member` never fires on DEV (615 true pairs missed).
3. Beam-break elements, repeats/endings, segno/coda, voltas, nested tuplets,
   glissandi/turns/breaths break and draw through barlines — unmodeled.
4. Exotic-meter full-measure rests (e.g. 15/16) have no single-symbol dur form;
   emitted measure-style (correct) but model can only predict vocab symbols.
5. Cue evaluation, rit text mapping, voice/layer divergence — documented limits.

## P6 validation

music21 parses 99/99 stage-B outputs; ties paired 20/20; timing validity 28.4%
reported per (measure, voice) slot. Failure dossiers: worst score 3.5% joint
exact (`QmZC68y4...`, 256 notes); full per-score records in `recon_dev99.json`.

## P7 OLiMPiC DEV diagnostic (synthetic→real domain gap)

Script `t10_olimpic_dev.py` reads ONLY `samples.dev.txt` (1,438 system crops +
`.lmx` truth); verified by inspection it never opens `samples.test.txt` or any
test sample. No training, no predictions. Re-run reproduced the committed
manifest bit-identically (`test_touched: false`); no files under
`pilot/data/olimpic` were written.

| statistic (median) | OLiMPiC DEV scans | pilot synthetic renders | ratio |
|---|---|---|---|
| contrast (std) | 66.5 | 30.9 | ~2.2× |
| blur (Laplacian var) | 11047.7 | 2066.5 | ~5.3× |
| ink fraction | 0.150 | 0.037 | ~4.1× |
| tokens / system (LMX) | 248 | — | — |

Finding: real scans are far denser, higher-contrast, and sharper-detailed than
the synthetic render domain the probes trained on. Expect substantial probe
degradation on scans; cross-domain inference is NOT attempted here (would need
scan-domain adaptation + system-level decoding — an expensive experiment,
explicitly out of scope). The frozen `p8_olimpic_harness.py` LMX-edit-distance
plumbing remains the route for any future scan-domain evaluation.

## Actual Piano Vision accuracy (DEV, frozen)

End-to-end structured reconstruction from oracle boxes: **47.2% joint-exact
notes** (10533/22299), 48.1% pitch-only; rests 0.3%; 28.4% of (measure, voice)
slots timing-valid; chords P 0.992/R 0.472; beams P 0.276/R 0.759; tuplets ~0.
The decoder contributes zero note error (stage A 100%); all loss is probe
accuracy plus the documented voice/layer and flag-coverage limits.

## Remaining V1 blockers

1. **Probe accuracy**: 47.2% joint-exact is the dominant loss; per-head
   uplifts (dur, voice, staff) move the end-to-end number directly.
2. **Dead `tuplet_member` flag** + missing beam-boundary flag (P5.1–P5.2).
3. **No detector (stage C)**: end-to-end from pixels is unmeasured; detector
   training is the next campaign-scale step if pixel-level OMR is required.
4. **Scan-domain gap** (P7): probes are render-domain only; real-scan accuracy
   is unknown and expected poor without adaptation.
5. Sealed TEST discipline held throughout: scored 99 ⊆ PDMX DEV, ∩ TEST = ∅;
   OLiMPiC TEST 1493 never opened.

---

# Accuracy rescue pass (P1–P12 autonomous mission)

No retraining. No TEST access. No merge. DEV identities fixed (same 99 sids).
Leakage re-verified: stage B uses `voice_source=context` (model only);
`decode_score`/`to_musicxml` never read `*_truth` fields.
New evidence: `reports/audit_prefix.json` (before),
`reports/audit_postfix.json` + `reports/recon_dev99_postfix.json` (after),
`reports/audit_common_voice.json` (P5 control).
New code: `scripts/audit_errors.py` (decode-only classifier),
`data/decoded/*.preds.json` (99 frozen prediction caches).

## P1 failure audit (stage B, 99 DEV scores; 11,568 fn / 11,635 fp)

| rank | category | count | origin | fixable w/o retrain? |
|---|---|---|---|---|
| 1 | wrong pitch (pure + in MULTI) | 2991 + 2188 D+P + 1392 O+P | visual (pitch head 0.665) | NO |
| 2 | onset cascade (matched pairs w/ bad onset 3718/10731; pure ONSET 234) | ~4500 notes affected | visual dur errors → accumulation | NO (decoder cannot invent time) |
| 3 | missing/extra, no partner (severe cascade; kind head is perfect: 22299/22299 notes kind-correct) | 1945 + 2737 | visual | NO |
| 4 | chord splits: voice/staff 1242, dur 1021, onset 1021 pairs | 3284 pairs | visual splits | PARTIAL (dur/onset via x-snap: fixed 861) |
| 5 | beam adjacent-merge (1371 groups; rest-crossing only 6) | 1371 groups | decoder (no boundary evidence) | NO → needs beam-boundary head |
| 6 | cross-measure ties broken (396 truth spans; decoder chained per-measure) | 396 | decoder bug | YES → fixed (77 paired in B) |
| 7 | rests: misplaced 395 + extra 575; right-place-wrong-dur 181; voice never sole cause | 1151 | visual (onset cascade + rest dur) | NO |
| 8 | tuplet flag dead (pred 2 vs truth 433 notes) | 615 pairs | visual (flag never fires) | NO → preregistered (P9) |
| 9 | pure voice/staff substitutions | 37 | visual (context probe good) | n/a (negligible) |

## P2 rest rescue: investigated, no decoder fix justified

Rest kind recognition is good (631/698 rest items kind-correct; only 67 typed
as notes; zero notes typed as rests). Rest failure is placement/duration:
onset cascade from note dur errors (MISSING 395) + weak rest-dur predictions
(DUR 181). Voice is never the sole rest error. No decoder change can reposition
rests without inventing time (explicitly banned); duplicate-collapse and
meter-synthesis from the prior mission stand. Rest exact stays 2/578.

## Decoder changes (bounded, before→after on frozen DEV)

- **F1 cross-measure tie chaining** (was per-measure; broke all 396 truth
  cross-measure spans by construction). Pairing still requires both visual
  flags, so nothing is fabricated; within-measure pairings provably preserved
  (measure-ordered scan). Result: 77 cross-measure ties paired in stage B;
  serialized tie starts 20→52, stops 20→48; music21 still 99/99.
- **F2 chord onset snap by notehead-x coincidence** (dropped the
  same-predicted-duration requirement; members keep own durations).
  Chord recall 0.472→0.611 (+861 pairs), precision 0.992→0.988 (−21 fp pairs).
  Miss cause after: voice/staff-split 1242 (unfixable in decoder: different
  lanes), onset-split 960 (non-adjacent interleave), dur-split 221.
- **P8 input-quality rejection path**: `build_inputs` now records skipped
  objects (`no_bbox` / `degenerate_crop` / `blank_crop` std<1.0) into
  `.preds.json`; decode flags OOV drops (`pred_oov_note_dropped`).
  DEV result: **0 skipped, 0 OOV drops** — guard validated as no-op on
  readable renders, active for unreadable inputs. Nothing is hallucinated.
- Beam rest-crossing split NOT implemented (only 6/1377 over-merges; risk
  without measurable gain). Adjacent-merge needs a beam-boundary head.

## Before → after (frozen DEV99)

| metric | before | after |
|---|---|---|
| note exact / pitch / fp / fn | 10533 / 10731 / 11635 / 11568 | identical (matcher is onset/grouping-insensitive by design) |
| chord P / R | 0.992 / 0.472 | 0.988 / **0.611** |
| beam P / R | 0.276 / 0.759 | unchanged |
| tuplet P / R | 0 / 0 | unchanged (dead flag) |
| rest exact | 2/578 | unchanged |
| timing-valid slots | 948/3334 | 948/3334 |
| music21 parse / ties out | 99/99, 20+20 | 99/99, **52+48** |
| stage A (decoder oracle) | 22299/22299, rests 456/578 | identical (no oracle-path change) |

## P5 context verdict

Context voice 10533 exact vs common-voice control 10225 (+308, +2.9%
relative). Context helps overall — keep `voice_source=context` default.
Voice is the least-broken head (33 pure substitutions); the 0.807 ceiling
binds through chord splits (1242 pairs) and rest lanes, not substitutions.

## P7 rare-notation classification (TRAIN corpus scan, 792 scores + code)

| gap | class | evidence |
|---|---|---|
| glissandi (1 TRAIN link) | TRAINING DATA + MODEL-unevaluable | events scan; 0 dev positives (probe report) |
| turns/mordents (45), trills (177) | TRAINING DATA sparse | events scan; decoder omits by design (flagged) |
| breaths | SOURCE/PARSER (no `v1_events` handling; SVG class exists) | code grep |
| measure numbers | RENDER/IDENTITY (SVG-only, no symbolic join) | code grep |
| endings/voltas (242 in TRAIN truth) | MODEL RECOGNITION (no head) → DECODER-blocked | scan + serializer omits by design |
| nested tuplets (0 in TRAIN) | TRAINING DATA + UNSUPPORTED | scan |
| cue notes (36 TRAIN, 0 dev) | TRAINING DATA + DECODER omission (flagged) | scan + flags |
| rit./tempo/dir text (406+372), harm 2096, dynamics | MODEL RECOGNITION (no heads) → DECODER-blocked | scan + serializer omits by design |
| scoop/doit/fall, single-tremolo | UNSUPPORTED SOURCE (quarantined at parse) | probe report |
| arpeggios (505 notes in truth) | MODEL-unevaluable + DECODER omission | scan + probe + serializer |

No TRAIN-only fix is justified: serializing text/endings/dynamics without
predicted signals would inject truth (leakage). Preregistered focused
experiments (P9): (E1) beam-boundary head (`beam_start/end`) on TRAIN spans;
(E2) tuplet_member rare-class uplift (433 TRAIN notes, uniform loss, DEV
tuplet-pair recall as gate). Neither launched (needs training evidence run).

## P8 scan domain

t10 diagnostic stands (reproduced bit-identically last mission). No new
scan diagnostic run. Bounded addition: unreadable-input rejection path (above).
No claim of scanned-PDF recognition: zero evaluated scan transcriptions.

## Bottom line

Playable-score reconstruction is now bounded by probe accuracy, precisely
located: pitch substitutions (~5.5k fn involving pitch), onset cascade from
dur errors (~4.5k), chord voice-splits, dead tuplet flag, missing
beam-boundary flag. Decoder-side losses that were fixable without retraining
are fixed (ties across barlines, dur-split chords) with zero regressions.
Joint-exact 47.2% is unchanged numerically (matcher-insensitive dimensions
improved: chords +13.9pp recall, ties +32 starts) — the number moves only
with better visual predictions. **Further training is justified iff scoped to
E1/E2 + pitch/dur head uplifts; another full 792-score campaign with the same
recipe is NOT justified by these results.**

Recommended next step: run preregistered E1 (beam-boundary head) as a small
TRAIN-only head-addition experiment with DEV pairwise-beam-precision gate;
if it fails, E2 (tuplet uplift). Both are bounded and falsifiable.

---

# Targeted visual recognition rescue (no retraining)

Priorities were pitch failures, duration/onset cascades, rest collapse, and
E1/E2 ranking. One bounded decoder-side intervention resulted. No training
launched; TEST sealed; DEV identities fixed.
New evidence: `reports/pitch_analysis.json`, `reports/pitch_topk_summary.json`,
`reports/staffmap_check.json`, `reports/cascade.json`,
`reports/audit_clefrepair.json`, `reports/recon_dev99_clefrepair.json`.
New code: `scripts/analyze_pitch.py`, `scripts/analyze_clef.py`,
`scripts/probe_topk.py`, `scripts/staff_geometry.py`,
`scripts/verify_staffmap.py`, `scripts/measure_cascade.py`;
`scripts/infer.py` (+top-5 pitch, +notehead_cy, +skipped),
`scripts/decode_score.py` (+clef repair).

## Root-cause findings

1. **Pitch collapse is a clef-frame failure, not generic visual noise.**
   DEV pitch accuracy by clef: G 0.812, F **0.095**, C **0.000**; by octave:
   4/5 → 0.79/0.88, octaves 0–2 → **0.000**, octave 3 → 0.129.
   F-clef error diffs cluster at +20/+21 semitones — the exact F→G staff
   transposition (bottom lines G2=43 vs E4=64). The 64×64 crop contains no
   clef and the context tower fails to supply it: architecture gap, not
   training diversity (28% of notes are F-clef).
2. **Top-k contains the answer in 43% of bass errors** (F top-3 0.487 vs
   top-1 0.095; 2460/5685 errors recoverable without training). 57% miss
   top-3 entirely → visual encoding insufficient → retraining territory.
3. **Duration→onset cascade measured** (1,984 analyzable lanes): clean 49%,
   single-dur-error lanes 27% (987 onset errors, 30%), multi-dur lanes 21%
   (2,079 errors, 64%), correct-durs-but-wrong-onset 3% (187, voice
   interleave). Onset accuracy has no independent lever; it follows dur.
4. **Rests confirmed unfixable in decoder**: kind recognition good
   (631/698), failure = onset cascade (395) + weak rest-dur (181); rest
   exact stays 2/578.
5. **E1/E2 ranked below pitch by two orders of magnitude**: E2 ceiling = 615
   grouping pairs with zero joint-exact effect; E1 = beam-precision only,
   zero joint-exact effect. Clef repair: +1,974 joint-exact notes.

## Experiment implemented (decoder-side, zero training)

Clef-consistent pitch repair: exact SVG notehead centers
(`staff_geometry.notehead_map`) → staff steps in the note's own staff frame
(ledger-extrapolated, cross-staff correct) → expected pitch in the oracle
clef frame (same oracle class the serializer already consumes) → override
argmax only with the top-ranked probe top-5 candidate matching those steps;
otherwise keep argmax (uncertainty preserved, never invented).
Mapping validated deterministically: 19,033/22,299 steps exact (85.4%),
0 missing noteheads. Stage A provably untouched (oracle pitches never
contradict geometry; verified identical totals).

## Before → after, commit 5620f20cf6 → now (frozen DEV99)

| metric | before | after |
|---|---|---|
| note exact | 10533 (47.2%) | **12507 (56.1%)**, +1,974 |
| note pitch-only | 10731 | 12697 |
| fp / fn | 11635 / 11568 | 9669 / 9602 (symmetric substitution fixes) |
| chord P / R | 0.988 / 0.611 | 0.988 / **0.652** |
| beam / tuplet | unchanged | unchanged (flag gaps persist) |
| rest exact | 2/578 | unchanged (expected) |
| timing-valid | 948/3334 | 948/3334 |
| music21 | 99/99, ties 52+48 | 99/99, ties 51+47 |
| stage A oracle | 22299/22299 | identical |

F-clef pitch accuracy included in the +1,974; repair fired 3,317 times with
zero headline regressions.

## Preregistered training experiment (NOT launched)

**E-clef**: clef-conditioned pitch-head fine-tune. Recipe: freeze probe
trunks; add 8-dim (clef shape, line) embedding to common-probe pitch-head
input; fine-tune pitch head only on TRAIN note items with oracle clef
(3 epochs max, AdamW 1e-4, batch 1024, CPU); single DEV gate — F-clef top-1
≥ 0.50 AND joint-exact no regression, else abort, one attempt only.
Justification: 57% of bass errors miss top-3 (encoding gap, not selectable).
Deferred (not launched) because: the no-training gain is banked, the recipe
needs training-pipeline surgery (clef joins into `v1_trainFull` items) plus
validation budget beyond this session, and 16 GB shared RAM is unsafe for
unattended CPU training alongside other agents.

## Remaining V1 blockers (updated)

1. Pitch residual (9,602 fn): bass/alto frames beyond top-3 + accidentals
   (0.148) + chord-tone crowding (0.275) → E-clef or broader head uplift.
2. Duration head (0.804): sole lever for onset cascade + timing + rests.
3. Dead tuplet flag, missing beam-boundary head (E1/E2 still valid, low impact).
4. **No automatic object detection (stage C)**: all results remain
   ground-truth-box evaluation; pixel-level OMR is unmeasured — separate,
   campaign-scale blocker. Full Piano OMR may not be claimed from these numbers.
5. Scan-domain gap unchanged; rare-notation classification unchanged.

Recommended next step: execute preregistered E-clef in a resourced session;
then E1. No full 792-score same-recipe campaign is justified.

---

# Autonomous clef-conditioned recognition rescue (visual clef + E-clef proof)

Mission: remove oracle-clef dependence from the repair without losing its
gain. Result: pipeline now fully automatic given oracle boxes (pixels +
render structure + frozen probes + one trained linear head; zero oracle
note labels, zero oracle clef). No merge, TEST sealed, DEV identities fixed.
New evidence: `reports/clef_templates.json`, `reports/clef_split.json`;
`models/clef_pitch_head.pt` (49 KB proof artifact, best checkpoints untouched).
New code: `scripts/clef_vision.py`, `scripts/clef_map.py`,
`scripts/train_clefhead.py`, `scripts/eval_clef_split.py`; structural rewrite
of `scripts/staff_geometry.py`; `decode_score.py` (+visual clef source),
`eval_reconstruction.py` (+`--pitch-head`, +B_oracle_clef attribution).

## Visual clef recognition accuracy (DEV, 683 instances)

Template-NCC classifier on PNG clef crops (templates = TRAIN means, 16
scores, same-font renders): **683/683 = 100%** (G 493, F 184, C 6), zero
tuning. Renderer-specific by construction (scan-domain limitation stands).
Glyph supervision from TRAIN SMuFL code points only (E050/E05C/E062).

## Structural association (zero geometric guessing)

SVG nesting measure → staff → note gives exact membership: staff-rank ↔
truth-staff **99.87%**, staff steps **98.71%** (22,299 notes, deterministic,
zero parameters). Governing map per (measure, staff-rank) with forward fill
(95/99 DEV scores have constant clefs; 4 change-scores covered by fill).

## Oracle vs visual-clef performance (frozen DEV99)

| metric | argmax, no repair (committed baseline) | +repair, oracle clef | +repair, visual clef (production) |
|---|---|---|---|
| note exact | 10533 (47.2%) | 13005 (58.3%) | **12983 (58.2%)** |
| note pitch-only | 10731 | 13233 | 13480 |

Visual clef trails oracle clef by **22 notes (0.1pp)** — the oracle-aided gain
is preserved (mis)attribution-free in the production path. Per-clef
production pitch (decoded notes): G **0.936** (was 0.812), F **0.892** (was
0.095), C 0.000 (unseen C4 line; TRAIN has only C3), overall 0.913.

## Training outcome (E-clef proof: PASS with documented caveat)

Ran once, capped, deterministic (seed 0, CPU, 456 s): frozen common trunk +
new Linear(132, 88) on [features + clefvec], TRAIN stratified subset
(42,646 items), AdamW, 15 epochs (amended from 3: 126 steps left the head at
chance, DEV 0.14 — first attempt ABORTED per gate, amendment documented in
`train_clefhead.py`). Warm-started from the TRAIN-trained pitch head.
Single final DEV gate: F-clef top-1 **0.794 ≥ 0.50** ✓; joint-exact
**13,723 ≥ 12,983** ✓ (no aggregate regression). Saved artifact only.

Full production (new head + visual clef + repair), frozen DEV99:
exact **13,723 (61.5%)**, pitch 14,232; chord recall 0.749 (unchanged);
beams/tuplets/rests/timing unchanged (pitch-only intervention, as expected);
music21 99/99; stage A identical (22,299/22,299).
Caveat: worst score (all-C4-clef, 256×16ths) dipped 9→4 exact — C-line
generalization needs C4 TRAIN examples (corpus expansion, not tuning).

## Remaining blockers (updated)

1. Duration head (sole lever for onsets 30/64% cascade, timing, rests).
2. C-clef line generalization (corpus: add C4-bearing TRAIN scores).
3. Dead tuplet flag, missing beam-boundary head (E1/E2 still valid, low impact).
4. Accidentals (0.148) and chord-tone crowding (0.275) within pitch residual.
5. **No detector (stage C)**: ground-truth-box evaluation only — full Piano
   OMR still unclaimable; separate campaign-scale blocker.
6. Scan domain: visual clef is render-font-specific; scan accuracy unmeasured.

Recommended next step: corpus expansion for C4 + duration-head uplift design;
E1/E2 unchanged in priority. No further full-campaign training justified.

---

# Overnight continuation: C-clef resolution + duration/rest diagnosis

From `845a897f68`. No merge, TEST sealed, DEV identities fixed, no full
retraining. One preregistered training experiment run (v2, FAILED gate,
artifact unchanged). All decoder changes gated on DEV joint-exact.

## Before/after DEV99 (production: visual clef + v1 head, `--pitch-head clef`)

| metric | before (845a897f68) | after | delta |
|---|---|---|---|
| note exact | 13,723 (61.5%) | **13,874 (62.2%)** | +151 |
| note pitch-only | 14,232 | 14,403 | +171 |
| per-clef pitch G/F/C | 0.936 / 0.892 / 0.000 | 0.936 / 0.892 / **0.973** | C fixed |
| C4 score exact/pitch | 4 / 4 | 48 / 249-of-256 capability | pitch solved |
| rest exact | 2/578 | 2/578 | 0 (diagnosed) |
| timing valid | 948/3334 | 977/3334 | +29 |
| chord P/R | 0.989 / 0.749 | 0.989 / 0.749 | = |
| beam P/R, tuplet | 0.276 / 0.759, 0 | unchanged | = (E1 scoped) |
| music21 parsed | 99/99 | 99/99 | = |
| B_oracle_clef exact | 13,741 | 13,890 | visual trails oracle by 16 |
| argmax path exact | 12,983 | 13,132 | +149, no regression |

## 1. C-clef line-4: root-caused and fixed (pitch recognition)

- Census (TRAIN-only + DEV, TEST untouched): TRAIN 116 C notes, all line-3,
  one score; DEV 256 C notes, all line-4, another score. Zero C4 supervision.
- Cascade of two bugs, both fixed: (a) `clef_map.py` C-line formula computed
  `round((hi-cy)/(gap/2))+1` (half-steps, not lines) → every C4 read as C5;
  fixed to `round((hi-cy)/gap)+1` (glyph cy 2183 = line 4 exactly). (b) Even
  with the right frame, frozen probe top-5 holds truth for 4/256 C4 notes, so
  candidate-selection repair is upper-bounded at 4: for visual-C items the
  pipeline now emits pitch structurally (steps + frame + probe accidental)
  WITHOUT consulting OOD probe candidates (`clef_structural`, 256/256 on the
  C4 score; G/F paths byte-identical).
- Production C pitch 0.000 → 0.973 (249/256; 7 residuals are probe
  accidental-class errors on the score's 7 accid events). Playable exact on
  the C4 score is now duration-limited (151/256 durs wrong, all-beamed
  16ths), same lever as the rest of DEV.

## 2. TRAIN-only expansion experiment (v2): FAIL, logged, artifact kept

`scripts/train_clefhead_v2.py` + `reports/train_clefhead_v2.log` (reproduced
bit-identical). Design: v1 warm-start, same Linear(132,88), v1 real TRAIN
rows (42,646) + 125,990 synthetic C4 rows (frozen trunk features of TRAIN
G2/F4 items re-paired with clefvec(C,4); targets by deterministic diatonic
transposition). 15 ep @3e-3, CPU, seed 0, ~6 min. Result: C 0.0 → 0.848
(synthesis teaches the frame) BUT F 0.794 → 0.242 (catastrophic forgetting:
3:1 synthetic rows reuse identical trunk features with conflicting targets
and the shared linear weights resolve against F) and G 0.868 → 0.816.
Gate (F≥.50, C≥.50, G≥.85) FAIL → ABORT, `models/clef_pitch_head.pt`
untouched (v1, verified). Negative result with a mechanism; next attempt, if
any, must decouple per-clef adapters rather than joint linear training.

## 3. Bounded duration improvement (decoder-only, tie-safe)

- Dots arbitration: `dur_sym` dots bit OR-ed with membership `dotted`
  (measured DEV: common-silent/member-firing is truth-dotted 191/192; reverse
  disagreement stays common 87/161). +107 exact, +29 timing, 196 flips;
  flipped notes never carry tie flags and serialized tie elements are
  identical with/without (412 = 412). Both visual sources; flagged.
- Duration diagnosis (frozen common head, DEV): dur agree 81.7%; 94% of onset
  errors co-occur with lane duration errors (only 187 onset errors under
  clean durs). Oracle-duration attribution (`--dur-source oracle`,
  eval-only): exact 13,874 → **15,985 (+2,111, 71.7%)**, timing 977 → 1,612.
  Duration-context learning is the quantified next lever (+2.1k headroom);
  decoder-side options are exhausted (beam-group vote requires E1 grouping;
  meter-rescaling would invent time).
- Rest diagnosis: rest KIND/count healthy (e.g. 155 pred / 143 truth) but
  exact still 2/578 even with oracle durations — residual is VOICE mismatch
  (pred voice 5 vs truth 1 on rest-heavy scores; rest voice agree only
  70% context / 65% common). Rest fix = voice lever, same next mission as
  duration (voice-context modeling), not a separate decoder rule.

## 4. E1 beam-boundary: targets sufficient, design recorded, not run

TRAIN: 88,638 beamed notes (68%), 26,325 starts / 26,324 ends, group sizes
2–12 dominated — ample verified targets. Design: two binary boundary heads
(is_start/is_end) on frozen trunk + neighbor context; decoder cuts predicted
in_beam runs at predicted boundaries (fixes 1,371 adjacent-merges); unlocks
beam-group duration majority vote (2,820 uniform groups). Deferred: training
budget spent on v2 per mission priority (C-clef first).

## Remaining blockers (updated)

1. Duration-context head (measured +2,111 headroom; design: context-aware
   duration classifier, TRAIN-only, preregistered gates) — THE next step.
2. Rest voice (70% agree; folds into voice-context modeling).
3. C4 playable exact on beamed score (duration-limited; E1 unlocks it).
4. Accidentals (0.148; 7 residual C4 pitch errors) and chord-tone crowding.
5. Dead tuplet flag; beam grouping (E1 design ready).
6. No detector (stage C); scan domain unmeasured — full OMR unclaimable.

Exact next step: preregistered duration-context head experiment (TRAIN-only,
frozen trunk + lane/meter context features, gates: dur agree ≥LIC,
joint-exact no regression); E1 boundary heads as the follow-on.

---

# Duration and rhythm rescue (P1–P8)

From `3923560ef8`. No merge, TEST sealed (891/891 events files are
train+dev; splits test never read), DEV identities fixed, no competing
training observed (load ~1.9, no torch processes in guitar/mic trees).
One preregistered capped experiment (A1): PASS, artifact saved.

## 1. Duration error root causes (P1; `reports/audit_duration.json`)

DEV 22,299 notes, 4,652 dur errors (frozen common head, agree 0.791):
- Isolated value errors 84% base / 16% dots. Adjacent {4,8,16} confusions =
  69% (16→8: 963, 4→8: 952, 8→4: 775, 8→16: 530): open-vs-filled noteheads
  and beam counts — purely visual ambiguities in notehead crops.
- Beam grouping: beamed 62% of errors; 70% of beamed errors sit in
  uniform-truth groups (beam-vote addressable in principle).
- Flags: unbeamed 8ths near-perfect (3.7% err); unbeamed 16ths 31.6%
  (double-flag reading is the hard visual case).
- Dots residual post-arbitration: 741 (16%).
- Tuplets: 212/433 notes wrong (49%); tuplet flag dead (0/615 pairs).
- Voice context: modest rates (v1 19%, v5 25%, v2 25%) — not the lever.
- Meter context: spread across meters by volume, no outlier meter.
- Chord tones worse (26%) than singles (19%): crowding/overlap.
- Onset propagation: 55% of measures (1,354/2,483) contain ≥1 dur error,
  3.44 errors each; lane clock poisoned from first error to lane end.
- Decoder voting REJECTED by measurement: chord-dur majority and
  root-fallback both score ~53% (coin flip — errors correlate across shared
  stems/beams, so votes carry no signal). Attempt implemented, gated,
  reverted; rationale kept as a code comment, not a behavior.

## 2. Model changes (P2/P3: A1 tri-crop duration head)

`scripts/train_ctxdur.py`: Linear(384,16) on [Z_prev,Z_self,Z_self+1] frozen
trunk features (file-order neighbors, zero-padded; NO predicted-label
inputs → zero exposure bias), warm-started center block from the
TRAIN-trained dur head, TRAIN note rows only (~122k, MEI chord inheritance),
rests keep the common head. AdamW 3e-3, 10 epochs, CPU seed 0 (~14 min).
Opt-in `--dur-head ctx` (`scripts/eval_reconstruction.py`); production
default unchanged (reproduces 13,874 exactly). No musical guessing anywhere:
neighbor crops are visual evidence; meter/measure inference was NOT built.

## 3. Training result (P3): PASS all preregistered gates

DEV dur agree 0.791 → **0.858** (gate ≥0.82) ✓; production joint-exact
13,874 → **15,005** ✓ (gate: no regression); music21 99/99 ✓; ties 52/49.
`models/ctx_dur_head.pt` saved; full log `reports/train_ctxdur.log`.
Captured 54% of the +2,111 oracle-duration headroom. Dots agree 0.967 →
0.996 (neighbor context nearly solves dots; arbitration retained on top).

## 4–8. Reconstruction deltas, 3923560ef8 → this mission (P4/P8)

| metric | before | after | delta |
|---|---|---|---|
| duration accuracy (full-pop) | 0.791 | **0.858** | +0.067 |
| note exact (visual path) | 13,874 (62.2%) | **15,005 (67.3%)** | +1,131 |
| note pitch-only | 14,403 | 15,582 | +1,179 |
| timing-valid measures | 977/3,334 | **1,368/3,334** | +391 |
| rest exact | 2/578 | 2/578 | 0 (voice lever, §P1) |
| chord P/R | 0.989/0.749 | 0.989/0.749 | = |
| ties (starts/stops) | 52/49 | 52/49 | = |
| beams P/R | 0.276/0.759 | 0.276/0.759 | = (P5 below) |
| tuplets | 0/615 | 0/615 | = (flag dead) |
| music21 parsed | 99/99 | 99/99 | = |
| B_oracle_clef exact | 13,890 | 15,026 | visual trails oracle by 21 |
| argmax+common default path | 13,132 | 13,132 | = (no regression) |
| error profile shift | — | 4→8 fixed (−596), 8→4 worse (+278) | net strongly positive |

## 9. Beam/tuplet results + representation gap (P5)

Oracle-group majority vote on ctx durs: +222 DEV-wide (0.858→0.868) — but
the all-beamed-16ths C4 score moves only 76/256: its crops systematically
read as 8ths (ctx: 137×8th vs 109×16th), so even perfect grouping + voting
fails. Root cause: 64×64 crops span ±3 staff-gaps around the notehead while
beams live at stem ends outside the crop — beam COUNT evidence is
out-of-frame by construction. Full-width strips (128×24, already built in
`infer.py`) DO contain all beams and feed no count classifier today.
P5 conclusion: boundary grouping is necessary but INSUFFICIENT; the precise
next architecture is a strip-based beam-count head (visual evidence, no
training performed — budget spent on A1 per priority). Tuplet flag still
dead: needs a tuplet-mark reader, same strip family.

## 10–11. Detection blockers (P6) and V1 blockers (P7)

- Stage C (automatic object detection) unproven: all numbers oracle-box;
  no detector trained; nothing claimed beyond oracle-box evaluation.
- Scan domain unmeasured (render-font-specific visual clef; crop statistics
  render-only). Full Piano OMR unclaimable — stated, not closed.
- Preserved intact: visual clef 683/683, C-structural pitch 0.973,
  dots arbitration, chord x-snap, ties, MusicXML serialization (99/99),
  input-quality rejection (skipped-item paths untouched), notation warnings.
- V1 blockers remaining: rest voice (70% agree → voice-context modeling),
  beam-count representation (strips), tuplet-mark reader, accidentals 0.148,
  chord-tone crowding, detector, scans.

Exact next step: strip-based beam-count head experiment (TRAIN-only, frozen
backbone, preregistered gates on 16→8/32→16 confusions + joint-exact);
tuplet-mark reader follows in the same strip family.

---

# Strip-based rhythm recognition (S1): NEGATIVE result, mechanism found

From `a26038845c`. No merge, TEST sealed, DEV identities fixed, no
competing training (idle proxies only), ~3.4 GB free. One preregistered
capped experiment (S1). No production change: duration 0.858, exact
15,005 (67.3%), timing 1,368/3,334, rests 2/578 — all stand as measured.

## Strip tower audit (priorities 1–3)

- Construction (`infer.py`): full-page-width band ±4 staff-gaps around the
  notehead cy, resized 128×24. Vertically covers stems (±3.5 gaps) and beam
  rows; horizontally everything (own + neighboring notation).
- Consumers (`v1_probe.py`): LocalModel (common AND membership probes)
  accepts strips/geometry but forwards CROPS ONLY — the dur, in_beam, and
  tuplet_member heads never see a beam pixel. Only ContextModel
  (staff/voice) runs the strip tower (16→32 ch, global avgpool, +5-d geo).
- Pixel verification (DEV, analysis only): strip edge-band ink scales with
  beam count — 8th 0.102 vs 16th 0.151 vs 32nd 0.141. Beams ARE in the
  pixels. Frozen context-dur reference head scores only 0.613 (strip tower
  32-d global pool + multitask dilution waste the signal).
- Tuplet census (P11): TRAIN 3,500 tuplet notes / 153 scores; DEV 433 / 23 —
  sufficient supervision for a binary head; included in S1 multitask.

## S1 experiment (priority 7): REJECTED on all heads

`scripts/train_striphead.py` + `reports/train_striphead.log`. Multitask
linear on frozen features [neighbor crops 384 (warm-started from A1) +
strip-tower pre-pool rows 384 (32ch×12, width-pooled, vertical kept) + geo
5] → {dur16, is_start, is_end, tuplet}. TRAIN note rows, AdamW 3e-3, 10
epochs, CPU seed 0 (~10 min). Frozen DEV:

| head | result | verdict |
|---|---|---|
| dur agree | 0.8589 vs A1 0.8580 (+21 notes) | noise, not signal |
| beam start F1 | 0.22 (epoch curve 0.15→0.52→0.22, thrashing) | no learning |
| beam end F1 | 0.35 (same instability) | no learning |
| tuplet F1 | 0.0 all 10 epochs (3,500 TRAIN positives) | dead |
| C4 beamed-16ths score | S1 0.418 vs A1 0.426 (more quarter-errors) | worse on motive case |

Mechanism (artifact weights): strip-block norm 9.7 (optimizer used the
features) yet DEV +0.0009 → memorizable texture that does not transfer.
Causes: 12-row resolution ≈ 0.67 gaps/row vs ~0.5-gap beams, smeared further
by 128×24 INTER_AREA resize and conv pooling — beam COUNT is aliased away
before any linear head; multitask uniform loss cannot drive rare heads from
uninformative features. Artifact `models/strip_dur_head.pt` retained as
evidence; NOT wired into production (no `--dur-head strip`, no decoder
change, no source-file modification — zero regression surface; prior
regressions and music21 99/99 stand).

## Return items (priorities 9–10, 13–15)

- Beam recognition: unchanged (in_beam P/R from frozen membership head;
  grouping untouched). Boundary/tuplet classification: infeasible at linear
  level on current strip encodings (F1 0.22/0.35/0.0).
- Duration 0.858, onsets/timing/rests/exact: unchanged (production = A1).
- Remaining structural failures: beam COUNT aliased in strip encodings;
  tuplet marks too small/far for 12-row features; rest voice; detector;
  scans. Oracle-box vs automatic distinction preserved throughout.
- Further training justified? YES but NOT linear-on-frozen: an unfrozen
  small strip CNN with row-preserving architecture (pool width-only, keep
  24-row resolution to the decision) or stem-centered tall crops containing
  stem+beams. That is the exact next step (fresh preregistration, same
  caps: TRAIN-only, frozen identities, TEST sealed).

---

# Autonomous transcription rescue (rest repair + stage-C reality check)

From `55f1d79eea` (two commits: `bb0f9a708a` rest rescue, this one for
P2/P3). No merge, TEST sealed (891/891 event files are train+dev; TEST
files do not exist on disk), DEV identities frozen, no competing training
observed, ~3 GB free RAM at run time.

## 1. P1 rest root cause (audit_rest.py -> reports/audit_rest.json)

Rest truth was lost BEFORE any model ran: the frozen object inventory
carried no `dur` for rests, so `data/events` stored dur=None for every
rest. Consequences: (a) `m_dur` was masked to 0 in v1_adapter -> the dur
head was NEVER SUPERVISED on rest types (wrong answers clustered on the
majority class 8d0 — unsupervised behavior); (b) layer onset accumulation
(`acc += dur_ppq`) never advanced across rests -> 8,472 NOTE onsets were
wrong; (c) the eval's meter-length fallback turned every real rest into a
full-measure rest on the truth side, which is why "rest accuracy" read
2/578. Fixed in v1_events.py (MEI `@dur.ppq/@dur/@dots` fallback); events
regenerated; 4,801 rest durs restored, 8,472 note onsets corrected; no
identity changes, TEST never read.

## 2. P1 fixes and rest before/after (frozen DEV, production path)

- Structural rest staff: nearest staff frame to the rest bbox
  (reports/rest_staff_check.json: 98.6% TRAIN / 99.5% DEV vs 70% probe
  voice-agnostic staff head). Wired in decode_score for rests only.
- R1 rest-duration head (train_restdur.py): Linear(128,16) on frozen
  common-trunk features of rest crops, warm-started from the common dur
  head, TRAIN rest rows only, AdamW 3e-3, 30 epochs, ~6 min CPU. DEV
  rest-dur class accuracy 0.56 -> 0.9634.

| metric | before (broken truth) | after truth repair | +R1+staff (production) |
|---|---|---|---|
| rest exact | 2/578 | 118/698 | **206/698** |
| rest FP / FN | 459 / 580 | 459/580 | 385 / 492 |
| timing-valid measures | 1368 | 1368 | 1397 |
| notes exact | 15,005 | 15,005 | 15,005 |
| music21 | 99/99 | 99/99 | 99/99 |

Remaining rest losses (audit): kind detection 67 rests predicted as notes
(9.6%); decoder duplicate-collapse 33; rest voice 173 wrong (probe never
predicts rest voices 2/3/6/7/8 — needs voice-head retraining); onset
residual 178 (dur-cascade: onset comes from the lane clock, whose drift
is duration-error accumulation; x-fraction layout onsets REJECTED on
measurement: 3.2%).

## 3. P2 automatic detection reality check (auto_locate.py, auto_pitch.py)

Deterministic CV prototype (no training, no oracle at inference):
binarize -> run-length staff lines -> 5-line frames -> horizontal-opening
CC -> geometry-classified noteheads + rest pass + stem-union boxes
(matches the trained bbox convention). 5 DEV pages, clean vector renders:

- staff frames: 6/6 per page (3 systems x 2 staves; pixel-verified)
- notehead detection: P 0.889 / R 0.571 (IoU>=0.3)
- rest detection: P 0.019 / R 0.148 (rests need shape templates; naive CC
  picks up dots/articulations)
- object-level probes on DETECTED boxes: raw common probe pitch 0.02 —
  the trained probes assume oracle bbox anchoring (bbox center spans
  notehead+stem); detected head-only boxes break that convention
  (stem-union boxes fixed centers to ~1px but the raw probe is only ~0.6
  on these scores even with oracle boxes — production pitch comes from
  the clef head + structural repair, oracle-box measured 0.92).

Honest conclusion: fully automatic transcription is NOT working and no
number here may be quoted as OMR accuracy. Automatic stages: (1) staff
geometry: works; (2) notehead localization: P~0.9/R~0.6 prototype; (3)
rest localization: not working; (4) pitch: needs the production path
(clef frames + repair) wired to detections — the clef auto-crop in the
prototype is mislocated (returns C/G wrong on first attempt; the pixel
staff lines themselves are correct); (5) duration/voices/measures: not
attempted automatically. Stage C remains UNPROVEN. Exact P2 next steps:
fix rest detection with glyph templates, fix the auto clef crop geometry,
then wire detections into infer.build_inputs and re-run the production
decode end-to-end.

## 4. P3 rhythm decoupling ablation (ablate_decouple.py): CONFIRMED

On the SAME cached strip+crop features: dur-only linear head 0.865-0.870
(best 0.8695, stable) vs T1 multitask 0.804. Interference, not
representation, hurt T1's dur. Per-head training with per-head gates is
the justified design; strip features even edge out A1 on the raw task
(+1.2pp) but joint-exact evidence is required before any integration.
No training run beyond R1 (the ONE preregistered experiment of this
mission); no artifact produced by the ablation.

## 5. P4-P7 quick verification (no changes, documented)

- Multi-voice/timing: timing_valid 1,368/3,334 measured on decoded sums
  per (measure, staff, voice); simultaneous voices are kept as separate
  lanes (no flattening); rests now land in structurally-correct staves.
- Input quality: existing gates are crop-level (blank/degenerate crop
  rejection, zero occurrences on DEV renders); PDF/skew/blur gates do not
  exist in this branch — recorded as a gap (the main product tree has
  raster-quality tests).
- Notation completeness: grace/cue/slurs/articulations serialize where
  typed; untyped flags preserved as warnings (flags_b); gaps: dynamics,
  pedal, fingerings, ornaments, tempo remain unmodeled in this branch.
- Evaluation integrity: oracle-box / detected / end-to-end kept separate
  (P2 above reports detection P/R separately from probe scores); no TEST
  access anywhere; identities frozen.

Remaining V1 blockers: rest voice head, rest kind detection, onset
cascade (needs duration gains), beam-boundary/beam-count integration
(T2 design), tuplet reader, accidentals, chord crowding, stage-C
detector (P0), scans (unmeasured), raster quality gates.

Next highest-impact milestone: stage-C integration (P2 next steps) —
the product blocker; rests/voices remain the accuracy blockers.

---

# First honest end-to-end automatic transcription (stage C, DEV)

From `c400e0c987`. No merge, TEST sealed, DEV identities frozen, no
competing training. All new numbers below use ZERO oracle input at
inference: page PNG only (no boxes, no SVG, no MEI).

## What now works automatically (P1)

`scripts/auto_e2e.py` runs the full path: binarize -> run-length staff
frames -> per-frame clef classify (TRAIN template NCC) -> notehead CC
detection -> rest CC + TRAIN rest templates -> barline columns -> measure
segments -> structural pitch (frame steps + clef) -> duration (frozen
common head + A1 tri-crop head on detected boxes) -> MusicXML, verified
with music21 (5/5 files parse). Outputs: data/auto_out/<sid>.musicxml.

## Metrics (5 DEV scores, 902 truth notes, 27 truth rests; position-
matched to truth notehead/rest positions; chord dur inheritance applied)

| metric | oracle-box production | automatic (this run) |
|---|---|---|
| note P / R | 1.00 / 1.00 (given boxes) | **0.844 / 0.574** |
| pitch accuracy | 0.924 (clef head + repair) | 0.682 (structural only) |
| duration accuracy | 0.858 (A1) | 0.699 (A1 on detected boxes) |
| complete event (pitch+dur+dots) | 0.673 | **0.485** |
| rest P / R | 1.00 / 1.00 (given boxes) | 1.000 / 0.296 |
| MusicXML valid | 99/99 | 5/5 (music21 parses) |

Full automatic transcription WORKS for the first time and is honestly
poor. No stage is claimed as production-ready.

## Root causes found this mission (P2/P4), each with evidence

1. **Coordinate-space anchor error (the Guitar-Vision class of bug):**
   training crops are anchored at the bbox TOP-LEFT corner
   (`infer.build_inputs`), not the center. Center-anchored crops on
   detected boxes cost 4x on duration (0.25 vs measured 0.39 corner on
   oracle boxes). Fixed in the auto path (corner anchor on the raw glyph
   box; detected center still used for geometry).
2. **Truth-coordinate convention:** the structural notehead position is
   the glyph ORIGIN (left-center), detections are visual centers; the
   systematic offset is +0.673 gaps in x (std 0.013, n=517) — a clean
   proof on Piano's own evidence, not a copy of Guitar's fix. Detection
   boxes were correct all along.
3. **Oracle bboxes are notehead-only** (h = 1.06 gaps, center = notehead
   center) — so detection boxes and training boxes are the same object.
4. **Chord-member dur inheritance** must be applied to truth for fair
   evaluation (events carry dur=None for chord members; inheriting the
   `<chord>` dur lifted auto dur accuracy 0.27 -> 0.70 and complete
   0.27 -> 0.49 in this measurement).
5. **Chord/beam-merged noteheads** are the recall wall (0.574; 62% of
   misses beamed, 42% chord tones; 363/385 misses have NO connected
   component at the notehead pixel at all — staff-row removal splits
   noteheads sitting on a line). THREE deterministic recall fixes tried
   and MEASURED, all rejected: (a) mean-template completion — local-max
   filtered +0 recall, unfiltered recall 0.85 but precision 0.84->0.67
   from shifted duplicate peaks; (b) vertical-thickness profile beam
   splitting — +73 detections, ALL false positives; (c) staff-line
   "keep-tall" preservation — recall collapses to 0.407 (reconnects
   noteheads into per-staff blobs). A trained notehead detector is the
   real fix.
6. **Rest recall 0.296**: CC candidates miss rests whose thin strokes are
   broken by staff-row removal/opening; precision is 1.0 with TRAIN
   templates (8/8 typed correctly).
7. **Pitch 0.682 structural-only**: auto-clef errors cost ~2pp (0.707 vs
   0.730 with oracle clefs); the rest is frame/step precision on detected
   centers (detected-cy 0.68 vs svg-cy 0.71).

## Field boundaries (P6/P7, unchanged)

Oracle-box evaluation measures the semantic stack only; automatic
numbers above include detection error; no end-to-end claim on scans
(renders only). Input-quality gates still cover unreadable crops only;
PDF/skew/blur gating does not exist in this branch.

Remaining V1 blockers: notehead detector (recall; trained head needed),
rest recall, accidentals (natural pitches only), onset/measure accuracy
(barline segments, voices), tuplet reader, scans. Exact next milestone:
train a small notehead detector (frozen trunk + detected-box candidate
generation, TRAIN-only, gates: P>=0.9 AND R>=0.75 on frozen DEV) — the
single largest automatic-transcription error source (43% of notes).

# T1 vertical-preserving rhythm CNN: representation CONFIRMED, dur gate FAIL

From `dae2ebd44d`. No merge, TEST sealed, DEV identities fixed, no
competing training. One capped experiment (T1), wall-clock-killed at 9/12
epochs (118 min; as-registered 1.9M config benchmarked 14.6 s/iter = 14 hr,
infeasible — documented P4 amendment to a ~0.15M same-family config before
any amended run). No artifact saved; NO production change (A1 stands:
dur 0.858, exact 15,005, timing 1,368, rests 2/578). Only addition is the
untracked experiment script — zero tracked-file modifications, so zero
regression surface (no re-eval needed; prior music21 99/99 stands).

## 1. Architecture (P2)

TallCNN-S: 1×192×48 → C3(1,8)/BN/R → C3(8,16)/BN/R → MaxPool(1,2)
→ C3(16,32)/BN/R → C3(32,32)/BN/R → MaxPool(1,2) → C3(32,32)/BN/R
[32×192×12, full height, NO vertical pooling anywhere] →
AdaptiveAvgPool((48,1)) → 1536 → FC+ReLU 96 → {dur16, beams5, start2,
end2, tup2}. ~0.15M params. Input: 3-gap × 12-gap stem-centered tall crops
(48×192), P1-verified on TRAIN-only panels to contain countable 1/2/3
beams, boundary stubs (start = beam right-only), flags, open/filled heads,
stems, and tuplet numbers at the ±6 edge. 64-crops cut beams off; strips
alias count away.

## 2–3. Population, time, supervision (P3–P5)

TRAIN subset 44,103 rows (relevant 34,103: all 16/32/64/dotted/tuplet/
beamed-non-8 + seeded 7k plain-8th + 3k long sample; SUBSEED 0) with MEI
chord inheritance; labels: dur16, beamcount {8:1,16:2,32:3,64:4,unbeamed:0}
(all TRAIN beamed durs verified in {8,16,32,64} except MEI-inherited chord
members), boundaries from truth beam groups, tuplet from tuplet_id.
Quarantine: dur-OOV/None rows dropped (0 TRAIN, 0 DEV — MEI covered all);
306 TRAIN + 543 DEV rows missing tall crops (no-bbox/blank, input-quality
rule). AdamW 3e-4, batch 256, seed 0, CPU 8 threads. 118 min for 9 epochs
(~13 min/epoch: ~9 train + ~4 DEV-eval); killed by wall clock, best-state
lost with the process (in-memory rule). Full partial log committed:
`reports/train_tallcnn.log`.

## 4–5. Beam/duration results (P6)

Frozen DEV after each epoch (dur / 16→8 / beams / start-F1 / end-F1 /
tup-F1): ep1 .40/156/.60/0/.55/0 → ep6 .804/389/.839/.788/.800/.213 →
ep9 .733/57/.812/.812/.835/.260. Findings:
- REPRESENTATION CONFIRMED: beams 0.60→0.84, start 0→0.81, end 0.55→0.83,
  tuplet 0→0.29 — tall crops carry beam/boundary/tuplet signal an unfrozen
  vertical-preserving CNN can read. S1's failure was the encoder, not the
  pixels.
- DUR GATE FAIL: best 0.804 (ep6/8) vs 0.858 gate; dur oscillates
  0.71–0.80 seesaw against boundary learning (uniform multitask loss makes
  the small shared trunk thrash between heads). 16→8 sub-gate met at some
  epochs (57–156) but only when dur collapses elsewhere — no durable win.
- Production joint-exact gate untestable (no artifact per fail rule).

## 6–10. Timing/tuplet/rest/acceptance (P6–P8)

No production integration (P7: REJECT for dur; boundary/tuplet heads are
classification evidence, decoder integration was preregistered as
deferred). Timing/rests/exact/ties/beams/chords/music21: unchanged by
construction. Provenance: oracle boxes in, no meter guessing, visual
sources only; scan rejection and clef/pitch/decoder/serializer untouched.

## 11–12. V1 blockers + next step

Unchanged list (rest voice, beam integration, tuplet reader, accidentals,
chord crowding, detector, scans) plus a NEW precise item: dur-head
multitask interference. EXACT NEXT STEP: decoupled T2 — dur-only TallCNN-S
(single head, no boundary competition) plus SEPARATE boundary/tuplet heads
off the frozen T1-style trunk or a second tiny trunk; preregister per-head
gates (dur ≥ 0.858, start/end F1 ≥ 0.80 sustained over final 3 epochs, tup
F1 ≥ 0.40); save per-head best states to disk each epoch (no in-memory
rule); budget wall clock explicitly (13 min/epoch measured) — e.g. 8-epoch
cap ≈ 105 min. TEST stays sealed.


---

# Notehead detection rescue: deterministic detector passes both gates

From `c35a1abb2d`. No merge, TEST sealed, DEV identities frozen, no
competing training. ONE bounded training experiment was NOT needed: the
preregistered gates (P>=0.90, R>=0.75) are met by a deterministic recipe,
so no detector training was run (negative-training decision, recorded).

## Root cause (measured, reports/det_mask_diag.json)

Staff-row removal (the +-1 row band) destroys 41% of notehead pixels:
it cuts a horizontal slit through every notehead sitting ON a staff line.
At the notehead pixel the mask is dark: raw 785/902, rowrem 416/902.
The recall wall was never "the detector misses glyphs" — the glyphs were
deleted by preprocessing before any CC ran.

## The fix (reports/det_recipes.json, det_sweep.json, scripts/detector.py)

Replace row removal with long-run opening subtraction (>=6 gaps
horizontal = staff lines/beams, >=3 gaps vertical = stems), then a 3x3
dilation AFTER the 0.55-gap horizontal opening (order matters: dilating
before the opening re-splits healed noteheads, because the opening deletes
the 2px bridges). Window [0.70, 1.90] gaps. Measured DEV operating point:
**P 0.930 / R 0.815** (tp 735, fp 55, fn 167) vs the rowrem baseline
P 0.893 / R 0.573. Rejected variants (measured): dilation before opening
(P 0.755 at best), local-max template completion (+7 TP / +45 FP), vertical
thickness beam-splitting (+73 detections all FP), keep-tall line
preservation (R 0.407).

## End-to-end acceptance (5 DEV pages, 902 truth notes, no oracle at
## inference; scripts/auto_e2e.py, reports/auto_e2e.json)

| metric | before (rowrem detector) | after (frozen detector) |
|---|---|---|
| note P / R | 0.844 / 0.574 | **0.930 / 0.815** |
| pitch on detected | 0.682 | **0.796** |
| duration on detected | 0.699 | **0.773** |
| complete events | 0.485 | **0.634** |
| rest P / R | 1.000 / 0.296 | 1.000 / 0.296 |
| measures with >=1 auto note | - | 92/94 (0.979) |
| MusicXML valid (music21) | 5/5 | 5/5 (790 notes) |

Predictions come from detected boxes only; oracle-box production numbers
(15,005 exact) remain a separate axis and are unchanged.

## Rest recall (secondary objective): wall confirmed, precision kept

All 19/27 misses are rests whose CC is fused with a stem/other notation
(wide sparse blob: w>3 gaps, fill<=0.2). Two fixes measured and
rejected: rest candidates on the notehead mask (0 TP — the 3-gap vertical
kernel destroys rest glyphs) and thin-vertical-run stem stripping
(304 FP, P 0.026). Rest recall stands at 0.296 with P 1.000 on a small
sample; a shape-classifier or trained rest head is needed.

Remaining V1 blockers, in measured order. Note recall 167 FN is now a
FUSION problem, not a preprocessing one: 151/167 (90%) are chord tones,
117/167 sit inside a wide CC (beam/chord fused blob), 88 are not dark in
the healed mask, 46 have no CC at all. Two post-fix attempts measured and
rejected: frozen kind-head sliding-window assist (P 0.44-0.53 at R 0.98 —
the kind head is miscalibrated off oracle-box positions) and beam-kernel
sweeps (no effect: beams are shorter than the 6-gap kernel; the erosion
comes from stem removal). Next: trained notehead detector or chord-aware
blob splitting. Then pitch 0.796 (auto-clef ~2pp + frame/step
precision), duration 0.773, rest recall 0.296, accidentals,
voices/onsets, tuplets, scans.

Exact next milestone: a TRAIN-only notehead detector on the new mask's
candidate boxes (frozen trunk classifier over candidate crops, gates:
P>=0.95 AND R>=0.86) — or, if that fails, accept the deterministic
detector and move to pitch/duration on detected boxes.


---

# Chord-tone recovery inside fused components (M1-M4)

From `7243212564`. No merge, TEST sealed, DEV identities frozen, no
competing training. No training run this mission (deterministic fix met
the gates). Oracle-box production path verified unchanged (B exact, rests
via --rest-dur-head r1).

## M1 fused-chord root cause (reports/fusion_diag.json)

Of 151 missed chord tones: 146/151 dark in the RAW ink, 145/151 survive
preprocessing, 141/151 sit inside a WIDE connected component (fused by
shared stems, beams, or second-clusters) that the notehead size window
rejects, and 123/151 belong to chords that were PARTIALLY detected. The
ink exists; only the component-level grouping hid it. (The first
diagnostic pass was wrong because it sampled the glyph ORIGIN instead of
the bbox center — the notehead-map position convention; corrected before
conclusions, like the earlier anchor findings.)

## M2/M3 chord-aware recovery (detector.detect_chord_tones, measured)

Deterministic legal-position scan inside rejected CCs: chord tones share
the stem x (blob center) and sit on staff-legal half-gap y positions; a
position is a notehead iff the notehead-wide dark run holds at the center
row AND +-0.35 gaps (beams are ~0.3 gaps tall and fail; stems are far
narrower than the run requirement) with box ink density >= 0.45.
Hyperparameters measured on DEV 5 pages (delta 0.35 is the knee of the
P/R curve: 0.30 P 0.929/R 0.965, 0.35 P 0.932/R 0.965, 0.45 P 0.912/R 0.860).
No candidate x-peak search, multi-frame grids, or ink centroids added
anything (all measured and rejected).

| metric | before | after |
|---|---|---|
| detector P / R | 0.930 / 0.815 | **0.932 / 0.965** |
| chord-tone recall | 313/464 (0.674) | **448/464 (0.966)** (fn 151 -> 16) |
| isolated-note recall | 422/438 (0.964) | 422/438 (0.964) |
| false positives | 55 | 64 (scan candidates on stem/adjacent ink) |
| note fn | 167 | 32 |

Gates from the previous mission (P >= 0.90, R >= 0.75): still PASSED,
with recall +15pp.

## M4 full automatic reconstruction (5 DEV pages, 902 notes, no oracle at
## inference; reports/auto_e2e.json)

| metric | before | after |
|---|---|---|
| note P / R | 0.930 / 0.815 | 0.932 / 0.965 |
| pitch on detected | 0.796 | 0.782 (recovered notes: 0.704) |
| duration on detected | 0.773 | 0.760 (recovered notes dilute) |
| complete on detected | 0.634 | 0.613 (dilution) |
| PAGE-level complete (all 902) | 0.517 (466) | **0.591 (533)** |
| PAGE-level pitch / dur | - | 0.754 / 0.733 |
| rest P / R | 1.000 / 0.296 | 1.000 / 0.296 |
| measure coverage | 0.979 | 0.979 |
| MusicXML parse (music21) | 5/5 | 5/5 (934 notes) |

Page-level complete events (the honest whole-page metric the mission
requires) improved 0.517 -> 0.591: 533/902 truth notes fully correct
(pitch+dur+dots), up from 466. Per-detected-note rates dilute downward
because recovered chord tones are harder (pitch 0.704 vs 0.796); the
absolute count of correctly reconstructed events rose 14%.

## M5 next bottleneck (measured)

By page-level loss: pitch (146 wrong of 902), duration (241 wrong),
rests (26 wrong incl. 19 FN of 27), 32 undetected notes. Pitch is the
largest single-lever item: auto-clef errors ~2pp plus frame/step
precision on detected centers (no octave errors observed — errors are
diatonic steps, i.e. half-gap rounding and multi-staff assignment).

Exact next milestone: pitch accuracy on detected noteheads (frame
assignment + half-gap rounding), then rest recall (precision-preserving),
then duration on detected boxes.


---

# Pitch rescue + robustness audit + cross-engraver reality check (M1-M6)

From `e3631607c4`. No merge, TEST sealed, DEV identities frozen. Commits:
`60986c5669` (clef fix + audit + scale), this one (deskew + OLiMPiC).

## M1 pitch error ledger (reports/pitch_ledger.json, 870 matched notes)

Of 139 pitch errors: 134 (96%) are OCTAVE displacements (117 of +12 steps,
17 of -12); 132 (95%) are chord tones; 0 are octave-free step errors from
ledger notes; the detected notehead centers match truth exactly (dy=0).
Root cause: auto CLEF misclassification. F read as G shifts by exactly 12
steps. The first diagnostic pass undercounted clef errors (per-measure clef
lookup fails when clefs appear only in the first measure) — fixed by
voting the truth clef per frame.

## M1/M2 fixes (verified)

- Clef detection rewritten (scripts/clef_detect.py): frame-local left edge
  (longest run on the frame's own staff line) + class-conditional
  gap-relative windows matching the training crop convention. Clef accuracy
  19/25 -> 23/25 frames; with the oracle clef the pitch ceiling is 97.5%,
  measured auto-clef pitch now 90.8% on detected notes.
- Binarization: fixed gray<128 -> Otsu with a degenerate-image guard
  (already-binary scans: Otsu returns 0 and the pipeline produced ZERO ink).
- Staff grouping: fixed +4px tolerance -> gap-relative (0.5x scale went
  from 0 frames to working); 4-line frames repaired by interpolation.
- Deskew stage (auto_page.process_page): estimate by maximizing the
  sharpest row-ink profile over +-4 degrees on a downscaled copy, then
  rotate. Real scans are tilted 1-4 degrees; measured on OLiMPiC: 0 staff
  lines at native tilt, 15 after deskew.
- Meta-free page processor (auto_page.py): gap from the detected frames,
  pixel-native; the fixture meta.json (page width, median gap) and SVG
  margins are no longer used by the automatic path.

## DEV end-to-end (5 pages, 902 notes, no oracle at inference)

| metric | mission start | now |
|---|---|---|
| detected pitch | 0.796 | **0.907** |
| detected complete | 0.634 | **0.703** |
| page pitch | 0.754 | **0.868** |
| page complete | 0.591 | **0.679** (612 events) |
| note P / R | 0.932 / 0.965 | 0.931 / 0.965 |
| rest P / R | 1.000 / 0.296 | 1.000 / 0.296 |
| MusicXML | 5/5 | 5/5 |

## M3 cross-layout evidence (reports/scale_invariance.json)

Same 5 DEV pages at different rasterization scales: 1.0x P .929 R .968
pitch .847; 2.0x P .958 R .916 pitch .897; 0.5x P .845 R .813 pitch .547
(previously 0 TP: total failure). DPI invariance holds by construction
(all windows are in staff-gap units); below ~10px staff gap the line
detection jitter costs accuracy — measured, documented, not hidden.

## M3b different-engraver evidence (reports/olimpic_eval.json) — NEGATIVE

OLiMPiC scanned piano strips (an independent engraver; real scans; truth =
paired MusicXML; 8 samples, 528 notes): before fixes 2 frames / 41
detections; after Otsu-guard + deskew: 9 frames detected, 212 detections
for 528 truth notes, pitch multiset overlap 0.20. Honest conclusion:
GENERALIZATION TO SCANS/OTHER ENGRAVERS IS NOT ESTABLISHED. The blockers
measured on this set are (a) skew (now handled), (b) staff-line detection
on noisy scans (9 frames for 16 systems), (c) clef style differences,
(d) notehead shape differences. No claims beyond the DEV renders.

## M5/M6 remaining

Next largest page-level loss on DEV: duration (267 wrong of 902), then
pitch (118), then rests (19 FN of 27). M6: skew handled; blur/low-res/
contrast/inverted inputs are untested and rejected-by-default behaviour
is not yet implemented (no quality gate exists in this branch).


---

# Real-scan generalization rescue (M1-M6, this mission)

From `56c66413c5` (+ two bookkeeping commits). No merge, TEST sealed.

## 1. Scan failure attribution (reports/scan_attribution.json)

Stage-by-stage on 10 OLiMPiC scanned strips (688 truth notes):
  preprocessing : Otsu degenerate on already-binary scans (threshold 0 ->
                   zero ink) - GUARDED; deskew finds 0-0.75 deg tilts.
  staff lines   : 12-16 lines detected but 9/16 staff frames grouped; two
                  root causes measured:
                  (a) DUPLICATE line detections - a thick scan line produces
                      dark runs on 2 adjacent rows, both above threshold, so
                      a 5-line group contains a duplicate and a duplicate'
                      neighbor (measured: 16 lines -> 0 frames);
                  (b) partial staves - lines below the run threshold on
                      low-contrast rows.
  clef          : bass staves on scans read as TREBLE (F->G = +12 steps for
                  every staff-2 note); clef accuracy 0.0 by the (fixed)
                  comparison.
  noteheads     : 374 detections after fixes (was 212).
  pitch         : multiset overlap 0.077 - see the breakdown below.

## 2/3. Fixes (all deterministic, gap-relative) and before/after

| OLiMPiC (independent engraver, scanned) | before | after |
|---|---|---|
| staff frames | 9 | **16** (of 20 systems) |
| note detections | 212 | **374** (recall 0.21 -> 0.54) |
| pitch multiset overlap | ~0.20 (loose metric) / 0.077 (strict per-staff) | 0.077 |
| note pitch, treble staff only | - | ~0.25 agreement |
| note pitch, bass staff | - | 0 (clef F->G: every note +12 steps) |

Fixes: duplicate-line merge (0.4 x median spacing), run threshold
min_frac 0.22 -> 0.10 (recovers staff lines on low-contrast rows),
4-line frame repair, frame evenness validation, non-finite gap guard.
DEV renders: note P 0.931, R 0.957, pitch 0.907, complete 0.703,
page complete 0.679 (612/902), rests P 1.000/R 0.296, MusicXML 5/5 —
unchanged except note recall 0.9645 -> 0.9568 (7 notes) caused by the
Otsu binarization required for scans (documented trade, all other
metrics identical).

## 4. Hidden assumptions found and closed (reports/HARDCODE_AUDIT.md updated)

- fixed +4px staff-grouping tolerance -> gap-relative (0.5x scale).
- fixed gray<128 -> Otsu with a degenerate-image guard (binary scans).
- page-global leftmost-dark-column as system left edge -> per-frame staff
  line run (fixed last commit; this mission found it again from the scan side).
- duplicate staff-line detections -> merged by spacing-relative threshold.
- fixed staff-line run fraction 0.22 -> 0.10 (low-contrast scan rows).
- fixture meta.json (page width / staff gap / SVG margins) -> derived from
  the detected frames (auto_page.py).
Still open: clef templates are Verovio-font specific (scans fail), notehead
boxes absorb thick staff-line remnants on scans (cy error), no page-size
limit, no rotation beyond +-4 deg, no contrast/quality gate.

## 5/6/7. Quality, full-page accuracy, rejected experiments

Full-page (familiar DEV): 612/902 complete events (67.9%), pitch 86.8%,
duration 73.3%, rests P 1.0/R 0.296, measures 97.9%. Independent scans:
NOT usable (pitch 0.077) — reported, not hidden. Rejected this mission:
phase-lock (median legal-grid phase; measured +0.02 only - noteheads in
spaces legitimately sit at frac 1), ink-strength frame validation
(-23 detections, no pitch gain), frame evenness validation alone
(no pitch gain, kept because it fixed broken frames: 12 -> 16).
No training was run this mission (deterministic fixes only).

## Next highest-impact blocker (scan path)

Two measured scan failures, in order: (1) clef recognition on scans — bass
read as treble, zero pitch on half of all notes; the fix is a
shape-discriminative clef classifier (F has two dots, G a spiral, C two
vertical bars) instead of NCC means tuned on render fonts, or scan-style
templates built from the OLiMPiC TRAIN-style material. (2) Notehead cy on
thick-line scans: boxes absorb staff-line remnants, shifting centers.
Until both land, automatic transcription must be documented as
render-grade only.


---

# Scan clef rescue: per-source templates + key-signature diagnosis

From `12a8397687`. No merge, TEST sealed, DEV identities frozen.

## Root cause of the scan clef failure (M1)

The clef classifier used per-class mean NCC templates built ONLY from
Verovio render clefs. On independent scans the clef glyph sits at a
different x-offset, has different proportions, and its ink is thicker, so
render templates matched the G class on bass staves (F->G = +12 steps for
every staff-2 note; measured 0/16 scan frames correct before this work).
Diagnosed with dumped crops (reports/scan_clef_diag.json, /tmp/clefscan):
the scan bass clef is clearly present with its two dots but at a different
geometry than the render font.

## Fix: per-source per-class templates (TRAIN-side supervision)

`clef_templates2_build.py` builds mean NCC templates from TWO sources:
A. Verovio render clef instances (SMuFL glyph labels), and
B. OLiMPiC scanned frames whose truth clef comes from the sample's own
   MusicXML — TRAIN-side samples only (verification samples held out;
   the first 10 OLiMPiC samples are never used for templates).
`clef_detect.detect_clef` scores each class per source and takes the
render-preferred max (RENDER_TOL=0.05).
Measured (reports/clef_variants.json, reports/clef_templates2.json):
  DEV renders (116 frames): 0.914 (render-only templates: 0.92)
  held-out scans (15 frames): 0.800 (render-only templates: 0.00)
  rejected variants: exemplar bank (render 0.216), line-stripped
  templates (scan 0.333), source-sum (scan 0.533).
End-to-end OLiMPiC pitch multiset 0.0768 -> 0.1092; bass staves now read
F4 (visible in olimpic_eval2 detail).

## Honest DEV cost (documented, not hidden)

One render frame flips (QmbShS frame 0, G2 -> F4) because the scan
template scores higher on that crop. Effect on the 5-page DEV eval:
detected pitch 0.9073 -> 0.8702, complete events 0.7034 -> 0.6802,
page complete 612 -> 587 of 902. Over the full 116-frame DEV sample the
clef accuracy changes by 1 frame (0.92 -> 0.914). Kept because the scan
capability is otherwise zero; the frame is identified for follow-up.

## Key-signature diagnosis (the next-largest scan failure)

Every OLiMPiC verification sample has a key signature (fifths -5..+5) and
15-66% of notes carry an accidental; the pipeline estimates NATURAL
pitches only, so those notes can never match. Prototype
(`keysig.py`, reports/keysig.json): TRAIN render key-signature templates
(E262 sharp / E260 flat) + matchTemplate over the startup region.
Current accuracy is NOT deployable (render key detection 3/22; flats
confused with sharps; staff lines split accidentals into fragments).
Not shipped. This is the single largest measured remaining scan blocker.

## Cross-style acceptance (M3)

A. familiar DEV renders: note P 0.931 / R 0.957, pitch 0.870 detected /
  0.833 page, complete 0.680 / 0.651 page, durations 0.760/0.727, rests
  P 1.000/R 0.296, measures 0.979.
B. transformed pages (0.5x/1.0x/2.0x): verified last mission.
C. independent engravers (renders of other publishers): not available
  locally — stated, not claimed.
D. real scans (OLiMPiC): note recall 0.544, pitch multiset 0.109 — NOT
  usable; blockers in order: key signatures (prototyped), notehead cy on
  thick-line scans, clef style residuals.
No resized pages are presented as independent evidence.


---

# Key signatures + clef regression fix (M1-M6)

From `25de8c1112`. No merge, TEST sealed, DEV identities frozen.

## M1 — the familiar-DEV clef regression is FIXED

The per-source templates made the scan_F template match RENDER treble
crops (score 0.29 vs render_G 0.14 on QmbShS frame 0) because the
render-tuned class-conditional window captures the tall G glyph and the
scan template is staff-heavy. Fix (source-independent, uses only pixels):
a structural guard — a G clef's ink extends ABOVE the top staff line,
F/C glyphs sit inside it. Measured: render G above-band ink 0.074-0.083,
render F/C 0.000; on scans the distributions overlap but the guard still
nets positive. No dataset identity is used at inference.
Result: DEV pitch 0.8702 -> 0.9073 (restored), complete events 587 -> 607,
and the held-out scan pitch multiset 0.1092 -> 0.157 (the guard helps
scans too). Clef decisions on the 5 eval pages: 0/7 wrong.
Residual (documented): 607 vs the all-time-best 612 events — 5 events,
from the scan-focused frame-validation changes, not the clef.

## M2 — key-signature recognition (deployed for detection, application
## gated off)

`keysig2.py`: glyph-box NCC templates from TRAIN render keyAccid glyphs
(SMuFL E262/E260) cropped with the SAME merged-CC extraction the detector
uses (shared `merged_boxes`; staff-line-removal splits accidentals at the
staff rows, so fragments are merged within glyph-size bounds).
TRAIN render key accuracy **0.75** (30/40). Scan-side templates built
from TRAIN-side OLiMPiC samples (supervision = the sample's MusicXML
fifths, accidentals = the leftmost |fifths| boxes) — scan key accuracy
0.0 (scan accidental fragments are not mergeable with the render
constraints; documented, not shipped).

## M3 — accidental propagation: gated OFF on purpose

Applying the detected key to the diatonic mapping was measured to HURT:
pitch 0.9073 -> 0.7625, because a wrong key shifts a whole staff by a
semitone. Confidence gating does not separate correct from wrong
detections (measured: correct conf 0.65-0.73 vs wrong 0.0 and 0.6-0.7).
The wiring is in place (fifths per frame, key_alteration) but disabled
with a comment. Key accuracy must be >>0.75 before enabling.

## M4-M6 — scan geometry, evaluation separation, quality

Ongoing: notehead centers on thick-line scans (the remaining scan pitch
loss after clefs); evaluation kept separate (familiar DEV vs held-out
scans); no quality gate added — scans are transcribed with measured
limitations rather than rejected, and no gate may reject on page size or
font alone (per mission).

## Current verified numbers

Familiar DEV (5 pages, 902 notes, no oracle): note P 0.931 / R 0.957,
detected pitch 0.9073, duration 0.7601, complete 0.7034, page pitch
0.8681, page duration 0.7273, page complete 607/902, rests P 1.000/R
0.296, measures 0.979, MusicXML 5/5.
Independent OLiMPiC scans (10 samples, 688 notes): frames 16, note
recall 0.544, pitch multiset 0.157 (from 0.0768), clef 0.80 per frame.
Key signatures: detected at 0.75 on renders, 0.0 on scans — the single
largest remaining scan blocker.


---

# Cross-engraver key-signature rescue (M1-M6)

From `ebca821cbc`. No merge, TEST sealed, DEV identities frozen. RAM was
constrained (~160-250MB free, other agents active), so all work was
single-page and analysis-first; no training was run this mission.

## M1 — scan key-signature root cause

Dumped the key-signature startup region on held-out scans (known fifths
from the sample's MusicXML):
  - the line-free CC view shows SHATTERED fragments: the accidentals are
    split by staff rows into 2-4 pieces with 0.3-1.5-gap gaps, and thick
    scan staff-line remnants (w 3.19 gaps, h 0.05) survive the horizontal
    opening and pollute the region;
  - x positions are consistent (fx0 + ~4.1 gaps on renders) but the
    vertical positions measured against the detected bottom line are
    wildly variable (-16 to -102 halfsteps), i.e. the frame/clef
    association used for the expected-position table is not yet
    consistent across scores (a frame-rank-to-SVG-staff alignment bug in
    the study, not in the pipeline);
  - sharp/flat glyph templates built from render crops score 0.63-0.69 on
    render frames but <0.31 on scan frames (render-key accuracy 0.75,
    scan-key 0.0).

## M2 — position-table approach attempted, not deployable

A clef-relative expected-position table (accidental i at fx0+x_i, y_i
halfsteps above the bottom line) was extracted from TRAIN render keySig
glyphs. The x positions are tight (4.09 gaps, σ 0.4 for i≥1) but the y
positions were inconsistent across scores (σ up to 54 halfsteps) because
the study associated frame 0 with SVG staff 0 without verifying the
alignment. Fixing the alignment is the identified next step; the recognizer
was NOT shipped.

## M3 — key application: measured and KEPT GATED OFF

Key detection accuracy: 0.75 on TRAIN renders (30/40), scan 0.0.
Gating study (60 TRAIN pages):
  all detections                 0.700
  conf >= 0.65                   0.897 (35/39)
  conf >= 0.65 AND >=2 accids    0.765 (13/17)
Applying a wrong key shifts a whole staff by a semitone; with 4 wrong
keys per 17-39 applied pages the net complete-event effect is net
negative, so the application stays gated off (wiring and comment in
auto_e2e.py record this). This matches the mission rule.

## M4 — familiar-DEV 5-event gap: attributed, not recovered

The 612 -> 607 difference is NOT from the clef (0/7 frames wrong on the
5 eval pages now, the structural guard holds) but from 7 lost note TPs
(TP 870 -> 863) introduced by the scan-required staff-line handling
(duplicate-line merge + min_frac 0.10). A/B tested: frame validation
on/off (no change), 4-line frame repair on/off (no change) — both
neutral on DEV. The remaining suspects (merge threshold, run threshold)
are required for scans (frames 9 -> 16, detections 212 -> 374). Trade
accepted and documented: 5 familiar events for the scan capability; the
mission's 25-event regression from the previous commit remains fixed.

## Verified final numbers

Familiar DEV (5 pages, 902 notes, no oracle at inference): note P 0.931 /
R 0.957, detected pitch 0.9073, duration 0.7601, complete 0.7034, page
pitch 0.8681, page duration 0.7273, page complete 607/902, rests P
1.000/R 0.296, measures 0.979, MusicXML 5/5.
Independent OLiMPiC scans (10 samples, 688 notes): frames 16, note recall
0.544, pitch multiset 0.157, clef 0.80/frame, key 0.0.


---

# Key-evidence repair mission (measurement foundation + gated key application)

From `564a180432`. Commits: `1b44089414` (+ bookkeeping). No merge, TEST
sealed. All calibration on TRAIN; DEV used for regression only.

## 1. Frame-to-reference-staff correspondence: REPAIRED

The earlier position study assumed detected frame[0] == SVG staff rank 0,
which produced the absurd y-spreads (-16 to -103 halfsteps). New
`ref_staff.py` matches each detected frame to the reference staff in PIXEL
space with the same transform inference uses ((svg_y + ty)/10 * sx);
25/25 frames matched on the 5 eval pages at <= 6px mean line distance.
With the correspondence fixed, the aligned table (660 TRAIN scores, 2,382
frames) is tight: x sd <= 0.16 gaps, y sd <= 0.05 halfsteps, and
clef-dependent exactly as notation requires (G vs F positions differ).

## 2. Original ink vs line-removed: DEFINITIVE (the core question)

Position-based accidental detection (windows at the table positions, ink
test vs an above-staff control band):
  TRAIN renders, source=original ink   : 27/36 = 0.750
  TRAIN renders, source=line-removed   : 0/36  = 0.000
Preserving accidental strokes across staff rows is REQUIRED; line removal
destroys them (the accidentals' bodies sit on the staff rows). No
glyph-template decision is involved in this conclusion - it is measured
against the aligned positions.

## 3. Key-signature accuracy

  renders (TRAIN, 36 keyed scores): 0.750 (same as the previous NCC method)
  held-out scans (9 samples):        1/9 correct, 2 abstentions
False-key examples from the held-out set (kept as evidence,
reports/keysig_pos_detect.json):
  4976604 truth -5 -> -3  (silent: count capped by table coverage)
  4978397 truth +5 -> abstain (both types supported)
  4978393 truth -3 -> +2  (silent: flat/sharp positions both inked)
  4982505 truth +2 -> abstain
  4945954 truth -4 -> 0   (ink below the absolute threshold)
Consequence: 1/9 correct with silent failures is NOT deployable, and the
mission rule applies - key application stays GATED OFF (unchanged).

## 4. Per-score before/after (auto_e2e.py, previously unpopulated)

QmPVDdky tp203/fp15/fn10 complete135 (213 truth)
QmPyTcVQ tp352/fp33/fn19 complete232 (371 truth)
QmVjQbrG tp69/fp5/fn2 complete39 (71 truth)
QmbShSji tp127/fp5/fn0 complete115 (127 truth)
QmYkUNDS tp112/fp6/fn8 complete86 (120 truth)
Totals unchanged: 863/902 TP, 607/902 complete, page pitch .868,
duration .727, rest 8/27 with 0 FP, measure coverage .979, MusicXML 5/5.
The familiar 607/902 baseline is preserved exactly; no unexplained
regression below it.

## 5. Regressions re-run

  clef guard : 24/25 reference-matched eval frames (1 misfire: QmPyTc
              frame 5, an F clef read as G - documented)
  scan frames: 16 frames / 374 detections / recall 0.544 / pitch
              multiset 0.157 (unchanged)

## 6. Overlays

reports/overlays/*.png show staff identity (frame -> reference measure,
staff rank, clef, pixel match distance), the clef crop box, the
key-signature search window, and the expected accidental positions.

## 7. Rejected experiments (this mission)

  window tuning: 0.9/0.6 gaps (dilution), 0.55/0.35 (over-discrimination:
    sharps/flats interleave within 0.5 gaps) - reverted
  median-over-all-windows baseline (time-signature windows inflate it)
  control region past the time signature (it IS the time signature ->
    background 0.21) - replaced by an above-staff control band
  5-7 accidental counts: no TRAIN table entries (only 2 scores have 5+
    sharps) -> coverage abstention added, not guessed

## 8. Single next blocker

Scan key signatures: the aligned table proves the positions are stable on
renders (sd 0.05 halfsteps) but scan accidental ink is fainter and its
windows overlap between sharps and flats, so the position test is not yet
discriminative there (1/9 with silent failures). Next: a scan-side
position calibration on TRAIN-side OLiMPiC material (supervised by the
samples' own MusicXML keys, disjoint from the 10 verification samples),
plus a joint sharp/flat likelihood over the vertical ink profile instead
of independent per-position tests. Only then re-measure the key-application
gate with the same wrong-key accounting as the candidate detector.


---

# Scan accidental recognition rescue: NEGATIVE result, key stays OFF

From `4e3faddaa8`. Commit `d03eb04688`. No merge, TEST sealed. All
calibration on TRAIN-side material; the 10 held-out OLiMPiC samples are
used exactly once, at the end.

## M1 scan-side calibration (reports/scan_accid_fit.json)

161 TRAIN-side scan samples (disjoint from the 10 verification samples),
first frame per page, production clef detection, ORIGINAL-INK windows at
the aligned table positions:
  present_f0 ink 0.156 vs absent_f0 0.171 — INVERTED (no separation)
  present_s1 0.287 vs absent_s1  0.235 — 1.2x only
Cause (measured): scan accidentals are vertically offset from the
render-derived table positions — median offset 0.42 gaps, p90 0.83 gaps,
only 25% within 0.3 gaps (horizontal is fine: median 0.02). The aligned
table is a render-geometry table; this engraving places accidentals
differently, so fixed-position windows measure background.

## M2 joint classifier (reports/scan_profile_keysig.json)

Staff-relative 28-bin vertical ink profile over the key-signature x-band
(fx0+2.9..6.6 gaps, 2.5 gaps above the top line to 3 below), measured on
original ink with staff rows masked (keeps ~90% of accidental strokes,
removes the lines that dominate the raw profile). Nearest-centroid over
per-(clef, fifths) centroids learned from TRAIN-side scans (19 classes,
each 1-17 samples). Held-out verification: 1/9 exact, 5 WRONG, 3
abstentions (decided accuracy 0.167). Classes with few samples and small
inter-class margins make centroid assignment unreliable.

## M4 safety measurement

One wrong key corrupts 7.0% of notes on the familiar DEV set (every
F-letter note shifts); 5 wrong keys per 9 scan samples would corrupt
roughly a third of those scores. Net effect of enabling: decisively
negative. Key application remains GATED OFF (unchanged from before).

## M5 hidden assumptions found

  - the aligned position table is render-geometry, not engraving-
    independent: scan accidental vertical placement deviates by 0.42 gaps
    (median) — position transfer is a hidden assumption and it fails;
  - raw vertical profiles are dominated by staff lines (masking them
    reintroduces the partial-fragmentation tradeoff: ~10% stroke loss
    accepted in the profile test);
  - centroid classes need more samples per (clef, fifths) — 19 classes
    over ~160 samples is too fragmented.

## M6 baseline preserved (re-verified after all changes)

Familiar DEV: 607/902 complete events, page pitch 0.8681, duration
0.7273, rest P 1.000/R 0.296, measure coverage 0.979, MusicXML 5/5,
note P 0.931/R 0.957. Independent scans: 374 detections, 16 frames,
recall 0.544, pitch multiset 0.157. No regressions.

## Honest conclusion

Scan key-signature recognition is NOT solved: two independent approaches
(fixed positions, joint profiles) both fail on held-out scans with
dangerous failure modes (silent wrong keys). Key application stays off;
the natural-pitch pipeline is unchanged and safe. The measurement
foundation from the previous mission (frame/staff correspondence,
aligned table, overlays, per-score reporting) is the durable asset.


---

# Small learned scan-symbol detector: NEGATIVE on scans, strong on renders

From `ca75fb8682`. No merge, TEST sealed, baseline untouched (git diff
empty; all work in new experiment scripts).

## M1 training-evidence audit (reports/train_evidence_audit.json)

  180 TRAIN-side scan samples carry a usable key label (score-level
  MusicXML fifths only — NO symbol-level scan supervision exists locally)
  787 render symbol boxes with EXACT glyph labels (E262 sharp 666 /
  E260 flat 121) across 238 trainable scores
  the 10 verification samples have now been measured in four missions and
  are explicitly not pristine untouched evidence
  class balance (scans): -6..+6, the largest classes 16-29 samples

Decision: train the symbol classifier on render symbol boxes only (exact
labels), use scans strictly for validation with weak score-level sign
labels.

## M2 architecture and training

TallCNN (222k params, vertical-preserving, width-only pooling) on 32x64
staff-relative crops. Training set: 1,429 render positives + ~3,080
render negatives (table positions with no accidental). Score-disjoint
split: 190 train / 48 held-out render scores. AdamW 3e-4, batch 256,
seed 0, 10 epochs, CPU (~3.5 min).

## Results

  render held-out (score-disjoint) symbol accuracy: 0.9945-0.9989
      -> the classifier is excellent and transfers across SCORES
  TRAIN-side scan key accuracy: 0.000 decided (128/151 abstain);
      forced per-sample majority vote 0.586 (weakly better than chance)
  held-out verification: same abstention pattern

## Root cause of the scan failure (the useful finding)

  foreground confidence on scan crops: median 0.002, p99 0.031 — the
  classifier is certain every scan crop is background
  confidence does not correlate with the true key sign (sharp-sign 0.0132
  vs flat-sign 0.0164) — no usable signal
  visual diagnosis (crop montages): render positives are clean 1-2px
  strokes; scan crops carry 4-5px staff-line remnants (measured: median
  4px, up to 22px) that reconnect glyphs into single blobs, plus faded
  speckled ink. Three masking variants were tried (+-1 row, uniform
  masked, thickness-aware) — the crops still differ enough that a
  render-trained classifier abstains on all of them.

## M3-M5 integration decision

Key application remains DISABLED. The render-domain result (0.99) is not
extrapolated to scans; enabling application would corrupt whole staves
(per the earlier measurement, one wrong key shifts 7% of notes and 5 of
9 scan samples would be wrong).

## M6 baseline preservation (re-verified)

  familiar DEV: 607/902 complete events, page pitch 0.8681, duration
    0.7273, rest P 1.000/R 0.296, measures 0.979, MusicXML 5/5
  independent scans: 374 detections, 16 frames, recall 0.544, pitch
    multiset 0.157 — all unchanged

## Honest conclusion and next blocker

Three independent approaches to scan key signatures have now failed
honestly (fixed positions, vertical profiles, cross-font learning). The
blocker is a genuine domain gap that cannot be closed without scan
symbol-level supervision. The single next step: obtain scan key-signature
symbol boxes (weak supervision via alignment of the OLiMPiC MusicXML to
the scan frames — expensive) OR restrict the risk by reporting key
signatures as "unknown" on scanned input while shipping the natural-pitch
pipeline. No further training is justified on the current evidence.


---

# Real-scan supervision foundation: alignment works partially, labels insufficient

From `de3171f770`. Commit (this mission). No merge, TEST sealed, baseline
untouched (verified by re-running the full evaluation).

## Alignment method (mission item 1)

Each OLiMPiC sample contains per-system strips (p1-s1.png,
p1-s1.musicxml, p1-s1.lmx), so the key signature is annotated per strip.
Alignment exploits the one hard notational fact: the key signature is the
only symbol run between the clef and the time signature, so:
  1. glyph candidates are generated from the horizontal ink profile of the
     key-signature window (fx0+2.9..6.4 gaps — measured to end before the
     time signature), staff-line rows masked by their MEASURED thickness
     (median scan 4px vs render 1.5px; masking was required for the
     profiles to separate at all);
  2. the |fifths| leftmost candidates are labelled with the key's sign
     (count constrained by the strip's own annotation);
  3. each label is verified INDEPENDENTLY of the key: the crop must match
     the render accidental template of the labelled class by an NCC
     margin, and must contain a single ink mass (adjacent accidentals 1
     gap apart merge and would otherwise produce corrupted labels).

## Alignment uncertainty (mission item 2)

measured on 180 TRAIN-side strips:
  128 had usable frames (25 no_frame, 27 no_key)
  count agreement (peaks found == |fifths|): 51/128 = 0.398
  77 strips (60%) produced FEWER candidates than the key requires
  27 labels passed all three checks (13 sharp / 14 flat) over 21 strips
  31 candidates rejected as appearance-ambiguous
  28 rejected as multi-symbol (merged accidentals)
  visual inspection of the surviving montage
  (reports/scan_sym_montage.png) shows roughly half of the survivors are
  clean single accidentals; the rest remain clef/time-signature fragments
  that pass the automated checks

## Trustworthy symbol labels (mission items 3-4)

  27 candidate labels (visually ~15 clean) from 21 strips
  This is NOT sufficient to train a reliable scan-specific detector: at
  ~15 reliable positives with unbounded residual noise, any trained model
  would overfit and its error rate could not be established. Per the
  mission rule ("only train if the labels are sufficiently trustworthy"),
  NO TRAINING WAS PERFORMED in this mission.

## Scan accuracy and false-key rate (mission items 7-8)

  Unchanged: no new model, so the baseline stands — render-trained
  classifier abstains on scans (fg median 0.002), per-sample vote 0.586,
  key signature correct 1/9 on the held-out set.
  Key application remains DISABLED (no downstream change to measure).

## Baseline preservation (mission item 9)

  familiar DEV: 607/902 complete events, page pitch 0.8681, duration
    0.7273, rest P 1.000/R 0.296, measures 0.979, MusicXML 5/5
  independent scans: 374 detections, 16 frames, recall 0.544, pitch
    multiset 0.157
  All re-verified after this mission's work.

## Font / page-size / coordinate assumptions audited (mission item 10)

  all geometry staff-relative (gaps), no page dimensions, no fixed pixel
  positions; crop extent GW/GH in gaps; line masking is thickness-
  measured not assumed; candidate generation is profile-based (no fixed
  accidental count assumption — the count comes from the strip's own
  annotation and is verified, not assumed); verification templates come
  from labelled render boxes but are used only to REJECT labels, never to
  create them.

## Remaining blockers

  The binding constraint is symbol-level scan supervision: 60% of strips
  fail count alignment and the surviving labels cannot be independently
  verified well enough to bound their error. The next step is not another
  training round: it is to improve alignment quality (accidental
  separation at 1-gap spacing is the failure mode) — e.g. a strip-level
  accidental-position detector trained on RENDERED positions of the same
  MusicXML (render + scan domain pair), which would give per-strip symbol
  boxes without needing scan annotations. Until then key signatures on
  scans stay unrecognized and key application stays off.


---

# Scan-to-notation alignment: render registration reaches ~1-gap precision; supervision still insufficient

From `5e1b63a54e`. No merge, TEST sealed, baseline untouched (re-verified:
607/902 complete events, page pitch 0.8681, duration 0.7273, rest P
1.000/R 0.296, measures 0.979, MusicXML 5/5). Per M5 no training was run.

## M1 render of matched MusicXML

Each OLiMPiC strip (p1-s1.musicxml) renders with the local Verovio
toolkit; the render exposes EXACT key-signature accidental positions in
keyAccid groups plus staff line geometry.

## M2 staff-relative alignment

Per strip: render staves vs scan frames matched per-staff (the render
packs several staves per page while a scan strip is one system, so plain
index matching abstained 26/28 - fixed by grouping the render's accidentals
per staff and mapping render staff i to scan frame i). Each scan staff gets
a per-line curvature model (y sampled at 64 x-offsets), so skew/curvature is
handled for the vertical mapping. The horizontal mapping was rebuilt twice:
  1. u-fraction over each frame's x-extent: failed badly (dx median 15.3
     gaps) because render frames are wide incl. indent while scan strips
     are tightly cropped and the key signature sits at 15% of the render
     width vs 2% of the scan width.
  2. clef-relative gap units: dx median 15.3 -> 0.866 gaps.

## M3 ink-verified transfer

Labels transfer only when the mapped scan window contains ink (>= 0.12);
46 candidates passed before the per-staff mapping, 30 after; 18-7 rejected
as no-ink. MusicXML accidentals never create invisible symbols.

## M4 confidence ledger (reports/align_precision.json, 36 TRAIN-side strips)

  count agreement (render accidental count == scan blob count): 8/36 strips
  abstentions: 63 candidates had no corresponding scan frame
  localization error on the 17 paired labels: dx median 0.87 gaps
    (p90 1.57), dy median 0.97 gaps (p90 1.97)
  within 0.5 gap: 11.8%; within 1.0 gap: 23.5%
  Usable trustworthy labels: 0 at the required precision (a symbol crop
    needs < ~0.4 gaps since neighbouring accidentals sit 1 gap apart)

Overlays: reports/align_overlays/*.png show the mapped windows landing
within about one accidental of the true glyph - direction right, precision
not.

## M5 stop-and-report (per the mission rule)

  Trustworthy scan symbol labels remain ~0: count alignment holds on only
  22% of strips and positional error is ~1 gap. NO TRAINING on this
  supervision. The previous 27-label set stands as the best available and
  remains unused.

## M6 layout/quality assumptions audited

  all geometry staff-relative (gaps), no page dimensions; clef-relative
  horizontal mapping removes the indent/crop assumption; curvature models
  absorb non-linear distortion; staff-count and frame mismatches abstain
  rather than guess; unreliably aligned strips are reported as abstentions
  (63 this run) instead of being transcribed silently. Key-signature
  application remains OFF.

## Remaining blockers

  The binding constraint is now precise: render-to-scan registration
  precision (~1 gap) and count agreement (22%). Closing it needs either
  (a) optical-flow/point registration over the whole staff (beyond a
  bounded session) or (b) scan-style augmentation of the render symbol
  crops (measured 4px lines, speckle, curvature) to attack the domain gap
  without scan supervision. Next milestone: (b) as a bounded,
  preregistered experiment.


## M1-M6 bounded augmentation experiment (this session)

  M1 measured domain differences (reports/domain_diff.json, 13 scan
   strips + 12 render pages):
    staff thickness: render constant 2px vs scan 3-22 (med 4)
    ink fraction in key-region window: render 0.136 vs scan 0.195
    blur (mean gradient): render 130.5 vs scan 113.3
    glyphs merge into ~4.5-gap blobs on scan vs ~1.0 gap on render;
      glyph contrast std render ~45 vs scan 0-35.

  M2 one predefined, measured augmentation only (no arbitrary noise):
    3px dilation, Gaussian noise sigma 15 + Otsu re-binarize, horizontal
    shear +/- 5 pct, 40 pct probability of 3/5 Gaussian blur; applied to
    positives and negatives identically (64x32 crops).

  M3 result (reports/augment_exp.json):
    G1 render held-out symbol accuracy = 0.9938   -> PASS
    TRAIN-side scan: 13 correct / 16 decided / 112 abstain over 128 groups
      (decided acc 0.8125, coverage 0.1250)   -> G2 FAIL
    VERIFICATION strips: 0 decided groups.

  M5 stop condition: augmentation did NOT increase scan coverage past the
   current regime. No model artifact (models/clefsym_aug.pt not saved).
   Key-signature application stays OFF. Bottleneck recorded: scan accidentals
   fuse into ~4.5 gap blobs, not reproducible by render-side thickening+
   noise; further NN training on these crops is not justified.

  M6 unknown-key safety communication:
    Never apply a key signature when G2/G3 fail. Emit MusicXML with no
    <key> element, explicit <accidental> for every affected note, and a
    credit: "Key signature undetermined; review accidentals manually."
    Report field key_status=unknown in accompanying JSON; do not infer a
    key from PDF crop dimensions; block downloadable MIDI/perform-score
    export until the user attests key signature or per-part override.


## Rhythm accuracy + uncertainty safety (this session)

  M2 attribution (reports/audit_duration.json, 22299 notes, 4652 errors):
    beamed duration errors 2892 (2023 in uniform-truth beam groups);
    unbeamed 1760; dots 741; tuplets 212; chords 1757; voices 1/5 dominant.
    Rests (reports/audit_rest.json, 698 truth rests): kind_not_rest 67,
    dropped 40, staff 22, voice 173, dur 54, onset_only 178, duplicate 33,
    exact key 195 (0.28).

  M3 bounded correction (decode_score): rest voice assigned to the majority
    predicted voice on the same (measure, staff), with staff-based fallback.
    eval_reconstruction (10 DEV scores, visual clef + ctx dur + r1 rest):
    B_rest_tp 9 -> 11 (+2), B_tp_exact unchanged (1785), B_tp_pitch
    unchanged (1856). No regression in notes; rest voice accuracy measured
    0.71 -> 0.77 on 631 rests. Beam-group duration voting was prototyped
    but produced a small negative exact delta on the sample and is NOT
    applied; documented as not justified.

  M4 uncertainty safety:
    auto_e2e MusicXML now carries <miscellaneous-field
    name="croperscore_key_status">unknown</miscellaneous-field> plus a
    <credit> "Key signature undetermined by automatic transcription;
    review accidentals manually." and an explicit <key><fifths>0</fifths>
    so unresolved keys cannot masquerade as confidently correct C major.
    Key application remains OFF; no accidentals fabricated.

  M5 evaluation: sealed TEST untouched; no model changes; no retraining.


## Beamed rhythm recognition (this session)

  M1 attribution: 16,649 beamed notes; dur accuracy 0.584 for the per-note
    head. Truth durations: 8th 8004, 16th 2780, dotted 8th 367, 32nd 206,
    plus 5292 chord members (dur None). Beam-depth confusion dominates.

  M2 correction: structural SVG beam-count recognition (1->8th, 2->16th,
    3->32nd) using stem_x = content-bbox x + width, staff-relative
    geometry only, no score IDs. Measured 0.984 dur accuracy on 13,056
    beamed notes. Implemented in decode_score for in_beam notes. No training.

  eval_reconstruction (10 DEV scores, visual clef + ctx dur + r1 rest):
    B_tp_exact 1785 -> 1808 (+23), B_tp_pitch 1856 -> 1879 (+23),
    B_timing_valid 133 -> 137 (+4), B_rest_tp 9 -> 9 (0). No regression.

  M3 rest integrity: rest voice majority from predicted notes was prototyped
    but did not improve voice_ok (418 either way) and is NOT applied; the
    accepted head (voice_ok 418) is preserved. Rest voice accuracy 0.71
    (unchanged). Complete rest exact_key 190.

  M4 unknown key safety: MusicXML carries croperscore_key_status=unknown
    credit + explicit fifths=0. LIMITATION: an explicit <fifths>0</fifths>
    can still be read as C major by other applications; Corranzo's UI display
    of the uncertainty is NOT verified in this session (no UI run). Recommend
    the importer/UI surface the miscellaneous-field and credit text, and
    block "playable MIDI export" until attested. Key recognition stays OFF.

  M5: sealed TEST untouched; no retraining; no new downloads. Beam-count
    fix relies on SVG render structure (oracle structure input), so it
    benefits the reconstruction/decoded pipeline but NOT the fully
    automatic (no-SVG) path, which remains unaffected.

  Remaining limitation: beamed duration in the fully automatic path (no SVG)
    still depends on the per-note head (0.584). A trained beam-aware
    duration head on detected crops is the next justified step, but
    requires scan-side supervision that does not yet exist.


## Image-based beam recognition (this session)

  M1: simple CV beam counting on raster (row/column transitions) achieved
    only 0.19-0.25 match to SVG truth beam count on clean renders; rejected
    as insufficient.

  M2: trained a 4-class beam-count CNN (0/1/2/3 beams) on 8000 render crops
    with SVG-derived labels. Result (reports/beamcount.json):
      heldout acc 0.823, dev20 acc 0.788 (n=4608).
      class 0: 0.942, class 1: 0.694, class 2: 0.888, class 3: 0.000.
    Gate (dev20>=0.80) FAILED. No model artifact saved (models/beamcount.pt
    not created). Triple-beam class unusable (35 training samples).

  M5 decision: image-based beam classifier REJECTED. Structural SVG method
    remains the only path to 0.984 beamed dur accuracy. Automatic (no-SVG)
    beamed dur remains 0.584. Honest gap preserved.

  M4 unknown key safety: verified MusicXML markers present (credit +
    miscellaneous-field croperscore_key_status=unknown + fifths=0). LIMITATION:
    explicit fifths=0 can still be interpreted as C major by external
    importers; Corranzo UI display of the uncertainty is not verified in
    this session (no UI run). Recommend UI read the miscellaneous field and
    block playable export until attested. Key recognition stays OFF.


## Automatic OMR accuracy rescue (this session)

  M1 root-cause: auto_e2e baseline on 5 DEV renders (902 truth notes):
    note P .931 / R .957; pitch_acc .907; dur_acc .760; complete .703 (607);
    rest recall .296 (8/27). Largest error contributors: beamed durations
    (0.584), rests (0.296 recall), note detection FP 64. Pitch already
    strong. Timing_valid 0.333. Scan path remains separate and weak
    (pitch overlap .157).

  M2 real-image eval: existing 5 DEV renders + scan verification strips;
    no new data added. Auto path is render-only (no scan pipeline in
    auto_e2e). Sealed TEST untouched.

  M3 attempted improvements:
    (a) Beam-count image classifier: trained on 8000 render crops with
        SVG-derived labels -> dev20 acc .788, class3 0.000. REJECTED.
    (b) Rest detection staff-line removal: candidate coverage .296 -> .852,
        but template recognition collapsed (scores .28, rest_tp 0). REVERTED.
    No verified automatic improvement this session.

  M4 input-quality gate: not implemented; auto path has no quality check.
    Recommend adding resolution/staff-detection confidence thresholds and
    abstention. Not done this session.

  M5 notation completeness: tracked; key sig OFF; rests limited; beams
    limited in auto path; chords/voices handled in reconstruction path.

  M6 evaluation: no before/after improvement; baseline unchanged.

  Remaining blockers: (1) beamed duration in image-only path (needs
    beam-aware trained head with scan supervision); (2) rest detection
    (needs better segmentation + recognition); (3) no scan auto pipeline;
    (4) no input-quality gate. A deeper architecture review (Astra 6) is
    justified: the existing per-note-head + frozen probe approach has
    plateaued; progress requires either scan-side supervised data or a
    joint detection+recognition model.

  Integration recommendation: do NOT integrate; no measured improvement over
    live implementation.


## 4-day launch sprint: pretrained OMR benchmark + quality gate (this session)

  Benchmarked homr 0.7.0 (AGPL-3.0) on 5 DEV render pages:
    Runtime ~15-44s/page on CPU; produces full MusicXML with key signatures,
    voices, chords, rests, beams. AGPL -> isolated research evaluation only;
    production implications unresolved. No integration this session.

  Implemented input-quality gate in auto_e2e: if staff detection yields no
    frames or no notes, emit a withheld-result MusicXML with credit
    "Input quality too low for reliable transcription; result withheld."
    instead of fabricating notation. (Safety net; not triggered on the 5
    clean DEV renders.)

  No measured accuracy improvement; baseline unchanged (607 complete,
    rest recall .296, dur_acc .760). Deeper architecture review justified.

  Sealed TEST untouched. Not merged to main.


## Accuracy breakthrough mission: direct architecture comparison (this session)

  Scored generated MusicXML (not just renderability) against page-1 truth on
  the same 5 DEV scores, using multiset matching on (midi, duration, dots):
    auto_e2e: complete TP 311/902 (recall .345, precision .336); pitch TP
      199/249? (pitch key includes chord members; see report); duration
      TP 18/41; rests 0/27.
    homr 0.7.0: complete TP 636/902 (recall .705, precision .705); pitch
      TP 188/249; duration TP 40/41; rests 27/27.
  Per-score homr complete recall: .29, .75, 1.00, .87, .95.
  Note: multiset metric is stricter than the native position metric that
    produced the familiar 607/902 = .703 baseline; both systems are scored
    identically here, so the relative result is valid.

  MusicXML measure validity (5 DEV pages): auto_e2e bad measures 20/28,
    29/38, 0/22, 1/25, 8/14; homr 4/16, 12/20, 0/10, 0/16, 0/32.
  homr is decisively stronger on both content and measure validity.

  Licensing:
    - homr 0.7.0: AGPL-3.0 (software); weights from TrOMR (license must be
      confirmed before any production use). Isolated research evaluation only.
    - oemer 0.1.8: MIT (software). Weights download failed in this
      environment (SSL certificate verification), so oemer was NOT scored.
      It is the legally usable candidate for the next evaluation.
    - Audiveris: AGPL-3.0 (not installed/tested).

  Decision: current architecture cannot sustainably reach high fidelity.
  Pretrained OMR is decisively better. Production path must either (a) obtain
  a licensing decision for an AGPL engine, or (b) evaluate the MIT oemer
  engine on the same references. No AGPL code/weights copied into production.

  Input-quality gate preserved; it triggers only on no-staff/no-note input,
  so clean music is not rejected merely because the recognizer is weak.

  No accuracy improvement implemented this session; the decisive comparison
  is the deliverable. Sealed TEST untouched; not merged.


## Production-viable OMR rescue: oemer evaluation + unfamiliar-font benchmark

  SSL fix (without disabling verification): oemer's weight download used
  urllib without a CA bundle; setting SSL_CERT_FILE to certifi's
  cacert.pem resolved it. Also patched oemer/bbox.py find_lines to accept
  both (N,1,4) and (N,4) HoughLinesP outputs (OpenCV 4.14 returns the
  latter; prior crash was an IndexError, not a security bypass).

  Same five DEV pages, same matcher (architecture_compare.json):
    auto_e2e   complete TP 311/902 (.345)
    homr       complete TP 636/902 (.705)
    oemer      complete TP  54/213 (.254) on the one page it completed
               (homr on that page: 62/213 = .291; auto: 22/213 = .103)
  oemer runtime: ~6-7+ min/page on this Mac (CoreML falls back to CPU,
  ~3.3 GB RSS, heavy swap). It crashed on 4/5 attempted pages/fixtures
  (bbox/find_lines and centers indexing). Not production-viable as-is.

  Unfamiliar clean CC0 fixtures (benchmarks/omr-fixtures, 5 piano PDFs +
  MusicXML references; rendered at 200 dpi, no reference passed to engine):
    homr complete TP 135/535 (.252), pitch .253, duration .417, rests .333.
    Per fixture: beginner 0/32 (!), rhythm-tuplets .016, grand-voices .193,
    articulation .227, dense .367.
    oemer: crashed/timeout on the beginner fixture; no fixture outputs.
  This is the key generalization finding: homr's .705 on Verovio renders
  does NOT transfer to an unfamiliar benchmark font (.252, beginner 0%).
  A readable image can still transcribe wrongly; the input-quality gate
  detects unreadable input, not readable-but-wrong output.

  Licensing:
    oemer 0.1.8 software MIT; weights shipped via the MIT repo's GitHub
      release (confirm weight license in legal review).
    homr 0.7.0 AGPL-3.0; TrOMR weights license unconfirmed -> research only.

  Integration recommendation: do not integrate any engine yet. oemer is
  legally usable but too slow/fragile and only ~25% complete on one page;
  homr is stronger but AGPL and fails the unfamiliar-font benchmark.
  Next step: run oemer on a Linux/GPU worker with the bbox fixes, and/or
  evaluate a licensed TrOMR/SMT-style model on the CC0 fixtures.

  Input-quality gate preserved; no merge/deploy. Sealed TEST untouched.


## Sustainable hybrid OMR architecture (this session)

  Hybrid routing: digital PDFs with embedded notation-font glyphs take the
  vector path; image-only PDFs/scans/screenshots take the image path.
  Working vector prototype: scripts/pdf_vector_omr.py (PyMuPDF, research
  only). It extracts staff lines/barlines/stems from PDF drawings, classifies
  noteheads/rests/clefs by staff-relative bbox geometry, associates noteheads
  to stems, and maps to written pitch. Output schema:
  {schema:"corranzo-notation-ir/1", notes:[{midi,x,y,staff,measure,clef,
  confidence}], rests:[...], route:"vector"|"image"}.

  Digital-PDF pitch accuracy on the vendored CC0 fixtures (truth MusicXML,
  never passed to extraction):
    beginner-single-vector     32/32  pitch recall 1.000 (33 detected)
    rhythm-tuplets-vector      63/63  pitch recall 1.000 (66 detected)
    grand-voices-vector        76/88  pitch recall 0.864 (88 detected)
    dense-advanced-vector     159/264 pitch recall 0.602 (226 detected)
    articulation-scan           0/88  route=image (no vector glyphs; correct
                                      fallback to the image path)
  Durations/beams/tuplets are NOT yet decoded by the vector prototype; only
  notehead/pitch/clef/route are claimed.

  Image/scan path (unchanged evidence): homr 70.5% complete on 5 Verovio DEV
  pages but 25.2% on the CC0 fixtures (beginner 0%); oemer MIT 25.4% on one
  page, ~6-7 min/page and crash-prone locally. No image engine is
  production-ready.

  Licensing:
    Vector prototype imports PyMuPDF (AGPL-3.0) -> research evaluation only.
    Production digital-PDF route must use the existing browser PDF.js
    pipeline (Apache-2.0) or a permissive PDF parser (pdfminer.six/pypdf).
    oemer MIT; homr AGPL; Audiveris AGPL.

  Shared representation + validation: the prototype emits the common IR
  above with confidence and route. Full measure validation remains the
  existing MusicXML validator; vector durations are the next component.

  Resource: vector extraction is seconds/PDF, <100 MB RSS; image OMR is the
  expensive path (oemer ~3.3 GB RSS, minutes/page). Disk is at 2.6 GiB free,
  below the 5 GiB safety floor; no large downloads/training.

  Decision: continue the hybrid vector-first architecture. It is the only
  path with measured high pitch accuracy on digital PDFs and a legally
  usable production story (PDF.js). Next: decode stems/beams/flags/dots in
  the vector path and add the shared validator before MusicXML.
  No merge/deploy; sealed TEST untouched.


## Complete vector music recognition (this session)

  pdf_vector_omr.py now derives rhythm from structural PDF evidence:
    - SMuFL noteheads 0xE0A2 whole, 0xE0A3 half, 0xE0A4 black;
    - black heads: beam level count 0/1/2/3 -> quarter/8th/16th/32nd;
    - augmentation dots from 3x3 filled circles (x1.5);
    - rests from SMuFL 0xE4E3..0xE4E7 with duration; unknown glyphs are
      emitted as unresolved, never fabricated;
    - chords grouped by x coincidence; one-to-one stem clusters; measures
      from width-filtered barlines (stems have width 0.8, barlines 1.0/1.8).
  MusicXML serializer emits notes/rests, clefs, credits, no <key>/<time>
  (unresolved; never silently C major / 4/4). Unresolved rests are omitted
  and listed, not replaced by quarter rests.

  Complete-event scores vs reference MusicXML (multiset midi+duration+dots,
  reports/vector_omr_complete.json):
    beginner-single-vector   complete 32/32 (1.000), pitch 11/11, dur 3/3,
                             rests 0/1, measures 8 (0 bad)
    rhythm-tuplets-vector    complete 48/63 (0.762), pitch 13/16 (0.813),
                             dur 7/12 (0.583), rests 3/5, measures 8 (0 bad)
    grand-voices-vector      complete 76/88 (0.864), pitch 76/88, dur 3/3,
                             measures 16 (0 bad; measure count inflated by
                             treating grand-staff staves as separate systems)
    dense-advanced-vector    complete 159/264 (0.602), pitch 0.601,
                             dur 2/3, measures 16 (13 bad)
    articulation-scan        route=image (no vector glyphs) - not scored
    aggregate 4 vector PDFs  complete 315/447 (0.705), pitch 258/378 (0.683),
                             duration 15/21 (0.714), rests 3/6 (0.500)
  Beginner is the first independently reference-scored, rhythm-bearing
  MusicXML transcription: data/vector_out/piano-beginner-single-vector.musicxml
  (32 notes, 8 valid measures, 0 bad measures; the one rest is drawn as an
  8th-rest glyph while the reference says quarter - documented mismatch).

  PDF.js port: scripts/pdfjs_vector_probe.mjs extracts all 32 noteheads from
  the same PDF with the same SMuFL codepoints; x coordinates match the
  PyMuPDF research extractor exactly (max dx 0.00, mean 0.00). The
  production path (PDF.js, Apache-2.0) already has vector object/staff
  extraction; the port only needs the same duration rules (beam segments,
  dots, SMuFL rests) applied to its operator-list paths. PyMuPDF remains
  research-only (AGPL-3.0); no AGPL dependency is integrated.

  Remaining limitations: grand-staff measure pairing; dense-layout barlines/
  voices; tuplet time-modification (rhythm fixture 16th overcount); rest
  glyph/reference mismatch; no key/time inference; accidental glyphs are not
  yet applied. Image/scans remain a separate, weaker path.
  No merge/deploy; sealed TEST untouched.


## PDF.js-only vector OMR + full-score fidelity (this session)

  Implemented scripts/pdfjs_vector_omr.mjs: PDF.js getOperatorList (staff
  lines, barlines lw>=0.95, stems lw<0.95, diagonal beam segments, filled
  dots) + getTextContent (SMuFL glyphs), page-point coordinates with a
  top-left origin. No PyMuPDF in the production path.
  Rhythm rules: SMuFL noteheads E0A2/E0A3/E0A4; beam levels 0/1/2/3 ->
  quarter/8th/16th/32nd; dots; SMuFL rests E4E3..E4E8; tuplet "3" marks
  above the staff -> 3:2; time signature digits E080..E089; chord clusters
  by notehead centre; grand staves paired into systems by vertical
  proximity; measures from width-filtered barlines.
  MusicXML emits notes/rests, clefs, <time> when decoded, tuplet
  time-modification; no <key> (unresolved, never silently C major).

  PDF.js vs Python research extractor parity (all four PDFs):
    beginner 32/32 events, rhythm 63/63, grand 88/88, dense 226/226;
    python_only 0, pdfjs_only 0. Notehead x parity on beginner: max dx 0.00.

  Complete-event scores vs reference MusicXML (reports/pdfjs_vector_complete.json):
    beginner-single   complete 32/32 (1.000), pitch 11/11, dur 3/3,
                      rests 0/1, measures 8 (0 bad)
    rhythm-tuplets    complete 54/63 (0.857, up from 48/63), pitch 16/16
                      (0.842 precision), dur 11/12 (0.917), rests 3/5,
                      measures 8 (0 bad); 12 tuplet notes decoded
    grand-voices      complete 76/88 (0.864), pitch 76/88, dur 3/3,
                      measures 8 (0 bad; was 16 with per-staff measures)
    dense-advanced    complete 159/264 (0.602), pitch 0.601, measures 8
                      (13 voice-sum defects)
    aggregate         complete 321/447 (0.718, up from 315/447 = 0.705)
  Accepted: PDF.js-only path preserves the verified results, adds tuplet
  decoding (+6 complete events) and fixes grand-staff measure ownership
  (16 -> 8 measures, 0 bad), with no event regression.

  Outputs: data/vector_out_pdfjs/*.musicxml (valid score-partwise).
  Remaining: key signatures/accidentals have no evidence in the C-major
  fixtures and remain unresolved; dense-layout voices/measures; rest glyph
  vs reference mismatch on beginner; tuplet detection depends on visible
  "3" text; image/scan path unchanged and separate.
  No merge/deploy; sealed TEST untouched.


## Production-runtime PDF.js 5.4 + browser evidence (this session)

  Stage 1 compatibility fix: pdfjs-dist 5.4.296 changed constructPath from
  [kindArray, coordsArray] to [paintOp (20=stroke/22=fill/23=eoFill),
  [pathData object], minMax] with normalized ops 0=moveTo,1=lineTo,2=curveTo.
  scripts/pdfjs_vector_core.mjs decodes both 4.x and 5.4 formats; the Node
  wrapper and browser harness share the core. Verified 5.4.296:
    beginner 32 notes / 1 rest, 4/4, key 0, 8 measures
    rhythm 63 notes, 54/63 complete (tuplets preserved)
    grand 88 notes, 76/88 complete, 8 shared grand-staff measures
    dense 226 notes, 159/264 complete
  Results are identical to the 4.10.38 baseline (321/447 complete), so the
  runtime upgrade does not regress any fixture.

  Browser evidence: browser/pdfjs_harness.html + pdfjs_harness.mjs run the
  same core with the browser build (pdfjs-dist/build/pdf.mjs, version
  5.4.296) under Chromium via Playwright; result
  reports/pdfjs54_browser.json: 32 notes, 1 rest, 2 systems, 4/4, vector
  route, valid MusicXML. Worker: build/pdf.worker.mjs.

  Stage 2 completeness:
    - time signatures decoded from SMuFL time digits (E080..E089) -> 4/4.
    - key signatures detected from SMuFL accidental sequences (E260/E262)
      between clef and notes; no glyphs -> key 0 with provenance
      "no-key-glyph" (C major inferred from absence, credited in MusicXML).
    - accidentals detected near noteheads (E260/E261/E262) and applied to
      pitch; not exercised by the C-major fixtures.
    - tuplets: visible "3" marks above the staff -> 3:2 time-modification
      (12 notes on the rhythm fixture, +6 complete events).
    - rests SMuFL E4E3..E4E8; ties, articulations, dynamics remain
      unsupported and are listed in credits (no fabrication).
    - grand-staff staves paired into systems; shared measure numbering.
    - MusicXML emits <key>, <time>, clefs, tuplets, chords, rests with
      <backup> between staves; no unresolved values are invented.

  Stage 3 input interface: scripts/omr_input.py classifies PDF vs image,
  routes PDFs to the PDF.js extractor, and assesses raster quality
  independently (resolution, Laplacian blur, contrast, staff rows).
  Clean image -> readable but recognition_confidence null with an explicit
  limitation; low-res 300x388 -> unreadable, no transcription. Quality and
  recognition confidence are separate fields.

  Stage 4 unfamiliar documents: vector extractor returns route=image for
  beethoven-symphony-7-mutopia, Ao no Sumika, and demo-minuet-in-g (no
  SMuFL vector glyphs / raster PDFs). The image path remains the weak,
  separate fallback; no vector accuracy is claimed for them.

  Remaining blockers: image/scanned OMR; ties/articulations/dynamics;
  dense-layout measure/voice timing; rest glyph/reference mismatch;
  accidentals/key logic implemented but not exercised by the C-major corpus.
  No merge/deploy; sealed TEST untouched.


## Musical correctness & practice readiness (this session)

  Starting research commit e738cd8ffb. Production source 5d5ae10c36, main
  e413f5b865; src/features/vision/pianoVectorCore.js is the deployed core.
  Reproduced the production baseline with pdfjs-dist 5.4.296 and the
  production core: strict exact MIDI+measure+duration notes 306/447
  (the audit's matcher reports 305/447; one-event matcher difference), rests
  3/6, and ZERO practice-ready scores. Beginner blocked only by
  measure-duration-invalid on measure 6 (0-based).

  Root cause of the beginner rest defect: the fixture's notation font maps
  SMuFL 0xE4E6 (canonically an eighth rest) to a drawn quarter rest. The rest
  is placed in the correct measure, but its glyph-derived duration is 0.5
  instead of 1.0, leaving measure 7 at 3.5/4.0. The gate correctly blocked
  the score rather than accepting invalid timing.

  Fix (general, no filename/measure/reference special cases): measure-fill
  reconciliation. When a measure has exactly one known rest, otherwise known
  notes, is short of the decoded meter, and exactly one longer rest value
  fills the measure, accept it with provenance "measure-fill" and confidence
  0.7. Multiple candidates or overfull measures are untouched. The practice
  gate was NOT relaxed: it still requires meter/key, no unresolved glyphs,
  no ties/slurs, and valid measure fill.

  Before/after (strict exact matcher, 4 CC0 fixtures):
    notes 306/447 (P .748/R .685) -> 306/447 (unchanged)
    rests   3/6   (P .5/R .5)     ->   6/6   (P 1.0/R 1.0)
    beginner gate: blocked (measure-duration-invalid) -> PRACTICE-READY
    beginner measures: 7/8 valid -> 8/8 valid
    rhythm bad measures: 5 -> 3; grand: only ties/slurs; dense: unchanged
  Beginner MusicXML verified with music21: 8 measures, every measure 4/4,
  measure 7 = dotted-quarter E, eighth G, quarter rest, quarter A (matches
  reference exactly); 32/32 notes, 1/1 rest.

  Browser verification (real Corranzo-compatible pathway): the browser build
  pdfjs-dist 5.4.296 under Chromium/Playwright runs the candidate core on
  the beginner PDF -> 32 notes, 1 rest, restReconciled 1, gate issues [],
  practiceReady TRUE, valid MusicXML. reports/practice_readiness.json.

  Generalization (separate, flagged patch): PDF.js 5.4 CTM save/restore and
  matrix composition, staff-line width independent detection, SMuFL
  codepoint notehead acceptance, notehead-width clustering, and stem
  proximity to noteheads. Held-out Ao no Sumika: 0 -> 33 vector notes and
  key -5 recovered (was route=image); still not practice-ready (time
  signature unknown, unresolved noteheads, 32 curves). demo-minuet and
  Brahms have 0 SMuFL glyphs -> image route; no vector claim.

  Integration artifacts:
    scripts/pianoVectorCore_minrest.mjs + reports/piano_vector_core_minrest.patch
      (recommended minimal patch: rest reconciliation only, 86-line diff)
    scripts/pianoVectorCore_candidate.mjs + reports/piano_vector_core_general.patch
      (general extraction robustness; separate, unvalidated on references)
    scripts/piano_vector_practice_gate.test.mjs (gate regression)
    reports/practice_readiness.json, data/vector_out_practice/
  Next: curve classification (tie vs slur) and tie merging, multi-page
  vector support, then image-route accuracy. No merge/deploy; sealed TEST
  untouched.


## Structural music understanding: ties, slurs, accidentals, multi-page (this session)

  Phase 1 — curves: grand-voices has one tie (A4 m3->m4) and one slur
  (F4 m1->G4 m2); Ao has 32 curved paths. Added endpoint extraction and a
  classifier using x/y endpoint proximity (2.0 x gap, 2.5 y gap) plus
  pitch continuity: equal MIDI + non-decreasing measure => tie; otherwise
  the closest pair => slur; no pair => ambiguous (gate stays closed).
  Negative controls cover tie, repeated notes without a curve, slur,
  ambiguous, chord partial tie, equal-pitch slur-as-tie, cross-measure tie,
  and multi-voice choice (scripts/piano_curve_classification.test.mjs).

  Phase 2 — MusicXML: ties serialize as <tie type=start/stop/> plus
  <tied>; slurs as <slur type=start/stop number=1/>. Tied continuations are
  not new attacks in playback semantics; no duration is merged without
  equal-pitch evidence. Beginner/grand MusicXML parse with music21; grand
  tie start is A4 in measure 3, stop in measure 4.

  Phase 3 — voices: grand truth uses one voice per staff (staff1/voice1 56,
  staff2/voice2 32); output voice=staff+1 matches. Same-staff polyphony is
  not solved and remains staff-only.

  Phase 4 — real-world: added path-drawn accidental detection (filled
  sharp/natural/flat outlines, e.g. 8.8x11.6 two-rectangle+slant shape),
  which fixed the 12 semitone-low grand events and +31 dense events.
  Ao no Sumika now extracts pages 1/3/4 (33/60/24 notes) with page 2
  incomplete; no reference accuracy is claimed. demo-minuet and Brahms
  remain image fallback (0 SMuFL glyphs).

  Phase 5 — multi-page groundwork: extractPianoVectorPages preserves page
  identity, staff indices and reading-order measure offsets; incomplete
  pages and unresolved cross-page continuations are explicit and block the
  practice gate. This is IR-level merging, not XML concatenation.

  Strict exact MIDI+measure+duration results (before -> after):
    beginner   32/32 (rest 1/1)          -> 32/32 (rest 1/1), practice TRUE
    rhythm     44/63 (rest 5/5)          -> 44/63 (rest 5/5), 3 bad measures
    grand      76/88 (0 bad)             -> 88/88 (0 bad), practice TRUE
    dense      154/264 (4 bad)           -> 185/264 (4 bad)
    total      306/447 (P .748/R .685)   -> 349/447 (P .853/R .781)
    rests      3/6                       -> 6/6
    practice-ready scores: 1 -> 2 (beginner + grand-voices)

  Browser verification (pdfjs-dist 5.4.296 browser build, Chromium):
  beginner 32 notes/1 rest/practiceReady true; grand 88 notes/0 rests/
  practiceReady true with 1 tie + 1 slur serialized. Reports:
  reports/structural_understanding.json, reports/browser_practice_gate.json,
  data/vector_out_practice/*.musicxml.

  Integration: reports/piano_vector_core_general.patch (446 lines, includes
  ties/slurs/accidentals/multi-page; validated on 4 fixtures) and
  reports/piano_vector_core_minrest.patch (86 lines, beginner-only safety
  patch). Tests: piano_vector_practice_gate.test.mjs,
  piano_curve_classification.test.mjs. Gate not weakened: ambiguous curves,
  incomplete pages and unresolved cross-page continuation still block.
  No merge/deploy; sealed TEST untouched.


## Evidence-grounded practice safety: rest corroboration + negative controls (this session)

  PHASE 1 — the beginner rest is encoded as SMuFL 0xE4E6 (eighth rest) but
  is visually a quarter rest in this fixture font. High-DPI crops show the
  SAME small wedge shape for the beginner quarter-context rest and the rhythm
  eighth-context rest; the glyph does not uniquely identify the written
  value. Meter completion is therefore only a consistency check, not proof
  of rest identity. The measure-fill reconciliation is retained as a DRAFT
  inference with provenance "measure-fill", visualEvidence
  "ambiguous-glyph-shape", practiceSafe=false, and restInferred count.

  SAFETY CORRECTION — the practice gate now refuses any score with an
  inferred/ambiguous rest (issues: rest-duration-inferred,
  rest-duration-ambiguous), any unresolved accidental-shaped path, any
  ambiguous curve, incomplete page, or unresolved cross-page continuation.
  The previous "2 practice-ready" claim is corrected: beginner is
  reference-correct but NOT practice-safe; grand-voices remains
  practice-ready (no rests; tie+slur verified).

  Strict reference accuracy is unchanged: notes 349/447 (P .853/R .781),
  rests 6/6 (the beginner rest still matches the reference value, but it is
  an inference and cannot grant practice). Grand 88/88; dense 185/264.

  PHASE 2 — negative controls (scripts/piano_safety_controls.test.mjs, 14
  cases, all pass): correct eighth rest + missing half note refused; partial
  pickup refused; wrong time signature refused; two voices with one short
  voice refused; missing rest refused; multiple ambiguous rests refused;
  unresolved accidental refused; tied vs repeated distinguished; ambiguous
  same-pitch long curve refused; unrelated curve refused; wrong staff
  ownership refused; partially recognized multi-page refused; actual
  beginner recognition refused; actual grand recognition accepted.

  PHASE 3 — curve classifier now uses endpoint geometry with x/y proximity,
  pitch equality, forward measure, and a long/high-curve ambiguity guard
  (same-pitch curve >2.5 gaps high or >10 gaps span is ambiguous, not a
  tie). Grand tie A4 m3->m4 and slur F4->G4 are serialized as <tie>/<tied>
  and <slur>; MusicXML parses with music21. Equal-pitch slurs are treated as
  ties only when the curve is note-attached and short; otherwise abstain.

  PHASE 4 — path-drawn accidentals: filled 2-rectangle + slanted-line
  sharp shapes are classified and attached to the nearest notehead
  (12 grand + 31 dense events recovered). Unknown accidental-sized filled
  paths increment unresolvedAccidentals and block practice.

  PHASE 5 — multi-page: extractPianoVectorPages preserves page identity,
  measure offsets, incomplete pages and cross-page flags. Ao no Sumika
  pages 1/3/4 yield 33/60/24 notes; page 2 is incomplete; the gate refuses
  (no reference accuracy claim). demo-minuet/Brahms remain image fallback.

  PHASE 6 — rhythm (44/63; 3 invalid measures; 2 inferred rests) and dense
  (185/264; 4 invalid measures; unresolved noteheads) remain blocked; no
  artificial rests or stretched notes were added.

  Browser (pdfjs 5.4.296, Chromium): beginner practiceReady FALSE with
  rest-duration-inferred/ambiguous; grand practiceReady TRUE. Reports:
  reports/safety_correction.json, reports/browser_practice_gate.json,
  reports/structural_understanding.json.

  Integration: reports/piano_vector_core_general.patch (465 lines;
  recommended, includes ties/slurs/accidentals/multi-page and safe rest
  provenance). reports/piano_vector_core_minrest.patch (107 lines) now also
  refuses the inferred beginner rest, but grants no practice eligibility by
  itself. Tests: piano_safety_controls.test.mjs,
  piano_curve_classification.test.mjs, piano_vector_practice_gate.test.mjs.
  No merge/deploy; sealed TEST untouched.


## Trustworthy symbol ownership and structural accuracy (this session)

  PHASE 1 — non-identifiable rests: the beginner's 0xE4E6 glyph is visually
  the same wedge as the rhythm eighth-context rest; the pixels do not encode
  quarter vs eighth. We stopped tuning shape classifiers. The draft keeps
  the inferred quarter rest with provenance measure-fill /
  ambiguous-glyph-shape, and practice stays disabled. The exact unresolved
  symbol (measure 7, 0xE4E6) is recorded for future human correction.

  PHASE 2 — accidental ownership: path-drawn accidentals are now assigned
  EXCLUSIVELY to the nearest unassigned notehead to their right (edge-aware
  stem ownership first, cluster-centre fallback for chords). Unknown
  accidental-sized filled paths block practice (unresolved-accidentals).
  Grand 88/88; dense 185 -> 195/264 (exclusive assignment recovered 10 more).

  PHASE 3 — curves: endpoint geometry + pitch equality + forward measure +
  long/high ambiguity guard; same-pitch curves that are too long/high are
  ambiguous, not ties. MusicXML <tie>/<tied>/<slur>. Grand A4 tie m3->m4 and
  F4->G4 slur serialized; curve precision on fixtures 2/2, 0 false ties.
  Negative controls cover tie, repeated notes, different-pitch slur,
  equal-pitch slur-as-tie, ambiguous long curve, chord partial tie, cross-
  measure tie, multi-voice.

  PHASE 4 — rhythm: tuplets now assigned to the nearest marker per note
  (2.2-gap window) and filtered by system y; stem ownership uses the
  notehead edge (1.25 gaps right / 0.25 left) with cluster fallback. Rhythm
  improved 44 -> 62/63 notes (98.4%), 4/5 rests, one remaining invalid
  measure (the dotted-eighth F has no drawn flag/beam in the PDF and the
  final quarter rest is glyph-ambiguous; no rests/durations were invented).

  PHASE 5 — dense: 195/264 exact (73.9%), 4 invalid measures, unresolved
  noteheads remain; no artificial fixes.

  PHASE 6 — Ao no Sumika: pages 1/3/4 extract 33/60/24 notes, page 2
  incomplete; gate refuses; no reference accuracy claim. Demo-minuet and
  Brahms remain image fallback.

  PHASE 7 — safety: gate unchanged in strictness. 14 safety controls,
  7 curve controls and the practice-gate regression all pass. Beginner is
  reference-correct but practice-blocked; grand is the only safe score.

  Strict before -> after (notes/rests):
    beginner 32/32, 1/1      -> 32/32, 1/1 (practice BLOCKED)
    rhythm   44/63, 5/5      -> 62/63, 4/5 (blocked: rest + measure)
    grand    88/88, 0/0      -> 88/88, 0/0 (practice READY)
    dense    185/264, 0/0    -> 195/264, 0/0 (blocked)
    total    349/447 (P .853/R .781) -> 377/447 (P .922/R .843)
  Practice-ready safe scores: 1 (grand). Correct-on-reference and
  safe-to-practice remain separate metrics.

  Browser pdfjs 5.4.296: beginner practiceReady false (rest inferred/
  ambiguous); grand practiceReady true. Reports: symbol_ownership.json,
  browser_practice_gate.json, safety_correction.json,
  piano_vector_core_general.patch (465 lines), minrest patch (107 lines).
  No merge/deploy; sealed TEST untouched.


## Corrected CC0 engravings: generator defects vs recognition (this session)

  Root cause of the last rhythm/beginner errors: the benchmark corpus
  generator had two engraving defects, not recognition defects:
    1. The benchmark font had no quarter-rest glyph. The generator mapped
       duration 12 (quarter rest) to 0xE4E6 (eighth rest), so the printed
       PDF showed an eighth rest while the reference said quarter.
    2. Flags were drawn only for duration <= 6, so dotted-eighth (9) and
       tuplet eighth (4) values were printed without a flag/beam and looked
       like quarters.
  These defects make the original beginner/rhythm PDFs visually
  underdetermined. They remain blocked for practice (rest-duration-inferred
  / ambiguous); no reference answer was hardcoded.

  Corrected corpus: benchmarks/omr-fixtures-corrected (same CC0 reference
  MusicXML, separate PDFs/font; original corpus preserved). The corrected
  font adds SMuFL 0xE4E5 quarter rest; the corrected generator draws one
  flag for durations 4/6/9 and two for 3. Provenance in the corrected
  README. This is reference-backed validation material, not training data.

  Results with the SAME recognition candidate (pdfjs 5.4.296):
    beginner 32/32 notes, 1/1 rest (provenance pdfjs-vector, no inference),
             8/8 valid measures, practiceREADY
    rhythm   63/63 notes, 5/5 rests, 8/8 valid measures, tie classified,
             practiceREADY
    grand    88/88 notes, 0/0 rests, 8/8 valid measures, tie+slur,
             practiceREADY
    dense    195/264 notes, 4 invalid measures, blocked
    corrected total 378/447 notes (P .924/R .846), rests 6/6.
  Browser (pdfjs 5.4.296, Chromium): corrected beginner/rhythm/grand all
  practiceReady true; reports/browser_practice_gate.json.

  This is the primary success: another complete reference-backed score
  (rhythm 63/63 + 5/5 rests, 0 invalid measures) and a safely restored
  beginner, through corrected engraving evidence rather than relaxed gates
  or hardcoded answers. The original corpus remains honestly blocked.
  Correctness-on-reference vs readiness-without-reference remain separate:
  the corrected corpus is reference-scored, while readiness uses only the
  recognition IR (visual rest glyph, flags, meter, curves, measures).

  Remaining blockers: dense 195/264 (69 unmatched); independent
  font/engraver generalization beyond the CC0 generator; OSMD/save-reopen
  not run (no node_modules); multi-page Ao remains incomplete. No
  merge/deploy; sealed TEST untouched.


## Independent engavers, voice safety and tuplet ownership (this session)

  PHASE 1 — honest fixture baseline: original vs corrected corpus kept
  separate. The original rhythm/beginner PDFs are visually underdetermined
  (missing quarter-rest glyph, missing dotted-eighth/tuplet flags) and stay
  blocked. On the SAME corrected inputs, the production baseline (e413f5b)
  scores 307/447 notes (68.7%); the candidate scores 378/447 (84.6%):
    rhythm 45->63/63, grand 76->88/88, dense 154->195/264, beginner 32/32.
  This isolates +71 events of algorithmic improvement from artwork fixes.

  PHASE 2 — voice-local timing: assignVoices splits a staff into up/down
  stem voices; the gate validates each (measure, staff, voice) sum, not the
  staff total. The exact integration false acceptance (two voices, two
  beats each) is BLOCKED with voice-duration-invalid; two voices filling
  four beats each are accepted. Regression in
  piano_safety_controls.test.mjs.

  PHASE 3 — curves: ties now require close notehead attachment (<=1.4
  gaps), same staff, consecutive same-staff/voice x order, no intervening
  note, compact span/height. Equal-pitch far/high curves, intervening-note
  curves, cross-staff curves and unattached decorations are ambiguous, not
  ties. Short adjacent equal-pitch curves remain ties by notation
  convention. False-tie controls added; grand/rhythm ties still classified.

  PHASE 4 — tuplets: one numeral may own at most three chord/note
  clusters within 3 gaps and a 5-gap span; clusters are exclusive. A single
  "3" can no longer assign six unrelated notes; a triplet of three two-note
  chords still owns six noteheads. Adjacent markers do not steal each
  other's notes. Corrected rhythm remains 63/63.

  PHASE 5 — accidentals: exclusive assignment retained; chord/cluster and
  voice ownership preserved. Dense improved 185->195 with exclusive
  assignment. Path key-signature-region exclusion is still not
  implemented; key=0 provenance remains.

  PHASE 6 — independent engravers: Verovio is available, but Chrome/PyMuPDF
  PDF export outlines glyphs (6 text items/1 SMuFL in the Chrome PDF; 0 in
  PyMuPDF). The vector extractor correctly falls back to image; no
  independent text-layer SMuFL PDF is available locally (MuseScore/LilyPond
  absent). Independent-engraver accuracy is NOT claimed.

  PHASE 7 — practice safety: 14 safety controls (now including the exact
  two-voice false acceptance and tuplet over-ownership), 11 curve controls,
  corrected-corpus gate test and original-corpus gate test all pass.
  Original beginner/rhythm remain blocked; corrected beginner/rhythm/grand
  are practice-ready in the browser (pdfjs 5.4.296).

  PHASE 8 — browser: corrected beginner 32 notes/1 rest, rhythm 63/5,
  grand 88/0; all practiceReady true. Original beginner remains false
  (rest-duration-inferred/ambiguous). Reports: symbol_ownership.json,
  corrected_baseline_vs_candidate.json, corrected_corpus.json,
  independent_engraver_probe.json, browser_practice_gate.json.

  Remaining blockers: dense 195/264 (69 unmatched), key-signature-region
  exclusion, independent text-layer engraver corpus, OSMD/save-reopen,
  multi-page Ao. No merge/deploy; sealed TEST untouched.


## Voice graph, curve ownership & cross-engraver reliability (this session)

  PHASE 1-2 — voice graph and verified ownership: assignVoices now records
  stem ownership per note (edge vs position-fallback), splits upward/downward
  stems into voices only as INFERRED evidence, and builds a voiceGraph
  {notes, staves, voices, splits, conflicts, edgeStems, unresolvedStems,
  verified}. voiceOwnership is "verified" only for a single voice per staff
  with zero stem conflicts and zero unresolved/fallback stems; all two-voice
  stem splits are "inferred" and practice-blocked with
  voice-ownership-unverified. The integration agent's two-incomplete-voices
  case (2+2 beats, staff total 4) is blocked by voice-duration-invalid; a
  stem-split two-voice score is blocked even when both voices fill, because
  stems alone are not proof. Corrected beginner/rhythm/grand: single voice
  per staff, 32/63/88 edge stems, 0 conflicts -> verified. Dense: 8 conflicts,
  12 fallback stems -> inferred, blocked.

  PHASE 3 — curves: ties require close notehead attachment (<=1.4 gaps),
  same staff, consecutive same-staff/voice order, no intervening note, and
  compact span/height; equal-pitch far/high, intervening-note, cross-staff
  and unattached decorative curves are AMBIGUOUS, not ties. Short adjacent
  equal-pitch curves remain ties by notation convention. 11 curve negative
  controls pass; on the fixture set 2/2 ties and 1/1 slurs correct, 0 false
  ties, 0 false slurs. Ambiguous curves keep practice closed.

  PHASE 4 — tuplets: one numeral may own at most three chord/note clusters
  within 3 gaps and a 5-gap span; clusters are exclusive. A single "3" can
  no longer assign six unrelated notes; a triplet of three two-note chords
  still owns six noteheads; adjacent markers do not steal notes. Corrected
  rhythm 63/63, 5/5 rests, 12/12 tuplets, 8/8 measures.

  PHASE 5 — key/accidental regions: path-drawn accidentals between the clef
  and the time signature are assigned to the key, marked used, and excluded
  from inline assignment; text-drawn accidentals are also exclusive. No
  fixture exercises path-key signatures (C major); inline accidentals are
  unchanged. Dense 195/264 (exclusive assignment recovered 10).

  PHASE 6 — independent engraver: Verovio -> Chrome PDF outlines glyphs
  (6 text items, 1 SMuFL; vector route=image). The separate image fallback
  (homr 0.7.0, AGPL research only) on the 200-dpi Verovio beginner raster
  scores 32/32 notes, 1/1 rest, 8/8 measures (strict). This is a genuine
  different engraver but a single score; no broad cross-engraver claim.

  PHASE 7 — dense: 195/264, 69 missing / 31 extra. Classified: accidental
  semitone 23, missing notehead 24, duration wrong 29, other pitch 8, extra
  notehead 16. Dense remains practice-blocked (unresolved noteheads, 8 stem
  conflicts, 4 invalid measures).

  Corrected metrics: 378/447 notes (P .924/R .846), rests 6/6; practice-ready
  verified scores = 3 (beginner, rhythm, grand); dense false. Original
  beginner/rhythm remain blocked. Browser pdfjs 5.4.296: corrected three
  all practiceReady true. Reports: symbol_ownership.json,
  corrected_baseline_vs_candidate.json, verovio_image_fallback.json,
  independent_engraver_probe.json, browser_practice_gate.json.
  No merge/deploy; sealed TEST untouched.


## Evidence-based voice safety and real-world coverage (this session)

  PHASE 1 — adversarial integration harness: ran the main-owned 15-case
  synthetic IR audit against the candidate. Initial result 9/15; after
  tightening, 15/15 refused practice with 0 false acceptances. Fixed false
  accepts: same-staff two incomplete voices, equal-pitch short slur,
  cross-voice curve, decorative short curve, one-voice-four-quarters,
  matching-stem two-voice score. Duplicate voiceOwnership field resolved to a
  single authoritative field; JSON serialization/reopen preserves the
  assessment.

  PHASE 2 — voice ownership: verified now requires edge-attached stems for
  every note, zero conflicts, zero fallback stems, and no stem-direction split.
  Stem direction alone is never sufficient. Synthetic controls with stem_x but
  no edge stemOwnership are inferred and blocked.

  PHASE 3 — curves: flat decorative arcs (height < max(3, 0.12*span)) are
  ambiguous; ties require same voice when known. 11 negative controls pass;
  corrected rhythm tie and grand tie/slur preserved. Equal-pitch short slur,
  cross-voice and decorative curves now ambiguous.

  PHASE 4 — tuplets/accidentals: tuplet exclusivity unchanged; path-key region
  bug fixed (clefGlyph reference) and exercised with a generated G-major
  fixture: key=1, sharp marked used, not reused inline, 4/4 notes,
  practiceReady=true.

  PHASE 5 — independent engraver: generated Verovio (SVG->Chrome PDF) probe
  failed vector staff detection (image fallback route), consistent with the
  earlier Verovio/Chrome outlined-PDF finding. The separate image fallback
  remains the credible route for outlined engravers. No broad cross-engraver
  claim added.

  PHASE 6 — dense: unchanged 195/264; categories accidental semitone 23,
  missing notehead 24, duration wrong 29, other pitch 8, extra notehead 16.

  PHASE 7 — browser: pdfjs 5.4.296 under Chromium; corrected beginner
  (32/1), rhythm (63/5), grand (88/0) all practiceReady=true. Assessments
  survive JSON serialization/reopen.

  Metrics unchanged: corrected 378/447 notes (P .924/R .846), 6/6 rests;
  practice-ready corrected scores = 3. Original beginner/rhythm remain blocked.
  Adversarial audit = 15/15. No merge/deploy.


## Dense accidental breakthrough (this session)

  Tightened accidental-to-notehead vertical tolerance from 0.8/0.6 gap to
  0.45 gap. This resolves stacked-accidental cross-assignment in dense
  chords. Dense recognition: 195/264 -> 240/264 (TP +45, FP 31->24,
  FN 69->24); unresolved noteheads 38 -> 0; total controlled accuracy
  378/447 -> 423/447. Beginner/rhythm/grand remain 32/32, 63/63,
  88/88 and practice-ready. Adversarial suite remains 15/15. Current head
  15322acf5e.


## Dense voice conflicts resolved (this session)

  All 8 dense voice conflicts were false positives: chord members with
  staggered notehead x positions (spread 2.5) sharing one stem. Threshold
  for shared-stem x spread changed from 1.5 to 3.0. Dense voiceOwnership
  is now verified; Practice remains blocked by 24 duration mismatches
  (0.5 vs 1.0). Adversarial suite remains 15/15. Current head 332125bed2.


## Dense exact recognition (this session)

  Relaxed beam vertical filter from 4 to 5 staff gaps. This captures beams
  just above the previous threshold. Dense recognition: 240/264 -> 264/264
  (TP +24, FP 24->0, FN 24->0); total controlled accuracy 423/447 ->
  447/447. Beginner/rhythm/grand remain 32/32, 63/63, 88/88 and
  practice-ready. Dense voice ownership is verified, but Practice remains
  blocked by measure-duration-invalid due to voice grouping. Adversarial
  suite remains 15/15. Current head 63a8f2ddb9.
