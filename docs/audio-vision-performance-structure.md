# Audio Vision — performance structure, and why the corpus is still easier than real music

Research only. No training; production unchanged.

## 1. Performance layer implemented

`performComposition()` in `scripts/lib/synthCorpus.mjs` turns a composition into
a performance **before** rendering, so the performed events are the truth and
the symbolic grid is kept beside them (`symbolicOnsetSeconds`,
`symbolicOffsetSeconds`). Applying timing after annotation would silently
corrupt labels; that is explicitly avoided.

Seeded, separately configurable: **note-on jitter** (default σ ≈ 20 ms), **chord
rolls** (32 ms spread by pitch), **per-note velocity spread** (40 %),
**quiet inner voices** (×0.40), **staccato** (25 %), **legato** (20 %),
**damping** (15 %), **register dynamics** (bass ×0.85, melody ×1.1). Every
performed note records `rolled` and `performed` flags, and the audible onset is
still measured from the waveform.

`renderComposition(spec, { realistic, performance, performanceOptions })` now
offers three modes: clean, timbre-only, performance.

## 2. Measured result — performance does NOT reproduce the real failure profile

Same 12 compositions (2 instruments × 6 textures), unchanged production
extractor, same scorer; the real GuitarSet profile measured with the same code
beside it:

| mode | micro F1 | P | R | **bass recall** | mid | high | **quiet notes** | octave errors | onset MAE |
|---|---|---|---|---|---|---|---|---|---|
| clean | 0.930 | 0.912 | 0.967 | **1.000** | 0.986 | 0.959 | **0.958** | 6 | 8.6 ms |
| timbre | 0.960 | 0.965 | 0.962 | **0.945** | 0.986 | 0.963 | 0.958 | 4 | 11.8 ms |
| performance | 0.943 | 0.920 | 0.974 | **1.000** | 0.986 | 0.973 | 0.968 | 7 | 14.6 ms |
| **real GuitarSet** | **0.862** | 0.929 | **0.816** | **0.425** | — | 0.845 | — | — | — |

Jitter, rolls, articulation, damping and uneven dynamics moved the score by
−0.017 and left **bass recall at 1.00** (real: 0.425) and **quiet-note recall at
0.97** (real: materially worse). The failure *shape* did not converge.

## 3. What that means

The real bass/quiet failures are not caused by performance timing or dynamics
in isolation. The remaining structural difference is **masking**: in real
playing the bass note shares its time and spectrum with loud upper voices whose
harmonics sit on top of its fundamental, and the recording mixes them. In the
corpus, even the bass texture is mostly bass notes alone; the dense texture puts
the bass at a comfortable level under a melody that is only ~2 dB louder.

So the next modelling step is not more jitter — it is **mixture and masking
structure**: a bass line deliberately 8–15 dB below bright upper voices, octave
and fifth doublings whose partials collide, and sustained notes overlapping the
next attack.

## 4. Annotation validity

Every performed note keeps: performed onset, performed offset, symbolic onset,
symbolic offset, velocity, instrument, rolled flag. The audible onset is
measured from the waveform and used as the label. A shift from jitter/rolls is
therefore *inside* the label, not an error against it. Onset MAE against the
performed truth rose 8.6 → 14.6 ms across modes, which is the model's detection
cost, not a labelling error.

## 5. Splits and quantities

Composition-keyed splits unchanged; all variants (timbre, performance) of a
composition stay in its split. This round generated 36 renders in memory (12
compositions × 3 modes, ~11 min of audio) and materialised no new audio;
artifacts are the JSON reports.

## 6. Training decision

**Not justified.** The corpus still fails the mission's own gate — it does not
reproduce the relevant real error categories (bass 1.00 vs 0.43, quiet 0.97 vs
materially worse). Training on it would repeat the two previous failures.

## 7. Next experiment

Add **mixture/masking** to the renderer (bass 8–15 dB under bright upper voices,
colliding partials from octave/fifth doublings, sustained overlaps) and re-run
this same benchmark; acceptance is the **failure shape** (bass recall and dense
F1 converging on the real profile), not a lower aggregate F1.

## 8. Reproduce

```bash
node --expose-gc scripts/audio-vision-performance-bench.mjs \
  --json benchmarks/audio-vision/performance-bench.json
```

Artifact: `performance-bench.json` (per-composition rows for all three modes,
mode and per-instrument summaries, the real reference). Tests:
`tests/synthCorpus.test.js` (10) still pass with the performance layer.
