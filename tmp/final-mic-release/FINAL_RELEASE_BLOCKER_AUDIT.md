# Corranzo final release-blocker audit

Date: 2026-07-31 (America/New_York)

Commit audited: `11081f68c9e0bf0334f04a7d8d3bdfb729ef2889`

Release-blocker fix commit: `26229144446358bb5528c98c31c58e7f65185b8d`

## Recommendation

**SHIP**, with the physical microphone/browser limitations listed below.

The microphone acceptance gate, frozen OMR gate, unit and script suites, production build, clean-session browser flows, score ownership, instrument switching, Guitar/TAB, report export, and heavy-score relative budgets are green. No additional feature work or OMR tuning was performed.

## Bugs reproduced and resolved

### 1. Duplicate visual-practice stem identities

Reproduction: open the bundled Minuet in G in Visual practice. React continuously emitted a duplicate-key error for `stem-note-m8-t9.000-31-treble`. Because the same identity was reused across render updates, React could duplicate or omit a voice's stem.

Root cause: `buildStaffLaneStems` groups stems by score group, staff, and written voice, but the SVG render ID included only group and staff. Two voices at one onset on the same staff therefore produced the same key.

Fix: include written voice in the stem identity. A focused regression constructs overlapping voices on one staff and asserts two unique IDs. The in-app browser was reopened after the change; the restored Visual view produced zero console errors.

### 2. Release QA selectors did not follow the accessible controls

Reproduction: the browser microphone campaign passed the detector/capture checks, then timed out while selecting Wait For You or after switching to an empty Guitar library. The application remained usable and the accessible Wait For You radio worked directly.

Root cause: the harness selected a state-dependent wrapper `label`, and after Piano→Guitar isolation it could attempt to choose a practice mode before a Guitar score had loaded.

Fix: select the radio by its stable accessible name and load the Guitar demo when Practice controls are absent. The complete browser microphone campaign then passed 27/27.

### 3. Full script gate had stale runtime contracts

Reproduction: `npm run test:scripts` expected one mic chord tone to complete the whole chord, expected the obsolete 30-cent default, and failed under Node 24 because a JSON module lacked an import type.

Root cause: the script assertions predated sequential mic chord collection and the accepted 35-cent setting; Node 24 enforces JSON import attributes.

Fix: align the script assertions with the already-tested production contract and mark the local manifest import as JSON. No matching, OMR, or score-follow semantics changed. The full script suite and production bundle pass.

## Files changed after the microphone commit

- `src/features/practice/staffLaneLayout.js`
- `tests/staffLaneLayout.test.js`
- `scripts/browser-mic-wfy-qa.mjs`
- `scripts/test-pitch-detection.mjs`
- `src/dev/fixturePaths.js`

## Final automated results

| Gate | Result |
|---|---|
| Focused microphone tests | 8 files; 117/117 passed |
| Deterministic final microphone corpus | 40/40 runs; 74/74 expected events; 0 false negatives; 0 false positives |
| Microphone browser QA | 27 passed; 0 failed |
| Existing mic accuracy replay | 27/27 note clips; 0/4 silence/noise false positives |
| Existing mic polyphony replay | `v2-improves`; 94.4% exact chord hit; 98.2% per-note recall; 0 false advances |
| Full unit suite at final commit | 279 files; 2,813 passed; 5 skipped; 0 failed |
| Full script suite | passed, including alignment corpus benchmark |
| Focused visual-layout regressions | 61/61 passed |
| Production build | passed |
| Frozen semantic OMR corpus | evaluator 2.0.0/schema 2; 9/9 fixtures; no regression |
| Instrument-switch E2E | 11 passed; 0 failed |
| Guitar library/TAB ownership regression | passed |
| Recognition report/export E2E | 6 scenarios passed, including explicit PDF confirmation and OMR failure |
| Heavy-score performance harness | passed all 4 assertions; dense score 802 notes/49 measures |
| Clean-session release browser audit | 36 functional assertions passed; one obsolete Play selector was a harness false negative and direct Play/Pause verification passed |

Frozen OMR metrics at `26229144446358bb5528c98c31c58e7f65185b8d`:

