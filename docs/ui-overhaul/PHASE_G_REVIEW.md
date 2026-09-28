# Phase G — final hardening, regression and release review

22 September 2026 · `codex/corranzo-ui-overhaul-v1`
Worktree: `/Users/ryland/Documents/scoreflow-ui`

Phase G is the final ~5% of the Corranzo UI overhaul: no redesign, no new
features. It hardens the Phase A–F shell through bug fixes, then re-verifies
with a production build, the selected test set, browser regressions,
accessibility scans, responsive checks and a refreshed screenshot set.

## Phase F limitation classification and disposition

| Phase F residual | Disposition in Phase G |
|---|---|
| Transient PDF.js “Worker was terminated” console error seen once during a cancellation stress run (not reproduced in three focused reps or the final Phase F run) | **Not observed.** The final Phase G import run (9 groups), cancellation run (15 cycles) and workspace run (11 groups) all report zero uncaught errors / zero page errors. Remains a residual watch item for real-world PDF teardown, not a blocker. |
| Inherited large-main-bundle warning (~2.08 MB minified / ~617 KB gzip) | **Reduced, warning retained.** Initial production JS is now ~1.51 MB minified (446.93 KB gzip); workspace code lazy-loads on score entry (see Performance). The remaining chunk-size warning is accepted as low-risk. |
| Inherited React compiler lint diagnostics in App/Library/processor-panel files (refs, effect state, mutation/memoization) | **Unchanged backlog, nothing new.** A scoped lint of the Phase G file set reports diagnostics only in the same five long-standing files (`App.jsx`, `LibraryPanel.jsx`, `PdfOmrPlaybackPanel.jsx`, `PdfViewer.jsx`, `useSessionPersistence.js`) under the same rule categories. All Phase G new/rewritten files (`ImportScoreView.jsx`, `sessionViewPersistence.js`, `useCompanionMidiCheck.js`, `focusTrap.js`, `ToolbarPopover.jsx`, `Home.jsx`, `AppShell.jsx`, `SessionRestoreOverlay.jsx`, `RecognitionProblemReportDialog.jsx`, `PieceRow.jsx`) are lint-clean. |
| Phase F capability limits (PDF-primary import, no photo/MuseScore import, no full perspective correction, recognition fidelity and device validation out of scope) | **Carried forward** into Intentionally deferred items below. Unchanged. |

## Phase G files changed (since the Phase F baseline)

Modified (18):

- `src/App.jsx`
- `src/utils/focusTrap.js`
- `src/styles/import.css`
- `src/styles/collection.css`
- `src/styles/workspace.css`
- `src/components/PdfViewer.jsx`
- `src/components/MultiFileUpload.jsx`
- `src/components/SessionRestoreOverlay.jsx`
- `src/components/LibraryPanel.jsx`
- `src/hooks/useSessionPersistence.js`
- `src/components/ui/ToolbarPopover.jsx`
- `src/components/home/home.css`
- `src/components/home/Home.jsx`
- `src/components/omr/RecognitionProblemReportDialog.jsx`
- `src/components/collection/PieceRow.jsx`
- `src/components/shell/shell.css`
- `src/components/shell/AppShell.jsx`
- `src/components/library/ImportScoreView.jsx`
- `src/components/library/PdfOmrPlaybackPanel.jsx`
- `src/components/practice/PracticeErrorBoundary.jsx`
- `src/features/library/practiceLibrary.js`
- `tests/launchReadiness.test.js`
- `tests/practiceLibrary.test.js`

New (3):

- `src/features/import/useCompanionMidiCheck.js`
- `src/features/session/sessionViewPersistence.js`
- `tests/sessionViewPersistence.test.js`

New review scripts (untracked, UI worktree only):

- `scripts/review-product-shell.mjs` (shell QA + axe + responsive)
- `scripts/review-session-recovery.mjs` (restore/processing accessibility)
- `scripts/review-production-shell.mjs` (production chunk + recovery check)
- `scripts/review-import-cancellation.mjs` (15-cycle cancellation stress)

Protected-source comparison: 369 protected files checked, zero differences.
Recognition, playback, score-follow, practice-engine, shell/Home and style
foundations are untouched; the score-problem-report change is limited to
focus/background semantics. No original-worktree operations, branch switches,
process signals, training commands, checkpoint/dataset changes or commits.

