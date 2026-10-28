# Guitar import + recognition — integration handoff

Branch: `codex/guitar-vision-product`
Head at handoff: see `git log -1`. Base main observed: `e97283200a`
(the mission brief said `f7a43bc0c4`; main has since moved — rebase before
picking). This branch is 5 commits behind main; **no merge performed**.

## Patch A — import hang root cause (highest priority)

Files:
- `src/App.jsx` — `handleOmrGenerated` validates the generated source with
  `validateOmrSourceMeta` before any side effect; returns `{ok:false,message}`.
- `src/components/library/PdfOmrPlaybackPanel.jsx` — 20 s watchdog for a
  completed run the Library never accepts.
- `src/features/import/importPresentation.js` — measure-rhythm failure copy.
- `src/features/omr/runPdfOmrClient.js` — 5 min overall timeout (fallback).
- `src/features/omr/runPdfOmrPipeline.js` — user AbortError is not logged as
  an OMR failure.

Commits: `8c54397e4c`, `bf7b1ed470`, and the abort-logging hunk of
`aac25b3e80`.

No conflicts with current main in these files (`git diff --stat HEAD...main`
shows only `guitarTabCore.js`).

Cherry-pick:
```
git cherry-pick 8c54397e4c bf7b1ed470 aac25b3e80
```
(`aac25b3e80` also brings the browser suite; drop it if only the fix is wanted
and apply the 4-line AbortError guard manually.)

### Root cause
OMR completed (`status=READY`, source applied) but the Library's
`validateOmrSourceMeta` rejected it because 3+ non-leading measures did not
fill the time signature. `shouldShowLibraryOmrPanel` re-opened the panel,
which was already READY — a state that renders "Checking your score" with no
actions. Nothing could ever change it.

### Before / after (real app, real PDF.js)
| input | before | after |
|---|---|---|
| 5-page partial-measure (surrogate for hikaru-nara) | indefinite "Checking your score", 0 actions | recoverable error in ~5.6 s, `Try again / Report / Choose another PDF` |
| corrupt PDF | failure panel | recoverable error in ~1.6 s |
| valid 5-page standard | READY | READY in ~2.6 s |
| failure → valid retry | — | READY in ~8.2 s |
| cancel mid-preparation | — | PAUSED in ~0.9 s, `Prepare score` available |
| save → reload → open | — | READY restored, viewer renders |

## Patch B — browser regression suite

- `scripts/guitar-import-lifecycle-e2e.mjs` (single PDF; exits 1 on a stuck
  "Checking your score").
- `scripts/guitar-import-lifecycle-suite.mjs` (8 scenarios, fresh context;
  `BROWSER=webkit`, `ONLY=<substring>` filters).
- `benchmarks/omr-fixtures/import-lifecycle/` fixtures + README.
  - valid-standard-5p.pdf `4f531af287e2cdeaa25965bf0b38f844`
  - partial-measure-5p.pdf `eca721f995323e1df275c08366af1b3f`
  - slow-standard-16p.pdf `7b8cacb2a2bc05212af78098b3162053`
  - paired-tab.pdf `59ddc525b2ba4c6c6d021c1d6ecec83e`
  - sparse-tab.pdf `252806fa22c5f0da96f0adac188fce09`
- Commits: `fb44e730b8`, `aac25b3e80`, `c67b0eb838`.

Result: Chromium **8/8**, WebKit **8/8**.

Run:
```
npx vite --port 5200 --strictPort
node scripts/guitar-import-lifecycle-suite.mjs
BROWSER=webkit node scripts/guitar-import-lifecycle-suite.mjs
```

## Patch C — recognition: SMuFL rest evidence (additive, preview-only)

Files:
- `src/features/vision/guitarTabCore.js` — `SMUFL_RESTS`, `notationRests`,
  `rests` in `recognizeGuitarTabPdf`/`analyzeNotationRhythm` summaries.
- `tests/guitarVisionRests.test.js`, `benchmarks/omr-fixtures/guitar-rests-vector/`.
- Commit `ae3cb54fa4` (+ tests `c5ce7def9e`).

This is additive to main's accepted stem fix (main lacks `SMUFL_RESTS`).
Rests are **detected and reported only** — not emitted into MusicXML, because
rest-to-beat alignment is not yet evidence-backed. Practice stays disabled.

## Explicitly NOT included

- **Dotted-note recovery**: a disk-density detector was prototyped and
  rejected after it read chord-symbol glyph bowls as dots (2 false dotted
  quarters on the standard fixture). `tests/guitarVisionDots.test.js` locks the
  conservative abstention. Do not merge any dot-promotion change.
- Ties, independent voices, multi-page Guitar experimental recognition,
  TAB-only rhythm slashes, scanned PDFs.

## Recognition baseline (must hold)

| fixture | result |
|---|---|
| mixed | 21/21 confident onsets, 4/4 measures, 60/60 SF |
| paired | 32/32 onsets, 8/8, 116/116 SF |
| techniques | 32/32, 8/8 |
| sparse | 32/32 SF, 32 null durations (abstains) |
| standard notation | 40 onsets, 16 eighths + 24 quarters |

## Rollback

Patch A is isolated to import lifecycle files; reverting it restores the old
hang. Patch C is additive; reverting removes rest reporting only. Neither
touches Practice enablement.

## Unsupported inputs (must stay recoverable)

Lead sheets whose measures the recognizer cannot fill, rhythmic-slash charts
with no pitched notes, corrupt/encrypted PDFs, and 5+ page experimental Guitar
(>1 page is rejected by the experimental path and falls back to standard
preparation). All now end in a clear message with retry; none should spin.
