# Corranzo Stable Release Consolidation — Final Report

## 1. Verified live commit/version
- **Live Cloudflare version ID:** `50b609d4-2834-485f-86c5-8fce88fe6eb4`
- **Live bundle hash:** `index-Czbeq01m.js`
- **Source commit of deployed bundle:** `6d8adbbb88` ("fix(navigation): preserve query params across view changes")
- **Verified:** `curl https://corranzo.com/` returns the bundle hash above; all routes (`/`, `/privacy`, `/terms`, `/contact`) return HTTP 200.

## 2. Updated main commit
- **Official main:** `6d8adbbb88` (fast-forwarded from `fcdb8d0172`, 145 commits, no force-push)
- **origin/main:** `6d8adbbb88` (pushed successfully)
- **Method:** `git merge --ff-only 6d8adbbb88` (ancestry permitted fast-forward; no history rewritten)

## 3. Production/main differences
- **None.** Main (`6d8adbbb88`) now matches the live deployment exactly.
- The 2 tracked modifications in the main worktree (`PracticeSessionContext.jsx`, `usePracticeSession.js`) were stashed (`stash@{0}: protect-practice-engine-wip-modifications`) to protect them. They are an in-progress Practice Engine adaptation to the new session provider API and can be reviewed/applied by the Practice Engine agent.

## 4. Tests passed
- Build: ✓ (`vite build`, 1.20s)
- Essential unit tests: 71/71 (appViewHashRouting 8, audioVisionMusicXmlSemantics 6, sessionRestoreRouting 7, sessionViewPersistence 4, practiceClock 3, practiceClockIdentity 3, practiceEngineCorrectness 36, neuralMicIdleGuard 3)
- Browser e2e: practice-reliability 18/18, pdf-first-import 17/17, audio-vision-edge 12/12, practice-score-follow 17/17
- No console/page errors in any audited flow.

## 5. Production contents verified (from implementation)
- PDF-first importing ✓ (browser-pdf-first-import-e2e 17/17)
- Score Following timing fixes ✓ (cursorMotionTimeline, wfyCheckpointCursor present)
- Tie duration fixes ✓ (tieDurationIntegrity tests pass)
- WFY timing validation ✓ (waitForYouCheckpoints, wfyCheckpointCursor)
- Practice Engine render-loop repair ✓ (128a91388b in ancestry)
- Latest Practice Engine optimization ✓ (956ee6a0bc, 65b92119ae in main via cherry-pick)
- Sound Engine sample/license fixes ✓ (c4940fd6f9 in ancestry)
- Audio Vision MusicXML corrections ✓ (arrangementMusicXml.js has TAB + fixes)
- Audio Vision arrangement persistence ✓ (sessionPersistence allows MusicXML-only saves)
- Standard guitar notation + TAB ✓ (9/9 independent structure check)
- Browser Back/Forward navigation ✓ (hash routing, appViewHashRouting 8/8)
- Saved-score restoration ✓ (pdf-first-import e2e restore passes)
- MIDI and microphone practice ✓ (practice-reliability e2e 18/18)

## 6. Changes still needing integration
- None. All verified stable changes are in main.
- The Practice Engine's perf work is already in main (via cherry-picks c25f0c7e9e, d755cbe893).
- The Audio Vision MusicXML fix (9648f75220) is integrated (a7865d583b).

## 7. Experimental research to preserve
- **Piano Vision:** `codex/piano-truth-unblock` (197 unique commits, 12 tracked dirty) — DO NOT MERGE (unfinished research). Worktree: scoreflow-piano-unblock.
- **Guitar Vision:** `codex/guitar-vision` (206 unique commits, 13 tracked dirty) — DO NOT MERGE. Worktree: scoreflow-guitar.
- **Audio Vision research:** `codex/audio-to-solo-arrangement` (3 unique commits: 9648f75220 integrated, c9e5e9b23d/cb48fcea5a docs) — worktree: scoreflow-audio-vision (5 tracked dirty, active agent).
- **Mic reliability research:** `codex/neural-mic-reliability` (4 unique commits) — potentially valuable but unverified. Worktree: scoreflow-mic-reliability.
- **Sound Engine research:** `codex/notation-aware-audio` (0 unique, fully merged). Worktree: scoreflow-sound-engine (clean).

