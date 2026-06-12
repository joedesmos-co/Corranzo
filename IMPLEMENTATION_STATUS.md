# ScoreFlow Implementation Status

**Last updated:** 2026-06-12 (Phase 1 complete, Phase 2 starting)

## Git

| Item | Value |
|---|---|
| Branch | `main` |
| Baseline (untouched) | `2146791` |
| Phase 0 commit | `3a5bdd9` |
| Phase 1 commit | *(pending commit)* |

## Test results

```
npm test → 35/35 pass (4 files)
  parserTiming.test.js      11/11
  timelineExpansion.test.js 11/11
  timelineApi.test.js       10/10
  loopWfyDomain.test.js      3/3
```

All former Phase 0 red tests (audit P1–P10, time-domain) now green.

## Completed work

### Phase 0 (`3a5bdd9`)
- Vitest + fixtures + regression suite; build verified

### Phase 1 (complete)
- **`xmlTree.js`**: ordered XML walk (`preserveOrder`)
- **`parseMusicXml.js`**: document-order parser — fixes P1–P4, P10
- **`parseMeasureRepeats.js`**: explicit repeat interpreter — fixes P5–P9
- **`timeline.js`**: unified written/performed API (`getTimeline`, `locate`, `windowsForMeasure`, `performedBeats`, `performedNotes`)
- Wired timeline into `practiceLoopRegion.js`, `waitForYouCheckpoints.js`, `measureNavigation.js`
- Regenerated `demo-minuet-in-g.anchors.json` (96 quarters, m1=3q, ~41.14s)

## Current Phase 2 task

Replace schedule-everything MIDI engine with transport-driven clock; enable XML-only playback; remove Safari UA gate.

## Remaining phases

- **Phase 2:** Unified playback engine, tempo rate, metronome, capability probes
- **Phase 3:** Single cursor resolver, anchor promotion, page-follow
- **Phase 4:** WFY polish, tempo UI, calibration UX
- **Phase 5:** iPad hardening, cleanup, docs, lint zero

## Exact next file/function

`src/features/practice/midiPlaybackEngine.js` → windowed scheduler on performed timeline
