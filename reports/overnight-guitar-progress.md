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

### Product branch: codex/guitar-vision-product @ 639da8b330
- Ported all standalone fixes to src/features/vision/guitarTabCore.js
- Mixed: 21/21 conf, 4/4 meas; Standard: 16/24; Paired/Techniques/Sparse preserved
- All 4 guitarVisionRhythm.test.js tests pass
- Mixed fixture PDF updated to corrected stems version
- SMuFL rest glyph recognition added (U+E4E3-E4E7, 0 false positives)
- Browser verification (Chromium): PASSED
  - Mixed: events 60, onsets 21, conf 21, meas 4/4, rests 0
  - Standard: rows 40, counts {1:24, 0.5:16}, rests 0

## BLOCKER: App-level import hang

The "Checking your score" hang on corranzo.com for a 5-page PDF with standard
notation + rhythmic slashes is NOT a guitarTabCore recognition issue. The core
correctly returns 21/21 on mixed and 0 rests/events on unsupported inputs.

The hang is in the app-level OMR pipeline:
- PdfOmrPlaybackPanel.handleGenerate -> runScorePreparation -> runPdfOmrClient
- runPdfOmrClient has a 120s per-page timeout (OMR_PAGE_TIMEOUT_MS)
- But if the worker crashes or the pipeline hangs before reaching the worker,
  the promise may never resolve/reject
- The "Checking your score" state in ImportScoreView shows when !ready
  (requires pdfState==='ready' AND timingReady, which requires musicXmlSource)

### Root cause hypothesis
The standard OMR pipeline (runPdfOmrPipeline) processes the PDF page-by-page.
For a 5-page PDF with standard notation + rhythmic slashes (no TAB), the pipeline
may:
1. Fail to find TAB staves -> no recognition -> should error, but may hang
2. Process all 5 pages sequentially with 120s timeout each = up to 10 min
3. The worker may crash on unsupported notation, leaving the promise unresolved

### Fix needed (NOT YET IMPLEMENTED)
1. Add overall timeout to runPdfOmrClient (not just per-page)
2. Ensure runPdfOmrPipeline rejects on unsupported input (no TAB staves found)
3. Ensure PdfOmrPlaybackPanel catch block fires and clears loading state
4. Add error recovery in ImportScoreView for OMR failures

### Why not fixed this session
- Requires running the actual app (dev server + browser) to reproduce
- The OMR pipeline code (runPdfOmrPipeline, worker) is complex and not testable in Node
- The fix is in app-level code, not guitarTabCore

### Next executable steps
1. Start dev server: `npm run dev` in scoreflow-guitar-product
2. Reproduce with a 5-page standard notation PDF
3. Add console.log/omrTrace to runPdfOmrPipeline to find hang point
4. Implement timeout + error recovery
5. Test in Chromium and Safari

## Unfinished milestones
1. Import hang fix: NOT done (blocker identified, fix not implemented)
2. Independent layout generalization: NOT done
3. Dot positive verification: NOT tested
4. Ties/sustain/techniques: NOT implemented
5. Multiple voices: NOT implemented
6. Multi-page/TAB-only/scanned: NOT implemented
7. Integration handoff: NOT prepared

## Resource status
- Disk: 14 GiB free (above 5 GiB threshold)
