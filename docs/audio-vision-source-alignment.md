# Audio Vision — source alignment, onset truth and event reconstruction

Research only. Production Basic Pitch weights untouched. No deployment.

## Milestone 1 — Independent source-timeline audit

Clip metadata: 50 clips, 3 s excerpts, 44.1 kHz, startSeconds 0–547 s into
source recordings. 29 unique source files, 30 unique truth files. 56/897 truth
notes have negative onset (started before the clip).

Align-probe (DSP: spectral-flux peaks, no model) per instrument:
- **Piano:** systematic offset (bestDelta −0.125 to −0.85 s, high match rate).
  Truth onsets are consistently early. Real alignment problem.
- **Acoustic guitar:** small offset (mean −0.08 s). Most of the earlier
  "40.6 % misaligned" stratum is weak/scattered attacks and grace notes.
- **Electric guitar:** essentially aligned (mean −0.01 s).

Independent waveform check (RMS energy attack nearest to truth onset) confirms:
piano truth ~96 ms early; acoustic bossa-single ~10 ms early. The align-probe
correction is waveform-supported, not model-optimized.

## Milestone 2 — Evaluator correction (separate eval copy)

Applied per-clip align-probe deltas to truth onsets; kept raw scoring visible.
Artifact: `benchmarks/audio-vision/real-bench-aligned.json`.

| slice | raw F1 | aligned F1 | raw R | aligned R |
|---|---|---|---|---|
| piano | 0.068 | **0.274** | 0.071 | 0.321 |
| acoustic-guitar | 0.779 | 0.691 | 0.794 | 0.716 |
| electric-guitar | 0.708 | 0.686 | 0.815 | 0.800 |
| eval (mixed) | 0.493 | 0.548 | 0.580 | 0.653 |
| eval-fresh (guitar) | 0.843 | 0.755 | 0.824 | 0.739 |
| all | 0.597 | 0.597 | 0.642 | 0.659 |

**Key finding:** the correction helps piano substantially but *hurts* guitar.
A single global correction does not work for all instruments. The piano
alignment problem is real; the guitar "misalignment" is mostly weak attacks and
grace notes, not a systematic offset. Do not apply align-probe deltas to
guitar.

## Milestone 3 — Raw model versus extractor

Soft-recall on 12 clips / 202 notes:
- strict onset (0.12 s): 0.426
- soft onset (0.30 s): 0.554
- **pitch-only (within 1 s): 0.926**

The model detects the correct pitch for ~93 % of truth notes. Misses are onset
timing and annotation issues. Failure attribution on the 96-note reference set:
- Clear notes: recall 0.810 (model works).
- Grace-short (<0.1 s): recall 0.294 (annotation legitimacy + weak attacks).
- Negative-onset: recall 0.000 (clip boundary).
- Misaligned: recall 0.667.

Extractor (0.65/0.50/3) is not the bottleneck for the tail; onset probability
peaks themselves are shifted for dense chords and misaligned annotations.

## Milestone 4 — Bounded onset experiments

- **Onset threshold 0.65→0.50:** +0.030 F1 / +0.090 recall on held-out,
  +13–15 false notes (acoustic). Piano recall unchanged +10 false notes.
  Candidate only, not integrated.
- **Onset snapping to energy peaks:** WORSE (F1 0.753 → 0.737). Model onsets
  are already better than raw energy peaks. Rejected.
- **Frame threshold 0.5→0.35 / minNoteFrames 3→2:** no recall gain.
- **Combined onset+frame:** recall +0.115 but precision −0.119, F1 flat.

## Milestone 5 — Duration and sustain

On 47 matched notes: MAE 237 ms mean, 48 ms median. 11/47 clip-truncated.
Over/under balanced (24 vs 23). Clear notes worst (429 ms mean), short best
(37 ms). Onset MAE on matched notes 33 ms. Duration is an outlier/truncation
effect, not a systematic model defect. The 298 ms headline MAE is skewed by
a few long-sustain outliers.

## Milestone 6 — Product worker test

The candidate change (onset threshold 0.65→0.50) is a single constant in
`audioVisionPitchWorker.js` NOTE_EXTRACTION. No model change, no new
dependencies, no runtime/memory impact, browser-compatible. If pursued, it
should be an opt-in research variant with a false-note regression suite, not a
production default. The basicPitchNode test harness mirrors production
thresholds, so measured deltas describe the actual browser pipeline.

## Milestone 7 — Research decision

**Recommendation: (C) corrected reference alignment for piano, then (A) targeted
onset work, before any (D) training.**

- Piano alignment is a real, fixable problem (+0.206 F1 from correction).
- Guitar does not benefit from alignment correction; its gap is onset timing
  on dense chords and weak attacks.
- Onset threshold lowering is a modest candidate (+0.03 F1) but adds false
  notes and doesn't help piano. Not integrated.
- Onset snapping is actively harmful.
- Training remains unjustified: pitch detection is ~0.93; the gap is onset
  alignment and annotation quality.

## Resource usage

No large downloads. Disk ~15 GiB. No training. Runtime ~60 min.

## Artifacts

- `scripts/audio-vision-align-diagnose.mjs` — independent DSP alignment.
- `scripts/audio-vision-reference-notes.mjs` — 96-note auditable set.
- `scripts/audio-vision-onset-snap.mjs` — onset-snapping (negative result).
- `benchmarks/audio-vision/real-bench-aligned.json` — corrected benchmark.
- `benchmarks/audio-vision/reference-notes.json` — 96 notes with evidence.
- `docs/audio-vision-source-alignment.md` — this report.
- Prior artifacts preserved. Tests: `tests/synthCorpus.test.js` (10) pass.
  Production untouched.
