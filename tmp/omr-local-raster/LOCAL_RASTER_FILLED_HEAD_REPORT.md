# Local raster filled-notehead campaign

- Starting HEAD: `beeb5f0` (`beeb5f066e7bdcb3043df5fa001c92abdadb0088`)
- Evaluator: frozen 2.0.0 / schema 2
- Scope: Phase 7A bounded local raster infrastructure and Phase 7C conservative filled heads only
- Status: **REVERTED — acceptance gate failed**

## Phase log

### Repository and artifact audit

- Confirmed HEAD is exactly `beeb5f0`.
- Confirmed tracked and staged production code is clean.
- Preserved pre-existing untracked `tmp/` artifacts and diagnostic scripts under `scripts/`; none are production inputs and none will be committed.
- Read the Phase 1 inventory, Phase 2 design, dense-ledger report, and prior component-recovery report in full. Parsed the complete 226-record JSON inventory.
- The inventory summary calls all 226 records `no-head-sized-component`, but the re-confirmation field contains 220 exact matches, 2 `component-outside-font-origin-range`, and 4 null reasons. The live runtime reason, not the summary label, will control the invocation gate. All seven high-extreme records retain the exact eligible reason.
- Rejected strategies remain absent: no optical profile, vector fragment clustering wire, oval body preservation, neighbor-body preservation, broad ledger non-suppression, or broad stacked ownership.

### Current architecture findings

- Vector PDF pages render at a 1000 px analysis width through `pdfPageAnalysis.js`.
- The PDF document proxy is keyed by content/identity, pinned for the full OMR run, and destroyed only after safe eviction. Page rendering currently returns an owned `ImageData`; it has no supersampled page-image cache.
- Browser recognition transfers the owned analysis buffer to one OMR worker. The worker runs synchronous `processOmrPageAnalysis`, including vector glyph mapping and `resolveNoteheadAnchor`.
- `resolveNoteheadAnchor` first estimates a font-aware metric anchor, classifies horizontal staff/local-ledger rows, masks thin ledger strokes, suppresses stem-like columns, and accepts one compact component. `no-head-sized-component` is returned before pitch mapping falls back to glyph metrics.
- Because eligible failures are known only after this synchronous pass, rendering a supersampled page before every analysis would violate the bounded invocation/cost requirements. The implementation candidate is a deterministic second page-analysis pass only when the first vector pass reports eligible recovery requests. The PDF remains pinned, one supersampled render is shared by all requests on that page, and the supplemental pixel buffer is released after that page.
- Raster-only and TAB-only paths do not enter vector notehead anchoring and will remain ineligible.

### Experiments

- Pure segmentation attempt 1: 29/31 focused cases passed. A down-stem clipped by the deliberately shallow lower crop escaped a full-length stem gate. The local vertical-run threshold was changed from 0.95 to 0.62 staff spaces while retaining the per-pixel thin-horizontal requirement, so compact body rows remain protected.
- The initial shared-body test expected one of two almost coincident origins to win. That contradicts the campaign's unambiguous-ownership rule; both candidates correctly rejected. The test now requires at most one owner and permits the correct all-ambiguous outcome. No ownership threshold was weakened.
- Dense production-path probe 1: one supersampled page was rendered and shared; 18 high-extreme anchor touches (10 unique requests in matched chords) invoked segmentation, zero were accepted, and all rejected as `no-confident-filled-body`. High-extreme remained 25% exact / 23 missing / 21 extra. This neutral attempt is retained only while diagnosing crop transforms/component features; no semantic claim is made.
- Dense component trace 2 reproduced the first raster-stage divergence. All seven high-extreme target crops clipped the candidate-position body at the left crop boundary, leaving only 0.35–0.43-space fragments, while intact neighboring heads remained farther right. The Phase 1 `recoverableLikely` flag counted non-empty ink rather than a complete owned body. The next isolated experiment keeps the crop area essentially unchanged, shifts its horizontal coverage from metric-center extents L0.55/R1.35 to L1.20/R0.80, and measures ownership from the actual glyph origin. Segmentation confidence thresholds are unchanged.
- Dense crop-origin experiment 3: the recentered crop produced 3 accepted anchors from 22 attempts (19 conservative rejections). Shared-page render cost was 32.4 ms; segmentation cost was 24.8 ms total (1.13 ms/attempt); all 22 crop buffers were released. One accepted high-extreme-position anchor moved to a raster optical center, but the high-extreme evaluator stayed at 25% exact and worsened from 23/21 to 24/22 missing/extra tones. Because an anchor firing without semantic correction is not useful, the hard acceptance gate failed. A frozen full-corpus measurement will be captured for safety evidence, then all runtime/test changes will be reverted.

