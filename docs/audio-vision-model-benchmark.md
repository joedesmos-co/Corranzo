# Audio Vision — model benchmark

**Question.** The current route is Spotify's **Basic Pitch** (a small
instrument-agnostic onsets/frames/contours model) running in a Web Worker.
Would a stronger pretrained model make Corranzo's arrangements more musical -
and could it even run in the product?

**How it was measured.** Not from paper numbers. Both models were run on the
**same** independent synthesized reference (a piano piece with exactly known
notes, onsets, durations and hands; the models only ever see the audio) and
scored by the **same** matcher (`scripts/lib/eventScore.mjs`): pitch
precision/recall, onset MAE, duration MAE, full-reference event F1, the
melody-anchor recall and the invented-note rate.

Reproduce:

```bash
node --expose-gc scripts/audio-vision-model-bench.mjs \
  --external <hft-note-json> --json benchmarks/audio-vision/model-bench.json
```

## The measured comparison

Reference: 51 exact notes, 100 BPM, 24 s of audio.

| metric | Basic Pitch (in use) | hFT-Transformer (Sony, ISMIR 2023) |
|---|---|---|
| full-reference **event F1** | 0.646 | **0.842** |
| pitch precision | 0.477 | **0.909** |
| pitch recall | **1.000** | 0.784 |
| onset MAE | 4 ms | 4 ms |
| **duration MAE** | **313 ms** | **42 ms** |
| melody-anchor recall | **1.000** | 0.909 |
| invented-note rate | 0.402 | **0.000** |
| inference (24 s audio, CPU) | 32.7 s | 18.8 s |
| model download | **0.92 MB** | 20.5 MB |
| licence | Apache-2.0 (code **and** weights) | MIT (code); checkpoint via a GitHub release |
| checkpoint rights | vendored in-repo, no ambiguity | trained on **MAESTRO (CC BY-NC-SA 3.0)** - a non-commercial corpus |
| runs in the browser worker | **yes** (TensorFlow.js) | no (PyTorch; an ONNX conversion would be needed) |
| zero cost to run | **yes** (on the musician's device) | no (a server-side model costs money per minute of audio) |
| pip install / heavy runtime | already installed | torch + torchaudio + a 20 MB checkpoint |

### What the comparison says

* **Basic Pitch finds everything and invents a lot.** Pitch recall is 1.000 -
  every reference note is found, with a 4 ms onset error. But 40 % of the
  notes it reports have no support in the reference, and its note *durations*
  are 313 ms off on average (a held chord comes out as a staccato).
* **hFT-Transformer is much more precise and its durations are 7.5x better**
  (42 ms). It invents nothing on this reference. Its recall is lower (0.784)
  because it is conservative about quiet notes, and it is a *piano* model
  trained on a piano corpus.
* **Neither model is the bottleneck on real recordings.** On the five GuitarSet
  performances (real guitar, JAMS truth) the model stage reaches F1 0.788
  while the *arrangement* stage lands at 0.667-0.692. The loss is downstream
  of the model.

## Verdict: do not integrate a stronger model yet

| criterion | Basic Pitch | hFT-Transformer | winner |
|---|---|---|---|
| accuracy on the reference | F1 0.646, 40 % invented | F1 0.842, 0 % invented | hFT |
| accuracy on real guitar | F1 0.788 (measured) | not measured - piano-only weights, and a guitar evaluation needs the GuitarSet truth with a guitar model | - |
| inference runtime (browser, per second of audio) | ~1.4 s (measured in the browser worker) | not deployable without an ONNX conversion and a browser re-validation | Basic Pitch |
| memory | 0.9 MB model + TF.js | 20.5 MB model + a converted runtime (3-10x the JS) | Basic Pitch |
| licence / checkpoint rights | Apache-2.0, unambiguous | code MIT, **weights trained on a non-commercial corpus** - a commercial product needs clearance | Basic Pitch |
| zero-cost feasibility | free, on-device | a hosted model is a per-minute cost; a 20 MB download per user is a real cost on a phone | Basic Pitch |
| integration risk | in production | needs a PyTorch->browser port, a re-implementation of the note post-processing, and a fresh quality evaluation | Basic Pitch |

**Decision: keep Basic Pitch.** The measured gain of the stronger model does not
survive the product's constraints (a 20 MB download with unresolved
checkpoint rights, a browser port that does not exist, and a per-minute cost
if it is served), and the model is not where the music is being lost anyway.

**But the comparison earned its keep**: it showed that the *durations* Basic
Pitch reports are the weak point (313 ms), and that its precision is the weak
point (40 % invented). Those are pipeline problems, and they are addressed
where the evidence points (see `docs/audio-vision-stage-loss.md`).

### What would change the verdict

* A browser-deployable checkpoint with unambiguous commercial rights.
* A measured gain on the REAL recordings (GuitarSet guitar, not a synthetic
  piano), not only on a synthesized reference.
* An inference budget that fits the product (the current route already costs
  ~1.4 s of CPU per second of audio in the browser worker).

### Candidates that were considered and not run

| candidate | why not run here |
|---|---|
| Magenta onsets-and-frames (the model Basic Pitch is derived from) | Python/TF only, no browser path, no note-level gain over Basic Pitch for a monophonic-ish source |
| ByteDance `piano_transcription_inference` (MIT) | PyTorch only; the checkpoint's terms were not verified in this sprint |
| SSR-based guitar transcription (Ueda et al.) | the most promising GUITAR candidate (it outputs string + fret directly, which is what a guitar arrangement needs); a PyTorch model with a non-trivial corpus pipeline - the next thing to benchmark, with the GuitarSet truth this repo already has |
| "Y-BasicPitch" style fine-tunes of Basic Pitch | the same architecture, so browser-deployable; the weights and their terms were not verified in this sprint |

## The current route's cost, measured

* Model: 0.92 MB (`public/neural-model`), loaded once, cached by the browser.
* Runtime: 24 s of audio in 32.7 s of CPU in Node; in the browser worker it
  is ~1.4 s per second of audio, off the main thread (the interface stays
  responsive: the worst main-thread block measured 54 ms).
* Memory: the worker holds the graph model plus one 2 s window; the page heap
  does not grow with the recording length.
* Cost: zero. The model ships with the app and runs on the musician's device.
