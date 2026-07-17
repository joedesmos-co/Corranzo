# Corranzo OMR V3 Promotion Baseline

Date: 2026-07-16

Branch: `codex/omr-v3-promotion`

Status: Phase 0 baseline; no production OMR behavior changed.

## Inputs and method

The audit covered `docs/OMR_V3_FINAL_REPORT.md`, `docs/OMR_V3_IR_SPEC.md`, the V3 implementation, the PDF import UI and client/worker pipeline, the benchmark dashboard, and the complete current manifest/corpus. `PROJECT_BRIEF.md` is named in the sprint instructions but is not present in this repository or workspace; the supplied sprint brief is therefore the governing product brief.

The baseline command was:

```sh
/usr/bin/time -p npm run omr:benchmark-dashboard -- \
  --json tmp/omr-v3-promotion-baseline/report.json \
  --md tmp/omr-v3-promotion-baseline/report.md
```

It completed successfully in 16.40 seconds wall time (19.15 seconds user CPU, 0.32 seconds system CPU). Preprocessing and the V3 shadow were enabled; ScoreGraph clip promotion was disabled.

## Baseline outcomes

| Outcome | Result |
| --- | ---: |
| Manifest fixtures | 16 |
| Enforced fixtures passing policy | 10/10 (100%) |
| Diagnostic fixtures evaluated but skipped by policy | 6/6 |
| Dashboard failures/errors | 0/0 |
| Imports reaching a deterministic terminal outcome | 16/16 (100%) |
| Imports producing recognized playback | 15/16 (93.75%) |
| Enforced imports producing recognized playback | 9/10 (90%) |
| Expected honest rejection | 1 (`guitar-paired-scan`) |
| V3 shadow-ready enforced transcriptions | 9/10 |
| Runtime promotions | 0 |

"Import success" above means the PDF was read and the pipeline returned either playable output or a defined, user-safe recognition rejection without a crash. "Recognition success" means MusicXML playback was produced. The paired guitar scan is counted as an enforced benchmark pass because its frozen policy requires honest rejection, but it is not counted as a recognition success.

## Recognition baseline

Macro accuracy across the nine enforced fixtures that emitted transcriptions:

| Metric | Baseline |
| --- | ---: |
| Pitch accuracy | 28.82% |
| Duration accuracy | 56.41% |
| Onset accuracy | 57.89% |
| Chord grouping accuracy | 62.32% |
| Note detection F1 | 74.84% |
| Aggregate absolute measure-count error | 25 |

The V3 shadow remains `shadow-only`: two enforced fixtures improve on at least one metric, six regress, and one expected-rejection fixture has no post-recognition shadow output. No promotion gate or confidence threshold was changed.

## Confidence distribution

Production confidence was available for 15 recognized fixtures:

| Population | Minimum | Median | Mean | Maximum |
| --- | ---: | ---: | ---: | ---: |
| All recognized fixtures (15) | 0.6000 | 0.8523 | 0.8150 | 0.8650 |
| Recognized enforced fixtures (9) | 0.6000 | 0.8432 | 0.7925 | 0.8650 |

The all-fixture values, sorted, are `0.6000, 0.6265, 0.7613, 0.7987, 0.8414, 0.8432, 0.8474, 0.8523, 0.8649`, followed by six values effectively equal to `0.8650`.

This distribution is poorly calibrated: exact diagnostic scores and materially inaccurate enforced scores often receive the same 0.865 confidence ceiling. The current document confidence is an arithmetic mean of measure confidence and does not model staff continuity, voice continuity, system neighbors, or structural/rhythmic agreement.

## Common failure modes

1. **Measure/system allocation:** dense piano, paired guitar, and complex multi-page engravings create excess systems or measures. The enforced absolute measure-count error is 25; V3 structure still rejects correct staff pairings and duplicates measure timelines.
2. **Rhythm and voice serialization:** rhythm inference is the primary dashboard source on seven recognized fixtures. Chord grouping is the largest aggregate named bucket at 9,000 errors (31.31%).
3. **Guitar symbol and notation/TAB fusion:** standard guitar under-detects notes; paired notation/TAB fixtures have weak V3 pairing recall and the paired scan produces no usable notes.
4. **Scanned-page sensitivity:** the articulation scan produces 23 extra notes and only 46.85% duration accuracy. Existing preprocessing runs only after a coarse scanned/digital classification and always applies a full fixed transform set to scans.
5. **Confidence miscalibration:** very different recognition quality maps to nearly identical confidence because confidence is averaged rather than reasoned from structure.
6. **Whole-document rejection:** the pipeline rejects before V3 can evaluate the paired guitar scan and has no document-level mechanism to isolate a damaged system while retaining safe recognized regions.

## Import-pipeline audit snapshot

The pre-change import path is:

```text
File.arrayBuffer + blob URL
  -> auto-start OMR panel
  -> re-fetch blob URL
  -> clone PDF bytes
  -> pdf.js page-count load
  -> sequential render, yield, then text extraction
  -> copy full RGBA page
  -> preprocessing (another full copy even when skipped)
  -> worker serialization (another full RGBA copy + transfer)
  -> page recognition
  -> document post-processing + MusicXML
  -> re-fetch the same blob URL again
  -> create a replacement blob URL and reset the viewer
  -> parse/validate generated MusicXML
  -> Practice
```

The principal promotion opportunities are to reuse already-owned PDF bytes, overlap independent page render/text work, remove redundant full-page pixel copies while preserving transfer ownership, retry a failed worker page once, avoid re-fetching/replacing the PDF after successful OMR, and expose phase timing/recovery diagnostics for repeatable profiling.

## Baseline corpus coverage

The enforced CC0 corpus includes beginner single-staff piano, grand-staff voices, tuplets/rhythm, a raster articulation scan, dense piano, TAB-only guitar, standard-notation guitar chords, paired notation/TAB chords, paired techniques, and a paired guitar scan. The six diagnostic scores add clean and dense multi-page piano, a legacy-font beginner score, guitar, and two advanced public/legacy engravings, but are not redistribution-safe enforced fixtures.

The corpus has no enforced orchestral or beginner-book/multi-page scan category. Those are Phase 7 gaps, not silent successes.
