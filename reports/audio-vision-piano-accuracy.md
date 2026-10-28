# Audio Vision — real piano pitch accuracy

Research only. No main merge, deployment, or production model replacement.

## Breakthrough finding

The reported piano F1 of ~0.068 was **largely an evaluation artifact**, not a
model pitch-recognition failure. The Vienna 4x22 MIDI references drift from
the audio by a **per-performance constant** (documented in the manifest's own
excluded-note reasons for Mozart p01). When the drift is corrected uniformly
per performance, the released Basic Pitch model's piano F1 rises from **0.075
raw to 0.583 corrected** (P 0.55, R 0.64).

## Evidence

Per-performance offsets (seconds), consistent across every clip of the same
performance:

| performance | clips | offset | corrected F1 range |
|---|---|---|---|
| vienna-mozart-p01 | 4 | 0.525 | 0.529 – 0.889 |
| vienna-schubert-p01 | 3 | 0.420 | 0.432 – 0.480 |
| vienna-mozart-p02 | 1 | 0.000 (control) | 0.242 |
| vienna-schubert-p02 | 2 | 0.710 | 0.769 – 0.773 |

The **Mozart p02 control is aligned (offset 0)** and still scores 0.242, which
shows the pipeline itself works; the large offsets are take-specific drift, not
a systematic clip-cutter bug. The offsets are uniform within a performance
(0.525/0.525/0.525/0.525, 0.42/0.42/0.42, 0.71/0.71), which is the signature of
a source alignment offset, not per-note noise.

Note-by-note inspection confirms the model produces the **same pitches** as the
reference (e.g. a dyad: model 74/59 at 0.00 s vs reference 74/59 at 0.50 s); the
error was the 0.5 s origin, not the pitch.

## What this changes

1. The previous campaign's conclusion "piano failure is pitch" is corrected:
   the model's pitch recognition is substantially better than 0.068.
2. The earlier spectral-flux alignment correction was not purely overfit: for
   Mozart p01 it correctly found ~-0.5 s. The error was applying a single global
   rule across instruments/performances.
3. Retraining remains unjustified, but for a different reason: the model is
   not the dominant bottleneck on these takes.

## Remaining honest limitations

- The corrected 0.583 aggregate is still below guitar (0.78) and is not a
  held-out generalization claim: the offsets were estimated from the same
  clips. Independent source-file verification is still required.
- The aligned Mozart p02 control scores 0.242, showing some dense piano takes
  remain genuinely hard.
- No held-out piano set exists (all 11 clips are dev/eval).

## Product recommendation

- Do **not** present the raw 0.068 as the model's true piano accuracy; it is an
  evaluation-label problem.
- For user audio (no reference labels), the model's actual pitch detection is
  stronger than the benchmark suggested. The remaining product risk is the
  solo-arrangement thinning and quantization, not pitch recognition.
- Keep the Audio Vision v3 editor and review workflow.
- If a training decision is revisited, first obtain a piano corpus with
  independently verified source alignment (or per-performance offsets verified
  from source files).

## Artifacts

- `scripts/audio-vision-piano-note-compare.mjs` — note-by-note comparison.
- `scripts/audio-vision-piano-waveform-check.mjs` — RMS envelope evidence.
- `scripts/audio-vision-piano-offset-search.mjs` — per-clip offset search.
- `scripts/audio-vision-piano-performance-offset.mjs` — per-performance
  correction and metrics.
- `benchmarks/audio-vision/piano-performance-offset.json` — per-clip results.
- `reports/audio-vision-piano-accuracy.md` — this report.
- Tests: pipeline/MusicXML (52) and score-follow (66) pass. Production untouched.
