# Corranzo OMR V3 Accuracy Campaign — Final Report

Date: 2026-07-16
Branch: `codex/omr-v3-accuracy-campaign`

## Executive result

The accuracy campaign eliminated all six enforced OMR V3 regressions:

```text
Remaining enforced regressions
6 -> 0
```

The fixes preserve the existing architecture, production V2 output, confidence thresholds, benchmark fixtures, and rollout policy. They operate on general detector provenance and IR invariants rather than fixture identity.

The accuracy blocker is cleared, but **OMR V3 is not yet qualified to replace V2 in production**. The unchanged promotion gate remains `shadow-only` because only one enforced fixture has a genuine improvement where policy requires two, and `guitar-paired-scan` still rejects before a V3 shadow document can be captured. The current adapter also begins with legacy detector event evidence, so independent raw-symbol recognition has not yet been proven.

## Campaign boundaries

- No OMR architecture was rewritten.
- No confidence threshold was lowered.
- No benchmark truth, fixture, expected value, or fixture-specific branch was changed.
- No V3 component or full-V3 runtime promotion was enabled.
- Production MusicXML remains byte-for-byte governed by V2.
- Safe rejection remains a valid outcome for unsupported scores.

`PROJECT_BRIEF.md` remains absent from the repository and workspace. The supplied accuracy-campaign brief was therefore used as the governing product brief, as recorded in the [baseline](./OMR_V3_ACCURACY_BASELINE.md).

## Root causes fixed

| Enforced regression | First-loss subsystem | Targeted structural fix | Final result |
| --- | --- | --- | --- |
| `piano-grand-voices-vector` | Staff grouping discarded detector-owned source-system membership | Carry `sourceSystemId` and use it as one structural continuity signal when incomplete notation bands agree | 8 measures / 88 events; exact V2 parity on all gated recognition metrics |
| `piano-articulation-scan` | Geometry-only grouping rejected two valid detector-owned grand staffs | Add source-system continuity to the existing multi-signal grouping evidence | 8 measures / 111 events; exact V2 parity |
| `guitar-tab-sparse-vector` | Guitar builder replaced observed pitch and timing with fallback inference | Preserve explicit MIDI, onset, duration, and uncertainty before string/fret or spacing fallbacks | Exact V2 parity, including 70.00% pitch and the established timing metrics |
| `guitar-standard-chords-vector` | Explicit Guitar notation provenance was lost when staff-line detection returned incomplete two-line bands | Recover only detector-owned incomplete Guitar notation with pitched evidence; unlabeled incomplete bands remain ambiguous | 43 events and exact V2 parity, including the duration metric |
| `guitar-paired-chords-vector` | Notation/TAB partner identity and written/sounding pitch semantics were lost | Carry `sourcePairId`, prefer exact source staff ownership, preserve pitch semantics, and place overlapping groups into valid voice lanes | 10 measures / 91 events, exact V2 parity, 89.01% pairing recall, zero overlaps |
| `guitar-techniques-paired-vector` | Closed measure grids were subdivided and paired pitches were treated as an octave apart | Mark complete adapter grids and skip missing-boundary inference; preserve explicit sounding pitch | 12 measures / 28 events, exact V2 parity, 100% pairing recall |

The detailed traces and rejected alternatives are in [OMR_V3_ACCURACY_ROOT_CAUSES.md](./OMR_V3_ACCURACY_ROOT_CAUSES.md).

## Benchmark comparison

| Qualification measure | Before | After |
| --- | ---: | ---: |
| Enforced dashboard fixtures passing production policy | 10/10 | 10/10 |
| Enforced V3 regressions | **6** | **0** |
| Ready enforced V3 shadows | 9/10 | 9/10 |
| Exact V2/V3 parity among ready enforced shadows | 2 | 8 |
| Enforced fixtures with a genuine V3 improvement | 2 | 1 |
| Unavailable enforced V3 fixtures | 1 | 1 |
| Invalid V3 events | 0 | 0 |
| Duplicate V3 events | 0 | 0 |
| V3 voice-overlap violations | 6 on the paired-chords regression | 0 across the enforced set |
| Promotion state | `shadow-only` | `shadow-only` |

The reduction from two nominally improved fixtures to one is intentional and not an accuracy loss. One baseline fixture mixed improvements with a gated regression; restoring all of its metrics to exact V2 parity removes that mixed classification. The campaign optimized for no user-facing regression, not the count of green deltas.

`piano-dense-advanced-vector` retains the one unambiguous enforced improvement:

| Metric | V2 | V3 after campaign |
| --- | ---: | ---: |
| Pitch accuracy | 0.1477 | 0.1970 |
| Duration accuracy | 0.3939 | 0.6174 |
| Onset accuracy | 0.3333 | 0.4848 |
| Chord grouping accuracy | 0.2892 | 0.4594 |
| Note detection F1 | 0.4563 | 0.7102 |
| Absolute measure-count error | 11 | 2 |

The final dashboard contains 20 fixtures: **10 pass, 10 diagnostic skip, 0 fail, 0 rejected, 0 error**. Diagnostic skips remain non-enforced evidence and are not presented as successful recognition.

## Stress-corpus comparison

The targeted changes generalized across the diagnostic corpus:

