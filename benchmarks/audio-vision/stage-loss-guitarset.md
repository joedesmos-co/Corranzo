# Stage-loss ledger (per stage, against a reference the pipeline never sees)

generated 2026-10-22T12:52:28.271Z · sources: guitarset · onset tolerance 0.12s

| recording | S0 model F1 | S1 transcription F1 | S2 grid F1 | S3 melody recall | piano/inter F1 | guitar/inter F1 | density | invented | xml ok |
|---|---|---|---|---|---|---|---|---|---|
| guitarset-jazz2-solo | 0.82 | 0.833 | 0.811 | 0 | 0.821 | 0.83 | 2.72 | 0.211 | true |
| guitarset-jazz1-solo | 0.909 | 0.916 | 0.916 | 0 | 0.923 | 0.923 | 4.51 | 0.062 | true |
| guitarset-ss3-comp | 0.671 | 0.684 | 0.674 | 0 | 0.585 | 0.575 | 4.2 | 0.208 | true |
| guitarset-bn2-comp | 0.743 | 0.741 | 0.728 | 0 | 0.609 | 0.607 | 5.63 | 0.103 | true |
| guitarset-funk3-comp | 0.797 | 0.759 | 0.759 | 0 | 0.523 | 0.505 | 6.5 | 0.054 | true |

## Aggregate

```json
{
  "recordings": 5,
  "s0": {
    "eventF1": 0.788,
    "pitchRecall": 0.848,
    "onsetMaeMs": 12.4
  },
  "s1": {
    "eventF1": 0.787
  },
  "s2": {
    "eventF1": 0.778
  },
  "pianoIntermediate": {
    "eventF1": 0.692,
    "density": 4.712,
    "invented": 0.128
  },
  "guitarIntermediate": {
    "eventF1": 0.688
  },
  "xmlValid": true
}
```