## 8. Worktrees safe to retire
| Worktree | Branch | Unique commits | Tracked dirty | Node modules | Recommendation |
|---|---|---|---|---|---|
| scoreflow-audio-vision-staging | codex/audio-vision-product-staging | 0 | 0 | 710M | **Safe to retire** — fully merged, only untracked tmp/ |
| scoreflow-mic-engine | codex/corranzo-mic-engine | 0 | 0 | 710M | **Safe to retire** — fully merged |
| scoreflow-practice-ui | codex/score-follow-wfy | 0 | 0 | 402M | **Safe to retire** — fully merged |
| scoreflow-sound-engine | codex/notation-aware-audio | 0 | 0 | 402M | **Safe to retire** — fully merged |
| scoreflow-bughunt | bugfix/site-bug-hunt | 0 (merged) | 0 | 818M | **Safe to retire** — my own work, fully merged into main |
| scoreflow-integration | codex/unified-practice-integration | 1 (test harness) | 0 | 710M | Safe after archiving the 1 test commit |
| scoreflow-product-preview | codex/unified-practice-audio-preview | 4 (all in main via cherry-pick) | 0 | 789M | **Keep** — Practice Engine active (17 untracked tmp/ only) |
| scoreflow-scorefollow-precision | release-sound-and-av | 1 (docs) | 4 | 917M | **Keep** — scorefollow agent active |
| scoreflow-audio-vision | codex/audio-to-solo-arrangement | 3 (code fix integrated) | 5 | 710M | **Keep** — Audio Vision agent active |
| scoreflow-guitar | codex/guitar-vision | 206 | 13 | 399M | **Must preserve** — Guitar Vision research |
| scoreflow-piano-unblock | codex/piano-truth-unblock | 197 | 12 | none | **Must preserve** — Piano Vision research |
| scoreflow-mic-reliability | codex/neural-mic-reliability | 4 | 0 | 710M | **Keep** — mic research (potentially valuable, unverified) |

## 9. Estimated recoverable storage
- **Immediately safe (unique commits = 0, no tracked changes):** ~3.0 GB (audio-vision-staging 710M + mic-engine 710M + practice-ui 402M + sound-engine 402M + bughunt 818M)
- **Safe after archiving:** integration (710M) — archive the 1 test commit first
- **Requires user approval:** mic-reliability (710M) — 4 unique mic research commits
- **Must preserve:** guitar (399M), piano-unblock (no nm), audio-vision (710M, active), product-preview (789M, active), scorefollow-precision (917M, active)
- **Do not touch:** 28 GB Git pack, 6.2 GB preservation backup (`corranzo-preservation-2026-10-08`)

## 10. Remaining risks
- The 2 stashed modifications in the main worktree (`stash@{0}`) are an in-progress Practice Engine adaptation. The Practice Engine agent should review and re-apply them on the new main.
- The mic-reliability research (4 commits) has not been verified or integrated. The mic agent should confirm whether it should be merged.
- The integration worktree's 1 unique test commit (`305b6aec2b`) should be reviewed for value before retirement.
- Disk is 96% full (9.3 GB free). Retiring the 5 immediately-safe worktrees would recover ~3.0 GB.

## Recommended cleanup order
1. Retire `scoreflow-sound-engine` (0 unique, clean, 402M) — lowest risk.
2. Retire `scoreflow-practice-ui` (0 unique, clean, 402M).
3. Retire `scoreflow-mic-engine` (0 unique, clean, 710M).
4. Retire `scoreflow-audio-vision-staging` (0 unique, clean, 710M) — archive the 10 untracked tmp/ dirs first.
5. Retire `scoreflow-bughunt` (0 unique vs main, clean tracked, 818M) — my own worktree, fully merged.
6. Archive then retire `scoreflow-integration` (1 test commit, 710M).
7. Defer `scoreflow-mic-reliability` (4 unique mic commits) — pending mic agent review.
8. Preserve `scoreflow-guitar`, `scoreflow-piano-unblock`, `scoreflow-audio-vision`, `scoreflow-product-preview`, `scoreflow-scorefollow-precision` (active research).

## Verification command
```
git -C /Users/ryland/Documents/scoreflow log -1 --format='%H'  # 6d8adbbb88...
curl -s https://corranzo.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'  # index-Czbeq01m.js
```