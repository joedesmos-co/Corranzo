# Guitar seven-hour campaign — progress

Branch: `codex/guitar-vision-product`
Base at start: `8c54397e4c`

## Milestone A/B — import hang root cause (DONE)

**Exact root cause (reproduced, not guessed).**
The OMR run completed (`status=READY`, musicXml applied), but the Library's
readiness gate `validateOmrSourceMeta()` rejected the generated source because
`validateOmrMusicXmlMeasureRhythm()` found 3+ non-leading measures that do not
fill the time signature. `shouldShowLibraryOmrPanel()` then returned `true`
again, re-showing the OMR panel — but the panel was already in `OMR_STATUS.READY`,
which renders:

  "Checking your score"
  "Making sure the page and playback are available."

…with **no action buttons**. Nothing could ever change that state.

This is exactly the user's 5-page lead-sheet screen (standard notation + chord
symbols + rhythmic slashes ⇒ measures that do not fill 4/4).

**Fix** (`bf7b1ed470`):
1. `App.handleOmrGenerated` validates the generated source with
   `validateOmrSourceMeta` *before any side effect* and returns
   `{ok:false, message}` with the concrete reason.
2. `PdfOmrPlaybackPanel` watchdog: a completed run that the Library never
   accepts transitions to a retryable failure after 20s.
3. `describePreparationFailure` maps measure-rhythm failures to clear recovery
   copy ("Corranzo read the page but could not build reliable timing for every
   measure…").
4. Kept the existing 5-minute overall OMR timeout as a last-resort fallback.

## Browser evidence (real app, real PDF.js, dev server)

Surrogates committed under `benchmarks/omr-fixtures/import-lifecycle/`
(the original `hikaru-nara.pdf` was not available; these are clearly labelled
surrogates).

Chromium — 4/4 scenarios PASS:
- valid five-page standard → READY in 2.7s
- partial-measure five-page → RECOVERABLE in 5.6s, actions
  `Try again | Report a score problem | Choose another PDF`
  (before fix: indefinite `Checking your score`, 0 actions)
- corrupt PDF → RECOVERABLE in 1.6s
- failure then retry with valid PDF → READY in 8.2s

Expanded suite (six scenarios, fresh context each) — Chromium 6/6 PASS:
- cancel mid-preparation (16-page PDF) → PAUSED in 0.9s, no hang, no
  OMR-failure console noise (user aborts are no longer logged as failures)
- save then reopen after reload → READY restored, Open score renders the
  viewer (34 canvas/svg nodes)

WebKit (Safari engine) — 5/5 suite scenarios + save/reopen PASS with the same
outcomes.

Run:
```
npx vite --port 5200 --strictPort
node scripts/guitar-import-lifecycle-suite.mjs                       # chromium
BROWSER=webkit node scripts/guitar-import-lifecycle-suite.mjs       # webkit
ONLY=cancel node scripts/guitar-import-lifecycle-suite.mjs          # subset
```

## Milestone D — recognition quality preserved

- mixed: 21/21 confident onsets, 4/4 measures, 60/60 SF
- paired: 32/32 onsets, 8/8 measures, 116/116 SF
- techniques: 32/32, 8/8
- sparse: 32/32 SF, all 32 durations null (honest abstention)
- standard: 40 onsets, 16 eighths + 24 quarters
Focused vitest: 57/57 pass (guitar vision/notation/omr-tab/score-target);
import/musicXmlSource/viewer-recovery: 36/36 pass.

## Next
- Committed browser regression suite.
- Further notation work (rests emission, dots, ties, voices) unchanged and
  still practice-disabled.

## Integration verification (this round)

- Cherry-picked import lifecycle fix: `6477e73ca3` (5-min total timeout),
  `205c6f336c` (reject unusable OMR before side effects + panel watchdog),
  `a5825b4505` (abort logging + expanded suite).
- Import lifecycle browser suite:
  - Chromium 6/6 PASS (valid, partial-measure recoverable, corrupt recoverable,
    failure→retry READY, cancel PAUSED, save/reopen READY).
  - WebKit 6/6 PASS.
- Cursor: `0870192706` (stable layout systemIndex) verified in Chromium via
  `browser-practice-score-follow-e2e.mjs`: 17 passed / 0 failed, covering WFY
  advance/no-advance, chord completion, Play Along shared cursor, zoom, and
  zero console errors. WebKit cursor E2E not available (Chromium-only script).
- Focused unit tests: 75/75 pass across musicXmlSource, OMR banner/recovery,
  cursor motion, experimental vision, guitar extraction, PDF OMR.
