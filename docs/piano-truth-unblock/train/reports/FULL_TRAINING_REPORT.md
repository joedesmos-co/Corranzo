# Full supervised training campaign — report

Plan: `reports/COMPREHENSIVE_PROBE.md` P14. Data freeze intact
(dataset manifest hash verified). Both TESTs sealed throughout.
CPU only; no architecture sweep; no hyperparameter tuning.

## 1. Dataset integrity

- Splits frozen: TRAIN 792 / DEV 99 / TEST 99, disjoint (verified).
- Dataset manifest hash matches the committed file.
- trainFull items cover exactly the 792 TRAIN scores (135,143 items), zero
  leakage into DEV/TEST. dev20 items cover 20 DEV scores, zero leakage.
- Canonical events + joins unchanged from the verified pilot/probe.
- Note: v1 items were rebuilt for full training with expanded vocabs
  (duration 11→16, voice 7→8, staff 4→10 classes from full-TRAIN scan) and
  the validated corner-anchored framing; the P12 probe ran on the prior
  build, which remains reproducible from git history + the deterministic
  adapter.

## 2. Architecture actually trained

Three task-specific probes (no monolith), identical to the validated designs:
- **common**: local crop trunk + 9 heads (kind/pitch/duration/dots/staff/
  accidental/grace/cue/voice).
- **membership**: local crop trunk + 18 binary membership heads.
- **context**: strip tower + geometry → staff/voice (+kind/pitch/dur reference).
Uniform masked cross-entropy; AdamW lr=3e-4; batch 256; 8 CPU threads.
Augmentation: seeded photometric + mild affine on crops (JPEG/affine at 20%
rate for CPU cost); geometry inputs left unmapped (documented approximation);
perspective covered separately by the verified page-level recipe.

## 3. Compute used

CPU only (8 torch threads), batch 256, single-process loader. Runtimes:
common 2,561 s (7 epochs), membership 2,694 s (8 epochs), context 1,245 s
(9 epochs); controls blank 4,254 s / shuffled 2,765 s (5 / 7 epochs).
Total ≈ 3.5 h wall-clock sequential. Disk stayed above 29 GB free; checkpoints
are ~1 MB each (best + final per run). No GPU used; no RTX available/needed.

## 4. Training curve

Common: train loss 0.751 → 0.330 over 7 epochs; DEV metric 0.318 → best
0.7345 at epoch 3, early stop at 7. Membership: best 0.9445 at epoch 4, stop
at 8. Context: best 0.8145 at epoch 5, stop at 9. Full per-epoch curves in
`manifests/full_fit_*_normal.json`. No instability after the pre-flight
normalization fix; augmentation did not destabilize.

## 5. Best checkpoint

Single best-DEV checkpoint per probe (no re-selection):
`models/full_common_normal_best.pt` (epoch 3, metric 0.7345),
`models/full_membership_normal_best.pt` (epoch 4, metric 0.9445),
`models/full_context_normal_best.pt` (epoch 5, metric 0.8145).
SHA256 hashes in the fit manifests; final-epoch models also saved.

## 6. DEV metrics (best checkpoints)

Common heads (DEV, n in parentheses): kind 0.996 (5,371), pitch **0.665**
(5,001), duration **0.804** (4,260), dots 0.964, staff 0.712, accidental 0.980
(6 classes), grace 0.991, cue 1.000, voice 0.807. Majority baselines: pitch
0.094, duration 0.58, kind 0.964, staff 0.783, voice 0.799.
Membership (accuracy / precision / recall): in_beam 0.903 / 0.92 / 0.95;
chord_tone 0.986 / 0.94 / 0.96; tie_start 0.965 / 0.46 / 0.18; tie_end 0.968 /
0.62 / 0.10; slur 0.982 / 0.56 / 0.11; dotted 0.977 / 1.00 / 0.45; accidental
0.992 / 0.84 / 0.96; tuplet/articulation/ornament/fingering/arpeggio/glissando/
pedal/octave/hairpin at majority with recall 0.0 (too rare in dev20) or
dev-unevaluable (zero positives: cue, ornament, fingering, arpeggio, glissando,
pedal, octave).
Context: staff **0.822**, voice 0.807 (reference: kind 0.931, pitch 0.669,
duration 0.600).

## 7. Common/rare family breakdown

Well-supported families learn and generalize (pitch, duration, kind, beams,
chord-tones, accidentals, dotted). Rare membership heads (tie/slur/tuplet/
articulation/ornament/fingering/arpeggio/glissando/pedal/octave/hairpin) sit
at majority accuracy with 0.0–0.25 recall on dev20; several have zero DEV
positives and are train-supervised only. This matches the preregistered
expectation that rare heads follow support; no rare head is claimed as working
without positives.

