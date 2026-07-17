# Corranzo OMR V3 Accuracy Campaign Baseline

Date: 2026-07-16

Branch: `codex/omr-v3-accuracy-campaign`

Status: Phase 0 evidence captured before accuracy-campaign code changes.

## Inputs and method

The baseline review covered `docs/OMR_V3_FINAL_REPORT.md`, `docs/OMR_V3_IR_SPEC.md`, `docs/OMR_V3_PROMOTION_REPORT.md`, `docs/OMR_V3_PROMOTION_BASELINE.md`, the complete V3 shadow pipeline, the benchmark dashboard and gate, the 20-fixture manifest, and the real-PDF stress report. `PROJECT_BRIEF.md` is still absent from the repository and workspace, so the supplied campaign brief is the governing product brief.

The live baseline command was:

```sh
/usr/bin/time -p npm run omr:benchmark-dashboard -- \
  --json tmp/omr-v3-accuracy-baseline/report.json \
  --md tmp/omr-v3-accuracy-baseline/report.md
```

It completed in 32.59 seconds wall time (34.64 seconds user CPU, 0.95 seconds system CPU). The expanded dashboard passed: 10 enforced fixtures passed policy, 10 diagnostics were skipped by policy, and no fixture failed or errored. Production remained on V2.

## Gate baseline

| Gate outcome | Baseline |
| --- | ---: |
| Enforced fixtures | 10 |
| Enforced V3 shadows ready | 9 |
| Enforced fixtures with at least one V3 improvement | 2 |
| Enforced fixtures with at least one V3 regression | 6 |
| Exact V2/V3 parity fixtures | 2 |
| Expected-rejection fixture without post-recognition V3 output | 1 |
| Promotion status | `shadow-only` |

The gate is intentionally strict: any decrease in pitch, duration, onset, chord grouping, note F1, structural accuracy, fusion recall, or validity counts as a regression. A fixture may therefore be classified as regressed even when several other metrics improve. “Expected result” below means no worse than V2 on every gated metric, not perfect transcription of the truth score.

## Regression inventory

### 1. CC0 Grand Staff Voice Study (`piano-grand-voices-vector`)

- **Current V2 result:** 8 measures and 88 notes, exactly matching truth counts; pitch 62.50%, duration 81.82%, onset 97.73%, chord 97.75%, F1 98.86%.
- **Current V3 result:** 12 measures and 60 primary events; pitch 42.05%, duration 40.91%, onset 50.00%, chord 42.31%, F1 59.46%.
- **Expected result:** retain 8 measures and regress none of the five recognition metrics.
- **Why V2 succeeds:** its page analysis retains the two detected grand-staff systems and serializes all 88 recognized notes on the established measure timeline.
- **Why V3 fails:** four staff observations become three V3 systems. Two adjacent pairing decisions are rejected, producing four extra measure columns and leaving only 60 events in the serialized primary timeline.
- **Probable root cause:** **staff grouping**, followed by **measure detection**, **voice assignment**, and **serialization**. The shadow adapter preserves raw rows but drops the detector’s source-system membership when a band is segmented; the generic adjacent-pair scorer cannot reliably reconstruct the second grand staff.

### 2. CC0 Articulation Scan Study (`piano-articulation-scan`)

- **Current V2 result:** 8 measures and 111 recognized notes against 8 measures / 88 truth notes; pitch 31.53%, duration 46.85%, onset 61.26%, chord 60.48%, F1 80.40%.
- **Current V3 result:** 16 measures and 97 primary events; pitch 12.50%, duration 21.59%, onset 26.14%, chord 18.37%, F1 34.48%.
- **Expected result:** retain the V2 eight-measure timeline and regress none of its recognition metrics.
- **Why V2 succeeds:** preprocessing and the scan detector identify two playable systems; V2 keeps their shared measure allocation even though note detection is noisy.
- **Why V3 fails:** the same page becomes four single-staff systems with three rejected pairings. This doubles the measure count, leaves 25 of 122 adapted symbols unassigned, and destroys cross-staff alignment before voice construction.
- **Probable root cause:** **staff grouping** and downstream **ownership/recovery logic**. Preprocessing is not the differentiator because V2 and V3 receive the same processed page observations.

### 3. CC0 Sparse TAB Technique Study (`guitar-tab-sparse-vector`)

- **Current V2 result:** 8 measures and 40 recognized notes against 8 measures / 32 truth notes; pitch 70.00%, duration 72.50%, onset 57.50%, chord 80.00%, F1 88.89%.
- **Current V3 result:** 8 measures and 40 primary events; pitch 0.00%, duration 50.00%, onset 35.00%, chord 80.00%, F1 72.22%. All 40 events are marked approximate.
- **Expected result:** preserve the eight-measure structure and the exact pitch/timing observations already available from the detector.
- **Why V2 succeeds:** the TAB detector has already resolved playable MIDI plus event onset and duration before MusicXML emission.
- **Why V3 fails:** the TAB-only builder discards exact adapted onset, duration, and MIDI evidence, then reconstructs rhythm from horizontal spacing and pitch from string/fret alone.
- **Probable root cause:** **Guitar note grouping/rhythmic inference** and **serialization provenance loss**, not page structure or preprocessing.

