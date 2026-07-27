# Pre-Soak Stabilization Pass — Report

Date: 2026-07-27  
Scope: bug-fix / regression audit only (no OMR quality tuning, no AdSense, no redesign)

## 1. Bugs reproduced

### Bug A — Guitar + piano raster PDF hard-fails as “TAB”
**Repro:** Clean session → Guitar → upload `piano-articulation-scan.pdf` (or rapid A→B under Guitar).  
**Symptom:** OMR fails with `TAB staff lines were detected…` (or later `low-confidence` after partial routing fixes). Same PDF succeeds under Piano (224 events).

### Bug B — Misleading OMR failure lede
**Repro:** Any OMR failure UI.  
**Symptom:** Lede always said “Something went wrong while preparing this PDF.” even when a specific useful error was shown below.

### Bug C — Input-source modal blocks main navigation
**Repro:** Upload PDF → OMR completes → Practice opens with “How should Corranzo hear you?”  
**Symptom:** Modal scrim (`z-index: 2600`) covered the top bar (`z-index: 100`). Real pointer clicks on Library hit the scrim. Users could not reach My Uploads to replace a score without first choosing mic/MIDI.

### Bug D — OMR completion yanks Library mid-replacement
**Repro:** Rapid A→B→C uploads from My Uploads.  
**Symptom:** When B’s OMR finished while the user had already returned to Library to upload C, `navigateToView('practice')` yanked them out of Library. My Uploads disappeared mid-flow (`stale-musicxml` Scenario 3).

## 2. Root causes

| Bug | Root cause |
|---|---|
| A | Guitar `tabCapable` path treated weak 6-line geometry (and title glyphs) as TAB-only, skipping raster/notation analysis. Glyph-less scans also used `stavesPerSystem: 1`, breaking grand-staff pairing. |
| B | Hard-coded generic lede on retry UI, independent of `error`. |
| C | Full-viewport WFY modal portal above top bar; no Escape/scrim dismiss. |
| D | Unconditional `navigateToView('practice')` on successful OMR apply. |

## 3. Exact fixes

1. **TAB commit gate** (`detectTabNotation.js`, `processOmrPage.js`):
   - Empty glyph search → do not confirm geometry-only TAB.
   - TAB-only early return only with affirmative signal (fret digits, TAB clef, capo/unsupported TAB markers).
   - Glyph-less Guitar pages use grand-staff-capable `stavesPerSystem`.
   - Guitar hairpin/ASCII-dynamics flags only when TAB analysis is active.

2. **OMR failure lede** (`PdfOmrPlaybackPanel.jsx`): point to details below instead of generic “Something went wrong…”.

3. **Nav above modal + dismiss** (`App.css`, `WaitForYouInputSourceModal.jsx`, `usePracticeSession.js`, `PracticeControlPanel.jsx`):
   - Top bar `z-index: 2700`.
   - Escape / scrim dismiss defers modal (keeps default source, clears blocker).

4. **OMR auto-nav guard** (`App.jsx`):
   - Stamp `omrRunStartedAt` / `libraryNavAt`.
   - Skip auto Practice navigation when user returned to Library after this OMR started.

5. **Harness**: `scripts/pre-soak-stabilization.mjs` (A–M soak E2E); `stale-musicxml-ab-regression.mjs` uses native Library click.

## 4. Files changed

- `src/features/omr/detectTabNotation.js`
- `src/features/omr/processOmrPage.js`
- `src/components/library/PdfOmrPlaybackPanel.jsx`
- `src/App.css`
- `src/App.jsx`
- `src/components/practice/WaitForYouInputSourceModal.jsx`
- `src/components/practice/PracticeControlPanel.jsx`
- `src/features/practice/usePracticeSession.js`
- `tests/guitarOmrTabNotation.test.js`
- `scripts/pre-soak-stabilization.mjs` (new)
- `scripts/stale-musicxml-ab-regression.mjs`

## 5. Regression tests added

- Unit: glyph-less six-line → not confirmed TAB; title-only glyphs do not commit TAB-only; Capo-only still yields TAB-specific failure.
- E2E: `scripts/pre-soak-stabilization.mjs` (clean launch, upload/play, rapid replace, pagecount, reload, instrument switch, library roundtrip, seek/stop, malformed PDF UI, mismatched companions, Guitar+piano scan, stuck overlay).