## Baseline

Fresh commands at `beeb5f0`:

```text
node scripts/omr-semantic-corpus-eval.mjs --label local-raster-before --mode written --json tmp/omr-local-raster/baseline-semantic.json --text tmp/omr-local-raster/baseline-semantic.txt
node tmp/omr-high-extreme/build-high-extreme-baseline.mjs
```

- Frozen semantic corpus: 9/9 successful; evaluator 2.0.0/schema 2.
- Overall 69.4%, Pitch 72.3%, Rhythm 80.5%, Sustain 55.6%, Measure structure 77.3%.
- Incorrect pitch 168; incorrect chord 160; onset mismatch 113; duration mismatch 83; missing notes 72; extra notes 105.
- Guitar-standard Pitch/Rhythm: 86%/100%.
- High-extreme: 20 chords, 5 exact, **25% exact**, 15 incorrect, 23 missing tones, 21 extra tones.
- Low-extreme: **76.47% exact**, 6 missing tones, 2 extra tones.
- High-extreme anchor touches: 3 ink successes, 48 metric fallbacks; 39 fallbacks carry `no-head-sized-component`.
- The 67.12% aggregate quoted in an older generated high-extreme report is not the fresh `beeb5f0` result. The accepted dense-ledger report's ~72.3% Pitch/~80.5% Rhythm baseline is reproduced.

## Decision

**REVERT.** The recognizer did not improve high-extreme exact chord accuracy or missing tones. The best bounded experiment held exact accuracy at 25%, worsened high-extreme missing/extra tones from 23/21 to 24/22, and added one global incorrect-pitch defect. All runtime and test changes were removed. HEAD remains `beeb5f066e7bdcb3043df5fa001c92abdadb0088`; no commit was created.

## Tested runtime architecture (reverted)

The experiment used a two-pass vector-page path because eligibility is not known until ordinary vector and ledger-masked anchoring have both failed:

1. The normal 1000 px vector-page analysis collected requests only for existing Piano notehead glyphs on vector PDFs whose live rejection was exactly `no-head-sized-component` and whose staff/glyph/crop geometry was valid.
2. Requests were deduplicated and ordered deterministically by exterior-staff distance, page, glyph x/y, and candidate id. The page cap was 64.
3. One supersampled PDF page was rendered at the maximum requested local scale and shared by all crops on that page.
4. The same analysis page was run a second time with a page-owned recovery session. Browser-worker mode retained the first-pass analysis image and transferred one supplemental supersampled page buffer; direct mode reran synchronously.
5. Recovery could replace only the y anchor of its existing note candidate. It could not create events, alter timing/voice assignment, or enter raster-only/TAB paths.

The deterministic cache key was `document identity | page | scale (3 decimals) | rotation`. The per-run LRU held at most two page buffers, coalesced an in-flight render, dropped buffer references on eviction, and cleared before the pinned PDF document was released. The test implementation also cancelled an active PDF render on abort and released the render canvas after copying its `ImageData`.

The crop transform recorded source and raster bounds and supported 0/90/180/270-degree coordinate conversion. Segmentation itself conservatively rejected non-zero page rotation in this phase. Crop side was capped at 220 px; observed dense-page crops were 57×48–49 px at 2.114×.

## Segmentation and ownership tested (reverted)

- Foreground: alpha-composited luminance `<205`; no threshold expansion.
- Resolution: at least 5 raster pixels per staff space; target 28 px/staff-space.
- Known staff/ledger rows: only long runs at classified rows were eligible for masking. Thin row pixels were removed; vertically thick filled-body ink was retained.
- Stems: long vertical runs were removed only where the local horizontal extent remained thin.
- Component gate: width 0.40–1.18 spaces, height 0.24–0.82, area 0.10–0.68 space², density ≥0.42, origin distance ≤0.75.
- Confidence gate: ≥0.68 with ≥0.10 separation from a competing component.
- Ownership: the body had to be independently closest to its own glyph origin, could not overlap an already-owned body by more than 12%, and could not be assigned twice.
- Every rejection retained the existing metric anchor.