## 8. Minority duration result

Duration collapse is real and quantified (DEV): 8th 0.932 (2,486), half 0.966
(117), quarter 0.607 (633), 16th **0.870** (679 — learned despite minority
status), dotted-8th 0.284 (67), whole/dotted-half/32nd/dotted-quarter 0.000
(n=7/13/133/125). Collapse threshold sits around ~150 examples in this setup;
16ths clear it, 32nds and dotted variants do not. Mitigation belongs to the
next phase (balanced sampling with a stability proof, per the fixed strategy).

## 9. Context improvements

Staff: 0.822 context vs 0.712 crop-only (+0.11) — the strip tower supplies
genuinely new evidence. Voice: 0.807 vs 0.807/0.751 — at the geometry ceiling;
neither crops nor strips demonstrate visual voice discrimination beyond
positional correlation. Voice needs sequential/beam reasoning (future
decoder), documented as a limit.

## 10. Causal controls

Training-time (full data): blank pitch 0.075 / dur 0.159; shuffled pitch
0.079 / dur at majority. Inference-time on final models: blank pitch 0.062 /
dur 0.159; wrong-page pitch 0.067 / dur 0.434 / kind 0.878. The model depends
on the correct notation pixels at both training and inference; geometry-only
carries no pitch/duration signal. Voice-from-geometry reaches majority via
staff correlation (disclosed, not hidden).

## 11. OLiMPiC DEV domain gap

Predefined diagnostic re-run (DEV only, 1,438 samples, TEST untouched):
scans are variable-size system crops (width median 2,847 vs fixed 2,480
pages), ~2× contrast (66.5 vs 30.9), ~5× texture energy (11,048 vs 2,066),
~4× ink density (0.150 vs 0.037), LMX 32–808 tokens/system (median 248).
No transcription attempted (sequence model out of scope); no tuning against
this domain. Transfer remains unproven by design of this phase.

## 12. Score-level reconstruction result

Per-note attribute sequences in source order on full DEV (99 scores):
joint pitch+duration+staff+voice exact-match **0.449** (5,001 notes);
per-score mean 0.666, min 0.155. This measures attribute-sequence fidelity,
NOT sheet-music equivalence (no pairing/ordering semantics beyond source
order, no engraving validity). High glyph accuracy does not equal correct
reconstructed sheet music — stated explicitly.

## 13. Remaining unsupported notation

Unchanged from the V1 gate: scoop/doit/fall articulations, dropping
single-tremolo encodings, unrendered arpeggios, rit.-style unmapped words
(all with quarantine or explicit non-transcription behavior); BLOCKING_GAP
(glissandi, turns, breaths, measure numbers, standalone voltas, nested
tuplets, cue DEV metric) still gates V1 completeness claims, not training.

## 14. Comparison to previous proof

Small probe → full campaign (same code family, same budget rules):
pitch 0.680 → **0.665**, duration 0.686 → **0.804**, kind 0.996 → 0.996;
in_beam 0.828 → **0.903**, chord_tone 0.969 → **0.986**; context staff 0.811 →
**0.822**. Duration and relationship heads improved with full data; pitch
stable. Rare-head pattern reproduced (support-dependent). No contradiction;
scale helped where support existed.

## 15. Whether further training is justified

Yes, narrowly scoped: (a) rare-class handling with a stability proof (balanced
sampling/focal variants were rejected once for instability — retry only with
per-head gradient monitoring); (b) voice/sequence decoder work (page-level
LMX-style transcription toward OLiMPiC-style evaluation); (c) C-list data
expansion (feature-token search + verified pipeline). Uncapped sweeps and
architecture churn are not justified by these results.

## 16. Whether the recipe is ready for final sealed-test acceptance

Not yet. The recipe is frozen and validated on DEV, but acceptance requires:
(a) the C-list data expansion for completeness claims, (b) a voice/sequence
decoder before note-level real-world acceptance is meaningful, (c) the
controlled-capture batch for note-level real-world truth. Pilot TEST and
OLiMPiC TEST remain sealed; the single acceptance run happens only after
(a)–(c) land.

## 17. Exact next step

1. Targeted C-list expansion (glissandi, turns, breaths, measure numbers,
   voltas, nested tuplets + cue-bearing scores) via feature search over
   PDMX + the verified pipeline — data only, no model changes.
2. In parallel: execute the staged 8-page controlled capture for note-level
   real-world truth.
3. Then: voice/sequence decoder probe against OLiMPiC DEV (still sealed TEST),
   and only then the single frozen acceptance run on both TEST sets.
