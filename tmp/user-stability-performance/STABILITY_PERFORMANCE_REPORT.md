# USER-REPORTED STABILITY AND PERFORMANCE

**Date:** 2026-07-29  
**Suggested commit:** `fix(app): isolate instruments and improve heavy-score responsiveness`  
**OMR recognition:** unchanged (no tuning)

## Report ZIP index summary

Nine private reports were ingested read-only into `.local/recognition-reports/`
(never committed). Index: `.local/recognition-reports/REPORT_INDEX.md`.

| Score | Notes / measures | Class |
|---|---|---|
| Evangelion | 2808 / 125 | Heavy piano |
| Vivaldi Winter | 2903 / 145 | Heavy piano |
| La Campanella | 4105 / 155 | Heavy piano |
| Merry Go Round | 2409 / 230 | Heavy piano |
| Others (Ao no Sumika, JJK, Iris Out, Aria Math, Sweden) | varying | Piano / other |

All were **accepted**, provenance unavailable, PDFs included. Used for
reproduction context only — no recognition changes.

## Bug 1 — Instrument switch keeps wrong practice session

### Reproduced
Piano Practice → Guitar left the piano score live. Inverse also retained the
wrong instrument session.

### Root cause
`App.jsx` instrument-switch effect mirrored the outgoing PDF/MusicXML into the
destination instrument slot and remounted Practice on the same ActiveScore.

### Fix
- Save non-empty outgoing bundles into the **source** instrument store only.
- Clear live practice via `applyInstrumentBundle(empty)`.
- Navigate to Library filtered for the new instrument.
- Publish empty ActiveScore **synchronously** and clear playback snapshots so
  late `engine.load` cannot republish the old timeline.
- Soft-fail guitar mapping when ownership mismatches during the one-frame
  instrument re-render before clear (avoids DEV assert crash).
- My Uploads reopen applies the stored bundle after a clear.

### Acceptance
- No incompatible live practice survives the switch.
- Library opens for the selected instrument; uploads remain saved.
- No silent Piano↔Guitar conversion; no OMR on switch.

## Bug 2 — Practice unresponsive after OMR (~15s)

### Root cause
`validateOmrGeneratedPlayback` and `useMusicXmlTiming` each ran a full sync
`parseMusicXml`. Strict Mode could add another. Play-along lane groups were
built for the entire score on every Practice mount.

### Fix
- Shared `timingMapCache` keyed by content hash (validate seeds Practice).
- Defer `buildVisualLaneGroups` for play-along until input is actually active.
- Honest `PracticeTimingPrepBanner` while timing loads (`pointer-events: none`).
- Prep marks on `window.__SCOREFLOW_PRACTICE_PREP__`.

### Before / after (in-process relative)
| Stage | Before | After |
|---|---|---|
| Validate + Practice parse | 2× full parse | 1× parse + cache hit |
| Small cold → hot parse | — | ~66–120× faster on hit |
| Play-along groups on mount | always | only when play-along active |

## Bug 3 — Heavy score makes the whole app lag

### Dominant causes
C/D/F: repeated parse, full timeline rebuild, full visual-lane materialization.
PDF was already ±1 page windowed. Guitar mapping cheap on Piano. Provenance
off remains zero-cost.

### Fix
- Timing-map cache (Bug 2).
- Visual lane group LRU cache by content hash + scope.
- Existing `selectVisualWindow` keeps DOM small (Campanella: 313 groups → ~35
  windowed).
- Stale playback snapshot suppression on clear.

### Harness (`scripts/heavy-score-performance-harness.mjs`)
| Score | Cold parse | Hot parse | Visual cold → hot |
|---|---|---|---|
| Small beginner | baseline | cache hit | — |
| Medium (grand voices) | within relative budget | cache hit | — |
| Dense (La Campanella / dense fixture) | &lt;200× small | cache hit | ~380–770× |

Relative budgets only — no flaky absolute CI milliseconds.

## Accepted / reverted approaches

| Approach | Verdict |
|---|---|
| Clear live session + Library on instrument switch | **Accepted** |
| Carry score across instruments | **Reverted** (was prior behavior) |
| Timing-map cache by content hash | **Accepted** |
| Defer play-along lane build | **Accepted** |
| Soft-fail guitar mapping on ownership mismatch | **Accepted** |
| Fixed sleep / fake ready timeout | **Rejected** |
| OMR recognition changes | **Out of scope** |

## Files changed (primary)

- `src/App.jsx` — instrument switch clear, sync ActiveScore wipe, reopen path
- `src/features/instruments/instrumentPracticeBundle.js`
- `src/features/instruments/timingMapTabPositions.js`
- `src/features/musicxml/timingMapCache.js` *(new)*
- `src/features/musicxml/useMusicXmlTiming.js`
- `src/features/omr/validateOmrGeneratedPlayback.js`
- `src/features/playback/useScorePlayback.js`
- `src/features/practice/usePracticeSession.js`
- `src/features/practice/visualPracticeLane.js`
- `src/components/practice/PracticeView.jsx`
- `src/styles/practice.css`
- `docs/ACTIVESCORE_ARCHITECTURE.md`
- Tests + scripts: instrument bundle, timing cache, prep budgets, isolation E2E,
  guitar/stale/pre-soak/smoke regressions updated for clear-on-switch

## UI screenshots

Under `tmp/user-stability-performance/`:

- `01-piano-practice-ready.png`
- `02-guitar-library-after-switch.png` (Guitar Practice Library after clear)
- `03-final-library.png` (when E2E completes)
- `heavy-score-harness.json`
- `instrument-switch-e2e.json` / `.log`

## Regression results

| Gate | Result |
|---|---|
| Full unit suite (`npm test`) | **2716 passed** / 5 skipped |
| Production build | **Pass** |
| Heavy-score harness | **Pass** |
| Timing cache + prep budget tests | **Pass** |
| Instrument bundle unit tests | **Pass** |
| Instrument-switch UI E2E (all 9 scenarios / 11 asserts) | **Pass** (`passes=11 failures=0`) |
| Targeted lint on touched files | Pre-existing hook warnings elsewhere; no new intentional style violations |

Updated regression expectations (retain → clear):

- `scripts/guitar-library-regression.mjs`
- `scripts/stale-score-real-ui-regression.mjs`
- `scripts/pre-soak-stabilization.mjs`
- `scripts/browser-smoke-pass.mjs`

## Remaining limitations

- Explicit “Use this score with Guitar/Piano” conversion is **not** shipped
  (future intentional action).
- Full virtualization of every Advanced/diagnostic panel is partial; heavy
  Visual mode still builds groups once (then cached/windowed).
- Absolute wall-clock “first click &lt; N ms after OMR” varies by machine; relative
  budgets + cache hits are the CI-stable signal.
- Playwright E2E scenarios that reopen mid-OMR can still race; isolation E2E
  uses fresh sessions for playback-switch cases.

## Do not commit

Anything under `.local/` (reports, PDFs, `REPORT_INDEX.md`).