The original Phase 2 crop prior `(glyphX+0.55·gap, glyphY−0.51·gap)` with L0.55/R1.35 coverage clipped the target-position body on all seven high-extreme traces. A single evidence-backed experiment kept essentially the same crop width but shifted coverage to L1.20/R0.80 and evaluated ownership from the actual glyph origin. This recovered complete bodies, but the semantic result failed the gate. No confidence threshold was lowered.

## Seven high-extreme crop outcomes

All seven private crops were rendered and visually inspected. Images remain under `tmp/` and are not production/commit artifacts.

| Inventory candidate | Visual result | Raster result | Semantic outcome |
|---|---|---|---|
| m7 `x400.245 y679.677` G#5 | Compact body became complete after crop shift; another plausible body remained nearby | Rejected, confidence 0.544 <0.68 | Correct conservative rejection; chord stayed incorrect |
| m8 `x583.693 y679.677` G#5 | Head remained connected to dense neighboring ink/stem | Rejected, component 2.04×1.71 spaces | Correctly rejected as non-ownable; no chord correction |
| m8 `x599.592 y673.141` A#5 candidate | Small body evidence was far from both safe priors; visual chord expected F5/A5/C6 | Rejected, confidence 0.501, distance 0.716 | Correctly rejected; no missing-tone correction |
| m8 `x617.141 y679.677` G#5 | Several bodies remained one 2.04×1.18-space connected component | Rejected | Correctly rejected as ambiguous stacked ownership |
| m9 `x798.546 y679.677` G5 | Compact 0.86×0.57-space body selected at y=673.38 | **Accepted**, confidence 0.818 | Fired but did not correct an exact chord; high-extreme missing/extra totals worsened, so counted wrong/non-useful |
| m9 `x816.487 y673.141` A#5 | Plausible 0.93×0.71-space body, but competition/shape evidence was insufficient | Rejected, confidence 0.588 | Correct conservative rejection; no correction |
| m9 `x834.428 y679.677` G#5 | Plausible 1.04×0.68-space body with competing ink | Rejected, confidence 0.518 | Correct conservative rejection; no correction |

No target crop corrected a wrong pitch or a missing tone. One target fired and left the chord incorrect; six correctly fell back.

## Before / candidate / reverted metrics

| Metric | `beeb5f0` before | Best raster candidate | After required revert |
|---|---:|---:|---:|
| High-extreme exact chord accuracy | 25% (5/20) | 25% (5/20) | 25% (5/20) |
| High-extreme missing tones | 23 | **24** | 23 |
| High-extreme extra tones | 21 | **22** | 21 |
| Low-extreme exact | 76.47% | 76.47% | 76.47% |
| Low-extreme missing | 6 | 6 | 6 |
| Guitar-standard Pitch / Rhythm | 86% / 100% | 86% / 100% | 86% / 100% |
| Global Pitch | 72.329% | 72.291% | 72.329% |
| Global Rhythm | 80.468% | 80.516% | 80.468% |
| Overall | 69.439% | 69.492% | 69.439% |
| Incorrect pitch | 168 | **169** | 168 |
| Incorrect chord | 160 | 160 | 160 |
| Missing notes | 72 | 72 | 72 |
| Extra notes | 105 | 105 | 105 |

The small aggregate Overall/Rhythm movements did not satisfy the primary semantic gate and cannot offset the added pitch defect and worsened high-extreme tone counts.

## Raster diagnostics and false-positive analysis

Dense target page:

- Crops/page and attempts: 22 / 22 (limit not reached)
- Accepted anchors: 3
- Correct/useful anchors: 0
- Wrong anchors: 2 (one directly added an incorrect pitch; one contributed to the worsened high-extreme result)
- Neutral/non-material anchors: 1
- Rejections and metric fallbacks: 19 / 19
- Cleanup count: 22/22 crop buffers
- Cache: 1 page miss, 0 page-level LRU hits, 21 shared-crop reuses
- Page rasterization: 32.4 ms
- Crop segmentation: 24.8 ms total, 1.13 ms/crop

