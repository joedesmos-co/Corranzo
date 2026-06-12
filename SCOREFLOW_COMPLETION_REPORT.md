# ScoreFlow Completion Report

**Date:** 2026-06-12  
**Branch:** `main`

## Completed features

- Ordered MusicXML parser with repeat interpreter and performed timeline API
- Unified playback engine (MusicXML synth + optional MIDI backing, rate, metronome, seek/pause/stop)
- Measure-aligned MIDI mapping with explicit low-confidence proportional fallback
- Single cursor resolver with gap interpolation and layout anchor promotion
- Wait For You on performed time with repeat-pass checkpoints
- Shared cursor/note-target geometry
- Practice loops on performed time (including across repeat passes)
- Compact speed, metronome, effective tempo, and audio source controls
- System-level calibration guidance; manual measure correction preserved
- Practice statistics keyed to playback clock

## Replaced architecture

| Before | After |
|--------|-------|
| Competing clocks (`livePracticeTime`, MIDI wall time) | `ScorePlaybackEngine` performed-time clock |
| compute + validate cursor stack | `resolveScoreFollowCursor` |
| Three anchor mappers | Resolver + shared note-target baseline |
| Proportional-only MIDI mapping | Measure-aligned primary + warned fallback |
| Safari UA playback gate | Capability probes |
| Dead interpolation / playhead / auto-align shims | Removed |

## Remaining limitations

- D.C./D.S./Fine/Coda not interpreted
- Count-in not implemented
- Lint not at zero (~598 issues repo-wide; pre-existing React hooks patterns dominate)
- iPad Safari not physically verified in this session
- 60fps profiling requires target device

## Automated validation

| Check | Result |
|-------|--------|
| Tests | **59/59 pass** (8 files) |
| Build | **pass** |
| Lint | **598 problems** (592 errors, 7 warnings) — `.venv-fixtures/` ignored |

## Milestone commits

| Phase | Commit |
|-------|--------|
| Baseline | `2146791` |
| Phase 0 | `3a5bdd9` |
| Phase 1 | `2778761` |
| Phase 2 (partial) | `054743a`, `e9b3c3e` |
| Phase 2 | `bb83f5b` |
| Phase 3 | `2576e2a` |
| Status | `3dcb745` |
| Phase 4 | `78904a6` |
| Phase 5 | *(see git log after this commit)* |

## Files added (this completion)

- `src/features/score-follow/anchorSort.js`
- `scripts/timingMeasureAnchors.js`
- `tests/practiceExperience.test.js`
- `tests/playbackEngine.test.js`
- `ARCHITECTURE.md`
- `SCOREFLOW_COMPLETION_REPORT.md`

## Files removed

- `src/features/score-follow/scoreFollowPlayhead.js`
- `src/features/score-follow/autoScoreAlignment.js`
- `src/features/score-follow/scoreFollowCursor.js`
- `src/features/score-follow/scoreFollowStartSanity.js`
- `src/features/score-follow/scoreFollowInterpolation.js`
- `src/features/score-follow/timingMeasureAnchors.js` (relocated to `scripts/`)

## Browser checks not physically performed

- Mac Safari audio unlock and playback audition
- iPad Safari touch scroll, page follow, microphone WFY
- Background/resume browser tab behavior on iPad
- 60fps cursor profiling on target iPad

## iPad manual test checklist

1. Import XML-only score (no MIDI)
2. Tap Play to unlock audio
3. Pause, resume, seek scrubber
4. Change speed during playback (verify cursor stays aligned)
5. Enable metronome and adjust level
6. Create a measure loop on a repeated passage
7. Verify repeat/volta playback matches score
8. Verify moving cursor on demo or calibrated score
9. Wait For You with microphone on a short passage
10. Touch-scroll PDF; confirm page follow resumes after ~2s idle
11. Background Safari and return; confirm audio resumes where possible
