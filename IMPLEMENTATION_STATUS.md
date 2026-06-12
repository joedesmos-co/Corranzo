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

Branch: `main` (clean)

## Test results

```
npm test  → 51/51 pass (6 files)
npm run build → green
```

## Integrity checks (this session)

### Tempo fixture `repeatWithTempoChange`
**Legitimate test-data correction**, not weakened assertion. MusicXML tempo persists until the next `<sound tempo>` mark. The fixture originally omitted restoration on m3 while tests expected 120 BPM (2s measure duration after repeat). Adding `<sound tempo="120"/>` to m3 is correct MusicXML. Separate fixture `repeatWithTempoChangeNoRestore()` proves 60 BPM persists into m3 when no restoration exists (`playbackSchedule.test.js`).

### MIDI mapping
Proportional mapping retained only as **explicit low-confidence fallback** in `midiToPerformedMapping.js`. Primary path is measure-aligned piecewise mapping when alignment assessment ≠ `unlikely-match`. Fallback emits user-visible `mappingWarning` in playback UI.

## Completed by phase

### Phase 1 (`2778761`)
- Ordered parser (`xmlTree.js`, `parseMusicXml.js`)
- Repeat interpreter rewrite
- Timeline API + loop/WFY performed-time wiring
- Demo anchors regenerated (96 quarters, ~41.14s)

### Phase 2 (`bb83f5b`)
- `ScorePlaybackEngine` — windowed scheduler, deduped events, rate support
- `PracticePlaybackSettings` — speed slider, metronome toggle/level, effective tempo display
- Measure-aligned MIDI mapper + proportional fallback with warnings
- Unified practice clock (`clock.practiceTime`; removed `livePracticeTime`)
- Removed `demoHiddenWarningIds` suppression
- Tests: tempo persistence, MIDI mapping, schedule, rate/tempo display

### Phase 3 (`2576e2a`)
- `resolveScoreFollowCursor.js` — exact + interpolated cursor, gap-safe needsSetup
- `useScoreFollow.js` — single resolver (removed compute+validate duplicate path)
- `pairSystemSpanAnchors` role fix — layout anchors promote per measure
- `usePracticePageFollow.js` — scroll seed from `scrollTop`, 2s user-scroll suspend
- Display smoothing reachable (`lockExact` only at start lock)
- Tests: `cursorResolver.test.js` (gap interpolation, layout promotion)

## Remaining (Phases 4–5)

### Phase 4
- WFY calibration UX simplification (per-system taps)
- Note-target geometry shared with cursor resolver
- Count-in UI on metronome stream
- Manual iPad protocol (not performed this session)

### Phase 5
- Lint ratchet toward zero (currently ~636 repo-wide; `.venv-fixtures/` may still inflate)
- Delete dead code: `scoreFollowCursor.js` compute path, `scoreFollowStartSanity.js` validator, `beatInterpolation` placebo toggle
- `ARCHITECTURE.md`
- iPad 60fps profiling (requires device)

## Exact next work

Phase 4: wire `resolveScoreFollowCursor` geometry into `noteTargetContext.js`; remove `beatInterpolation` dead toggle.

## Manual verification not performed

- iPad Safari Play + cursor
- Browser audio audition
- Real-device 60fps profiling
