# Audio Vision — independent timing truth and actual transcription quality

Research only. No main merge, deployment, or production model replacement.

## 1. Independent audio/reference synchronization (model-free)

Method: spectral-flux onset envelope cross-correlated with the reference onset
impulse train over shifts [−1,+1] s, per clip, aggregated per performance. This
never reads Basic Pitch output.

Per-performance independent offsets (negative = reference is late):

| performance | clips | independent offset | consistency |
|---|---|---|---|
| vienna-mozart-p01 | 4 | −0.70 s | **consistent across all 4 clips** |
| vienna-schubert-p01 | 3 | −0.31 s | inconsistent (−0.45/−0.20/−0.32) |
| vienna-mozart-p02 | 1 | −0.88 s | contradicts model-aligned control |
| vienna-schubert-p02 | 2 | −0.37 s | inconsistent (+0.28/−0.85) |

**Conclusion:** only **Mozart p01** has a robust, independently confirmed
~0.5–0.7 s reference drift. The Schubert offsets (0.42, 0.71) are **not**
independently confirmed; the model-free method is inconsistent within those
performances and contradicts the aligned Mozart p02 control.

## 2. Honest performance (separated, not conflated)

| metric | value | status |
|---|---|---|
| Raw strict event F1 (all piano) | **0.075** | honest baseline, no correction |
| Independent-offset strict F1 | **0.397** | model-free offsets; only Mozart p01 reliable |
| Model-optimized strict F1 | **0.583** | **in-sample, unverified** — not held-out |
| Pitch-only recall (within 1 s) | **0.889** | model detects the right pitch |

Per performance:
- Mozart p01: raw 0–0.065 → independent 0.41–0.61 (drift confirmed).
- Schubert p01: raw 0.054–0.16 → independent 0.22–0.40 → model-optimized 0.43–0.48 (unverified).
- Mozart p02 (aligned control): raw 0.242; independent 0.182; model-optimized 0.242.
- Schubert p02: raw 0 → independent 0.23–0.39 → model-optimized 0.77 (unverified).

**The 0.583 must not be described as held-out model accuracy.** The honest
headline is: pitch-only recall 0.889, independent strict F1 ~0.40, raw strict
F1 0.075. The strict number is dominated by unverified reference timing.

## 3. Actual Audio Vision product path

Trace (previous campaign, re-confirmed): `runAudioArrangementPipeline` with the
production model preserves notes through extraction → arrangement (transcribed
≈ arranged). Guitar raw F1 0.73–0.97; piano raw 0.057–0.125 (timing/reference
issue above). No evidence of note loss in MusicXML serialization or the
arrangement.

The product does not have the reference-drift problem (users have no reference).
Its remaining risk is solo-arrangement thinning/quantization, not pitch
recognition.

## 4. Highest-impact proven defect

The proven defect is **benchmark reference alignment**, not a product code
defect. No narrow product change is justified by the current evidence without
source-file verification. Recommend:
1. Obtain the full Vienna source WAV/MIDI to verify the Schubert offsets
   independently (not available locally).
2. Keep production thresholds and weights.
3. Keep the v3 editor and review workflow; surface honest confidence for
   dense/low-agreement transcriptions.

## 5. Browser and UX

Not performed (no browser runtime; cursor owned by Integration). The existing
review/editor path is unchanged.

## 6. Resource usage and artifacts

No downloads. Disk 8.5 GiB. No training.

- `scripts/audio-vision-independent-offset.mjs` — model-free offset.
- `scripts/audio-vision-piano-honest.mjs` — separated metrics.
- `benchmarks/audio-vision/independent-offset.json`.
- `benchmarks/audio-vision/piano-honest.json`.
- `reports/audio-vision-timing-truth.md` — this report.
- Tests: pipeline/MusicXML (52), score-follow (66) pass. Production untouched.
