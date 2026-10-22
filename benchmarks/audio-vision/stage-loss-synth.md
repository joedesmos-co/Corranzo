# Stage-loss ledger (per stage, against a reference the pipeline never sees)

generated 2026-10-22T12:52:28.390Z · sources: synth · onset tolerance 0.12s

| recording | S0 model F1 | S1 transcription F1 | S2 grid F1 | S3 melody recall | piano/inter F1 | guitar/inter F1 | density | invented | xml ok |
|---|---|---|---|---|---|---|---|---|---|
| synth-reference | 0.65 | 0.691 | 0.78 | 0 | 0.681 | 0.681 | 1.79 | 0.209 | true |

## Aggregate

```json
{
  "recordings": 1,
  "s0": {
    "eventF1": 0.65,
    "pitchRecall": 1,
    "onsetMaeMs": 4
  },
  "s1": {
    "eventF1": 0.691
  },
  "s2": {
    "eventF1": 0.78
  },
  "pianoIntermediate": {
    "eventF1": 0.681,
    "density": 1.79,
    "invented": 0.209
  },
  "guitarIntermediate": {
    "eventF1": 0.681
  },
  "xmlValid": true
}
```

