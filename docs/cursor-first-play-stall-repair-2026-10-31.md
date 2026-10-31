# First-Play main-thread stall repair — 2026-10-31

## Result

The production first-Play stall is removed without changing musical timing or
cursor geometry.

| Production Chromium, 5 runs | Before | After |
|---|---:|---:|
| Longest main-thread task | 336–373 ms | **0 ms** (>50 ms threshold) |
| Maximum RAF gap | 317–367 ms | **0 ms** (>50 ms threshold) |
| Script CPU over 3 s | 928–1001 ms | **171 ms** |
| Total task CPU over 3 s | 1189–1304 ms | **395–402 ms** |
| First transport advance | 266–281 ms | **233–235 ms** |
| First cursor movement | 50–64 ms | **33–35 ms** |
| Click → first scheduled audio source | 42.8–49.0 ms | **6.7–9.3 ms** |
| Playing state | 14–18 ms | 16–18 ms |
| Retained heap after forced GC | +0.87 MB | +1.17 MB |

WebKit production:

| WebKit | Before | After |
|---|---:|---:|
| Maximum RAF gap | 209 ms | **35–37 ms** |
| RAF gaps > 50 ms | 2 | **0** |
| First cursor movement | 149 ms | **108–139 ms** |
| First transport advance | 367 ms | **308–339 ms** |

The dev trace's first-play gap fell from **728 ms** to **45 ms**. Chromium and
WebKit target-vs-painted-DOM comparison remained **0 mismatches**, with **0
fallback frames** and **0 backward steps within a system**.

## Exact blocking operation (profiled, not assumed)

A V8 CPU profile of the first Play in the production build (CDP
`Profiler.start`, CDP `Input.dispatchMouseEvent` to avoid evaluating on the
blocked main thread) showed the 400 ms active run dominated by:

| Before — self time | Function | Source |
|---:|---|---|
| 108.9 + 105.3 + 102.5 + 93.3 ms | `expandPerformedNotes` | `src/features/musicxml/timeline.js` |
| 48.9 + 45.2 + 36.4 + 36.0 ms | `buildMeasureMusicalEvents` | `src/features/score-follow/cursorMusicalProgress.js` |
| stack entries | `rebuildPlaybackVoice` → `flushPendingAudio` → voice.dispose / Sampler setup | `src/features/playback/scorePlaybackEngine.js` |

After the fix, the same profile's longest active run is **22.8 ms** and
`expandPerformedNotes` no longer appears in the top self-time list.

## Root cause

1. `getTimeline(timingMap).performedNotes()` re-expanded the whole score on
   every call. The motion timeline, note-target and checkpoint paths ask for
   it once per measure, so a 104-measure/1,584-note score paid an
   `O(entries × notes)` scan repeatedly during the first-play React render.
   `expandPerformedNotes` also filtered all notes for every performed measure.
2. `playFromUserGesture()` called `releaseAll()` before the first playback.
   `releaseAll()` always called `flushPendingAudio()`, which disposed and
   rebuilt the sampled instrument and metronome even though nothing had been
   scheduled and playback was stopped.

## Fix

`src/features/musicxml/timeline.js`
- Group notes by written measure once, then walk performed entries. This
  changes `O(entries × notes)` to `O(entries + notes)`.
- Cache the expanded performed-note array per timing map. The timing map is
  immutable, and callers only filter/map it.

`src/features/playback/scorePlaybackEngine.js`
- `releaseAll()` returns immediately when playback is stopped and
  `scheduledEvents` is empty. Pause/stop/seek with queued or sounding events
  still flush exactly as before.

No event times, score coordinates, cursor resolver, or scheduling windows were
changed.

## Preserved cursor fixes

Commit `aaf408c0fa` is untouched:
- measure-start knots for any first onset after the measure start;
- phrase boundary epsilon 10 ms → 1 ms.

Re-measured after the performance change:

| Boundary | Chromium | WebKit |
|---|---:|---:|
| 1:0 m6 → 1:1 m7 | 1.0 ms early | 1.0 ms early |
| 1:1 m12 → 1:2 m13 | 0.0 ms early | 0.0 ms early |
| 1:4 m30 → 2:5 m31 | 1.0 ms early | 1.0 ms early |
| 2:5 m32 → 2:6 m33 | 1.0 ms early | 1.0 ms early |
| 2:9 m57 → 3:10 m58 | 1.0 ms early | 1.0 ms early |
| 3:14 m88 → 4:15 m89 | 1.0 ms early | 1.0 ms early |

## Acceptance traces

- Hungarian Dance No. 5: 104 measures, 4 pages, repeats, system/page turns.
- Fugue in C, BWV 846: 27 measures, 2 pages, 455 ms pickup.
- First Play, replay, pause/resume, seek during playback, repeat jump, page
  turns, fit-mode change, viewport resize and scroll.
- Target-vs-DOM mismatch: 0. Fallback frames: 0. Backward within system: 0.
- First-play gap after fix: 45 ms Chromium, 54 ms WebKit, 64 ms Fugue
  Chromium. No frame starvation over 50 ms remains in production.

## Tests

`tests/firstPlayPerformance.test.js` adds:
- performed-note expansion is reused and still matches a fresh timeline;
- stopped engine with nothing scheduled does not rebuild the voice;
- queued/sounding audio still flushes on pause/seek.

Key suites: 26 files / 272 tests pass, including playback acceptance, timeline,
cursor and score-follow suites.

## Reproduction

```bash
npm run build
npm run preview -- --port 5180

node scripts/profile-first-play.mjs --base http://localhost:5180 --out /tmp/first-play.cpuprofile
node scripts/analyze-cpuprofile-task.mjs /tmp/first-play.cpuprofile
node scripts/cursor-startup-longtask.mjs --base http://localhost:5180
node scripts/cursor-first-play-metrics.mjs --base http://localhost:5180
node scripts/cursor-first-play-webkit.mjs --base http://localhost:5180
node scripts/cursor-memory-metrics.mjs --base http://localhost:5180
node scripts/cursor-first-audio-onset.mjs --base http://localhost:5180
```

## Integration

- Performance fix: `4c63d758f7` — `fix(playback): remove first-Play timeline
  expansion and voice rebuild stalls`
- Cursor timeline fix preserved: `aaf408c0fa`
- Prior verification harness preserved: `86226ce824`

No push, no deployment.
