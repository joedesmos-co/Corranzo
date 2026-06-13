# ScoreFlow Product Fix Report — Session 4

**Commit:** `7f8916b`  
**Date:** 2026-06-13  
**Status:** All 5 fixes shipped. 126 tests passing, lint at baseline (71), build clean.

---

## What was broken

Five product-blocking issues found through real browser testing.

### B — Pointer / click-through
The annotation overlay `PdfOverlayLayer` wrapper div had `pointer-events: auto` at all times. Even though the inner SVG `AnnotationLayer` correctly set `pointer-events: none` in pointer mode, the wrapper div intercepted all events first. Result: clicking the PDF, toolbar buttons, or transport controls was unreliable in pointer mode.

### C — User-uploaded score cursor never appeared
Three independent blockers all had to fire for the cursor to show:
1. `filterTrustedAnchors` excluded `AUTO_SYSTEM` / `AUTO` anchor sources — so auto-detected system anchors were never fed to the cursor resolver.
2. `assessScoreFollowTrust` returned `showCursor: false, needsSetup: true` whenever only auto anchors existed — blocking the cursor entirely even if anchors were present.
3. `useScoreFollow` threw away auto-setup results when confidence was below 62% — so most real uploaded PDFs produced zero anchors.

The user always hit the "needs setup" wall and never saw a cursor after uploading their own score.

### D — Cursor laggy / jumpy
`practiceTime` React state updates at ~5 Hz (every 200 ms). The cursor resolver read this state, so the cursor jumped in discrete steps visible even on desktop. The engine's `getCurrentScoreTime()` already did real-time wall-clock interpolation, but was never connected to the display-cursor RAF loop.

### E — Too much instruction text
`PracticeSetupPanel` had a long intro paragraph, conditional help tips, and an `<ol>` with three numbered steps. `ScoreFollowControls` status strings were multi-sentence. First-time users saw a wall of text before they could do anything.

### F — Audio sounds like beeps
The synth used a sine oscillator with sustain ~0.3. Sine has no harmonics (pure tone → "beep") and the sustain plateau meant every note played at full volume for its entire duration (no piano-like decay).

---

## What was fixed

### B — Pointer click-through (`src/components/pdf/PdfPageFrame.jsx`)
Added `isPointerTool` check at the `PdfOverlayLayer` level:
```js
const isPointerTool = activeTool === ANNOTATION_TOOLS.POINTER
// overlay div:
pointerEvents={alignmentMode || isPointerTool ? 'none' : 'auto'}
```
When pointer tool is active the entire overlay div passes events through to the PDF and UI beneath it.

### C — User-score cursor (3 files)
- **`src/features/score-follow/trustedAnchors.js`**: `filterTrustedAnchors` now includes `ANCHOR_SOURCE.AUTO_SYSTEM` and `ANCHOR_SOURCE.AUTO`.
- **`src/features/score-follow/scoreFollowTrust.js`**: Added `FOLLOW_TRUST_LEVEL.AUTO`. When `autoSystemCount >= 2` or `autoCount >= 2`, returns `showCursor: true, needsSetup: false, approximate: true`.
- **`src/features/score-follow/semiAutoScoreAlignment.js`**: Lowered `AUTO_APPLY_CONFIDENCE_THRESHOLD` from 0.62 → 0.42, `LOW_CONFIDENCE_THRESHOLD` from 0.58 → 0.30.
- **`src/features/score-follow/useScoreFollow.js`**: When auto-setup confidence check fails but `proposedAnchors.length >= 2`, anchors are applied as best-effort instead of discarded.

Result: after uploading PDF + MusicXML, auto-setup runs, finds staff systems, and produces an approximate cursor immediately. No manual setup required for the basic case.

### D — Cursor smoothness (4 files)
Threaded `engine.getCurrentScoreTime()` from the playback engine all the way to the display-cursor RAF loop:

