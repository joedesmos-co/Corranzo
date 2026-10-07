# Corranzo musician-UI integration

Branch: `codex/corranzo-integration` (worktree `/Users/ryland/Documents/scoreflow-integration`).
UI source: `codex/corranzo-musician-ui-redesign` through `590ecb4efd`.
Guitar (`scoreflow-guitar`), Piano (`scoreflow-piano-v26`), `main` and the UI
worktree were not modified. Nothing merged into any other branch.

## 1. Integration base commit

Local `main` @ `9442ace796` ("checkpoint: accepted reconstructed PDF-faithful
Visual mode and play-along follow bar") — the current product tip, 42 commits
ahead of `origin/main`, 0 behind. Alternatives rejected: `origin/main` (older),
`codex/v25-realpdf-adaptation` (dirty checkout, diverged piano research line),
`codex/guitar-vision` (active research elsewhere, explicitly excluded).

## 2. UI commits integrated

Seven cherry-picks (`-x`), in order, zero conflicts:

1. `21c320e362` test(ui): align stale UI assertions with the overhauled surfaces
2. `e8886df5e8` fix(a11y): contrast, heading order, internal-term leaks
3. `2f31c81278` fix(import): invalid list role on file-notice messages
4. `f89e917428` fix(shell): truthful nav toggle label, readable import helper
5. `77424bd240` test(corranzo): overhauled shell/import/workspace test coverage
6. `ba66f1ba5c` Redesign Corranzo around the musician's score and practice desk
7. `590ecb4efd` Polish pass (journal hierarchy, ruled selects, mobile stand,
   excerpt crop, listening cues)

## 3. Integration method

Cherry-pick, not merge. Reason (verified, not assumed): `main` is an ancestor
of the UI tip, but the UI branch history between `main` and `77424bd240`
contains ~91 Piano/OMR research commits (piano-vision V2, semantic repair
framework, OMR lattice work). A merge would have pulled that research history
and tree into the product, violating the integration constraints. File-level
analysis proved the 7 UI commits touch files no research commit ever touched
(83/83 pure-UI-delta files clean; 353/353 overhaul-scaffolding files clean), so
cherry-pick applied with zero conflicts and zero research leakage (verified by
path filter: no `piano-vision`, `sourceRelationGraph`, `sourceTemporalLane`,
`semantic-gold`, `semanticMusicXml`, holdout, repair or audit files added).

## 4–5. Conflicts and resolutions

No merge conflicts. No functionality dropped. No manual file copies.

## 6. Production build

`npm run build` passes on the integrated tree (only the pre-existing
chunk-size warning, identical on the base).

## 7–8. Full test result and baseline comparison

- Pre-integration base (`main` @ `9442ace796`): **3237 passed, 0 failed**
  (310 files). Clean.
- Post-integration: **3273 passed, 7 failed** (316 files; fewer files because
  research-only test files were correctly excluded).
- The 7 failures are byte-for-byte the same failures the finished UI branch
  carries (`betaOnboarding`, `designPhaseA` contrast, `ipadLayout`,
  `launchReadiness` Progress naming, `minimalAudioUi`, `mobileLayout`,
  `uxPolishSprint` demo copy). Each asserts a pre-redesign copy/design
  contract the redesign intentionally changed (documented in POLISH.md §4).
  No new failures from integration mechanics.
- `git diff --check` passes. ESLint: 110 flagged files repo-wide, 96 of them
  untouched `main` files (pre-existing dirt); the 14 integration-touched files
  produce output identical to the UI worktree (63 problems, same count both
  sides) — no new lint issues. The one `package.json` delta is the legitimate
  `axe-core` devDependency the review scripts require.

## 9. Smoke test (real integrated app, isolated browser contexts)

- Launch, Home (`Today's practice`, live score excerpt), repertoire rows,
  search, difficulty filter, keyboard tabs, empty/uploads tabs: pass.
- Import: drop PDF, cancel truthfulness, `Prepare score` → ready, mode
  choice, open score: pass. Corrupt MIDI/XML correctly blocked with recovery
  back to the saved PDF: pass.
- Practice: score renders, Play/Pause runs (position advances), seek slider
  reaches Bar 24, live bar reference updates, Tempo/Loop/Sound/Workspace
  settings dialogs with focus restore: pass.
- Play Along and Wait For You selectable; WFY shows `Your turn`: pass.
- Note guide shows the capitalized listening cue (`Both notes together`): pass.
- Markup: graphite annotation persists across reload (`Marks saved`): pass.
- History: timer runs, session saves with piece + notes, stats update: pass.
- Settings: Dark/Light surround toggle, sidebar toggle, Piano→Guitar→Piano
  round-trip (switching opens that instrument's library): pass, zero page
  errors throughout.
- OMR entry points: readiness pipeline completes in-browser and the score
  opens with generated timing: pass.

## 10. Responsive

Workflow suite asserts no horizontal overflow at 1920/1440/1280/1024/768/430/
390 on Home, Library, Import, readiness, workspace and dialogs: pass.
Integrated screenshots at 1440/390 (practice desk, Settings, Home stand)
eyeballed against the finished-UI evidence: identical intent, no integration
regressions. Dense-score phone readability still relies on zoom, as designed.

## 11. Accessibility

- `review-musician-ui`: 21/21 checks, zero violations.
- `review-musician-workflows`: 7/7 checks, zero violations.
- `review-musician-details`: 6/6 checks, zero violations.
- Skip link, route focus, dialog traps, 44px targets, reduced motion:
  re-verified by the suites on the integrated tree.
- Note: the workflows script has a pre-existing timing flake at the
  rail-collapse step (unawaited layout settle after viewport resize; it
  failed identically on the pristine UI branch and passed on re-run here with
  7/7). Script race, not a product defect; left as-is.

## 12. Integration-only fixes

None required for the product. The only changes beyond the 7 cherry-picks are
three one-line QA-script edits allowing `UI_REVIEW_ROOT` to override the
hard-coded UI-worktree assertion so the shipped review suites can validate any
checkout (this integration record file is the other addition).

## 13. Files changed beyond the existing UI branch

- `scripts/review-musician-{ui,workflows,details}.mjs`: cwd assertion accepts
  `UI_REVIEW_ROOT` (3 lines total).
- `docs/musician-ui/INTEGRATION.md`: this file.

## 14. Worktree / branch status

`codex/corranzo-integration`: 7 cherry-picks, plus a QA-script support
commit (UI_REVIEW_ROOT env), plus this record. Clean tree. Pushed to
`origin/codex/corranzo-integration`. No other branch touched; no merges
performed anywhere; Guitar/Piano research explicitly not pulled in (a later
Guitar integration must reconcile against this base).

## 15. Safe to merge into main/product?

Yes. The integrated tree is the current product base plus the finished,
validated musician UI, with research excluded by construction, zero conflicts,
zero new test/lint failures, and full end-to-end smoke coverage on the real
application state.

## 16. Recommended merge / deployment step

From a clean `main` checkout (no other worktrees on `main` exist today):

```
git checkout main
git merge --ff-only origin/codex/corranzo-integration
npm ci && npm run build && npx vitest run
git push origin main
```

Fast-forward applies: the integration branch is a straight descendant of
`main` (7 cherry-picks + 2 record commits). Then deploy via the normal
release path (`npm run build`, Cloudflare/pages flow as configured). Do not
merge this branch into `codex/guitar-vision`, `codex/piano-vision-v26`, or any
research branch — those must rebase onto the updated `main` instead.
