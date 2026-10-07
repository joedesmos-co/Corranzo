# Adaptation dashboard pair ingestion (P12)

The pilot's pipeline is exposed as a pair-ingestion contract for the future
training/adaptation dashboard. No UI is built here.

## Contract

Input: a directory of matched pairs, one symbolic file plus one PDF per stem:

```
mypiece.pdf + mypiece.musicxml   (or mypiece.mxl)
```

Command:

```bash
python3 scripts/p12_pair_ingest.py --pairs <dir> [--out <dir>]
```

Outputs per pair: `<stem>/pair.json`; batch: `pairs_batch.json` + `.sha256`.
A sanitised example is committed at `manifests/pairs_batch_example.json`.

## What each pair record contains

| field | meaning |
|---|---|
| `pair` | pair stem |
| `symbolic_path`, `symbolic_sha256` | source identity |
| `pdf_path`, `pdf.sha256`, `pdf.bytes`, `pdf.pages` | PDF provenance |
| `pdf.page1_png` | 200 dpi first-page raster for visual review |
| `checks.pages`, `checks.notes` | render extent |
| `checks.id_join_missing_nonstate` | exact join failures by class |
| `checks.state_mismatch`, `checks.state_unresolved` | state-join accounting |
| `checks.identity` | independent music21 population check (`ok`, counts, histogram) |
| `checks.dropped_features` | source notation dropped by the renderer |
| `checks.mei_sha256`, `checks.svg_sha256` | canonical render hashes |
| `checks.renderer`, `checks.xml_id_seed` | pinned renderer config |
| `status` | `PASS` or `QUARANTINED:<reason>` |

## Batch semantics for ~10 pairs

- Each pair is verified independently; one failure does not block the batch.
- The batch manifest records counts and per-pair status; a dashboard can show
  `pass / quarantined` and the reason per pair.
- Source identity is re-verified on ingestion (hash + re-render + join); a pair
  whose symbolic source changes fails identity.
- Dataset versioning: ingested pairs can be appended to a new dataset version;
  existing version manifests are never edited.

## Test result (in-repo pairs)

9 real in-repo pairs (CC0 fixtures, Mutopia/PD demo scores) were ingested:
**9 PASS, 0 quarantined**. All had exact source identity and exact joins; PDFs
were probed (page count + first-page raster + hash).
