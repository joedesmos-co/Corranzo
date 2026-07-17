# OMR V3 Production Qualification Baseline

**Date:** 2026-07-16 (America/New_York)  
**Branch:** `codex/omr-v3-production-qualification`  
**Starting commit:** `4b17d7e`

## Scope

This baseline answers a narrower question than the accuracy campaign: whether the available evidence proves that OMR V3 can replace V2 in production. It does not treat a benchmark score increase as sufficient evidence.

`PROJECT_BRIEF.md` is not present in the repository. The available V3 design, promotion, accuracy, qualification, stress-corpus, implementation, benchmark, and rollout materials were reviewed instead.

## Reproduction

```sh
/usr/bin/time -p npm run omr:benchmark-dashboard -- \
  --json tmp/omr-v3-production-qualification-baseline/report.json \
  --md tmp/omr-v3-production-qualification-baseline/report.md
```

Observed wall time: **32.00 seconds**.

## Current results

| Evidence | Result |
| --- | ---: |
| Manifest fixtures | 20 |
| Enforced fixtures | 10 |
| Enforced benchmark passes | 10 |
| Enforced benchmark failures/errors | 0 |
| Diagnostic fixtures skipped because local assets are absent | 10 |
| Remaining enforced V3 regressions | 0 |
| Enforced V3 improvements | 1 |
| Enforced fixtures without a completed V3 shadow | 1 |
| Runtime promotion | disabled |

The unavailable V3 fixture is `guitar-paired-scan`. V2 correctly rejects it as low-confidence before the existing V3 shadow result is built.

## Evidence limitation

The current ready V3 shadows are compatibility shadows. Their musical symbols are reconstructed from `measureRhythms`, which are already grouped, timed, voiced legacy runtime events. This is useful for exercising the V3 IR, structure, ownership, confidence, and serializer, but it does not establish that V3 independently recognizes notes, rests, chords, voices, or rhythm.

Consequently, **zero enforced compatibility-shadow regressions is necessary but not sufficient for production replacement**. At baseline:

- independently recognized enforced fixtures: **0/9** recognition fixtures;
- independently owned honest-rejection decisions: **0/1** rejection fixture;
- executable V3 runtime candidate: **not implemented**;
- exercised V3 rollback path: **not available**.

## Baseline decision

OMR V3 cannot legitimately replace V2 at this baseline. V2 remains authoritative. The production qualification work must first expose detector-level evidence to V3, quantify the independent result, capture V3 analysis on production rejection paths, and keep full replacement machine-blocked until those results and a rollback-capable runtime candidate pass.

