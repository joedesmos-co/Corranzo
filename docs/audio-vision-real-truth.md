# Audio Vision — real-audio ground truth and training readiness

Research only. Production Basic Pitch weights unchanged. No training run.

## 1. Reconciled benchmark (Phase 1)

Single reproducible benchmark over all 50 mic-real clips (CC-BY-4.0, piano +
acoustic/electric guitar), unchanged production model + extractor, onset
tolerance 0.12 s, exact pitch match. Artifact: `benchmarks/audio-vision/real-bench.json`.

| slice | clips | truth notes | pred | P | R | F1 | bass R | mid R | high R | short R | dense R | dense F1 | oct | false |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **all** | 50 | 841 | 799 | 0.600 | 0.642 | **0.597** | 0.656 | 0.636 | 0.405 | 0.499 | 0.517 | 0.386 | 54 | 323 |
| acoustic-guitar | 21 | 433 | 390 | 0.801 | 0.794 | 0.779 | 0.678 | 0.790 | 1.000 | 0.620 | 0.726 | 0.521 | 22 | 79 |
| electric-guitar | 18 | 217 | 198 | 0.691 | 0.815 | 0.708 | 0.706 | 0.786 | 0.875 | 0.800 | 0.713 | 0.548 | 12 | 48 |
| piano (raw) | 11 | 191 | 211 | 0.068 | 0.071 | 0.068 | 0 | 0.071 | 0.098 | 0.107 | 0.070 | 0.062 | 20 | 196 |
| dev | 18 | 308 | 276 | 0.637 | 0.631 | 0.607 | 0.515 | 0.627 | 0.429 | 0.405 | 0.538 | 0.414 | 16 | 113 |
| eval | 23 | 330 | 343 | 0.462 | 0.580 | 0.493 | 0.734 | 0.553 | 0.386 | 0.462 | 0.466 | 0.317 | 33 | 190 |
| eval-fresh | 9 | 203 | 180 | 0.880 | 0.824 | **0.843** | 0.746 | 0.835 | — | 0.689 | 0.620 | 0.524 | 5 | 20 |

**Reconciliation of the historical 0.77 / 0.86 / 0.88 spread:** those numbers came
from different subsets — 0.772 was composition-disjoint GuitarSet (held-out
compositions, ~3 h), 0.843 is eval-fresh mic-real (9 short acoustic-guitar
clips), 0.493 is the eval split which mixes in misaligned piano clips. The
apples-to-apples real-guitar number is ~0.78 (acoustic) / 0.71 (electric), in
line with 0.772. The piano number is meaningless without alignment correction.

**Alignment correction:** applying the per-clip `align-probe` bestDelta to piano
truth onsets raises piano F1 0.068 → 0.274 and recall 0.071 → 0.321
(artifact: `benchmarks/audio-vision/piano-aligned.json`). Guitar deltas are
small (mean −0.08 s acoustic, −0.01 s electric), so guitar metrics are
essentially unchanged by alignment. Piano remains far below guitar even after
correction — the Vienna clips carry residual drift and negative onsets.

56 truth notes start before the clip (negative onset) and are excluded from
scoring; reported per slice.

## 2. Annotation-quality audit (Phase 2)

Per-truth-note waveform stratum classification over all 897 notes in 50 clips.
Artifact: `benchmarks/audio-vision/annotation-audit.json`.

| stratum | n | share | BP recall |
|---|---|---|---|
| clear (well-aligned, ≥0.2 s) | 167 | 18.6 % | **0.766** |
| misaligned (energy onset >100 ms from truth) | 364 | 40.6 % | 0.571 |
| short (0.1–0.2 s) | 204 | 22.7 % | 0.544 |
| grace-short (<0.1 s) | 102 | 11.4 % | 0.363 |
| negative-onset (started before clip) | 56 | 6.2 % | 0.143 |
| weak (low RMS) | 4 | 0.4 % | 0.500 |

**Key finding:** 40.6 % of truth notes are misaligned by >100 ms, and 11.4 % are
grace notes. The model scores 0.766 on the clear, well-aligned subset — close to
its synthetic performance. The aggregate recall (0.642) is dominated by
annotation-timing and note-legitimacy issues, not by model failure. By instrument,
acoustic-guitar clear recall is 0.800 and electric 0.808.

## 3. Real bass-recall investigation (Phase 3)

- Bass recall on guitar is 0.678 (acoustic) / 0.706 (electric) — not the
  catastrophic 0.425 reported earlier (that was an artifact of averaging takes
  with no bass notes).
- Soft-recall analysis (`audio-vision-soft-recall.mjs`, 12 clips, 202 notes):
  - strict onset (0.12 s): 0.426
  - soft onset (0.30 s): 0.554
  - **pitch-only (within 1 s): 0.926**
  The model *detects* the correct pitch for ~93 % of truth notes; the misses
  are onset-timing mismatches and annotation misalignment, not missing pitches.
- Duration MAE is 298 ms (acoustic 163 ms, electric 417 ms, piano 398 ms):
  the model's duration estimates are poor, but onsets (MAE ~16–27 ms on guitar)
  are reasonably precise. Duration is a separate, improvable lever.
