# Overnight Accuracy + Stability Sprint — Final Report

**Date:** 2026-07-16  
**Branch:** `main`  
**HEAD:** `765981a` (after phase commits)

## Setup

- Confirmed work on `main` (fast-forwarded prior `codex/omr-accuracy-expansion` sprint work first so baselines reflected current product).
- Discarded generated OMR/tmp timestamp churn; left untracked `tmp/uiowa-mic-sources/` untouched.
- Recorded baselines before runtime edits (`tmp/overnight-sprint/BASELINE.md`).

## Baseline → Final metrics

### Mic accuracy

| Metric | Baseline | Final |
|---|---:|---:|
| Hit rate | 1.0 | **1.0** |
| False positive rate | 0 | **0** |

### Mic polyphony (V2 score-informed)

| Metric | Baseline | Final |
|---|---:|---:|
| Exact chord hit | 88.9% | **94.4%** |
| Required tone recall | 96.4% | **98.2%** |
| Wrong-tone acceptance | 0% | **0%** |
| False advances | 0 | **0** |
| Missed notes (aggregate) | 2 | **1** |
| Verdict | v2-improves | v2-improves |

Residual: `uiowa-piano-mf-cmaj7` still misses E4 — fundamental stays below the noise floor across windows (honest miss; not forced).

### OMR

| Scope | Baseline | Final |
|---|---|---|
| Enforced fixtures | 10 pass / 0 fail | **10 pass / 0 fail** (unchanged) |
| Runtime OMR | no change | **no change** (hard stop) |
| Voice serialization | 0 truth-approved | 0 truth-approved |

### Gates (final)

| Gate | Result |
|---|---|
| `npm test` | **2252 passed** / 5 skipped (224 files) |
| `npm run build` | green |
| `npm run mic:accuracy-replay` | pass |
| `npm run mic:polyphony-replay` | pass (94.4% exact) |
| `npm run mic:browser-qa` | **27/27** |
| `npm run omr:benchmark-dashboard` | overall pass |
| `node scripts/browser-smoke-pass.mjs` | **17/17** (desktop/iPad/mobile) |

## Phase results

### Phase 1 — OMR

**Hard stop.** See `docs/OVERNIGHT_OMR_HARD_STOP.md`.

- No safe cross-fixture runtime OMR improvement without risking known dense/Guitar regressions.
- Worst remaining enforced gap: `guitar-standard-chords-vector` (pitch 0%, measureΔ +8) from staff/system segmentation + measure allocation.
- Voice-aware serialization still blocked (0 truth-approved).

### Phase 2 — Mic polyphony

**Shipped.** Companion-relief ratio/confidence gates were inconsistent (`ratio >= 0.92` maps to confidence ≈0.016, but code required `confidence >= 0.02`), so split-register E4 could never pass relief even when fund≥noise.

- Fix: derive relief confidence floor from `ratioToConfidence(reliefMinRatio)`.
- Result: `uiowa-piano-mf-split-c3-e4-g4` exact hit; exact chord **88.9% → 94.4%**; FP unchanged at 0.
- Did **not** lower detection thresholds or open the fund-below-noise case (`cmaj7`).

### Phase 3 — Stability

No additional launch blockers reproduced beyond the highlight bug (Phase 4). Smoke + mic browser QA remained green after changes. Piano/Guitar switch, reload, and overlay dismiss paths stayed healthy in automated smoke.

### Phase 4 — UI polish (WFY score highlight)

**Shipped.** Score-view amber “Your note” highlight was min/max-stretching MusicXML `default-x` across the full PDF measure span, so early/left-cluster notes looked like half-measure bars.

- Map `default-x` via engraved `<measure width>` (or a modest rightmost+margin estimate).
- Cap highlight width relative to measure width; collapse wrongly wide chord spreads to median-x.

## Commits created

1. `30c39bd` — Document OMR overnight hard stop without unsafe runtime changes.
2. `d3131d5` — Fix piano companion-relief confidence gate for split-register chords.
3. `765981a` — Fix Wait For You score highlight stretching across half measures.

(Plus earlier fast-forward of accuracy-expansion sprint onto `main`.)

## Files changed (this overnight)

- `docs/OVERNIGHT_OMR_HARD_STOP.md`
- `docs/OVERNIGHT_SPRINT_REPORT.md` (this file)
- `src/features/microphone-input/v2/scoreInformedChordScorer.js`
- `src/features/practice/noteTargetContext.js`
- `src/features/practice/noteTargetPosition.js`
- `tests/micPolyphonyV2ScoreInformed.test.js`
- `tests/waitForYouTargetHighlight.test.js`

## Tests added

- Split-register UIowa E4 exact-chord regression
- Companion-relief gate consistency guard
- Engraved-width mapping + highlight width-cap regressions

## Regressions reverted

None this pass (no speculative OMR runtime attempts left in tree).

## Remaining blockers

1. **OMR guitar-standard / dense measure inflation** — needs new staff/system IR evidence; do not revive exhausted solvers.
2. **OMR voice serialization** — 0 truth-approved; shadow-only until canary passes.
3. **Mic `uiowa-piano-mf-cmaj7` E4** — fundamental below noise; recovering it would require weakening fund≥noise (rejected).

## Manual tests still required

1. Physical piano/guitar: Wait For You score highlight sits on noteheads (not half-bars) in Score view.
2. Physical split-register piano chord (bass + E4 + G4) advances once.
3. Cmaj7 dense voicing: confirm still may need Continue when interior E is masked (honest limitation).
4. iPad Safari listen-pass for mic unlock + WFY.
5. Optional: open `guitar-standard-chords-vector` PDF-only OMR and confirm warnings remain honest (no new nonsense notes).

## Success criteria check

- Measurable cross-fixture mic improvement: **yes** (88.9% → 94.4% exact)
- No enforced OMR benchmark regressions: **yes** (unchanged runtime)
- 0 false positives on speech/silence/noise: **yes**
- No launch blockers in automated smoke/QA: **yes**
- Clean UI fix for reported yellow bar: **yes**
- Honest limitations documented: **yes**
- Did **not** claim 100%
