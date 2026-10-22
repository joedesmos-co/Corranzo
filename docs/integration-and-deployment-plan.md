# Integration + deployment plan (Score Following → live website)

Status: **integration VERIFIED, deployment HELD** pending the Practice Engine
agent's commit (2026-10-14). This document is the durable record so the
release can be executed exactly when the preview is free.

## Topology (verified, read-only)

```
main                     fcdb8d0172   ← official main, never merged to
 └── … 92 commits …      bad9f98e18   ← score-follow final acceptance (merge-base)
      ├── preview        8cac636a54   codex/unified-practice-audio-preview
      │                                 (product: sound engine, mic, audio-vision,
      │                                  OSMD engraving, PDF-first import, practice engine)
      └── research       f04b96f29b   codex/score-follow-precision  (my 7 commits)
```

**Live now:** `https://corranzo.com` — HTTP 200, serving a Cloudflare
deployment from **2026-10-08** (version `5a2de273`, worker `corranzo`).
Verified live: my user-facing timing warning string ("…more notes than
fit…") has **0 occurrences** in the live bundle, and the preview's "Note
guide" mode has 0 occurrences → none of the last week's work (preview or
score-follow) is live.

**Deployment process (established):** `npm run deploy:cloudflare` =
`npm run build && wrangler deploy`, worker `corranzo`, assets from `./dist`
(`wrangler.toml`). Wrangler is authenticated
(`joedesmos.co@gmail.com`, account `4c9bb24874cf858b00ece7bde8d1a2ea`).

## Verified integration (branch `tmp-integration-verify`, commit `c2d4bf45a9`)

Merged `codex/score-follow-precision` into the preview tip **in the score-follow
worktree only** (no shared state touched). Two conflicts, both additive and both
resolved keeping both features:

| file | conflict | resolution |
|---|---|---|
| `src/features/musicxml/parseMusicXml.js` | preview adds `pedalSpans`; research adds `partMeasureNoteEnds` | keep **both** — walkPart params, both call sites, both return maps |
| `scripts/browser-cross-engraving-e2e.mjs` | preview tracks the update-depth warning; research added a duplicate classifier | keep the **preview's** tracking (better provenance), drop the duplicate helper |

Two integration fixes made during verification:
- `scripts/browser-pdf-first-import-e2e.mjs` — the preview's handler tracked
  the update-depth warning **and** pushed it into `consoleErrors`, so its own
  strict gate failed on a warning it explicitly calls "tracked". Added the
  `return` the comment already described. The warning is still collected and
  printed on every run (`TRACKED update-depth warning fired …`).
- `tests/audioArrangementMusicXml.test.js` — comment only: the Audio Vision
  arrangement generator emits overfull measures (`timingValidation: invalid`),
  and a *stale* staging artifact made bar 1's last G4 and bar 2's first G4
  collide, which the WFY fallback correctly splits into two checkpoints.
  The current generator's output does not collide, so the count stays 8/8.
  **Handoff to Audio Vision:** the generator packs more content per measure
  than the time signature holds.

Full diff saved at `<tmp>/integration-fixes.patch` (611 KB) for re-application
if the preview tip moves before the merge.

## Verification on the merged tree (all green)

| check | result |
|---|---|
| unit suite (`vitest run`) | **3769 passed / 0 failed** (5 heavy neural browser suites excluded for memory — see below) |
| `npm run build` | green (1.9 s) |
| `npm run test:scripts` | green |
| `browser-pdf-first-import-e2e` (PDF upload, render, playback, session save/restore, legacy restore) | **17/17** |
| `browser-practice-score-follow-e2e` (Preview, WFY correct/wrong/partial-chord/duplicate, Play Along, cursor, zoom) | **17/17** |
| `browser-unified-practice-midi-e2e` (MIDI WFY, transport, seek, loop, score change) | **26/26** |
| `browser-unified-practice-mic-e2e` (real mic clips, mic init) | **23/23**, 0 known-pre-existing warnings |
| `browser-tempo-acceptance-e2e` | **5/5** |
| `browser-score-follow-precision-e2e` (pixel onset lock) | **9/9** |
| `measure-tie-duration-integrity` | **11/11** |
| `measure-unseen-score-acceptance` (incl. holdout PDFs) | **35/35** |
| `measure-score-follow-precision` (24 scores) | **24/24**, 0 wrong-page/system/NaN/teleports |
| `measure-cross-engraving` (2 real PDF pairs) | 0.0105 / 0.0208 page, overflow 0 |

Note: the 7 UI-copy failures documented on the research branch are **closed** on
the preview (`b864d27a0b`), so the merged tree has zero pre-existing failures.

Environment note: the preview added `opensheetmusicdisplay` (OSMD engraving) —
declared in `package.json`/`package-lock.json` but **not installed** in the
score-follow worktree, which broke the build and made Vite return 500 for
`PracticeView.jsx`. `npm install` fixes it (lock file unchanged). Any checkout
that builds the preview line must install its dependencies.

## React "Maximum update depth" — investigated, not blocking

- Fires **2× during score open/import** (step `open-score`) in the PDF-first
  import flow; tracked and printed every run.
- **No blocking practice failure**: every functional assertion in that suite
  passes (PDF renders, playback, session restore, no uncaught page errors), and
  the practice + mic browser suites report **0 occurrences** (the preview's
  `c710b5a611` lane-identity fix removed the Play Along loop).
- Also reproduces at the research tip with my changes stashed / notice disabled
  / fallback disabled; stack is the practice clock (`PracticeSessionContext` RAF
  tick + `useScorePlayback` `flushTimeUpdate`), not the follow layer.
- Still open as an issue-ledger item; not hidden anywhere.

## Steps to execute when the preview is free

1. Wait for the Practice Engine agent to commit on
   `codex/unified-practice-audio-preview` (currently uncommitted:
   `AnnotationLayer.jsx`, `PdfPageFrame.jsx`, `useScorePlayback.js`).
2. Re-do the merge from that new tip (2 additives; re-apply
   `<tmp>/integration-fixes.patch` conflicts if the tip moved).
3. Re-run: build, unit suite, and the six browser suites + four node harnesses
   in the table above.
4. Deploy from the integrated branch: `npm run build && npx wrangler deploy`.
5. Verify live: `curl -s https://corranzo.com` → 200; then in the app confirm
   PDF import, Preview, WFY (MIDI), Play Along, a saved score, and that the live
   bundle now contains the timing-warning string ("more notes than fit").
6. Rollback: Wrangler keeps prior versions — `npx wrangler deployments list`,
   then `npx wrangler rollback <version-id>`; the current live version
   `5a2de273` is the known-good fallback.

## Data safety

No schema/storage changes in this integration; session save/restore and legacy
restore suites pass, and saved-session assertions are covered by the
PDF-first-import suite (session saved with its PDF identity, session restores,
legacy restore explained).
