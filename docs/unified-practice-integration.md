# Unified practice integration (codex/unified-practice-integration)

ONE dev build with the redesigned Wait For You AND the repaired neural
microphone. Merged, not redesigned. Not merged into main.

## 1. Integration commit
- `76bfd3e909` merge of `codex/corranzo-mic-engine` (`636d27c316`) onto
  `codex/score-follow-wfy` (`a68cab5919`), both based on `origin/main`
  (`fcdb8d0172`). **Zero overlapping files** between the feature
  branches — the merge was clean with no conflict resolutions and
  neither feature was discarded or altered at merge time.
- Follow-ups on top: `2747a731ba` (I2 cursor lock), `287ead57fa`
  (unified MIDI e2e), `9ce0776cbe` (V3-accept fix + feedback hardening),
  `47bd96e73a` (unified mic e2e).

## 2. Features combined
- Practice UI: shared score cursor, blue/green/red/muted note states,
  chord partials, compact WFY dock, Play Along/Preview highlights.
- Mic engine: spectral V2/V3 listening, neural path (flagged off),
  readiness-gated routing, canonical mic events, all mic tests/tools.

## 3. Merge conflicts
None (disjoint file sets). Interaction points verified by reading, not
merging blindly: neural/spectral `inputFeedback` (incl. matchedIndices
Sets) flows into the new score-state overlay; evaluator untouched.

## 4. Fixes found and made during integration (with proof)
- **V3 single-note deadlock (product bug, affected real users):** V3 latches
  `consumed` on its first ACCEPT while the hook waits for 3 consecutive
  confirmations that can never arrive → "1/1 matched" forever. Reproduced
  on the mic branch WITHOUT integration code (same stall). Fix: a V3
  acceptance (attack authority + full matched set) commits immediately;
  V2-direct results keep the confirm path. Verified: sustained C4 now
  advances Prelude 1→2 of 479 with green trail, V3 default-ON.
- **matchedIndices type crash (mine):** array broke guidance `.has()` and
  remounted the practice tree via error boundary. Reverted to Set
  passthrough + defensive `missingLabels`.
- **Calibration vs digital silence:** fake-file leading silence read as a
  dead stream (NO_INPUT). Test fixtures now use soft room tone; product
  NO_INPUT behavior (correctly refuses dead capture) unchanged.
- **Retry-calibration button missing from the AX tree** (present, visible,
  clickable, zero role-query hits): documented product a11y finding.

## 5. Browser E2E results
- `scripts/browser-unified-practice-midi-e2e.mjs`: **26/26** (Menuet +
  Prelude; I2 cursor-lock Δ, duplicates single-award, pause/seek/loop,
  score-change reset to middle C, zero console errors).
- `scripts/browser-unified-practice-mic-e2e.mjs`: **23/23** (fake-audio
  piano WAVs through getUserMedia; spectral C4 advance + green,
  wrong-pitch heard-yet-refused, melody multi-advance + cursor travel,
  neural engage/progress/disable-resume, permission-denied guidance,
  Play Along timed events, model-404 honest unavailable + spectral
  fallback, zero console errors; 1 skip: neural engage timing;
  N tracked known-pre-existing update-depth warnings).
- Screenshots: `tmp/unified-practice-midi/`, `tmp/unified-practice-mic/`
  (inspected: green/blue/red states on real Bach/Mozart engraving).
- Mic-branch harness suites pass unmodified in this tree:
  `neuralLiveInjection` 4/4, `micPracticeIntegration` 5/5.

## 6. Score cursor accuracy (I2/I5)
- WFY cursor column now locks to the checkpoint's resolved notehead x
  (exact with OMR geometry, onset-mapped otherwise); y stays
  system-anchored. Verified live: Δ within tolerance vs highlight box.
- Documented fallback preserved: no OMR/default-x → time-proportional
  intra-measure glide; approximate highlights keep dashed treatment.
  Nothing invented, nothing hardcoded per score.

## 7. Play Along
Timeline cursor + current-event highlight; lane outcomes mapped by onset
(±11 ms); mic capture-clock events evaluated live (missed/completed
states appear on the score). Bounded 150/280 ms windows preserved.

## 8. Regressions
- `npm run build` ✓. `npm run test:scripts` ✓ exit 0.
- `npm test`: 7 deterministic pre-existing failures (UI-copy/CSS, same as
  main) + load-flakes (`finalMicLowNoteCorpus`, `scoreFollowMotionModel`,
  `sourceFaithfulZeroDefectBaseline` flip skip/fail/pass across
  identical-code runs; each passes in isolation in BOTH trees).
- `neuralLiveInjection` + `micPracticeIntegration` pair-run flake
  (order-dependent single failure, passes alone/together/serially):
  pre-existing timing sensitivity, unrelated to integration (harness
  never mounts the practice app).

## 9. Remaining limitations (honest)
- Mic wrong pitches are refused SILENTLY by design (latching WRONG would
  pause matching); red flash exists for MIDI. Guidance Hint still works.
- In-app neural `listening` phase is timing-sensitive headless (panel
  present; progress guaranteed via no-dead-path routing either way).
- WFY→PlayAlong mic transition within one session can starve the Play
  Along detector (direct entry works; needs engine-lifecycle follow-up).
- Slow-CPU throttle + offline-after-model-cache not automated (shared
  16 GB Mac; readiness gate is unit-covered, fallback proven via 404).
- Pre-existing playalong update-depth warnings (mic-branch baseline).

## 10. Ready?
Yes — for development playtesting of the combined build on this branch.
Musician testing with a real instrument + real room still required
before any release claims (neural stays experimental/off by default).

## 11. Launch
```
cd /Users/ryland/Documents/scoreflow-integration
npm run dev   # or: npm run build && vite preview
```
E2E: `node scripts/render-unified-mic-clips.mjs` once, then
`E2E_PORT=5399 node scripts/browser-unified-practice-midi-e2e.mjs`
`E2E_PORT=5397 node scripts/browser-unified-practice-mic-e2e.mjs`

## 12. Recommended next step
Fix the WFY→PlayAlong mic detector handoff (transition starves Play
Along detection; direct entry works), then re-run the combined suite.
After that: V3 piano acceptance tuning for decaying (non-sustained)
notes, and the Retry-calibration AX-tree fix.
