# Audio Vision — rights-clean synthetic corpus: the data foundation

Research only. No training was run this round: the mission asks for a working,
verified data pipeline first, and two fine-tunes have already shown that
another underpowered run would teach nothing.

## 1. Pipeline architecture

```
plan (manifest)            composition ids -> instrument x texture, split by id
  -> compositionSpec()     notes: midi, onset, offset, velocity, instrument
  -> renderComposition()   in-house additive synthesis -> mono 22 050 Hz
  -> truth.json            exact event list + the spec + sample rate
  -> demo materialisation  36 clips, 15 MB (WAV + truth)
  -> evaluation            production Basic Pitch on the same audio
```

* **No third-party audio asset exists anywhere in the path.** The renderer is
  arithmetic (partials, envelopes, a deterministic noise transient); there is
  no soundfont, so there is no sample-library right to clear. MIDI is generated
  by our own generator, so there is no MIDI licence either.
* **On-demand by construction.** `renderComposition(spec)` is a pure function of
  the manifest; the plan (150 compositions) is 200 lines of JSON, not audio.
  Only the bounded demo is written to disk.
* **Deterministic.** Every composition derives from its id through an xorshift32
  RNG; the same id renders byte-identical audio on any machine.

## 2. Coverage

150 planned compositions: **2 instruments × 9 textures**, stratified across
train/val/test (96/25/23). Textures: single, melody, chords, dense, bass,
repeated, octaves, innerVoices (loud melody over a quiet inner line), mixed.
Pitch ranges 21–108, velocities 0.15–1.0, note lengths 0.25–4 beats, tempos
92–132 BPM.

Demo actually rendered: **36 clips, 1 232 notes, 156 s of audio, 15 MB**.

## 3. Ground-truth verification (the point of the round)

**Onset alignment** — the symbolic onset is not trusted; the audible onset is
measured from the waveform (64-sample RMS, 20 % of the note's own peak) on
energy-isolated attacks: **401 measured, median +1.107 ms, p95 +1.134 ms, worst
+2.902 ms**. A few measurements are negative (a previous note's tail still above
the threshold); the mean −2.1 ms reflects those, not the renderer. Latency is
therefore under 3 ms — far below any note boundary at 86 fps (11.6 ms/frame).

**Pitch/time truth**: every note carries exact midi, onset, offset, velocity and
instrument; offsets are checked to be after onsets and the event list is sorted.

## 4. Does Basic Pitch show useful error variation? — measured, and the honest answer is "too easy"

| texture | BP event F1 @60 ms (36 synthetic clips) |
|---|---|
| single / melody / repeated | 1.000 |
| octaves | 0.989 |
| mixed | 0.961 |
| dense | 0.938 |
| chords | 0.932 |
| innerVoices | 0.916 |
| bass | 0.893 |
| **all** | **0.958 (piano 0.957, guitar 0.960)** |

Compare with the released model on **real** GuitarSet: **0.772** micro F1 on
fresh compositions, **0.838–0.879** on other splits. The corpus is
**substantially easier than real music** — as the mission anticipated. The
renderer has correct timing and exact labels, but its acoustics are simplistic:
a static harmonic series per note, one decay law, no body resonance, no string
noise, no performance timing jitter, no mixing. The lowest scores (bass 0.893,
innerVoices 0.916, chords 0.932) show the textures that do stress the model,
which is where realism investment should go first.

**Therefore: this corpus is a pipeline, not yet a training set that can be
expected to transfer.** Any model trained on it must be evaluated on real
recordings, and a synthetic-only gain means nothing.

## 5. Splitting and contamination control

* `splitForComposition(id)` is a pure function of the composition id, so
  **every variant of a composition keeps its split** — a render with a
  different seed or timbre cannot straddle train and test.
* Splits are stratified across instruments and textures by construction (the
  plan contains every texture in every split).
* GuitarSet stays the real anchor with its composition-disjoint manifest from
  the previous round. The previously inspected GuitarSet compositions
  (Rock1/SS1/Funk2 and earlier) are not available as a fresh final test; any
  final claim on synthetic data must use its own held-out compositions, and any
  claim about real instruments must use real recordings.
* Synthetic and real are labelled separately in every manifest (`source`), and
  a synthetic render is never counted as evidence about a real instrument.

## 6. Storage efficiency

Plan = JSON. Demo = 15 MB (36 × ~10 s at 16-bit mono, plus truth JSON).
Full 150-composition materialisation would be ~65 MB of WAV — small enough to
regenerate on demand and throw away. Peak disk during the run was under 20 MB
beyond the repo. No existing corpus, checkpoint or benchmark was touched.

## 7. Licensing audit

| source | licence | training use | notes |
|---|---|---|---|
| in-house renderer + generator | ours | unrestricted | no third-party assets |
| GuitarSet | **CC BY 4.0** | permitted with attribution | real anchor, 3.05 h |
| Slakh2100 | CC BY 4.0 *claimed* | **not verified** | do not use before per-file check |
| MAESTRO / MAPS / hFT outputs | non-commercial / research-only | **excluded** | — |
| any soundfont | varies | **not used** | no sample rights in this path |

## 8. Why no training pilot this round

The corpus is 2.6 minutes of demo audio (the plan is longer but not yet
realistic enough to justify a run). Training on it would repeat the previous
mistake: a bounded gain on easy, homogeneous material that disappears on real
music. The mission's own priority — a functioning, verified data pipeline over
another overfit fine-tune — is what was delivered.

## 9. Next major blockers

1. **Acoustic realism**: per-partial decay is in; still missing body resonance,
   string noise, note-dependent spectral tilt, and performance jitter. Measured
   target: bring BP's synthetic F1 down toward its real-music level (0.77–0.88),
   which is the only sign the corpus is hard enough to be useful.
2. **Scale with variety**: 10–50 h requires generating with many timbres per
   instrument, dynamics sweeps and mixed ensembles — all cheap once the
   renderer is realistic.
3. **Real data**: GuitarSet remains the only rights-clean real anchor;
   Slakh per-file verification is the next candidate for real piano.
4. Only then a training pilot, selected on **event-level F1** through the
   production extractor, with rehearsal against the released model.

## 10. Reproduce

```bash
node --expose-gc scripts/audio-vision-synth-corpus.mjs --clips 36 \
  --out /tmp/synth-corpus --json benchmarks/audio-vision/synth-corpus.json
```

Artifact: `benchmarks/audio-vision/synth-corpus.json` (plan, onset statistics,
per-texture and per-instrument Basic Pitch results, per-clip rows). Tests:
`tests/synthCorpus.test.js` (9 tests: determinism, audible output, event
ordering, onset alignment < 5 ms, instrument timbre difference, split
integrity, variant stability, RNG determinism).
