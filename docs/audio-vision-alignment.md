# Audio Vision — real note alignment, onset accuracy and event extraction

Research only. Production Basic Pitch weights untouched. No deployment.

## Milestone 1 — Alignment verification (independent, DSP-based)

The `align-probe` is DSP-only (spectral-flux peaks, no model). Findings:

- **Piano:** systematic offset. bestDelta −0.125 to −0.85 s with high match
  rates (up to 1.0). Truth onsets are consistently early by 0.1–0.8 s. This
  is a real alignment problem (Vienna take origin / excerpt crop), not noise.
- **Acoustic guitar:** small systematic offset (mean −0.08 s). Most of the
  earlier "40.6 % misaligned" stratum is weak/scattered attacks and grace
  notes, not a global shift.
- **Electric guitar:** essentially aligned (mean −0.01 s).

Independent waveform check (RMS energy attack nearest to truth onset) confirms:
piano truth is ~96 ms early on average; acoustic bossa-single truth ~10 ms
early. The align-probe direction (shift truth by bestDelta) is the DSP-supported
correction, not a model-optimized one.

**Conclusion:** piano has a genuine alignment problem; guitar mostly does not.
The 40.6 % "misaligned" stratum is largely guitar notes with weak/scattered
attacks, not a systematic offset.

## Milestone 2 — Reference-backed note analysis

Compact auditable set: 6 clips, 96 truth notes, with per-note waveform attack
evidence, model prediction, extractor decision, and classification.
Artifact: `benchmarks/audio-vision/reference-notes.json`.

| stratum | n | BP recall (0.12 s) |
|---|---|---|
| clear | 21 | 0.810 |
| misaligned | 9 | 0.667 |
| short | 27 | 0.667 |
| grace-short | 34 | 0.294 |
| negative-onset | 5 | 0.000 |

Model predicted 51/96 (53 %) at strict tolerance; at pitch-only tolerance
(within 1 s) the rate is much higher (0.926 on the broader soft-recall study).
Misses are onset-timing and annotation issues, not pitch detection.

## Milestone 3 — Duration errors

On 47 matched notes: duration MAE 237 ms mean, 48 ms median (mean inflated by
outliers, max 1498 ms). 11/47 are clip-truncated (note extends past the 3 s
excerpt). Over/under estimation balanced (24 vs 23) — no systematic bias.
Clear notes have the worst duration error (429 ms mean) despite being the most
detectable; short notes are best (37 ms). Onset MAE on matched notes is 33 ms.

**Conclusion:** duration error is dominated by clip truncation and long-sustain
release ambiguity, not a model defect. The 298 ms headline MAE is an outlier
effect; the median (48 ms) is acceptable.

## Milestone 4 — Targeted extractor experiments

Onset threshold sweep (eval-fresh 9 clips / 200 notes; dev 18 clips):
- 0.65→0.50: +0.030 F1, +0.090 recall, +13–15 false notes (acoustic
  guitar). Piano recall unchanged but +10 false notes. Electric unchanged.
- Frame threshold 0.5→0.35: no recall gain, more false notes.
- minNoteFrames 3→2: no recall gain.
- Combined onset+frame: recall +0.115 but precision −0.119, F1 flat.

**Verdict:** onset threshold 0.50 is a modest candidate (+0.03 F1) but degrades
piano slightly and adds false notes. Not integrated. Retain production
thresholds (0.65/0.50/3) pending a false-note regression suite. Onset
smoothing, event splitting, and register-dependent evidence were not
separately tested (no clear mechanism identified beyond threshold).

## Milestone 5 — Training decision

**Not justified.** Pitch detection is already ~0.93 on real audio. The dominant
limitations are annotation alignment (piano) and onset timing (dense chords),
both addressable without retraining. Retraining would chase a non-problem and
repeat the two documented failures. Alternative losses (focal/cost-sensitive)
remain premature until alignment is fixed.

## Milestone 6 — Integration evidence

The candidate extractor change is a single threshold constant (onset 0.65→0.50)
in the Worker (`audioVisionPitchWorker.js` NOTE_EXTRACTION). No model change,
no new dependencies, no runtime/memory impact, browser-compatible (TF.js
backend unaffected). If pursued, it should be an opt-in research variant with
a false-note regression suite, not a production default. The basicPitchNode
test harness mirrors production thresholds, so the measured deltas describe
the actual browser pipeline.

## Resource usage

No large downloads. All on-demand from existing mic-real clips. Disk ~15 GiB.
No training. Runtime ~45 min across diagnosis + benches.

## Artifacts

- `scripts/audio-vision-align-diagnose.mjs` — independent DSP alignment check.
- `scripts/audio-vision-reference-notes.mjs` — compact auditable note set.
- `benchmarks/audio-vision/reference-notes.json` — 96 notes with evidence.
- `docs/audio-vision-alignment.md` — this report.
- Prior artifacts: real-bench.json, piano-aligned.json, annotation-audit.json,
  extractor test/dev scripts.
- Tests: `tests/synthCorpus.test.js` (10) pass. Production untouched.
