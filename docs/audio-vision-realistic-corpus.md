# Audio Vision — realistic, rights-clean corpus: measured domain gap

Research only. No training run; production untouched.

## 1. Manifest discrepancy — resolved

The plan is **144 compositions**, not 150: `--compositions 150` was a target and
`round(150 / 18 cells) = 8` produced 144 with no record of the difference. The
prose in the previous report said "150 planned". Fixed: the plan now distributes
the remainder exactly (`plan.length === planSize`, asserted), records
`requested`/`compositions`/`splitSum`/`everyCompositionInOneSplit`, and every
composition belongs to exactly one split by construction.

## 2. The measured gap (per isolated note, before → after)

| | attack ms | decay τ ms | centroid Hz | H1 share | even/odd | noise floor dB |
|---|---|---|---|---|---|---|
| **real acoustic guitar** | 5.8 | 188 | 247 | 0.56 | 1.71 | −8.8 |
| synth guitar, before | 2.9 | 610 | 1032 | 0.77 | 1.2 | −172 |
| **synth guitar, after** | **5.8** | **260** | **700** | 0.90 | 7.2 | **−55** |
| **real piano** | 49.3 | 930 | 528 | 0.064 | 6.9 | −2.2 |
| synth piano, before | 5.8 | 905 | 176 | 0.54 | 3.4 | −175 |
| **synth piano, after** | **26.1** | **1077** | 196 | 0.50 | 2.9 | **−56** |

## 3. Realism changes made (all rights-clean, in-house)

* **Guitar**: measured decay τ 610 → 260 ms (real 188); pluck-position comb
  filtering; body-resonance lift at 80–280 Hz; slower attack 5.8 ms (exactly
  the measured real value); **strum stagger** 6–18 ms for chord notes (recorded
  in the truth); paired-string detune; a −55 dBFS broadband floor; a 1.4 kHz
  microphone/body tilt that brought the centroid 1032 → 700 Hz.
* **Piano**: attack 5.8 → 26 ms (real 49); velocity-dependent brightness;
  16 partials with the fundamental no longer dominant; detuned unison strings
  (beating); register-dependent decay; a 5.2 kHz tilt; the same noise floor.
* **Truth**: the label is now the **audible** onset measured from the rendered
  waveform, stored alongside the symbolic onset (`audibleOnsetSeconds`), because
  a 30 ms piano attack is audibly ~7 ms late. A test asserts the recorded label
  reproduces from the waveform and that the shift stays inside one annotation
  frame (11.6 ms).

## 4. The finding that matters

**Basic Pitch's scores on the synthetic corpus did not change at all** after all
of that: 0.955 (guitar) and 0.978 (piano), identical note sets, precision 1.00.
The model is robust to timbre, decay, noise floor and microphone colouring.

So the 0.96-vs-0.77 gap is **not** acoustic timbre. It comes from the structural
properties of real performances that the renderer still lacks: performance
timing jitter, dynamics and articulation, note overlaps and masking, and the
recording/mixing conditions of a real session. Tuning the spectrum further would
be chasing a number the model does not respond to.

## 5. What is still missing (evidence-based)

1. **Performance timing**: real onsets deviate from the grid by 10–40 ms and
   chords are rolled; the renderer is metronomic.
2. **Dynamics and masking**: real recordings have wide velocity spread and a
   bass line that competes with the harmony; the renderer's mix is flat.
3. **Articulation**: staccato vs legato, muting, string buzz, pedal.
4. **Room**: a real impulse response, not a single-pole tilt.

These are the next realism investments, and they must be validated the same way:
by checking that BP's **error mechanisms** (bass recall, dense F1, octave
errors) start to resemble its real-recording errors, not by lowering a score.

## 6. Contamination and storage

Splits remain composition-keyed (every variant of a composition stays in its
split); synthetic and real are labelled separately. The plan is JSON; only the
bounded demo is materialised (~15 MB before, similar after); peak additional
disk during this round was under 20 MB.

## 7. Reproduce

```bash
node --expose-gc scripts/audio-vision-domain-gap.mjs --json benchmarks/audio-vision/domain-gap-after.json
node --expose-gc scripts/audio-vision-synth-corpus.mjs --clips 36 --out /tmp/synth-corpus
```

Artifacts: `domain-gap-before.json`, `domain-gap-after.json`,
`synth-corpus.json`. Tests: `tests/synthCorpus.test.js` (10).

## 8. Next experiment

Add **performance structure** to the renderer — seeded timing jitter, velocity
spread, articulation and a synthetic room IR — then re-run this same
measurement and require BP's bass/dense/octave error profile to move toward the
real recordings (real guitar bass recall is 0.43 in this sample) before any
training pilot.
