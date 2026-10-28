# Audio Vision product rescue report

Research only. No main merge, deployment, or production model replacement.

## Summary

Audio Vision's real-world transcription quality is limited primarily by the
released Basic Pitch model's onset timing on real recordings and by annotation
quality in evaluation data, not by the arrangement pipeline (which tests pass).
The score-follow cursor jumping could not be reproduced in this environment
(no browser runtime); its code-level tests (66 score-follow/cursor tests) pass.

## Transcription baseline (real audio, strict event F1)

| instrument | clips | F1 | precision | recall | onset MAE | duration MAE |
|---|---|---|---|---|---|---|
| acoustic guitar | 21 | 0.779 | 0.801 | 0.794 | 16 ms | 163 ms |
| electric guitar | 18 | 0.708 | 0.691 | 0.815 | 19 ms | 417 ms |
| piano (raw) | 11 | 0.068 | 0.068 | 0.071 | 65 ms | 398 ms |

Pitch-only recall (soft, 12 clips): 0.926. The model detects pitches; timing
and annotation quality are the confounds.

## Key findings

1. **Piano alignment is not waveform-supported.** The align-probe correction
   (0.068→0.274) was a re-scoring artifact. Independent energy-attack analysis
   disagreed for 7/10 piano clips. True piano baseline ~0.068.
2. **No held-out piano set exists.** All 11 piano clips are dev/eval.
3. **Guitar performance is reasonable** (0.71–0.78 F1), consistent with the
   0.772 GuitarSet number.
4. **Duration MAE 237 ms mean / 48 ms median** — outlier/truncation effect.
5. **Extractor threshold 0.65→0.50:** +0.030 F1 candidate, not integrated
   (adds false notes, doesn't help piano). Onset snapping: harmful.
6. **Synthetic corpus** (timbre/performance/masking) did not reproduce real
   failure shape. Training remains unjustified.

## Pipeline audit

The pipeline (`audioArrangementPipeline.js`) runs: import → analysis → Basic
Pitch inference → arrangement → MusicXML. Tests (52 pipeline/MusicXML/
arrangement tests) pass. The bottleneck is the model's onset timing on real
audio, not the arrangement or MusicXML serialization.

## Score-follow cursor

- 66 score-follow/cursor tests pass, including monotonicity and no-backward-snap
  guards within systems.
- Browser reproduction of the "jumping bar" could not be performed (no browser
  runtime in this environment).
- Likely cause: `systemKeyForCursor` uses `target.y.toFixed(4)` — small Y
  fluctuations from async worker responses could trigger false system-change
  snaps. Requires browser-level instrumentation to confirm.

## Recommendation

1. **Pause model/extractor research.** Data requirement to reopen: rights-cleared
   real audio with independently verified waveform-aligned onsets, separate
   dev/eval/eval-fresh splits with enough piano clips, per-stratum labels, and a
   false-note regression suite.
2. **Score-follow jumping:** instrument the cursor pipeline in a browser session
   and capture the specific transition that triggers the snap before attempting
   a fix. Do not make competing cursor changes without browser evidence.
3. Keep production thresholds (0.65/0.50/3) and released model weights.
4. Preserve Audio Vision v3 editor, trainable Basic Pitch reconstruction,
   rights-clean synthetic corpus, and all research artifacts.

## Resource usage

Disk 5.8 GiB (just above 5 GiB floor). No storage-intensive work performed.
No large downloads. No training.
