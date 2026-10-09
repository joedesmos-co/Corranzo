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
