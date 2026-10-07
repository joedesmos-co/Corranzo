# Zero-parameter sanity baseline (P10)

Source: `manifests/baseline.json` (verdict **PASS**). No learning, no model,
no predictions. This proves the dataset is internally coherent before compute
is spent on training.

## Checks

| check | result |
|---|---|
| splits disjoint | true |
| splits cover the PASS set | true |
| split counts | train 792 / dev 99 / test 99 |
| PASS scores with missing hashes | 0 |
| quarantined scores with a reason | true |
| id-join missing (non-state, PASS) | **0** |
| state groups rendered / resolved / unresolved | 14,157 / 14,028 / 129 |
| state mismatches | 0 |
| source-identity check (music21) | **990/990 exact** |
| geometry-invalid notes | 0 |
| object-table sample (30 gz files): hash + schema + note count | **30/30** |
| pages without detected staff groups | 0 |
| staff gap (page px) | 18.0 on every page |
| raster sample: 2480 px wide, non-blank | **20/20** |
| selection / dataset / determinism manifests present and hashed | true |
| cross-process determinism sample | **25/25 identical** |

## Quality-gate foundation (P11)

Per-page metadata for all 1,141 pages (`data/quality/`):

| metric | min | median | max |
|---|---|---|---|
| staff gap, raster px (2480 px width) | 21.26 | 21.26 | 21.26 |
| contrast (std, downscaled) | 11.45 | 30.91 | 68.21 |
| blur (Laplacian variance, downscaled) | 395 | 2,066 | 9,341 |
| ink fraction | 0.006 | 0.037 | 0.169 |

Rendered pages are uniformly clean by construction (staff gap constant, high
blur variance), so these metrics will become discriminative only once real
scans/photos are ingested. The capture protocol defines the ranges to sample.

## What the baseline does and does not prove

- Proves: the dataset's own geometry, joins, hashes, splits and object tables
  are coherent and reproducible; every PASS score has exact source identity.
- Does not prove: any model can transcribe; any real-world image is readable;
  any quality threshold is calibrated. Those require the OLiMPiC harness and
  the capture route.
