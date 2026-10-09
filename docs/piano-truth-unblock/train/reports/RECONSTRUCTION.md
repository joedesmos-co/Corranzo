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
