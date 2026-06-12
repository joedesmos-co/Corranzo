# ScoreFlow Implementation Status

**Last updated:** 2026-06-12

## Git commits (preserved)

| Milestone | Commit |
|---|---|
| Baseline | `2146791` |
| Phase 0 | `3a5bdd9` |
| Phase 1 | `2778761` |
| Phase 2 (partial) | `054743a`, `e9b3c3e` |
| Phase 2 (complete) | `bb83f5b` |
| Phase 3 | `2576e2a` |
| Status update | `3dcb745` |
| Phase 4 | `78904a6` |
| Phase 5 | `a5c4a8b` |

Branch: `main`

## Test results

```
npm test  → 59/59 pass (8 files)
npm run build → green
```

## All phases complete

### Phase 1 — Timeline core
Ordered parser, repeat interpreter, timeline API, demo anchors regenerated.

### Phase 2 — Playback engine
`ScorePlaybackEngine`, measure-aligned MIDI mapping, rate/metronome, unified clock.

### Phase 3 — Cursor resolver
`resolveScoreFollowCursor`, layout promotion fix, page-follow hardening.

### Phase 4 — Practice experience
- WFY note checkpoints carry `repeatPass`
- Note target uses shared cursor resolver geometry
- Performed-time measure windows for note-target timing
- System-level calibration copy in setup panel
- Compact audio source indicator (MusicXML synth vs MIDI backing)
- Tests: `practiceExperience.test.js`, `playbackEngine.test.js`

### Phase 5 — Cleanup and docs
- Deleted: `scoreFollowPlayhead.js`, `autoScoreAlignment.js`, `scoreFollowCursor.js`, `scoreFollowStartSanity.js`, `scoreFollowInterpolation.js`
- Removed `beatInterpolation` placebo toggle
- Relocated `timingMeasureAnchors.js` → `scripts/timingMeasureAnchors.js`
- Added `anchorSort.js` (performed-time anchor sort)
- ESLint ignores `.venv-fixtures/`
- `ARCHITECTURE.md`, `README.md`, `SCOREFLOW_COMPLETION_REPORT.md`

## Manual verification not performed

- iPad Safari Play + cursor
- Browser audio audition
- Real-device 60fps profiling
