# Integration + deployment plan (Score Following → live website)

Status: **DEPLOYED 2026-10-15.** Live: `https://corranzo.com` (Cloudflare
version `6aecf1c1-abda-4d9e-9ca3-1d0f01dcc9a0`), rollback target
`5a2de273-8c2d-4943-96b6-3392624c846c`.

## Topology (verified, read-only)

```
main                     fcdb8d0172   ← official main, never merged to
 └── … 92 commits …      bad9f98e18   ← score-follow final acceptance (merge-base)
      ├── preview        579650eee2   codex/unified-practice-audio-preview  ← DEPLOYED
      │                                 (product + practice-clock fix + ported tie fix
      │                                  + this integration: timing validation, WFY
      │                                  fallback, timing warnings, 3 repaired fixtures)
      └── research       b680fc5cdd   codex/score-follow-precision  (my 8 commits)
```

**Live before this release:** a Cloudflare deployment from **2026-10-08**
(`5a2de273`) — verified in the live bundle that the timing-warning string
had 0 occurrences and the preview's "Note guide" mode 0 occurrences.

**Deployment process (established):** `npm run build` then
`npx wrangler deploy` in the source tree (worker `corranzo`, assets from
`./dist`, `wrangler.toml`).

## What was integrated (the remaining verified Score Following work)

The Practice Engine had already ported the **tie-chain duration fix**
(`41713fdaf2`, both parser and checkpoint layers) and the **practice-clock
render-loop repair** (`128a91388b` + guard test `2f9750da6e`). This release
added only what was still missing, so no fix was applied twice:

- `src/features/musicxml/timingValidation.js` — automatic timing validation
  (overfull/unvoiced-flattened/voiced-without-backup/voiced-with-backup)
- `parseMusicXml.js` plumbing: `partMeasureNoteEnds` + `notatedNoteEndQuarters`
  + `voiceDefaulted` (the last also used by the ported tie fix)
- `waitForYouCheckpoints.js`: `splitCrossWrittenMeasureGroups` — the honest
  per-written-measure WFY fallback that prevents impossible requirements on
  flagged scores (grand-staff chords stay merged, valid scores untouched)
- user-facing timing warnings: `useWaitForYou` `timingNotice` +
  `WaitForYouSection` notice (live string: "This score's file has N measures
  with more notes than fit…")
- `canonicalTimingContract.js`: `describeSourceFidelity` reports
  `timing-invalid:overfull-measures:N`
- `scoreFollowPrecisionDiagnostics.js`: barline-dust rule (a checkpoint within
  11 ms of its own written window start is dust, not split-brain overflow)
- 3 repaired practice-library fixtures with provenance (BWV 846 prelude,
  Aguado a-minor, BWV 999) — the other 13 flagged files stay flagged
- tests + harnesses: `timingValidation.test.js`, `tieDurationIntegrity.test.js`,
  `measure-tie-duration-integrity.mjs`, `measure-unseen-score-acceptance.mjs`,
  `measure-holdout-pdf-acceptance.mjs`, `verify-live-deployment.mjs`

Merge: `codex/score-follow-precision` → `codex/unified-practice-audio-preview`
(`579650eee2`). Two additive conflicts, both resolved keeping both features
(preview's `pedalSpans` + research's `partMeasureNoteEnds`; kept the preview's
update-depth tracking in the cross-engraving harness with the `return` its own
comment already describes). The resulting tree is byte-identical
(`4a8ff89fd8…`) to the integration verified in the score-follow worktree.
Official main was not touched.

## Verification matrix (all green on the integrated tree)

| check | result |
|---|---|
| unit suite (`vitest run`, 5 heavy neural browser suites excluded for memory) | **3771 passed / 0 failed** |
| `npm run build` | green |
| `npm run test:scripts` | green |
| `browser-pdf-first-import-e2e` (PDF import, render, playback, session save/restore, legacy restore) | **17/17** |
| `browser-practice-score-follow-e2e` (Preview, WFY, Play Along, cursor, transitions) | **17/17** |
| `browser-unified-practice-midi-e2e` (MIDI WFY, transport, seek, loop, score change) | **26/26** |
| `browser-unified-practice-mic-e2e` (mic init, real clips) | **23/23** (1 skipped), 0 warnings |
| `browser-tempo-acceptance-e2e` | **5/5** |
| `browser-cross-engraving-e2e` (real PDF pairs, WFY lock, seek/zoom) | **7/7** |
| `browser-score-follow-precision-e2e` (pixel onset lock) | **9/9** |
| `browser-engraved-arrangement-e2e` (Audio Vision engraved practice, WFY advance) | **11/11** |
| `measure-tie-duration-integrity` | **11/11** |
| `measure-unseen-score-acceptance` (incl. holdout PDFs) | **35/35** |
| `measure-score-follow-precision` (24 scores) | **24/24**, 0 wrong-page/system/NaN/teleports |
| `measure-cross-engraving` (2 real PDF pairs) | 0.0105 / 0.0208 page, overflow 0 |
| **live deployment verification** (`verify-live-deployment.mjs` against corranzo.com) | **8/8** |

## React "Maximum update depth" — resolved, verified effective

The Practice Engine repaired the render loop (`128a91388b`) and added a guard
that asserts the failing invariant (`tests/practiceClockIdentity.test.js`).
On the integrated and deployed tree the PDF-first-import and cross-engraving
browser suites both report **"no update-depth warning in this run"**, and the
practice/mic suites report 0 occurrences. Nothing is suppressed: the
cross-engraving harness still tracks and reports any occurrence.

## Audio Vision compatibility

The Audio Vision arrangement generator emits measures that notate more content
than the time signature holds, so both targets are correctly flagged
`timingValidation: invalid`. No practice regression: checkpoint counts
unchanged (8/8), **0 impossible cross-measure requirements**, TAB mirrors
preserved (9/9), written duration preserved. The engraved-arrangement browser
flow passes 11/11 including WFY advancing on the correct note.
**Upstream handoff (Audio Vision owner):** fix the generator's measure packing
so bar N's content fits bar N's time signature — the follow layer flags it
honestly rather than guessing.

## Saved-data safety

No storage-schema changes. Session save/restore, legacy restore, and
PDF-identity persistence suites pass; `verify-live-deployment` confirms
localStorage state persists and restores on the live site. Nothing was
deleted or migrated.

## Rollback

Wrangler keeps versions. Current live: `6aecf1c1-abda-4d9e-9ca3-1d0f01dcc9a0`.
To roll back:
```
npx wrangler deployments list          # find the version id
npx wrangler rollback 5a2de273-8c2d-4943-96b6-3392624c846c
```
The code rollback is `git revert 579650eee2` on the preview branch
(the integration is a single merge commit).

## What to test personally on https://corranzo.com

1. **PDF import** (Import → choose a PDF, optionally a matching MusicXML in
   Advanced) — the PDF should render and open in Practice.
2. **Preview** — press Play; the cursor should follow and Pause freezes it.
3. **Wait For You** with a MIDI keyboard — correct/wrong/partial-chord notes,
   and that a chord keeps all required boxes.
4. **Tied notes** — a tied pair should behave as one long note (one required
   box; the sustain bar spans both written notes).
5. A score from the library that is **flagged** (e.g. Chopin mazurka, Aguado
   op03-*, Tchaikovsky) — WFY should ask for one measure's notes at a time and
   show the "more notes than fit" notice, instead of requiring two measures at
   once.
6. **Saved scores** — open a score, reload the page, and confirm it restores.