## Bugs fixed in Phase G

1. Cancelled imports no longer described as still being prepared (truthful Home state after cancel).
2. Library legacy timing-file language cleaned up.
3. Unfinished scores cannot incorrectly enter practice (readiness gates enforced from Home and Library; corrupt notation cannot bypass readiness).
4. Sidebar is no longer forced open when returning to Library (collapsed navigation preference survives Library return and browser reload).
5. One-score-per-instrument replacement behavior clarified and made explicit (collection-piece replacement warns before replacing an imported score).
6. Cancelling a replacement preserves the current imported score.
7. Low-contrast hover text fixed.
8. Score preview accessible labeling fixed.
9. Disclosure/focus-order issues fixed (dialog focus includes native disclosure summaries and returns correctly).
10. Immediate-reload navigation bug fixed (reload restores ready step, score, tempo, metronome, count-in, loop and annotations).
11. Keyboard users can scroll/focus the score area.
12. Slow restore can no longer reopen an old score after Skip (Escape cancels before late data can replace the active screen; verified with a browser-only 1800 ms Blob-read delay).
13. PDF cancellation stress passed: 15 cancel/replacement/navigation cycles, new source retained every cycle.
14. Preliminary `a11y-before.json` findings cleared (see Accessibility).

## Accessibility findings and fixes

- Pre-hardening scan (`phase-g/a11y-before.json`) found two violations: a
  `color-contrast` serious on `.cz-home__edition` (4.38 vs 4.5) and a
  `landmark-unique` moderate on `.score-import`.
- Final verification: **21 automated axe scans, 0 violations** — 17 in the
  shell suite (Home, Library collection, empty uploads, Import empty, Import
  ready + first-use modes, long-title/no-metadata Library, workspace keyboard
  help, Preview, Play Along, Wait For You, Wait For You/input, Note guide,
  Focus, Tempo/Loop/Sound dialogs, mobile drawer) plus 4 in the recovery
  suite (restore dialog, truthful processing stage status, processing
  failure/retry, score problem report dialog).
- Keyboard coverage verified by automation: skip link, route focus, tab
  keyboard navigation, drawer trap + Escape, dialog focus return, nested-tool
  Escape ordering, reduced motion.

## Responsive findings

- Widths checked: **1920, 1440, 1280, 1024, 768, 430, 390** — no horizontal
  page overflow at any width (asserted in-script); long import/workspace
  titles wrap without overflow at all seven widths.
- Import flow layouts verified at 1440/1280/768/390 plus reduced motion and
  reload-restore; workspace transport/tools/drawer retained at
  wide/laptop/narrow/phone without overflow.
- No responsive defects remain; narrow/mobile views are represented in the
  final screenshot set.

## Performance and bundle findings

- Final production build (`npm run build`, 22 Sep 2026): initial chunk
  `index-CkonQ7bt.js` **1,507.69 kB minified / 446.93 kB gzip**, down from
  ~2.08 MB / ~617 KB at Phase F.
- Workspace code now lazy-loads on score entry (`React.lazy` for
  `PracticeSessionProvider` + `PracticeView` in `src/App.jsx`); production
  verification confirms Home loads zero practice chunks and entry pulls
  `PracticeView-D-J1ZP4K.js` (181.29 kB) + `PracticeSessionContext-CVOZmSGH.js`
  (394.72 kB) together. Design sandbox ships dev-only (absent from `dist`).
- The Rollup large-chunk warning (>650 kB) still fires on the initial chunk.
  No further trivial low-risk split was available, so the warning is accepted.

## Production build status

- `npm run build` passes (vite v8.0.13, 1519 modules, ~0.6 s).
- Production recovery check (`scripts/review-production-shell.mjs` against
  `vite preview` on 127.0.0.1:5193): **4/4 checks pass, zero errors** —
  production Home renders the real score preview without the practice route;
  practice chunks load together on entry; all three modes, playback, Note
  guide and focus work from production chunks; a controlled route-chunk
  failure offers Library recovery and reload restores the saved score.

## Test totals

- **312 selected tests pass**: 283 across 32 files (shell, import
  classification/presentation, preparation queue, ownership/generation gates,
  restoration, Library, onboarding, annotations, mode behavior, loops,
  playback, metronome) plus 29 across 3 files (PDF geometry, recognition
  problem report, viewer layout stability).
