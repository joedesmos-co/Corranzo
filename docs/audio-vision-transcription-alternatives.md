# Audio Vision — transcription alternatives: what exists, what is legal, and what actually wins

Research only. Nothing here is integrated; production keeps Basic Pitch at
`0.65 / 0.50 / 3`.

## 1. Baseline, reproduced

Five **unseen** GuitarSet takes (`01_BN1-129-Eb_comp`, `01_BN2-166-Ab_comp`,
`01_Funk1-114-Ab_comp`, `01_BN1-129-Eb_solo`, `01_BN2-166-Ab_solo`), note level,
same matcher as every previous study (`scripts/lib/eventScore.mjs`, 120 ms
onset tolerance):

| | Basic Pitch (production) |
|---|---|
| micro F1 | **0.838** |
| precision | 0.894 |
| recall | 0.789 |
| onset MAE | 12.2 ms |
| duration MAE | 73 ms |
| octave errors | 22 |
| model size | 0.92 MB |
| inference (Node CPU) | 86.8 s for 115 s of audio (~0.75x realtime) |

(The arrangement-level F1 on these takes is 0.807; the two numbers measure
different things — note recognition versus the written arrangement.)

## 2. The fundamental misses — audited

The earlier claim was "58 % of missed notes have no evidence". Re-checked with
a **wide window** (±70 ms, ±2 semitones), so a note is only called invisible if
it is invisible even when the model is given the benefit of the doubt:

| | count |
|---|---|
| missed reference notes (51 recordings, 1,810 notes) | 577 |
| no evidence at ±23 ms, exact pitch (the original measure) | 335 (58 %) |
| no evidence at ±70 ms, exact pitch | 284 (49 %) |
| **no evidence at ±70 ms, any pitch within ±2 semitones** | **201 (35 %)** |
| visible only because the time window widened (alignment) | 51 (9 %) |
| visible only in a pitch neighbour (semitone/tone confusion) | 83 (14 %) |

So the honest split is: **35 % of misses are pure inference failures**, 14 %
are pitch-neighbour confusion, 9 % are alignment, and the rest have weak but
real evidence. The model, not the extractor, is the dominant limit — which is
why every threshold and filter experiment on this branch failed.

## 3. Candidates, with licensing checked at source

| candidate | code licence | weights: source and rights | size | runtime | browser | verdict |
|---|---|---|---|---|---|---|
| **Basic Pitch** (production) | Apache-2.0 | Apache-2.0 weights vendored in the package | 0.92 MB | TF.js, ~0.75x realtime CPU | **native** | keep |
| **hFT-Transformer** (Sony, ISMIR 2023) | MIT | GitHub release; **trained on MAESTRO (CC BY-NC-SA 3.0)** — commercial rights unresolved | 22.1 MB | PyTorch, ~0.24x realtime CPU | ONNX/WASM possible, unproven | **measured, worse** |
| **Magenta Onsets & Frames** | Apache-2.0 | GCS `maestro_checkpoint.zip`, **251.6 MB**, MAESTRO-trained | 251.6 MB | TF1 Python | no (download size) | rejected on size |
| **Omnizart** (MCTLab) | MIT | `omnizart download-checkpoints`; trained on MAPS/MAESTRO/MusicNet — per-checkpoint terms not stated | tens of MB | TF/Keras | unlikely | licence unresolved per checkpoint |
| **YourMT3** | **GPL-3.0** | — | — | PyTorch | no | rejected (copyleft) |
| **piano_transcription_inference** (ByteDance / qiuqiangkong) | **no licence file** | HF checkpoint | ~20 MB | PyTorch | no | rejected (unresolved) |
| **MT3** (Magenta) | Apache-2.0 | GCS, ~1 GB | ~1 GB | TF | no | rejected on size |
| **PianoTrans / GUI wrappers** | no licence | wraps the ByteDance weights | — | — | no | rejected |

Verification: repository licence endpoints (`api.github.com/repos/...`), the
magenta README's checkpoint URLs and a HEAD request for the size
(263,865,474 bytes), the hFT release asset (20.5 MB, MIT code). No weights
were downloaded for any candidate except hFT, which was already on this
machine from the earlier feasibility study.

## 4. The controlled comparison that settles it

hFT-Transformer was run on the same 12 recordings as production Basic Pitch:
the 5 unseen GuitarSet takes and the 7 usable Vienna piano clips (truth
origin aligned with the auditable `align-probe.json` δ, the corpus's four
excluded clips excluded). Same matcher, same truth, no tuning.

