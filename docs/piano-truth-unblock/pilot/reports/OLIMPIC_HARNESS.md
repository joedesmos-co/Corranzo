# OLiMPiC real-world benchmark harness

**Status: ingested and plumbed. No training, no predictions.**

## Dataset

- **OLiMPiC 1.0 Scanned** — system crops of real scanned pianoform sheet music
  (IMSLP page images) with MusicXML and Linearized MusicXML (LMX) truth from
  the OpenScore transcription of the same edition.
- Licence: **CC BY-SA 4.0** (legal review advised for adapted-data
  redistribution; model-weight derivative status is jurisdiction-dependent).
- Source: `https://hdl.handle.net/11234/1-5419`; GitHub release asset
  `olimpic-1.0-scanned.2024-02-12.tar.gz` (225.6 MB).
- Archive sha256 is recorded in `manifests/olimpic_benchmark.json`.

## Ingest result

| split | samples |
|---|---|
| test | 1,493 |
| dev | 1,438 |
| **total** | **2,931** system crops from 100 scores |

Every sample records image/MusicXML/LMX paths and sha256 hashes, image size,
LMX token count, and split identity
(`manifests/olimpic_benchmark.json` + `.sha256`).

## Evaluation plumbing

- Metric: normalised edit distance over whitespace-tokenised LMX sequences
  (`distance / len(truth)`), the same sequence-level view used by LMX-based
  OMR evaluation.
- **Self-check** (truth used as prediction): 2,931/2,931 samples at distance
  0.0 (`manifests/olimpic_selfcheck.json`). This proves ingestion, tokenisation
  and scoring are coherent.
- Future predictions: drop `<sample_id>.lmx` files in a directory and run
  `python3 scripts/p8_olimpic_harness.py --evaluate --predictions <dir>`. Missing
  predictions score 1.0 (empty baseline), so a model cannot game the harness by
  emitting nothing.

## Why this is a valid real-world benchmark

- The images are **real scans**, not renders.
- The truth is **system-level symbolic content**, so no pixel-level
  correspondence between two different engravings is required — this is the
  class of ambiguity that blocked the old campaign.
- The benchmark is frozen by hashes and split lists and is never used for
  training or pipeline tuning.

## Limitations recorded

- System-level, not note-level: the metric cannot verify individual glyph
  positions.
- The OpenScore transcription and the scanned edition are the same music but
  not the same engraving; the benchmark measures music-level transcription,
  not pixel alignment.
- The scanned dataset has dev/test only; no scanned train split is used here.

## Controlled-capture fallback

The capture protocol in `CAPTURE_PROTOCOL.md` remains the route for exact-truth
real-world images (note-level) and is the next real-world step if note-level
acceptance is required.