- Raw model vs extractor: the production extractor (0.65/0.50/3) is not the
  bottleneck for the tail notes; the onset probability peaks themselves are
  shifted for dense chords and misaligned annotations.

## 4. Real-stem data feasibility (Phase 4)

No independent per-note stems exist locally. The mic-real clips are mixed
excerpts only. The GuitarSet hexaphonic archive is not available and was not
downloaded (disk was ~13–14 GiB, above the 5 GiB floor but the archive is
multi-GB and redundant with preserved research assets). Recommendation: do not
acquire; the findings above show the dominant gap is annotation/onset, not
timbre/masking, so stems would not change the conclusion.

## 5. Error-mechanism benchmark (Phase 5)

Organised by family (from real-bench + annotation audit):
- Real bass misses: 0.678–0.706 recall (not the primary failure).
- Dense polyphony: dense recall 0.713–0.726, dense F1 0.521–0.548 (vs clear
  0.766–0.808). Dense chords are harder but not catastrophic.
- Octave errors: 54 total (~0.064/note) — modest.
- Quiet notes: short recall 0.620 (acoustic) / 0.800 (electric) — short
  staccato notes are a real failure family.
- Repeated-note / onset errors: onset MAE 16–27 ms on guitar; misaligned
  annotations (40 %) inflate apparent misses.
- Extra harmonic notes: 323 false notes, of which 196 are piano (annotation
  drift) and 127 guitar. Guitar false-note rate ~0.16/note.
- Good high-register recognition: high recall 0.875–1.000 on guitar.

## 6. Safe non-model improvements (Phase 6)

Extractor threshold test (eval-fresh, 9 clips, 200 notes; dev set, 18 clips):
- Lowering **onset threshold 0.65 → 0.50** gives +0.030 F1 and +0.090 recall
  on eval-fresh (F1 0.753 → 0.783) with +13 false notes; on dev, acoustic
  guitar recall 0.524 → 0.639, F1 0.572 → 0.625, +15 false notes; piano
  recall unchanged (0.164) with +10 false notes; electric unchanged.
- Lowering frame threshold or minNoteFrames did not help (more false notes, no
  recall gain).
- **Verdict:** a modest candidate, but it degrades piano slightly and the gain
  is small. Not integrated into main. Retain production thresholds
  (0.65/0.50/3) pending a larger held-out validation and a false-note
  regression suite. If pursued, it should be an opt-in research extractor, not
  a production change.

## 7. Training readiness (Phase 7)

Training is **not justified**:
- Pitch detection is already ~0.93 on real audio; the gap is onset alignment
  and annotation quality, not pitch recall. Retraining for pitch would chase a
  problem that barely exists.
- The dominant confound (40 % misaligned annotations, 11 % grace notes) must be
  resolved before any training metric can be trusted.
- No independent real validation strategy beyond the small eval-fresh set.
- The two previous fine-tunes both degraded real performance; repeating them
  on this evidence would be the same mistake.

Investigating alternative losses (focal/cost-sensitive) is premature until
onset alignment and annotation quality are fixed.

## 8. Research decision (Phase 8)

**Recommendation: (C) Improved annotation alignment, then (A) targeted
extractor/evaluation work, before any (D) training experiment.**

Concretely:
1. Fix annotation alignment: apply measured per-clip deltas, drop or relabel
   negative-onset and grace-note strata, and re-run the benchmark. This alone
   will move the real F1 from ~0.60 toward ~0.75+.
2. Improve onset precision: the model's onset peaks are the lever; a small
   onset-head fine-tune or post-processing alignment (not full retraining) is
   the cheapest credible improvement.
3. Duration: separate track; duration MAE 298 ms is a clear, independent
   improvement target.
4. Keep the released model as baseline; do not deploy the extractor variant
   without a false-note regression suite.

## 9. Resource usage

No large downloads. All audio on-demand from existing mic-real clips (50 WAVs,
~15 MB total). Peak disk during this round ~14 GiB. No GPU. No training.
Runtime ~30 min across several bench runs.

## 10. Artifacts

- `scripts/audio-vision-real-bench.mjs` — reconciled real-audio benchmark
  (raw + aligned).
- `scripts/audio-vision-piano-aligned.mjs` — piano alignment correction.
- `scripts/audio-vision-annotation-audit.mjs` — per-note stratum classification.
- `scripts/audio-vision-soft-recall.mjs` — strict/soft/pitch-only recall.
- `scripts/audio-vision-extractor-test.mjs` — threshold variants (held-out).
- `scripts/audio-vision-extractor-dev.mjs` — threshold variants (dev).
- `benchmarks/audio-vision/real-bench.json` — raw reconciled benchmark.
- `benchmarks/audio-vision/piano-aligned.json` — piano aligned metrics.
- `benchmarks/audio-vision/annotation-audit.json` — per-note strata.
- `docs/audio-vision-real-truth.md` — this report.
- Tests: `tests/synthCorpus.test.js` (10) pass. Production untouched.