## 6. Browser workflows tested

- Clean IndexedDB/localStorage launch
- Library piece open (Piano + Guitar)
- Upload → OMR → Play/Stop
- Multi-page → one-page pageCount reset
- Rapid A→B and A→B→C
- Reload active user score
- Piano ↔ Guitar retention
- Library → user PDF → Library
- Guitar + piano articulation scan
- WFY modal: Library click + Escape dismiss
- Malformed PDF → Try again + specific error

## 7. Test / build / lint results

| Gate | Result |
|---|---|
| `tests/guitarOmrTabNotation.test.js` | **25/25 pass** |
| Notation Fidelity Sprints 2–5 + Musical Structure Sprint 1 + vector beams + playback semantics + guitar mapping units | **97/97 pass** (focused batch) |
| Piano realism + guitar mapping sprint tests | **25/25 pass** |
| Piano audio benchmark | **pass** (0 stuck voices, 0 duplicates, sampler fixtures) |
| Guitar mapping benchmark | **pass** (0 invalid / same-string / impossible) |
| `omr:semantic-corpus` (written) | Ran; frozen evaluator unchanged (recognition residuals unchanged by this pass) |
| `stale-score-real-ui-regression.mjs` | **PASS** |
| `omr-pagecount-replacement-regression.mjs` | **PASS** |
| `guitar-library-regression.mjs` | **PASS** |
| `stale-musicxml-ab-regression.mjs` | **PASS** (after Bug D fix) |
| `pre-soak-stabilization.mjs` | **18 passes / 0 failures** |
| Full Vitest suite | **9 failed / 2640 passed / 5 skipped** (same 9 known pre-existing; +4 new passes vs prior 2636) |
| `npm run build` | **PASS** |
| `npm run lint` | **FAIL** — 221 errors / 37 warnings (pre-existing debt; not introduced by this pass) |

## 8. Known pre-existing failures (unchanged)

1. `tests/demoFixtures.test.js` — Guitar TAB regression PDF OMR alone  
2–3. `tests/omrNegativePage.test.js` — decorative cover isolation (2)  
4–6. `tests/omrTieRecall.test.js` — barline-interrupted / slur-like arcs (3)  
7. `tests/productFixes.test.js` — demo reload source revision  
8. `tests/scoreSourceGenerationGate.test.js` — in-flight OMR invalidate  
9. `tests/tabLaneLayout.test.js` — piano WFY hint expects “with your right hand”

Do not silently weaken these.

## 9. Remaining reproducible issues

- **Headless cannot prove audible audio** — Play advances clock; listen on hardware for silent/clipping.
- **Instrument switch immediately before upload** can still race React context (OMR may briefly see prior instrument). Wait ~300–500ms after Piano↔Guitar before uploading if testing instrument-specific paths.
- **Lint debt** remains large and pre-existing.
- **OMR recognition quality** on hard scans/tuplets/chords unchanged (frozen); soak stability does not claim recognition improvements.
- Physical **iOS/Safari** AudioContext resume not re-verified on device in this pass.

## 10. Manual smoke-test checklist

1. Hard-refresh; clear site data (or Skip restore). Confirm no stuck restore overlay; app clickable.  
2. Library → Start practice on a Piano piece → Play → Stop → seek.  
3. Guitar Library piece (supported) → Play.  
4. My Uploads → Piano → upload beginner PDF → wait Ready → Play.  
5. While on Practice with input modal: click **Library** (should work). Escape also dismisses modal.  
6. Rapid replace: upload A, quickly B, quickly another PDF — stay on My Uploads; final score plays.  
7. Guitar selected → upload `piano-articulation-scan` (or any piano scan) → must **not** show TAB-no-frets; should prepare or show a real non-TAB error.  
8. Piano ↔ Guitar several times — same piece, no duplicate engines / silent Play.  
9. Reload — same piece restores; no autoplay surprise; no stuck overlay.  
10. Library → user PDF → Library again — both clean.  
11. Malformed file — Try again visible; message mentions invalid PDF (not “something went wrong” only).  
12. Production build load once if shipping.
