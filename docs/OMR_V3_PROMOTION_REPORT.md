# Corranzo OMR V3 Promotion Report

Date: 2026-07-16

Branch: `codex/omr-v3-promotion`

## Executive result

This sprint promoted the existing OMR V3 architecture without redesigning it. The PDF-first product path is now explicit and verified:

```text
Upload PDF
  -> Setting up your music...
  -> Ready to practice
```

The original ten enforced benchmark policies still pass 10/10, and every frozen recognition metric is unchanged from the Phase 0 baseline. No confidence threshold was lowered, no benchmark-specific recognition rule was added, and the V3 transcription shadow remains non-promoted.

The pipeline is more conservative, more recoverable, and less wasteful. It reuses the uploaded PDF bytes, overlaps independent PDF work, retries a failed recognition worker once, preserves good digital pages byte-for-byte through preprocessing, reasons about confidence with V3 structure, and can retain healthy pages when another page fails.

The literal “almost any clean PDF” objective is not yet fully met. A clean orchestral full score and dense advanced piano engraving were safely rejected in the real-PDF stress run. A historical scan exposed the opposite risk: decorative cover and border content can be accepted as false music. These outcomes are recorded as limitations, not successes.

## Improvements made

### 1. Import pipeline

- Reused the already-owned upload bytes and original PDF blob instead of fetching and replacing the same PDF after OMR.
- Began page text extraction while the rendered page is being prepared, avoiding a serial wait between independent operations.
- Added one fresh-worker retry for a failed recognition page. The retry does not bypass recognition policy or confidence gates.
- Kept the product flow automatic; MusicXML, timing, and MIDI are optional supporting inputs rather than required conversion steps.
- Updated user-visible progress to the requested “Setting up your music...” and “Ready to practice” language.

### 2. Conservative page preprocessing

- Added sampled page statistics, content bounds, paper-tone and contrast analysis, and a stricter scan classifier.
- Added bounded contrast normalization, paper-background cleanup, isolated-speck removal, faint staff-line enhancement, and projection-based deskew.
- Deskew is limited to a small search range and applies only when the projection improvement is material.
- Clean digital pages take a zero-copy pass-through path; no cleanup is applied and their pixel buffer is unchanged.

### 3. Structural recovery

- Added conservative recovery for incomplete staff groups using compatible neighboring systems and page evidence.
- Added sparse missing-barline inference only when surrounding measure geometry and multi-staff support agree.
- Marked inferred structure in the V3 IR so downstream confidence can penalize it rather than treating it as observed fact.

### 4. Confidence reasoning

- Replaced the production document-level arithmetic mean with a V3 hierarchical bottleneck model.
- The model uses page structure, system-neighbor continuity, barline and measure-width consistency, expected staff participation, rhythmic validity, voice overlap constraints, and lower-tail measure quality.
- Weighted geometric means and lower quantiles make a damaged region visible instead of allowing many strong regions to average it away.
- The existing detector confidence remains the base value and is only calibrated within a bounded `0.9–1.1` multiplier. Existing acceptance thresholds are unchanged.
- Across the original fifteen recognized fixtures, confidence moved from `min 0.6000 / median 0.8523 / mean 0.8150 / max 0.8650` to `min 0.6341 / median 0.8812 / mean 0.8433 / max 0.9478`. The important change is differentiation: for example, the articulation scan moved from `0.6265` to `0.6595`, while the structurally inconsistent paired-guitar fixture moved from the old `0.8650` ceiling to `0.8374`.

### 5. Partial import recovery

- Isolated recoverable page recognition errors instead of aborting the whole document immediately.
- Healthy recognized pages continue into document assembly when at least one page remains usable.
- Diagnostics record failed page indexes, retry outcomes, recovery counts, and reasons.
- The pipeline still fails safely when the retained document has no systems, no usable notes, or does not satisfy the existing confidence policy.

### 6. Performance and diagnostics

- Removed the renderer-to-pipeline full-page RGBA copy and the clean-page preprocessing copy.
- A representative `1000 × 1294` page now avoids two `5,176,000`-byte copies, about `9.87 MiB` of transient copying per clean page.
- Reused the single V3 analysis document for confidence and shadow diagnostics instead of rebuilding equivalent structure.
- Added phase timing and partial-recovery data to OMR diagnostics without retaining page pixel buffers.
- The dashboard renderer now honors a fixture page cap before rendering, so the 151-page orchestral score exercises two pages instead of allocating all 151.

### 7. Real-PDF stress coverage

The dashboard grew from 16 to 20 fixtures. Four new real-PDF diagnostics cover public-domain orchestra, dense engraved piano, a historical scan, and a local beginner workbook. They are import-only and excluded from accuracy policy because they do not have independently verified symbolic truth.

| Stress PDF | Result | Confidence | Interpretation |
| --- | --- | ---: | --- |
| Beethoven Symphony No. 7, full score | safe rejection | 0.6391 | Multi-instrument staff grouping remains too ambiguous. |
| Beethoven Pathétique, movement 1 | safe rejection | 0.6545 | Dense chords, beams, ornamentation, and voices remain unsafe. |
| *Twinkle, Twinkle Little Stars* (1880 scan) | output emitted | 0.6212 | Visual QA found false structure from the cover/borders; this is an unsafe-acceptance risk, not a recognition success. |
| Local beginner themes workbook | output emitted | 0.9055 | Import completion is established, but note accuracy is unverified. |

