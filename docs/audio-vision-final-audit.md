# Audio Vision — reference alignment and final event-extraction audit

Research only. No main merge, deployment, or production model replacement.

## Milestone 1 — Source timestamps traced

50 clips, 3 s excerpts, 44.1 kHz (resampled to 22.05 kHz). 29 unique source
files, 30 unique truth files. 56/897 truth notes have negative onset (started
before clip). Align-probe (DSP, spectral-flux, no model) gives per-instrument
systematic offsets: piano −0.125 to −0.85 s, acoustic guitar mean −0.08 s,
electric mean −0.01 s. Independent waveform check confirms piano ~96 ms early.

## Milestone 2 — Instrument-specific alignment

Applied per-clip align-probe deltas (separate eval copy, raw preserved):

| slice | raw F1 | aligned F1 | verdict |
|---|---|---|---|
| piano | 0.068 | 0.274 | helps (real alignment problem) |
| acoustic-guitar | 0.779 | 0.691 | hurts |
| electric-guitar | 0.708 | 0.686 | slightly worse |
| eval (mixed) | 0.493 | 0.548 | helps (piano-heavy) |
| eval-fresh (guitar) | 0.843 | 0.755 | hurts |

**Do not apply a single global correction.** Piano has a genuine alignment
problem; guitar's "misalignment" is weak attacks and grace notes.

## Milestone 3 — Canonical manifest

`benchmarks/audio-vision/canonical-manifest.json`: 50 clips with identity,
source/license, exact reference timestamps, align-probe correction provenance,
evaluation tolerances (0.12 s onset, exact pitch), model/extractor version
(Basic Pitch released, 0.65/0.50/3), and per-clip raw + aligned metrics.
Aggregate raw F1 0.597 (R 0.642); aligned F1 0.597 (R 0.659).

## Milestone 4 — Model versus extractor

- Pitch-only recall 0.926 (model detects the notes).
- Strict-onset recall 0.426; soft 0.554.
- Extractor threshold 0.65→0.50: +0.030 F1 / +0.090 recall, +13–15 false
  notes (candidate, not integrated).
- Onset snapping to energy peaks: worse (0.753 → 0.737). Rejected.
- Frame/minNoteFrames: no gain.

False-note budget: production thresholds retained pending a regression suite.

## Milestone 5 — Duration and practice timing

Matched-note duration: mean 237 ms, median 48 ms, p90 854 ms, p95 1276 ms,
max 1498 ms. 11/47 clip-truncated. Over/under balanced. Onset MAE on
matched notes 33 ms (median 15 ms, p90 103 ms). Duration is an
outlier/truncation effect; onset timing is reasonably precise.

Browser worker path verified: `audioVisionPitchWorker.js` uses
`NOTE_EXTRACTION` (0.65/0.50/3) and `outputToNotesPoly` identically to
basicPitchNode, so Node measurements describe the browser pipeline. No model
change, no runtime/memory impact.

## Milestone 6 — Pause decision

**Recommendation: pause model training.** Pitch detection is already ~0.93 on
real audio. The dominant limitations are (1) piano annotation alignment and
(2) onset timing on dense chords — both addressable without retraining. No
training run justified. Preserve all weights, checkpoints, and synthetic data.

Next smallest evidence-supported step: fix piano alignment (per-clip deltas,
already measured) and re-run; then decide on a bounded onset-extractor change
with a false-note regression suite.

## Artifacts

- `benchmarks/audio-vision/canonical-manifest.json` (50 clips, raw+aligned).
- `benchmarks/audio-vision/real-bench.json`, `real-bench-aligned.json`,
  `reference-notes.json`, `annotation-audit.json`, `piano-aligned.json`.
- `docs/audio-vision-final-audit.md` (this report) plus prior docs.
- Tests: `tests/synthCorpus.test.js` (10) pass. Production untouched.
  Disk 11 GiB (above 5 GiB floor).
