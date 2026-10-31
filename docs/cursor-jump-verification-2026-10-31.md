# Cursor jump verification — 2026-10-31

## Patch under test

Commit `aaf408c0fa` — `fix(score-follow): remove 20ms measure-start gap and 10ms phrase-boundary early jump`

```diff
-  if (onsets[0].time > mStart + 0.02) {
+  if (onsets.length > 0 && onsets[0].time > mStart + 1e-6) {
     knots.push({ t: mStart, x: startX, measureNumber, kind: 'measure-start' })
   }
...
-export const PHRASE_BOUNDARY_EPSILON_SECONDS = 0.01
+export const PHRASE_BOUNDARY_EPSILON_SECONDS = 0.001
```

No other production behavior changed. No push, no deployment.

## Environment

- Chromium and WebKit through Playwright 1.61.1, headless.
- Vite dev server for frame traces; production `vite preview` build for the
  startup-stall measurement.
- Preview mode only. No microphone opened, no mic permission requested.
- Real library scores:
  - Hungarian Dance No. 5 — 104 measures, 4 pages, 23 playback phrases,
    repeats and page turns.
  - Fugue in C, BWV 846 — 27 measures, 2 pages, 10 phrases, 455 ms pickup
    delay at measure 1.
  - Allegro in G Major (guitar) — 49 measures, 8 systems, measures opening
    with rests (0.33 s delays at m17/m19/m21/…).

## 1. Phrase-boundary switch is no longer early

Deterministic browser probe: pause, seek to 1 ms steps around each real
boundary, read the live motion-timeline snapshot. The earliest time that
resolves to the next phrase is `boundary - epsilon`.

| Boundary | Before (Chromium) | After (Chromium) | Before (WebKit) | After (WebKit) |
|---|---|---|---|---|
| 1:0 m6 → 1:1 m7 @ 5.4545 | 10.0 ms early | 1.0 ms early | 10.0 ms early | 1.0 ms early |
| 1:1 m12 → 1:2 m13 @ 10.9091 | 9.0 ms early | 0.0 ms early | 9.0 ms early | 0.0 ms early |
| 1:4 m30 → 2:5 m31 @ 27.2727 | 10.0 ms early | 1.0 ms early | 10.0 ms early | 1.0 ms early |
| 2:5 m32 → 2:6 m33 @ 29.0909 | 10.0 ms early | 1.0 ms early | 10.0 ms early | 1.0 ms early |
| 2:9 m57 → 3:10 m58 @ 78.8068 | 10.0 ms early | 1.0 ms early | 10.0 ms early | 1.0 ms early |
| 3:14 m88 → 4:15 m89 @ 111.0038 | 10.0 ms early | 1.0 ms early | 10.0 ms early | 1.0 ms early |

Identical results in Chromium and WebKit. This is the visual jump the patch
removes: the cursor used to leave the old system up to 10 ms before the new
system's first note sounded. It now changes within 0–1 ms of the boundary.

## 2. Real anchors — no fallback, no backward step, no teleport

Live anchors were read from the running app (React fiber prop, 104 Hungarian /
27 Fugue anchors) and replayed through the shipped motion timeline at 1 ms
resolution.

| Score | Timeline null | Backward steps | Mid-system teleports | Wrong page | Onset avg err | Onset max err |
|---|---|---|---|---|---|---|
| Hungarian Dance | 0 ms | 0 | 0 | 0 | 0.0168 | 0.1894 |
| Fugue BWV 846 | 0 ms | 0 | 0 | 0 | 0.0039 | 0.3019 |

`null = 0 ms` means the motion timeline covered every millisecond; the legacy
fallback resolver was never invoked. The max onset error is the difference
between the motion timeline and the legacy `resolveMusicalXInMeasure` ideal on
ornamented/repeated notes; the motion timeline itself is onset-locked by
construction (`buildCursorMotionDiagnostics().maxOnsetErrorX = 0`).

## 3. Browser frame traces — target and painted DOM agree

Every animation frame recorded: audio-derived score time, runtime target
(x/y/page/system/measure/phrase/segment/fallback tier), painted cursor style
and `getBoundingClientRect` normalized against the page overlay, active page,
scroll, viewport and page-frame size. Phases included play from 0, pause,
resume, system boundary, page 2/3/4 turns, repeat jump, seek during playback,
fit-mode change, viewport resize and scroll.

