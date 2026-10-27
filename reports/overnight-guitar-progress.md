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

### Product branch: codex/guitar-vision-product @ ae3cb54fa4
- Ported all standalone fixes to src/features/vision/guitarTabCore.js
- Mixed: 21/21 conf, 4/4 meas; Standard: 16/24; Paired/Techniques/Sparse preserved
- All 4 guitarVisionRhythm.test.js tests pass
- Mixed fixture PDF updated to corrected stems version
- SMuFL rest glyph recognition added (U+E4E3-E4E7, 0 false positives)
- Rest counts reported in summary and analyzeNotationRhythm

## Unfinished milestones
1. Browser (Chromium/WebKit) verification: NOT run
2. Independent layout generalization: NOT done
3. Dot positive verification: NOT tested (only 0 false positives)
4. Ties/sustain/techniques: NOT implemented
5. Multiple voices: NOT implemented
6. Multi-page/TAB-only/scanned: NOT implemented
7. Integration handoff: NOT prepared

## Next executable steps
1. Run Playwright browser test on product module
2. Create dotted-note positive references and verify dot detection recall
3. Implement rest MusicXML emission (currently detection only)
4. Implement tie detection for same-pitch ties
5. Prepare integration patch spec

## Resource status
- Disk: 14 GiB free (above 5 GiB threshold)
