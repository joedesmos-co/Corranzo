# Audio Vision — seven-hour product quality campaign progress

Research only. No main merge, deployment, or production model replacement.

## Resource state

Disk 6.6 GiB free (above the 5 GiB floor). No downloads, no training, no
corpus generation. Work was lightweight Node diagnostics on the existing
mic-real clips.

## Phase A — traced the actual product pipeline

Ran `runAudioArrangementPipeline` (the real product path: import → analysis →
Basic Pitch → extraction → arrangement → MusicXML) with the production model
on rights-cleared mic-real clips. Compared raw model notes, arrangement events,
and reference notes.

| clip | instrument | ref notes | raw model | raw F1 | arrangement | arr F1 |
|---|---|---|---|---|---|---|
| piano-mozart-dyad | piano | 14 | 21 | 0.057 | 16 | 0.267 |
| piano-schubert-triad | piano | 26 | 22 | 0.125 | 14 | 0.300 |
| acoustic-bossa-chord | acoustic | 8 | 14 | 0.727 | 12 | 0.800 |
| acoustic-rock-dyad | acoustic | 15 | 14 | 0.966 | 13 | 0.929 |
| electric-eg07-single | electric | 12 | 15 | 0.889 | 15 | 0.889 |
| electric-eg04-dyad | electric | 16 | 13 | 0.897 | 11 | 0.815 |

**The pipeline does not lose notes** (transcribed ≈ arranged). Guitar is good
(0.73–0.97 raw). Piano is poor at the **raw model** stage (0.057–0.125), and the
arrangement only partially rescues it (0.27–0.30) by quantizing to a grid.

## Phase B/C — isolated model vs pipeline for piano

Independent check of onset alignment against waveform energy attacks:

| clip | ref→attack (mean/med) | model→attack (mean/med) |
|---|---|---|
| piano-mozart-dyad | 56 / 40 ms | 13 / 6 ms |
| piano-schubert-triad | 12 / 9 ms | 6 / 6 ms |
| piano-schubert-single | 8 / 9 ms | 5 / 6 ms |

The model's onsets are **at the right audio attacks** (better than the
reference labels). The piano failure is therefore **not onset timing** — it is
**pitch accuracy / extra notes**. Pitch audit per clip: only ~1 exact pitch
match, with octave, fifth, and other-interval errors plus unmatched notes.

Fragment-merging experiment (merge identical-pitch notes within a gap):
- gap 0 s (raw): F1 0.121
- gap 0.03 s: F1 0.077
- gap 0.06 s: F1 0.077
Merging makes it **worse** — the model's separate notes are real attacks, not
fragments. Rejected.

## Phase D — realistic piano evaluation

The existing piano clips have reference onsets that align with waveform attacks
(mean 8–56 ms), unlike the earlier overfit spectral-flux claim. But the model
still produces wrong pitches. No held-out piano set exists (all 11 clips are
dev/eval), so no generalization claim is made.

## Phase E — UX recommendation (not implemented)

Automatic piano transcription is not reliable enough to present as accurate.
Product recommendation:
- Surface a clear "review required" state when transcription agreement is low,
  especially for piano.
- Keep the Audio Vision v3 correction editor as the primary workflow for piano.
- Do not auto-approve Practice from an uncertain transcription.
These are UX changes that need browser verification; not changed in this
campaign.

## Phase F — browser verification

Not performed (no browser runtime; cursor work is owned by Integration).

## Phase G — research decision

**The fundamental blocker is model pitch accuracy on real piano, not the
pipeline.** The arrangement and MusicXML serialization preserve notes; the
raw model produces wrong pitches and extra notes on the Vienna piano clips.
Retraining is not justified without reliable, independently verified real
piano reference data and held-out validation.

Preserve: released Basic Pitch weights, trainable reconstruction, rights-clean
synthetic corpus, mic-real clips, evaluators, Audio Vision v3 editor.

## Minimum data requirement to proceed

A rights-cleared real piano corpus with:
1. Independently verified note-level pitch truth (not model-derived).
2. Separate dev/validation/test splits by composition and performer.
3. Enough clips for a held-out piano evaluation (current: 0 held-out).
4. A false-note budget for any extractor change.

## Artifacts

- `scripts/audio-vision-product-trace.mjs` — real pipeline trace.
- `scripts/audio-vision-piano-model-vs-attack.mjs` — onset alignment check.
- `scripts/audio-vision-piano-pitch-audit.mjs` — pitch error classification.
- `scripts/audio-vision-note-fragment-audit.mjs` — fragment merging (rejected).
- `reports/audio-vision-seven-hour-progress.md` — this report.
- Tests: pipeline/MusicXML/arrangement tests pass (52); score-follow tests
  pass (66). Production untouched.