Provenance, checksums, redistribution limits, page renders, and the category audit are documented in [OMR_V3_STRESS_CORPUS.md](./OMR_V3_STRESS_CORPUS.md).

## Benchmark comparison

### Policy and recognition

| Metric | Phase 0 baseline | Promotion verification | Change |
| --- | ---: | ---: | ---: |
| Original manifest fixtures | 16 | 16 comparable | — |
| Enforced policy pass rate | 10/10 (100%) | 10/10 (100%) | none |
| Enforced fixture failures/errors | 0/0 | 0/0 | none |
| Imports reaching a deterministic terminal outcome | 16/16 | 16/16 | none |
| Imports producing recognized playback | 15/16 | 15/16 | none |
| Pitch accuracy | 28.82% | 28.82% | exact |
| Duration accuracy | 56.41% | 56.41% | exact |
| Onset accuracy | 57.89% | 57.89% | exact |
| Chord grouping accuracy | 62.32% | 62.32% | exact |
| Note detection F1 | 74.84% | 74.84% | exact |
| Aggregate absolute measure-count error | 25 | 25 | exact |

The final expanded dashboard contains 20 fixtures: 10 pass, 10 diagnostic-only skip, 0 fail, 0 rejected, and 0 error. “Skipped” means non-blocking evidence, not a successful recognition claim.

### V3 promotion gate

The V3 transcription shadow remains `shadow-only`. Two enforced fixtures improve on at least one truth metric and six regress. Runtime promotion remains disabled. This preserves benchmark behavior and prevents an architecture-promotion sprint from silently becoming a recognition rewrite.

## Import speed comparison

All timings are wall time on the same development machine and should be treated as comparative local measurements, not service-level guarantees.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Comparable 16-fixture dashboard | 16.40 s | 15.81 s | -0.59 s (-3.6%) |
| Expanded 20-fixture final dashboard | — | 19.67 s | not directly comparable; four real PDFs were added |
| Browser smoke, simple clean PDF to Practice | — | 200 ms | product-path observation |

Accuracy was not traded for the comparable speed gain: the ten enforced core metric objects match the baseline exactly.

## Final verification

| Verification | Result |
| --- | --- |
| `npm test` | PASS — 235 files; 2,315 passed, 5 skipped |
| `npm run build` | PASS — Vite production build completed |
| `npm run omr:benchmark-dashboard` | PASS — 20 fixtures; 10 pass, 10 diagnostic skip, no failures/errors |
| Browser QA | PASS — automatic PDF copy and optional timing/MIDI copy inspected; no browser console errors |
| Browser smoke | PASS — 19/19 checks, automatic PDF setup observed, Practice reached, no uncaught errors |
| Responsive smoke | PASS — no horizontal overflow at desktop, iPad, or mobile widths |
| PDF visual QA | PASS — opening pages of all vendored stress PDFs rendered and inspected |
| Fixture integrity | PASS — all present SHA-256 fixture checksums verified |
| `git diff --check` | PASS |

The test run retains existing non-fatal pdf.js font-data and React test warnings. The production build retains the existing large-main-chunk warning; neither caused a test or build failure.

## Remaining weaknesses

1. **Orchestral structure:** instrument groups and large multi-staff systems are not recovered reliably enough for practice output.
2. **Dense piano:** beamed subdivisions, ornamentation, chord grouping, and multiple voices still compound into safe rejection.
3. **Non-musical scanned regions:** covers, borders, page edges, and typography can resemble staff structure. This is the highest-priority safety issue because it can produce plausible-looking false output.
4. **Paired notation/TAB scans:** string/fret recovery remains an honest rejection on the enforced scan fixture.
5. **Recognition accuracy:** the unchanged macro pitch accuracy of 28.82% means benchmark pass policy must not be conflated with note-perfect transcription.
6. **Confidence calibration:** structure-aware confidence is materially better differentiated but is not a substitute for truth-labeled calibration across real publishers and scan conditions.
7. **Partial recovery granularity:** isolation is page-level. A single damaged system on an otherwise valid page can still poison the page or document result.
8. **Real-score truth:** the added public-domain PDFs broaden import evidence but lack verified MusicXML truth, so they cannot support accuracy claims.

## Recommendations

1. Add a conservative non-musical-page and decorative-border classifier before staff recognition, with an explicit “no music on this page” outcome.
2. Build truth-labeled, redistribution-safe orchestral and dense-piano slices before changing staff grouping or voice logic.
3. Extend partial recovery from pages to V3 systems, preserving system ownership and emitting explicit damaged-region diagnostics.
4. Calibrate V3 confidence against truth-labeled real PDFs by category; keep the current thresholds fixed until false-accept and false-reject curves justify a policy change.
5. Continue the existing shadow-first rollout for voice-aware serialization. Do not promote while six enforced fixtures regress.
6. Add cold-device and multi-page latency budgets to CI once representative browser hardware is selected.
7. Split the main application chunk separately from OMR work; the build warning is not an OMR accuracy issue, but it affects perceived import readiness on cold load.

## Commit separation

1. `a1145c3` — Import pipeline audit
2. `1b43281` — Page preprocessing
3. `30ae15b` — Structural recovery
4. `f22d912` — Confidence reasoning
5. `a410d0a` — Partial recovery
6. `d8d49e1` — Performance
7. `0050348` — Benchmark expansion
8. Final verification — product copy, browser smoke coverage, verification artifacts, and this report

The detailed Phase 0 measurements and initial failure analysis remain in [OMR_V3_PROMOTION_BASELINE.md](./OMR_V3_PROMOTION_BASELINE.md).
