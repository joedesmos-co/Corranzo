# Corranzo integration — 7-hour campaign progress

## Live state (verified 2026-10-28)

| item | value |
|---|---|
| Live bundle | `index-B4mqi39S.js` |
| Live SHA-256 | `d81e87fe3d4e29f9b77fcad7b6568c5056b2b8364fa5b870ec56ff9a654d1364` |
| Live Worker | `a1a7bc33-7da9-4b9f-b1c5-98a5612c3b06` |
| Main at start | `f7a43bc0c4` |
| Main at end | `0870192706` |

## Milestone 2-3: cursor stability

Root cause: `systemKeyForCursor()` derived system identity from the target Y
coordinate. Even with 2-decimal rounding, a Y coordinate crossing a rounding
boundary produced a new key and triggered the realtime cursor's reset branch
(`state.x = target.x`), which is a visible jump.

Two-stage fix:
1. `f7a43bc0c4` — coarse Y rounding (4 → 2 decimals).
2. `0870192706` — prefer stable logical `meta.systemIndex` from the score layout;
   fall back to coarse Y rounding only when the layout index is unavailable.

Tests: 52 cursor tests pass (including new systemIndex preference and page
isolation cases).

## Not yet resolved

- Guitar five-page Safari import hang: research agent patch not yet complete;
  no independent reproduction performed.
- Audio Vision transcription quality: not addressed.
- Piano strict accuracy: production 317/447 strict TP vs research 447/447.
- Audio/mic performance tests: 24 known timeouts.
