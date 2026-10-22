# Corranzo Bug Hunt — Final Report

## 1. Starting and final commits
- **Starting commit (live baseline):** `560bc5d1bd` (2026-10-15, "Merge branch 'release-audio-vision' into release-sound-and-av")
- **Final commit (this work):** `c15310a6ed` on branch `bugfix/site-bug-hunt` (includes `cb5843196b` navigation, `a7865d583b` Audio Vision TAB, `c15310a6ed` AV persistence)
- **Live deployment version ID:** `18be664b-bf6e-4071-9db9-c2aab5812e3e`
- **Live bundle hash (before):** `index-CwawHliB.js`
- **Live bundle hash (after):** `index-CUe_-y4f.js` (verified live at https://corranzo.com)

## 2. Website areas audited
- Home, Library (Practice Library + My Uploads, search, instrument switch)
- Import (PDF upload, edge cases: unsupported types, broken/truncated PDF, standalone MusicXML on primary picker, multi-file)
- Practice workspace (Preview, Play Along, Wait For You, transport, tempo, keyboard shortcuts, focus mode, page navigation, zoom/fit)
- History (manual timer: start/pause/resume/stop/save)
- Settings (paper theme, sidebar, instrument, clear saved session)
- Audio Vision (upload → arrange → tempo correction → rebuild → open in practice → save → reopen)
- Responsive (375/414/768/1024/1280 widths; no horizontal overflow; mobile e2e passed)
- Navigation (browser back/forward, deep links to legal pages, unknown URL handling, double-click)
- Persistence (PDF import → save → reload → restore → delete; AV arrangement → save → reload → reopen)

## 3. Number of bugs discovered
- Total discovered: **4**
  1. (P2) Browser Back/Forward leaves the app instead of moving between views.
  2. (P3) `tests/audioArrangementMusicXml.test.js` failed on a fresh checkout (non-committed staging fixture).
  3. (P1) Audio Vision guitar arrangements lost their six-line TAB staff (audio-vision branch removed them).
  4. (P1) Audio Vision arrangements were never persisted (session save required a PDF), so they disappeared on reload and could not be reopened.
- Plus several near-misses that turned out to be correct behavior.

## 4. Bugs fixed by severity
- P1: 2 (guitar TAB staff restoration `a7865d583b`; AV arrangement persistence `c15310a6ed`)
- P2: 1 (browser history navigation `cb5843196b`)
- P3: 1 (test-infra fresh-checkout failure `cb5843196b`)

## 5. Audio Vision integration (a7865d583b)
Integrated the verified Audio Vision MusicXML corrections from `9648f75220` (codex/audio-to-solo-arrangement):
- Chord notes reuse their parent onset's duration; chord members no longer clip each other; `<backup>` always emitted before an empty LH voice; exact division accounting via `emitStaffVoice`.
- **CRITICAL: Guitar TAB preserved** (2-staff: notation + six-line TAB with standard tuning). Independent structure check: 9/9 PASS.
- Added `tests/audioVisionMusicXmlSemantics.test.js` (M1, 6 tests), adapted to treat TAB-staff notes as mirrors.

## 6. AV arrangement persistence (c15310a6ed)
- Session save previously required a PDF (`if (!pdfMeta?.fileName || !pdfBuffer) return`), so AV arrangements (MusicXML-only) were never persisted.
- Fix: allow saving when either a PDF or a MusicXML source is present; AV arrangements restore as first-class scores (not legacy notation-only), landing on the saved view with no misleading PDF-import guidance. View-change persistence keys on the MusicXML source when no PDF exists.
- Verified: arrangement survives reload and reopens in the practice workspace (av-persist.mjs).

## 7. Remaining bugs
- None confirmed. Audio Vision arrangement latency variance (18s–300s) on loaded hardware is environmental.
- "Open in Corranzo Practice" lands on the import "score ready" state (consistent with PDF import flow; not a bug).

## 8. Reproduction evidence
- Browser back bug: `scripts/audit/history-debug.mjs` — `history.length` stayed at 2 after 4 in-app navigations; `goBack()` → `about:blank`. Fixed: increments per view; back/forward restore correct view.
- Test-infra bug: `npm test` on clean clone → ENOENT on `tmp/audio-vision-staging/piano.musicxml`. Fixed: runtime skip with actionable message.
- TAB structure: independent check 9/9 PASS.
- AV persistence: av-persist.mjs — arrangement now survives reload and reopens (workspace: true).

## 9. Regression tests added
- `tests/appViewHashRouting.test.js` (new, 8 tests)
- `tests/audioVisionMusicXmlSemantics.test.js` (new, 6 tests)
- `tests/audioArrangementMusicXml.test.js` — runtime skip when staging fixture absent

## 10. Browser test results
- `browser-practice-reliability-e2e`: 18/18 pass
- `browser-mobile-reliability-e2e`: 12/12 pass
- `browser-pdf-first-import-e2e`: 17/17 pass
- `browser-product-audio-e2e`: 12/12 pass
- `browser-practice-score-follow-e2e`: 17/17 pass
- `instrument-switch-isolation-e2e`: 11/11 pass
- `browser-audio-vision-edge-e2e`: 12/12 pass
- Custom audit (import, practice, library, AV, settings, timer, navigation, persistence, edge cases): no console/page errors.

## 11. Console/network errors
- No uncaught page errors or unexpected console errors in any audited flow.
- OMR `OMR FAILURE:` diagnostics appear only for intentionally rejected inputs (corrupt PDFs) — expected telemetry.

## 12. Changes deployed
- Commits `cb5843196b` + `a7865d583b` + `c15310a6ed` deployed via `wrangler deploy`.
- 7 new/modified assets uploaded; 195 reused.

## 13. Live Cloudflare deployment version
- Version ID: `18be664b-bf6e-4071-9db9-c2aab5812e3e`
- Verified live bundle: `index-CUe_-y4f.js` (matches build)
- All routes (`/`, `/privacy`, `/terms`, `/contact`) return HTTP 200.

## 14. Saved-data safety
- No data loss. Persistence changes allow NEW saves (AV arrangements) without affecting existing PDF-based sessions. PDF scores still save/restore (verified: pdf-first-import e2e 17/17).
- IndexedDB (`scoreflow-session`) and localStorage meta remain compatible.
- Browser-based audit used isolated profiles; no real saved library was touched.

## 15. Rollback instructions
- Previous live version ID: `30ff86b3-d5d7-4f63-af4f-bddb745deb30` (bundle `index-O8iLLTnM.js`)
- To roll back: `npx wrangler rollback 30ff86b3-d5d7-4f63-af4f-bddb745deb30` (or redeploy commit `cb5843196b`).
- Git rollback: `git revert c15310a6ed` (persistence) → `git revert a7865d583b` (AV) → `git revert cb5843196b` (navigation), then redeploy.

## 16. Ownership handoff (Practice Engine)
- **Safe checkout:** `/Users/ryland/Documents/scoreflow-product-preview` on `codex/unified-practice-audio-preview` (head `95180f4b25`).
- **Tracked changes:** NONE (0 modified tracked files). The "17 uncommitted files" were all untracked `tmp/` directories (e2e outputs) — harmless, not source changes.
- **Running processes:** none editing the product-preview source (all running vite processes belong to the bugfix worktree).
- **Practice Engine's code work** (perf rescue: render-loop fix `128a91388b`, mic live frame `7cb423b3ca`, tie-chain fix `41713fdaf2`) is already in the live deploy (`560bc5d1bd` is a descendant of all of them). Only a docs commit (`95180f4b25`) is unique to the preview branch.
- **Safe baseline for resuming:** `bugfix/site-bug-hunt` at `c15310a6ed` (or live deploy `18be664b...`), which includes the navigation fix + Audio Vision integration + AV persistence. Practice Engine should rebase/merge from it. Do not edit `src/features/audio-vision/arrangementMusicXml.js` without coordinating — TAB staff preservation is now part of the contract.
- **Audio Vision research** (`9648f75220`, `c9e5e9b23d`) remains on `codex/audio-to-solo-arrangement`; only the MusicXML-emission fix (`9648f75220`) was integrated. Do not merge the full Audio Vision branch (it removes the guitar TAB staff).

## 17. Highest-priority next bugs
- Audio Vision arrangement latency variance on loaded hardware (profiling needed).
- Audio Vision → Practice handoff requires an extra "Open score" click after "Open in Corranzo Practice" (UX, if product wants it).
- A `globalSetup` for the staging fixture would make `audioArrangementMusicXml.test.js` always run its full assertion.
- Browser Back/Forward now works; consider preserving scroll position across Back/Forward.

## Bug ledger (reproducible)
| Bug ID | Feature | Severity | Repro | Root cause | Fix status | Regression test |
|---|---|---|---|---|---|---|
| BH-001 | App navigation | P2 | Load app → click Library → Practice → Import → browser Back → lands on about:blank | `navigateToView` only pushed state when pathname changed; all app views used "/" | Fixed (cb5843196b) | tests/appViewHashRouting.test.js |
| BH-002 | Test infra | P3 | `npm test` on clean clone → audioArrangementMusicXml fails ENOENT | Test read non-committed staging fixture | Fixed (cb5843196b) | tests/audioArrangementMusicXml.test.js (runtime skip) |
| BH-003 | Audio Vision (MusicXML) | P1 | Guitar arrangement XML had no `<staves>2</staves>` / TAB clef (audio-vision branch removed them) | Audio Vision fix dropped the TAB staff to simplify measure emission | Fixed (a7865d583b) | tests/audioVisionMusicXmlSemantics.test.js + tabcheck (9/9) |
| BH-004 | Audio Vision (persistence) | P1 | Arrange audio → open in practice → reload → arrangement gone, lands on home | Session save required a PDF (`if (!pdfMeta?.fileName || !pdfBuffer) return`); AV arrangements (MusicXML-only) never saved | Fixed (c15310a6ed) | av-persist.mjs (arrangement survives reload) |