The three accepts were `p1:m2:x284.730:y310.429`, `p1:m9:x780.605:y686.212`, and the target `p1:m9:x798.546:y679.677`. The m2 accept changed an already wrong chord to another wrong pitch. The two dense high-register accepts produced no exact-chord gain and the high-extreme run gained one missing and one extra tone. This shows that locating a compact rendered body is not sufficient evidence that its optical center is the semantically correct pitch anchor in these font/chord layouts.

## Performance and cleanup evidence

- Dense page phase in the raster run: 990 ms; paired post-revert run: 491 ms. This diagnostic indicates roughly one extra analysis pass (~499 ms, about 2× page time), despite rasterization and segmentation themselves totaling only ~57 ms.
- Supersampled dense page buffer: approximately 2114×2735×4 ≈ 23.1 MB. Peak process memory was not instrumented; a transient render canvas plus copied `ImageData` can roughly double that incremental allocation before canvas release.
- No crop exceeded 220 px; the 64-attempt limiter, deterministic ordering, cache reuse/eviction/clear, cancellation, and per-crop cleanup tests passed.
- Focused suite before rejection: 31/31 local-raster tests passed. With protected anchor/cache tests: 68/68 passed.
- Post-revert protected tests: 37/37 passed.

The near-doubling of dense-page time would require stronger semantic value even if the accuracy gate had passed. It did not.

## Files temporarily changed, then reverted

- `src/features/omr/localRasterNoteheadRecovery.js` (added, removed)
- `src/features/omr/localRasterPageCache.js` (added, removed)
- `src/features/omr/pitchFromStaffPosition.js`
- `src/features/omr/processVectorOmrPage.js`
- `src/features/omr/processOmrPage.js`
- `src/features/omr/runPdfOmrPipeline.js`
- `src/features/omr/runPdfOmrClient.js`
- `src/features/omr/omr.worker.js`
- `src/features/score-follow/pdfPageAnalysis.js`
- `tests/omrLocalRasterFilledHead.test.js` (added, removed)

There are no surviving changes under `src/` or `tests/`.

## Tests exercised by the temporary focused suite

The 31-case temporary suite covered the required filled-head/ledger combinations, up/down stems, beam/slur/accidental proximity, thin vector fragments with raster bodies, distinct stacked origins, double-assignment and ambiguous ownership rejection, artifact/empty/low-confidence rejection, reliable-vector and raster-only gates, rotated/scaled crop transforms, page-cache reuse, the 64-attempt limit, cancellation and crop cleanup, timing/voice immutability, low-register exclusion, and Guitar/TAB exclusion. It was removed with the rejected runtime implementation as required.

## Commands and final state

```text
node scripts/omr-semantic-corpus-eval.mjs --label local-raster-before ...
node tmp/omr-high-extreme/build-high-extreme-baseline.mjs
npx vitest run tests/omrLocalRasterFilledHead.test.js tests/omrFontAwarePitchAnchor.test.js tests/omrDenseLedgerClassifier.test.js tests/pdfAnalysisCacheKey.test.js tests/omrPipelineStageDiagnostics.test.js
node tmp/omr-local-raster/probe-dense-local-raster.mjs
node tmp/omr-local-raster/run-semantic-with-raster.mjs --label local-raster-after ...
node tmp/omr-local-raster/run-high-extreme-with-raster.mjs
node scripts/omr-semantic-corpus-eval.mjs --label local-raster-reverted ...
node tmp/omr-high-extreme/build-high-extreme-baseline.mjs
npx vitest run tests/omrFontAwarePitchAnchor.test.js tests/omrDenseLedgerClassifier.test.js tests/pdfAnalysisCacheKey.test.js tests/omrPipelineStageDiagnostics.test.js
```

Final frozen corpus after revert: 9/9, evaluator 2.0.0/schema 2, metrics exactly restored. Production build, full unit suite, Guitar/TAB, microphone, playback/audio, ownership/switching, export, and heavy-score harness were not rerun after the rejection because the candidate was removed before those acceptance-only validations; production is the unchanged accepted `beeb5f0` tree.

## Deferred work

Open-notehead segmentation and full stacked ownership remain deferred exactly as scoped. A future raster campaign should first establish candidate-to-rendered-body truth for the dense font layouts and avoid a full second page-analysis pass. The rejected crop-shift/confidence approach should not be revived without new semantic evidence.