| corpus | model | micro F1 | precision | recall | missed | false | octave errors | onset MAE | duration MAE | melody recall |
|---|---|---|---|---|---|---|---|---|---|---|
| **guitar (5 unseen)** | Basic Pitch | **0.838** | 0.894 | 0.789 | 163 | 72 | 22 | 12 ms | 73 ms | 0.891 |
| | hFT-Transformer | 0.653 | 0.665 | 0.640 | 278 | 249 | 41 | 18 ms | 83 ms | 0.749 |
| **piano (7 clips)** | Basic Pitch | 0.417 | 0.379 | 0.464 | 67 | 95 | 14 | 47 ms | 252 ms | 0.592 |
| | hFT-Transformer | 0.430 | 0.420 | 0.440 | 70 | 76 | **8** | 51 ms | 305 ms | 0.497 |
| all 12 | Basic Pitch | **0.771** | 0.800 | 0.744 | 230 | 167 | 36 | 32 ms | 178 ms | 0.717 |
| | hFT-Transformer | 0.620 | 0.629 | 0.612 | 348 | 325 | 49 | 37 ms | 212 ms | 0.602 |

**A strong, purpose-trained piano model is 18 points worse on guitar and 1.3
points better on piano**, at 24x the size, with unresolved weight rights and
no browser path. Its only genuine advantage is octave accuracy (8 vs 14 errors
on piano) — consistent with it being trained on a piano corpus.

### Is it complementary? (candidate model 7: "detect what Basic Pitch misses")

| corpus | notes BP misses | recovered by hFT | false notes hFT would add |
|---|---|---|---|
| guitar | 157 | **35 (22 %)** | **247** |
| piano | 66 | 6 (9 %) | 75 |

A cascade would add 35 real notes for 247 false ones — 14 % precision on the
additions. Not a trade worth building.

## 5. Browser feasibility, measured against the constraints

| | Basic Pitch | hFT | Magenta O&F | MT3 |
|---|---|---|---|---|
| download | 0.92 MB | 22.1 MB (≈5.5 MB int8) | 251.6 MB | ~1 GB |
| runtime | TF.js in a worker | ONNX Runtime Web / WASM (attention ops; WebGPU where available) | TF.js conversion of a TF1 graph | none practical |
| CPU per audio second | ~0.75 s (Node), ~1.4 s (worker) | ~0.24 s in PyTorch CPU; WASM typically 3–10x slower → 0.7–2.4 s | — | — |
| memory | flat, ~100 MB peak | +200–400 MB RSS in Python; WASM heap would need chunking | — | — |
| licence | clean | **unresolved** | dataset-bound | dataset-bound |

The only candidate that is simultaneously smaller than 5 MB, cleanly licensed,
already browser-native and faster than real time is the model already in
production. Everything stronger fails at least one hard constraint — hFT fails
licensing, Magenta O&F and MT3 fail size, Omnizart fails per-checkpoint
licensing.

## 6. Recommendation

**Keep Basic Pitch.** It is not the weakest link that can be replaced today: it
beats every measurable alternative on guitar, it is the only clean-licence
browser-native option, and a piano-specific model does not meaningfully beat it
even on piano.

**The sustainable path to substantially better transcription is to train the
small model on data whose rights we control**, not to import a large one:

1. **Fine-tune / distill Basic Pitch** (Apache-2.0 weights, 0.92 MB, TF.js
   unchanged) on:
   * **GuitarSet** — CC BY 4.0, 360 annotated solo-guitar performances
     (already on this machine; note-level JAMS truth);
   * **synthesized renders** from MIDI with permissively licensed samples —
     unlimited data, exact labels, no dataset licence at all;
   * optionally Slakh2100 (CC BY 4.0) piano/guitar stems.
   None of that requires a non-commercial corpus, and the artefact stays the
   same size and runtime, so browser feasibility is unchanged.
2. **Keep the evaluation split sealed**: train on GuitarSet *training
   recordings only*; evaluate on the five holdout takes used here and on the
   mic-real clips with the piano δ alignment. The current 0.838 guitar micro F1
   is the number to beat.
3. **Only then** consider a second model. The evidence says a complementary
   model must reach ≥ 60–70 % precision on the notes BP misses to be worth a
   cascade; hFT reaches 14 %.

### Why not distil hFT directly?
Its weights are trained on MAESTRO (CC BY-NC-SA 3.0). Distillation would
launder a non-commercial corpus into a commercial artefact — legally
unresolved and ethically the wrong call. The same architecture trained on
clean data is a different project, not a shortcut.

## 7. Rejected in this study

* Replacing Basic Pitch with hFT — worse on guitar, +1.3 on piano (inside the
  noise of a 125-note reference), unresolved rights.
* A complementary cascade with hFT — 14 % precision on the recovered notes.
* Magenta Onsets & Frames / MT3 — 251 MB / 1 GB downloads.
* Omnizart, YourMT3, ByteDance piano_transcription_inference — licence.
* Re-tuning thresholds, re-running extraction, harmonic suppression and
  conditional filtering — measured and rejected in earlier commits
  (`docs/audio-vision-missed-notes.md`).

## 8. Reproduce

```bash
# Basic Pitch side (Node)
node --expose-gc scripts/audio-vision-model-comparison.mjs \
  --hft-notes /tmp/hFT/corpus/note

# hFT side (Python, research only): the commands are in
# scripts/audio-vision-hft-run.md
```

Artifact: `benchmarks/audio-vision/model-comparison.json`.