1. **`src/features/playback/useScorePlayback.js`**: Exposes stable `getScoreTime` callback (`() => engineRef.current?.getCurrentScoreTime() ?? 0`).
2. **`src/context/PracticeSessionContext.jsx`**: Threads `getScoreTime` into `useScoreFollow`.
3. **`src/features/score-follow/useScoreFollow.js`**: Builds `resolveRealtimeCursor` (memoised resolver that takes a time argument) and passes both to `useScoreFollowDisplayCursor`.
4. **`src/features/score-follow/useScoreFollowDisplayCursor.js`**: In the RAF tick, calls `resolveRealtimeCursor(getScoreTime())` every frame. The cursor position is now resolved at 60 fps from the real engine time, not at the 5 Hz React state rate.

### E — UI copy (`src/components/practice/PracticeSetupPanel.jsx`, `src/components/pdf/ScoreFollowControls.jsx`)
- Removed: intro paragraphs, `PracticeHelpTip`, numbered step list, verbose `getSetupStatus()` strings.
- Status strings are now short labels: "Scanning PDF…", "Cursor needs setup", "Following · N positions linked".
- Detail strings are null when not needed (no empty `<p>` tags rendered).

### F — Piano synth (`src/features/playback/scorePlaybackEngine.js`)
```js
oscillator: { type: 'triangle8' },   // was 'sine'
envelope: { attack: 0.006, decay: 2.2, sustain: 0.0, release: 0.35 },
// filter: 3800 Hz lowpass (-12 dB/oct)   was 2200 Hz (-24 dB/oct)
// reverb: decay 2.5, wet 0.22
```
`triangle8` adds odd harmonics up to the 8th partial (piano-like warmth). `sustain: 0` means the note decays continuously from attack peak — no flat plateau. `decay: 2.2` lets each note ring out naturally.

---

## Tests added

`tests/productFixes.test.js` — 35 new regression tests:
- **Fix B**: `PdfPageFrame` derives `isPointerTool` and passes it to overlay; `AnnotationLayer` still has its own guard (defense-in-depth).
- **Fix C1**: `filterTrustedAnchors` includes `AUTO_SYSTEM`, `AUTO`, `DEMO`, `MANUAL`, `MUSICXML_LAYOUT` but not `AUTO_MEASURE`.
- **Fix C2**: `assessScoreFollowTrust` returns `showCursor:true` for ≥2 auto anchors; returns `false` for <2; `MANUAL` still takes precedence; result is marked `approximate`.
- **Fix D**: Source checks confirm `getScoreTime` and `resolveRealtimeCursor` are threaded through all 4 layers; stable refs (`getScoreTimeRef`, `resolveRealtimeCursorRef`) are present; RAF tick calls `rtResolve(rtGetTime())`.
- **Fix E**: No `<ol>`, no step instructions, no `PracticeHelpTip` in `PracticeSetupPanel`; status strings match short-label pattern.
- **Fix F**: `triangle8` oscillator, `sustain: 0`, `decay >= 1.5`, `attack <= 0.02`, filter frequency ≥ 3000 Hz, reverb `wet > 0`.

---

## Validation

| Check | Result |
|---|---|
| `npm test` | **126 passed**, 0 failed |
| `npm run build` | **Clean** (1.02 s) |
| `npm run lint` | **71 problems** (baseline — no regressions) |

---

## What still needs manual testing (iPad / browser)

1. **Pointer mode** — verify tapping toolbar buttons and PDF annotations works reliably with no ghost events from the overlay.
2. **Cursor glide** — verify the cursor moves continuously between measures (no 200 ms jumps) during live playback on device.
3. **Uploaded score auto-setup** — upload any PDF + matching MusicXML; confirm auto-setup runs, succeeds, and shows an approximate cursor without manual marker placement.
4. **Synth on Safari/iOS** — verify the `triangle8` tone sounds piano-like and not beepy; check volume balance and reverb tail.
5. **Annotation drawing in pen mode** — verify drawing still works correctly after the pointer-mode event-blocking changes.