| Fixture | Baseline V3 | Final V3 |
| --- | --- | --- |
| `clean` | 0.5906 pitch, 0.8102 F1, measure error 11 | Exact runtime parity, measure error 0 |
| `dense` | 0.1907 pitch, 0.8635 F1, measure error 10 | 0.1964 pitch, 0.8718 F1, measure error 3 |
| `simple` | Runtime parity | Runtime parity |
| `wet-hands-guitar` | 0.0816 pair recall, 30 overlaps, measure error 10 | 0.9592 pair recall, 0 overlaps, measure error 5 |
| `campanella-grandes` | 0.2063 F1, measure error 196 | 0.7684 F1, measure error 8 |
| `campanella-etude` | 0.3480 F1, measure error 90 | 0.4107 F1, measure error 52 |

Real-PDF behavior remained honest and stable:

| Category | Result after campaign | Interpretation |
| --- | --- | --- |
| Beethoven Symphony No. 7 orchestral vector | Rejected at confidence 0.6419 | Multi-part orchestral recovery remains unsafe |
| Beethoven Pathétique dense engraving | Rejected at confidence 0.6572 | Dense beams, ornaments, tuplets, and voices remain unsafe |
| Historical Twinkle scan | 421 notes, 98 measures, 2 pages, no failed or isolated pages | Recognition is stable; 41 measures remain rhythm-uncertain |
| Beginner engraved workbook | 585 notes, 113 measures, 3 pages, no failed or isolated pages, confidence 0.9059 | Stable high-confidence import |

Representative pages were rendered and visually inspected. The stress outcomes match visible score difficulty; no rejected score was relabeled as a pass. Full evidence is in [OMR_V3_ACCURACY_STRESS_VALIDATION.md](./OMR_V3_ACCURACY_STRESS_VALIDATION.md).

## Performance and responsiveness

| Measurement | Reference | Final | Assessment |
| --- | ---: | ---: | --- |
| Full 20-fixture dashboard wall time | 32.59 s accuracy baseline | 32.97 s exact final command | +0.38 s / +1.2%, within observed run variance |
| Other post-fix full runs | — | 27.82–32.93 s | No sustained slowdown |
| Browser smoke, clean PDF to Practice | 200 ms promotion result | 208 ms | +8 ms / +4.0%, stable product-path latency |
| Historical scan repeated import | — | 599–798 ms | Stable pages, measures, and notes |
| Beginner workbook repeated import | — | 607–870 ms | Stable pages, measures, and notes |

The memory confirmation run reported 1,576,517,632 bytes maximum resident set size and zero swaps. The fixes add bounded scalar provenance and transient event-lane arrays, not page-sized image buffers or additional raster passes. Worker transport and production responsiveness remain unchanged because V3 remains shadow-only.

## Final verification

| Verification | Result |
| --- | --- |
| `npm test` | PASS — 235 files; 2,324 passed, 5 skipped |
| `npm run build` | PASS — Vite production build completed in 440 ms |
| `npm run omr:benchmark-dashboard` | PASS — 20 fixtures; 10 pass, 10 diagnostic skip, no failures/errors; 0 enforced V3 regressions |
| Browser QA | PASS — observed `Setting up your music...`, automatic transition into Practice, `Piano ready`, `Following score`, rendered PDF, and zero browser warnings/errors |
| Browser smoke | PASS — 19/19; clean PDF reached Practice in 208 ms; no console or uncaught page errors |
| Responsive smoke | PASS — no horizontal overflow at desktop, iPad, or mobile widths in Library or Practice |
| Focused V3 tests | PASS — 46 tests across the six affected suites |
| Production rollout behavior | PASS — all promotion candidates remain `not-promoted`; V2 remains authoritative |

The full test run retains existing non-fatal pdf.js font-data and React test warnings. The build retains its existing large-main-chunk warning. Neither warning is caused by these changes or produced a failure.

## Remaining blockers

1. `guitar-paired-scan` rejects before post-recognition V3 shadow capture, so the gate still lacks one enforced V3 result. A structure-only pre-rejection capture hook is needed; the rejection itself must remain honest.
2. The V3 adapter still begins with legacy detector event evidence. Raw notation/TAB symbols must feed the V3 ownership and event stages before independent recognition can be claimed.
3. The unchanged promotion gate requires two genuinely improved enforced fixtures; only dense Piano currently qualifies.
4. Staff-group exact-match scores remain modest on the engraving-break evaluator even though recognition parity is restored.
5. Diagnostic `dense` and `wet-hands-guitar` still have non-enforced V3-vs-runtime gaps.
6. Multi-part orchestral scores and very dense engraved Piano remain below safe import confidence.

## Production recommendation

**Do not replace V2 in production yet.**

The six-regression accuracy blocker is resolved, so V3 is materially closer to promotion and can continue accumulating shadow evidence. Production replacement would still overstate what has been qualified because one enforced scan is unavailable and raw-symbol independence is unproven.

The next promotion attempt should:

1. capture structure-only V3 evidence before honest import rejection;
2. bridge raw detector symbols directly into V3 ownership and event reasoning;
3. achieve a second genuine enforced improvement without any regression or threshold change; and
4. repeat the complete stress, memory, worker, dashboard, and browser qualification.

Only then should a staged component promotion be considered. Full-V3 promotion should occur only when the existing gate passes without policy relaxation.