| Trace | Samples | Fallback frames | Target≠DOM | Backward within system |
|---|---|---|---|---|
| Hungarian / Chromium before | 4725 | 0 | 0 | 0 |
| Hungarian / Chromium after | 4735 | 0 | 0 | 0 |
| Hungarian / WebKit before | 2434 | 0 | 0 | 0 |
| Hungarian / WebKit after | 2428 | 0 | 0 | 0 |
| Fugue / Chromium before | 3399 | 0 | 0 | 0 |
| Fugue / Chromium after | 3403 | 0 | 0 | 0 |
| Allegro in G / Chromium after | 4015 | 0 | 0 | 0 |

All large x changes coincide with a page/system/phrase identity change or a
transport seek. There is no same-system backward step and no frame where the
painted bar disagrees with the motion-timeline target.

## 4. Short pickup / delayed-onset regression

No library fixture contains a first onset 0–20 ms after a measure line, so the
old `> 20 ms` rule was exercised with a derived multi-system fixture: a 10 ms
pickup at the first measure and again at a second-system start.

Before:
- First phrase began at the first note (`t=0.01`), so the cursor was invisible
  for the first 10 ms of the piece.
- At the second system, it switched to the first notehead at `t=2.000`
  (10 ms early) and stayed there until the note sounded at `2.010`.

After:
- Measure-start knot at `t=0, x=0.2`; cursor starts on the system's left edge
  and reaches the notehead exactly at `t=0.01`.
- Second system starts at `t=2.000, x=0.2` and reaches the notehead at
  `t=2.010`. `startError = 0`, `onsetError = 0`, `pass = true`.

Measures opening with rests longer than 20 ms were already covered by the old
rule; both before and after traces show no fallback and no backward step.

## 5. Remaining jump found — first-Play main-thread stall

The frame traces found one remaining visible jump: the first Play causes a
single long main-thread task. The cursor cannot paint during the task, then
advances by the elapsed music in one frame.

- Production build (`vite preview`, headless Chromium): 173–201 ms long task,
  149–183 ms RAF gap. Reproduced 3/3 runs.
- Dev build: 692–747 ms long task; WebKit trace showed a 494 ms gap.
- It does **not** occur on pause/resume, seek, system changes or page turns
  (those show 40–50 ms worst-frame gaps).
- Disabling page-follow and the cursor RAF does not remove it, so it is not a
  cursor-render or fallback problem.
- During the stall the runtime target and painted DOM still agree; the target
  simply cannot advance because the main thread is blocked.

This is a startup performance issue, not a spline/resolver discontinuity. It
has not been changed, per the “identify and reproduce before changing more
behavior” instruction.

Reproduce:

```bash
node scripts/cursor-startup-longtask.mjs --base http://localhost:5180
```

## Reproduction commands

```bash
# Live app (dev server on :5179)
node scripts/cursor-boundary-precision.mjs --browser chromium --label after
node scripts/cursor-boundary-precision.mjs --browser webkit --label after
node scripts/cursor-trace-browser.mjs --browser chromium --score "Hungarian Dance No. 5" --profile full --label after
node scripts/cursor-trace-browser.mjs --browser webkit --score "Hungarian Dance No. 5" --profile full --label after
node scripts/cursor-trace-browser.mjs --browser chromium --score "Fugue in C, BWV 846" --profile fugue --label after
node scripts/cursor-trace-browser.mjs --browser chromium --score "Allegro in G Major" --instrument guitar --profile guitar --label after

# Real-anchor audit (extract once from the live app)
node scripts/extract-score-data.mjs --score "Hungarian Dance No. 5" --out tmp/cursor-trace/score-hungarian.json
node scripts/cursor-real-score-audit.mjs tmp/cursor-trace/score-hungarian.json public/fixtures/hungarian-dance-no5/hungarian-dance-no5.mxl

# Short-pickup edge case
node scripts/audit-short-pickup.mjs

# Trace analysis
node scripts/analyze-cursor-trace.mjs tmp/cursor-trace/hungarian-chromium-after.json
```
