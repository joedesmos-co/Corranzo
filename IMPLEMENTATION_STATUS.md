# ScoreFlow Implementation Status

**Last updated:** 2026-06-12 (Phase 2 in progress)

## Git

| Item | Value |
|---|---|
| Branch | `main` |
| Baseline | `2146791` |
| Phase 0 | `3a5bdd9` |
| Phase 1 | `2778761` |
| Phase 2 | *(pending commit)* |

## Test results

```
npm test → 39/39 pass (5 files)
npm run build → green
```

## Completed

### Phase 1 (`2778761`)
- Ordered MusicXML parser (`xmlTree.js`, `parseMusicXml.js`)
- Repeat interpreter rewrite (`parseMeasureRepeats.js`)
- Timeline API (`timeline.js`) + loop/WFY wiring
- Demo anchors regenerated (96 quarters, ~41.14s)

### Phase 2 (partial, uncommitted)
- `scorePlaybackSchedule.js` — pure performed-timeline event builder (tested)
- `scorePlaybackEngine.js` — windowed scheduler, rate support
- `useScorePlayback.js` — XML-only + optional MIDI on performed clock
- Removed Safari UA playback gate (`isSafariPlaybackLimited()` → false)
- `usePracticeSession` uses score playback when MusicXML present
- Loop wrap works for XML-only playback
- Transport UI updated for MusicXML-first playback

## Current Phase 2 task

Wire tempo-rate UI; metronome event stream; delete `livePracticeTime` duplicate; remove demo warning suppression after alignment passes.

## Remaining

- **Phase 2:** tempo UI, metronome, MIDI measure-mapper (replace proportional), `livePracticeTime` cleanup
- **Phase 3:** unified cursor resolver, anchor promotion fix, page-follow
- **Phase 4:** WFY polish, calibration UX
- **Phase 5:** iPad profiling, lint zero, cleanup, docs

## Exact next file/function

Expose `playback.setPlaybackRate` in practice UI; add metronome ticks to `scorePlaybackEngine.scheduleWindow`

## Manual verification (not performed this session)

- iPad Safari: tap Play on demo → audio unlock + cursor advance
- XML-only piece without MIDI: Play enabled, audible synth