### 4. CC0 Standard Guitar Chord Study (`guitar-standard-chords-vector`)

- **Current V2 result:** 16 measures and 43 notes against 8 measures / 115 truth notes; duration 15.65%, pitch 0.00%, onset 13.91%, chord 20.61%, F1 35.44%.
- **Current V3 result:** 16 measures and 27 primary events; duration 14.78%. Pitch, onset, chord grouping, and F1 improve, but the duration decrease alone keeps the fixture regressed.
- **Expected result:** retain the four improved metrics without losing V2 duration accuracy.
- **Why V2 succeeds on the gated dimension:** it serializes all recognized standard-notation events, including detector timings that cross or fill the fixed measure budget.
- **Why V3 fails on the gated dimension:** 20 adapted symbols never become serialized note events; the Guitar builder rejects event groups whose exact detector duration exceeds its fixed measure-duration assumption.
- **Probable root cause:** **rhythmic inference/serialization** at the adapter-to-Guitar boundary. This is not a staff or measure-count regression.

### 5. CC0 Paired Notation and TAB Study (`guitar-paired-chords-vector`)

- **Current V2 result:** 10 measures and 91 notes against 8 measures / 116 truth notes; pitch 11.21%, duration 36.21%, onset 51.72%, chord 47.86%, F1 68.60%, measure error 2.
- **Current V3 result:** 14 measures, 72 primary events, and only 57 serializable events; pitch 2.59%, duration 11.21%, onset 16.38%, chord 14.57%, F1 25.43%, measure error 6, and 6 voice-overlap violations.
- **Expected result:** no worse than V2 on recognition, measure error, or voice validity.
- **Why V2 succeeds:** its `systemRoles` model links notation systems to their TAB partners before measure/event emission and retains the established ten-measure timeline.
- **Why V3 fails:** V3 classifies none of its three groups as the expected notation/TAB group, produces only four mirror pairs, creates four excess measures, and rejects overlapping event groups during serialization.
- **Probable root cause:** **staff grouping**, **measure detection**, **Guitar fusion**, **voice assignment**, and **serialization**. The adapter does not carry the detector’s explicit notation/TAB partner identity into structural evidence.

### 6. CC0 Guitar Technique Pairing Study (`guitar-techniques-paired-vector`)

- **Current V2 result:** 12 measures and 28 notes against 8 measures / 32 truth notes; pitch 3.13%, duration 50.00%, onset 65.63%, chord 53.85%, F1 70.00%, measure error 4.
- **Current V3 result:** 16 measures and 28 events; pitch remains 3.13%, but duration falls to 31.25%, onset to 43.75%, chord to 30.43%, F1 to 46.67%, and measure error grows to 8. No notation/TAB mirror is created.
- **Expected result:** retain the 28 events on a timeline no worse than V2 and preserve pairing evidence.
- **Why V2 succeeds:** detector-owned system roles and measure grids preserve event ordering; all matched V2 notes have correct onset even though pitch recognition is weak.
- **Why V3 fails:** shared-measure recovery inserts four inferred boundaries into an already closed adapter-provided grid, shifting the timeline from 12 to 16 measures. Pair identity is also lost, so all 56 notation/TAB observations are reported unpaired.
- **Probable root cause:** **measure recovery logic** plus **staff grouping/Guitar fusion**. The metric collapse is primarily alignment, not symbol detection.

## Subsystem attribution

| Fixture | Preprocess | Staff grouping | Measure detection | Voice assignment | Note/TAB grouping | Chord reasoning | Rhythm | Confidence | Recovery | Serialization | Import |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Grand staff voices | no | primary | downstream | downstream | — | downstream | downstream | no | secondary | downstream | no |
| Articulation scan | shared input | primary | downstream | downstream | — | downstream | downstream | no | secondary | downstream | no |
| Sparse TAB | no | parity | parity | — | primary | — | primary | no | no | primary | no |
| Standard Guitar | no | parity | parity | — | secondary | secondary | primary | no | no | primary | no |
| Paired Guitar chords | no | primary | primary | primary | primary | downstream | downstream | no | secondary | primary | no |
| Paired Guitar techniques | no | secondary | primary | secondary | primary | downstream | downstream | no | primary | downstream | no |

No regression is attributed to confidence thresholds or the PDF import pipeline. Lowering confidence would not repair any emitted MusicXML difference.

## Baseline constraints for fixes

1. Preserve all current production benchmark output; V2 remains authoritative during investigation.
2. Preserve the two exact V3 parity fixtures and the dense-piano V3 improvement.
3. Treat `guitar-standard-chords-vector` as a duration-specific failure rather than discarding its four V3 improvements.
4. Retain the honest rejection of `guitar-paired-scan`.
5. Do not infer success from import-only stress fixtures without symbolic truth.
6. Accept a fix only when it is expressed as detector-evidence or IR invariants, covered by fixture-independent unit tests, and stable on the full stress corpus.