- Overall: 67.12% (`0.6712333333`)
- Pitch: 66.86% (`0.6686333333`)
- Rhythm: 74.64% (`0.7463666667`)
- Measure structure: 72.85% (`0.7285222222`)
- Sustain: 55.56% (`0.5555555556`)
- Incorrect pitch/chord: 161/182
- Onset/duration mismatches: 170/102
- Missing/extra notes: 136/112

Microphone latency and accuracy at the final commit:

- Baseline: 62/74 matches, 12 false negatives, 0 false positives, 82.17 ms median latency, 816.44 ms maximum.
- Final: 74/74 matches, 0 false negatives, 0 false positives, 79.77 ms median latency, 259.77 ms maximum.
- Sustained-note double advances: 0 before and after.
- Wrong related octave false advances: 0.

## Commands completed

- `npm run mic:final-release`
- focused Vitest microphone, capture-lifecycle, musical-acceptance, re-arm, and WFY groups
- `npm run mic:accuracy-replay`
- `npm run mic:polyphony-replay`
- `node scripts/browser-mic-wfy-qa.mjs`
- `npm test`
- `npm run test:scripts`
- `npm run build`
- `node scripts/omr-semantic-corpus-eval.mjs --label final-release-commit --mode written ...`
- `node scripts/instrument-switch-isolation-e2e.mjs`
- `node scripts/guitar-library-regression.mjs`
- `node scripts/recognition-problem-report-ui-e2e.mjs`
- `node scripts/heavy-score-performance-harness.mjs`
- focused ESLint and whitespace checks for every changed file

## Browser scenarios actually completed

- Fresh storage and empty-library launch in isolated browser contexts.
- Existing-session restore and refresh without a blocking overlay.
- One-page and multi-page PDF OMR, page-count replacement in both directions, replacement during OMR, and navigation during preparation.
- Piano→Guitar, Guitar→Piano, rapid switching, switching while paused/playing, and switching with a report dialog.
- Play Along Play/Pause, seek, loop toggle, Score/Visual switching, and Wait For You re-entry.
- Mock microphone permission denial/grant, active capture, disabling on mode change, fresh state after instrument switch, quiet/noisy room fixtures, and responsive iPad/mobile layouts.
- Report export with and without explicitly confirmed PDF inclusion, accepted-score Help access, failed-OMR reporting, replacement reset, Escape, and focus restoration.
- Dense-score preparation with navigation remaining clickable, preparation banner observation, scrolling/seeking/resizing, and return to Library.
- Browser console inspection before and after the stem fix; the reproduced duplicate-key errors were eliminated.

## Deterministic/unit-only scenarios

- Permission revoked during use.
- Input track ended and device disconnected.
- AudioContext suspended, resumed, closed, or failed to resume.
- Hidden page defers AudioContext recovery until restoration.
- Capture start/stop/restart, cleanup idempotence, and no duplicate recovery callbacks.
- Corrupt/stale saved-session routing and restore gates.
- OMR late-result identity/epoch/run rejection and ownership/source isolation.
- Playback timing, tied sustain, repeats/voltas, metronome, track muting, tempo, loops, and no-stuck-note behavior.

## Not physically testable in this run

- A real microphone, its permission prompt, mid-session OS permission revocation, physical unplug/replug, or OS route change.
- Browser/OS automatic gain control, low-frequency rolloff, hardware compression/clipping, room hum, and device-specific resampling.
- Physical bass-piano A0-B1 response and latency.
- Safari and Firefox hardware capture behavior.
- A full browser application restart backed by the user's real persisted library; automated isolated Chromium restart/reload and deterministic persistence tests were used instead.

No physical-device validation is claimed. The manual-device plan in `MICROPHONE_RECOGNITION_REPORT.md` remains the required hardware follow-up.

## Known non-blocking limitations

- The production bundle still reports the existing large-chunk advisory; the build succeeds and this campaign did not redesign code splitting.
- PDF tests emit existing pdf.js standard-font/legacy-build warnings in Node; browser OMR and the full suite pass.
- The fixed 2,048-sample microphone analysis frame limits standalone autocorrelation at the very bottom of the piano. Score-informed harmonic evidence covers the deterministic low-register corpus without increasing the window or latency, but physical-device validation is still required.
- The repository retained unrelated pre-existing `tmp/` changes and artifacts. Both commits staged only campaign files.
