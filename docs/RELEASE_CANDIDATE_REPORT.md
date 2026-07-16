# Release Candidate Report

**Date:** 2026-07-15  
**Branch:** `codex/omr-accuracy-expansion`  
**Scope:** Post–Sprint 4 RC audit (verify → polish bugs/layout/copy/spacing only → report)

## Verdict

**Release candidate: GO** for product surfaces covered by the gates below. Residual mic polyphony and OMR voice-serialization work remain tracked as known non-blocking follow-ups, not RC blockers.

## Gate results

| Gate | Result |
|---|---|
| `npm test` | **224 files / 2249 passed** |
| `npm run build` | **green** |
| `npm run mic:accuracy-replay` | **hitRate 1.0**, false positives **0** (27 note hits / 4 correct rejects) |
| `npm run mic:polyphony-replay` | V2 exact chord hit **~88.9%**, wrong-tone acceptance **0%**, false advances **0**; verdict **`v2-improves`** |
| `npm run mic:browser-qa` | **27 / 27 pass** |
| `npm run omr:benchmark-dashboard` | Ran; rollout gate still recommends shadow-only **voice-aware-serialization** (no runtime promotion) |
| Browser smoke (desktop / iPad / mobile) | **17 / 17 pass**; no horizontal overflow; zero console / page errors |

## Browser smoke (viewport matrix)

Headless Chromium against `npm run preview` (`http://127.0.0.1:4173`):

| Viewport | Overflow | Practice score |
|---|---|---|
| desktop (1280×800) | none | pass |
| iPad (820×1180) | none | pass |
| mobile (390×844) | none | pass |

Coverage includes cold load, Piano/Guitar library → Practice, Play, Visual/Score, Wait For You section, Progress filters, reload persistence, and overflow checks.

## RC polish applied (this pass)

Confirmed issues only — no new features:

1. **Browser smoke × Sprint 3 compact WFY** — Mode radios are covered by their label span; smoke now clicks `.practice-mode__option` and asserts `.wait-for-you` / `aria-label="Wait For You"` (heading intentionally hidden in compact chrome).
2. **Library Start Practice** — Dismiss WFY input modal and guided-tour overlays after load so later clicks are not blocked.
3. **Mic browser QA** — Poll mic debug trace export until frames exist (race: assert ran before the analyzer produced frames).
4. **Practice Library credits** — Ellipsis on long attribution/license lines; full string available via `title` tooltip.

## Known residuals (not RC blockers)

| Area | Notes |
|---|---|
| Mic polyphony | Residual E4 misses on denser UIowa voicings (`uiowa-piano-mf-cmaj7`, split-register); exact chord ~88.9% |
| Mic accuracy | `uiowa-guitar-mf-g3` may log a competing harmonic MIDI while still counting as hit |
| OMR V2 | Voice serialization / duration / tie solvers remain shadow/diagnostic; dense baseline frozen; no runtime OMR promotion |
| Device audio | Headless gates do not prove audibility; physical desktop / iPad / phone listen-pass still recommended |

## Sprint context folded into this RC

1. Real-mic accuracy + polyphony corpus and V2 score-informed chord scoring  
2. Minimal Practice chrome (piece, mode, target, Continue)  
3. Curated Mutopia Practice Library ladder (26 pieces)  

## Commit

`Release Candidate polish.`
