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

Expanded suite (eight scenarios, fresh context each) — Chromium 8/8 PASS:
- cancel mid-preparation (16-page PDF) → PAUSED in 0.9s, no hang, no
  OMR-failure console noise (user aborts are no longer logged as failures)
- save then reopen after reload → READY restored, Open score renders the
  viewer (34 canvas/svg nodes)
- paired notation + TAB → READY
- sparse TAB (pitch-only source) → READY (standard preparation path)

WebKit (Safari engine) — 8/8 suite scenarios PASS with the same outcomes,
including save/reopen and cancel.

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

## Milestone C/E — regression tests and notation evidence

Committed `c5ce7def9e`:
- `tests/musicXmlSource.test.js`: locks the exact gate that caused the hang
  (3 short non-leading measures -> `validateOmrSourceMeta` false -> Library
  would re-open preparation).
- `tests/importPresentation.test.js`: measure-rhythm failure copy.
- `tests/guitarVisionRests.test.js`: positive SMuFL rest recognition from a
  real text layer (whole/half/quarter/eighth/16th), negative articulation and
  notehead glyphs, and zero invented rests on all scored fixtures.
- `tests/guitarVisionDots.test.js`: honest abstention on ambiguous small ink
  (no dotted durations promoted); zero dots on scored fixtures.

### Dot detection decision (measured, reverted)
A disk-density dot detector was prototyped and rejected: on the standard
fixture it read chord-symbol/annotation glyph bowls as dots (2 false dotted
quarters), corrupting durations. A two-scale density test, a next-column
bound, and a text-box exclusion still could not separate glyph loops from
dots at 150 dpi. The conservative connected-component detector is retained;
genuine dotted-note recovery remains UNSUPPORTED and practice stays disabled.
This is the "abstain rather than fabricate" path, not a claim of dot support.

### Recognition baseline re-verified after every change
mixed 21/21 conf, 4/4; paired 32/32, 8/8; techniques 32/32, 8/8;
sparse 32/32 SF with 32 null durations; standard 16 eighths + 24 quarters.
