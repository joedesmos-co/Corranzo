# Guitar Vision Overnight Progress

## Completed milestones

### Standalone research branch: codex/guitar-vision @ 98d1eedf73
- 21/21 mixed complete timed onsets, 4/4 valid measures, 60/60 SF
- Standard: 16/16 eighths, 24/24 quarters, 40/40 onsets
- Paired: 116/116 SF, 32/32 onsets, 8/8 measures
- Techniques: 32/32, 8/8 measures
- Sparse: timing abstains (null)
- Conservative dot detection added (0 false positives)
- Diagnostic overlay + geometry JSON committed

### Product branch: codex/guitar-vision-product @ ac20d3fdf5
- Ported all standalone fixes to src/features/vision/guitarTabCore.js
- Mixed: 21/21 conf, 4/4 meas; Standard: 16/24; Paired/Techniques/Sparse preserved
- All 4 guitarVisionRhythm.test.js tests pass
- Mixed fixture PDF updated to corrected stems version (MD5 695b8fc327fbaccd74117f55fdbc0fc3)

### Root cause of product gap (15/21 -> 21/21)
centerProbe=true inflated stem tips -> flags fired incorrectly -> beam_flag_conflict
-> durations nulled -> measure 3 failed -> 6 onsets unconfident.
Fix: convention-only stem pairs + gap-bridged runs + edge-derived tips +
beam-connected scoring + min_run 1.4 + dot detection.

## Unfinished milestones
1. Browser (Chromium/WebKit) verification: NOT run
2. Independent layout generalization: NOT done
3. Rest recognition: NOT implemented (separate detectVectorRests.js module exists)
4. Dot positive verification: NOT tested (only 0 false positives)
5. Ties/sustain/techniques: NOT implemented
6. Multiple voices: NOT implemented
7. Integration handoff: NOT prepared

## Next executable steps
1. Run Playwright browser test: load product module in Chromium, verify recognition
2. Create dotted-note positive references
3. Implement rest detection in guitarTabCore.js (SMuFL rest glyphs U+E4E3-E4E7)
4. Prepare integration patch spec

## Resource status
- Disk: 14 GiB free (above 5 GiB threshold)