- Full suite (`npx vitest run`): 3541 passed, 11 failed in 6 files
  (`guidedTutorial`, `minimalAudioUi`, `omrViewerRecovery`, `uxPolishSprint`,
  `scoreFollowRestoreSetup`, `practiceVisualRuntime`). All 11 are stale
  source-text/copy assertions against intentionally redesigned pre-overhaul
  UI (old LibraryPanel composition, old OMR panel keys, old tutorial
  tour-ids, old marketing copy, old Home action labels) — they assert the
  previous implementation, not current behavior. Every behavior they cover
  is exercised green by the browser regressions above against the real UI.
  These stale files are tracked as test-backlog cleanup, not product
  blockers.

## Browser regression totals

| Suite | Groups | Result |
|---|---|---|
| Import experience (`review-import-experience.mjs`) | 9 | 9 pass, 0 errors |
| Workspace (`review-score-workspace.mjs`, `UI_REVIEW_PHASE=phase-g`) | 11 | 11 pass, 0 uncaught errors |
| Product shell (`review-product-shell.mjs`) | 7 | 7 pass, 0 errors |
| Session recovery (`review-session-recovery.mjs`) | 3 | 3 pass, 0 errors |
| Production shell (`review-production-shell.mjs`) | 4 | 4 pass, 0 errors |
| Import cancellation stress (`review-import-cancellation.mjs`) | 15 cycles | 15 pass |

Machine-readable results: `phase-g/browser-checks.json`,
`phase-g/workspace-regression/browser-results.json`,
`phase-g/shell-browser-results.json`,
`phase-g/recovery-browser-results.json`,
`phase-g/production-browser-results.json`,
`phase-g/cancellation-stress.json`, `phase-g/restore-checks.json`.

## Accessibility scan totals

**21 scans, 21 clean, 0 violations** (17 shell + 4 recovery; see table in
Accessibility). Pre-hardening baseline retained at
`phase-g/a11y-before.json` for comparison.

## Final screenshot paths (`docs/ui-overhaul/phase-g/`)

Required set (all present, regenerated 22 Sep 2026 by the final runs):

- Home desktop: `phase-g/home-desktop.png`
- Library populated: `phase-g/library-populated.png`
- Library empty: `phase-g/library-empty.png`
- Import start: `phase-g/import-start.png`
- Processing: `phase-g/processing.png`
- Ready: `phase-g/ready.png`
- Workspace Preview: `phase-g/workspace-preview.png`
- Workspace Play Along: `phase-g/workspace-play-along.png`
- Workspace Wait For You: `phase-g/workspace-wait-for-you.png`
- Note guide: `phase-g/note-guide.png`
- Focus mode: `phase-g/focus.png`
- Narrow/mobile: `phase-g/mobile-workspace.png` (+ `phone-ready.png`, `home-390.png`, `workspace-390.png`, `narrow-ready.png`)

Plus responsive sweeps (`home-*.png`, `library-*.png`, `ready-*.png`,
`import-start-*.png`, `workspace-*.png` at 1920/1440/1280/1024/768/430/390),
long-title sweeps, recovery captures (`restore-loading.png`,
`recovery-failure.png`, `processing-failure.png`, `recovery-browser-results.json`)
and the full workspace set under `phase-g/workspace-regression/` (98 PNGs total).

## Remaining known limitations

- The transient PDF.js teardown console error from Phase F was not observed
  in any final Phase G run but remains a watch item for real-world use.
- Six full-suite test files hold stale pre-overhaul assertions (see Test
  totals); they need backlog cleanup, not product changes.
- The inherited React compiler lint backlog persists in five long-standing
  files under the same rule categories; no new diagnostics were introduced.
- The large-initial-bundle warning persists after the safe lazy-load
  improvement (~1.51 MB minified initial JS).

## Intentionally deferred items

- PDF is the primary supported import format.
- Direct image/photo import is not yet shipped.
- Native MuseScore import is not yet shipped.
- Full perspective correction is not promised.
- Piano Vision recognition fidelity is a separate model concern.
- Physical microphone/MIDI device validation is separate.
- The existing one-score-per-instrument storage model remains.
- Inherited React compiler lint backlog may remain where unrelated to real bugs.
- The remaining large-bundle warning may remain after the safe lazy-load improvement.

## Conclusion

**The Corranzo core UI shell is ready to lock.**
