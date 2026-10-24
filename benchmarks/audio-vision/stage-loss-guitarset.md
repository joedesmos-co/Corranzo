# Stage-loss ledger (per stage, against a reference the pipeline never sees)

generated 2026-10-24T17:34:49.825Z · sources: guitarset · onset tolerance 0.12s

| recording | S0 model F1 | S1 transcription F1 | S2 grid F1 | S3 melody recall | piano/inter F1 | guitar/inter F1 | density | invented | xml ok |
|---|---|---|---|---|---|---|---|---|---|
| guitarset-jazz2-solo | 0.876 | 0.876 | 0.852 | 0 | 0.85 | 0.855 | 2.55 | 0.157 | true |
| guitarset-jazz1-solo | 0.915 | 0.915 | 0.915 | 0 | 0.915 | 0.915 | 4.44 | 0.047 | true |
| guitarset-ss3-comp | 0.753 | 0.759 | 0.743 | 0 | 0.678 | 0.659 | 3.72 | 0.135 | true |
| guitarset-bn2-comp | 0.75 | 0.755 | 0.746 | 0 | 0.663 | 0.654 | 4.71 | 0.022 | true |
| guitarset-funk3-comp | 0.743 | 0.735 | 0.732 | 0 | 0.514 | 0.499 | 5.86 | 0.03 | true |

## Aggregate

```json
{
  "recordings": 5,
  "s0": {
    "eventF1": 0.807,
    "pitchRecall": 0.786,
    "onsetMaeMs": 12.2
  },
  "s1": {
    "eventF1": 0.808
  },
  "s2": {
    "eventF1": 0.798
  },
  "pianoIntermediate": {
    "eventF1": 0.724,
    "density": 4.256,
    "invented": 0.078
  },
  "guitarIntermediate": {
    "eventF1": 0.716
  },
  "xmlValid": true
}
```

