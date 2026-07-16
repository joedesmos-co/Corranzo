# Corranzo OMR V3 Staff/System IR — Final Sprint Report

Date: 2026-07-16

Branch: `codex/omr-v3-staff-system-ir`

Outcome: structure-first foundation complete; production unchanged; all V3 promotions rejected by gate

## Executive result

OMR V3 now exists as a normalized document graph beside the current runtime. It models pages, systems, staff groups, staves, shared measure columns, onset columns, voices, events, and relationships before independent MusicXML emission. The shadow can be enabled in development and benchmarks, produces canonical debug JSON and separate MusicXML, and is suppressed by a rollback switch.

The production benchmark remains green: 10 enforced fixtures pass, 6 diagnostic fixtures are skipped by policy, and no production fixture fails. The V3 candidate is not production-ready. It materially improves dense Piano, preserves exact current output on two enforced single-staff Piano fixtures, but regresses six other enforced transcriptions and cannot run after the expected honest rejection of the paired Guitar scan. Every promotion flag therefore remains disabled.

## Baseline

The pre-change Phase 0 baseline was captured before runtime edits:

- `npm test`: 224 files, 2,252 passed, 5 skipped.
- `npm run build`: Vite 8.0.13, 1,441 modules; only the existing large-chunk warning.
- OMR dashboard: 16 fixtures; 10 enforced pass, 6 diagnostic skipped, 0 failures.
- Enforced transcription macro metrics: pitch 28.82%, duration 56.41%, onset 57.89%, chord grouping 62.32%, note F1 74.84%.
- Aggregate absolute enforced measure-count error: 25.
- Largest corpus error bucket: chord grouping, 9,000 errors (31%).

The detailed fixture baseline, note counts, failure buckets, provenance audit, stage attribution, pipeline map, and duplicated structural assumptions are in `docs/OMR_V3_BASELINE_AND_ARCHITECTURE.md`.

## Architecture created

```text
current PDF/raster/vector detectors
  -> opt-in shadow observation capture
  -> staff candidates (raw + normalized geometry)
  -> systems and multi-signal staff groups
  -> shared cross-staff measure columns
  -> symbol ownership and onset columns
  -> Piano voice candidates OR Guitar notation/TAB fusion
  -> relationships and provenance graph
  -> independent deterministic V3 MusicXML
  -> current-vs-V3 truth evaluation and promotion gate

production detector/events -> production MusicXML (unchanged authority)
```

The shadow adapter is generic and has no fixture/song/page coordinates. It preserves current detector evidence so the entire V3 lifecycle can be exercised without replacing the proven production path. Raw detected scan rows remain source geometry while canonical physical lines drive classification. Adapted evidence is explicitly labeled; current-event reuse is a known evaluation limitation, not presented as independent V3 symbol recognition.

## IR schema

Schema version 1 provides stable deterministic IDs and plain JSON data for:

- `OmrDocumentIR -> OmrPageIR -> OmrSystemIR -> OmrStaffGroupIR -> OmrStaffIR`;
- system-owned `OmrMeasureColumnIR` and first-class `OmrOnsetColumnIR`;
- measure-local `OmrVoiceIR` and `OmrEventIR` candidates;
- document relationships for ties, slurs, beams, stem groups, notation/TAB mirrors, cross-staff links, repeats/voltas, and techniques;
- raw and normalized geometry, per-stage confidence, node-owned diagnostics, and source references.

Constructors do not mutate inputs. Validation rejects duplicate/dangling IDs, malformed geometry, non-finite timing/pitch data, unsupported enums, invalid confidence, and non-serializable data. Canonical serialization, parse/round-trip, deep-freeze, malformed-data, and debug-export tests are included. The complete field contract is in `docs/OMR_V3_IR_SPEC.md`.

## Stages implemented

1. Staff analysis collapses doubled raster rows, preserves raw rows, distinguishes 5-line, 6-line, and ambiguous bands, and retains evidence/confidence.
2. System/staff-group analysis scores overlap, left alignment, barlines, distance, notation evidence, instrument context, brace/bracket evidence, and repeated geometry. Rejected pairings remain diagnostics.
3. Measure analysis reconciles per-staff barlines into shared columns, distinguishes stem-like evidence, preserves interior empty spans, and avoids low-evidence trailing spans.
4. Ownership assigns every source symbol to page/system/group/staff/measure/onset or an explicit exclusion/unassigned bucket. Multi-digit frets, grace-note separation, repeated x positions, and chord stacks are covered.
5. Piano analysis builds separate staff voices, chord/rest groups, hard overlap constraints, alternate low-confidence candidates, and relationship edges without naive flattening.
6. Guitar analysis creates one event from paired notation/TAB evidence, carries string/fret/techniques, retains unpaired diagnostics, and marks TAB-only rhythm approximate.
7. The independent serializer emits deterministic MusicXML with key/time/tempo, valid finite timing, voices/staves, ties/slurs, chord markers, technical string/fret metadata, warnings, and stable numbering.
8. The dashboard evaluates accuracy, structure, fusion, duplicates, invalid events, overlaps, coverage, and conservative no-regression promotion gates.
9. Runtime integration is disabled by default. `omrV3Shadow` opts in, `omrV3Rollback` suppresses it, and all promotion requests are forcibly non-enabling.

## Final current-versus-shadow metrics

The macro comparison covers the nine enforced fixtures that emit transcriptions. The tenth enforced fixture is expected to reject honestly before shadow execution.

| Metric | Current runtime | V3 shadow | Delta |
| --- | ---: | ---: | ---: |
| Pitch accuracy | 28.82% | 17.12% | -11.70 pp |
| Duration accuracy | 56.41% | 44.08% | -12.33 pp |
| Onset accuracy | 57.89% | 41.70% | -16.19 pp |
| Chord grouping | 62.32% | 47.27% | -15.05 pp |
| Note F1 | 74.84% | 59.23% | -15.61 pp |
| Aggregate absolute measure error | 25 | 36 | +11 worse |
| Duplicate-event rate | 0% | 0% | parity |
| Invalid-event rate | 0% | 0% | parity |
| Voice-overlap violations | 0 | 6 | +6 worse |

V3 staff-group accuracy is 32.41% across the nine emitted enforced fixtures. Notation/TAB pairing recall is 3.42% across the three fixtures for which the current evaluator finds eligible V3 events. Enforced system-count exact-match accuracy is 0% for both current and V3 against the truth engraving breaks; the simple diagnostic fixture reaches 100%. These weak structural metrics are blockers, not confidence-adjusted away.

The promotion gate found two enforced fixtures with at least one improvement, six with regressions, one enforced expected-rejection fixture without shadow output, and no policy violations. Gate status is `shadow-only`.

## Fixture-by-fixture decision

| Enforced fixture | Current F1 | V3 F1 | Current/V3 measure error | Decision |
| --- | ---: | ---: | ---: | --- |
| Piano beginner single | 96.88% | 96.88% | 0 / 0 | parity; not promoted globally |
| Piano grand voices | 98.86% | 59.46% | 0 / 4 | rejected: grouping/measure/voice regression |
| Piano rhythm/tuplets | 88.89% | 88.89% | 0 / 0 | parity; not promoted globally |
| Piano articulation scan | 80.40% | 34.48% | 0 / 8 | rejected: scan grand-staff grouping |
| Piano dense advanced | 45.63% | 71.02% | 11 / 2 | improved: all five note metrics and measure count |
| Guitar TAB-only | 88.89% | 72.22% | 0 / 0 | rejected: pitch/rhythm/F1 regression |
| Guitar standard chords | 35.44% | 38.03% | 8 / 8 | mixed: pitch/onset/chord/F1 improve, duration regresses |
| Guitar notation+TAB chords | 68.60% | 25.43% | 2 / 6 | rejected: fusion/grouping regression; 6 overlaps |
| Guitar notation+TAB techniques | 70.00% | 46.67% | 4 / 8 | rejected: grouping/timing regression |
| Guitar paired scan | expected rejection | unavailable | n/a | production rejects honestly before shadow; blocks coverage |

All six diagnostic fixtures remain non-enforced. The simple diagnostic is exact V3 parity, while the larger local legacy scores expose unresolved multi-page grouping and measure inflation. They do not influence promotion eligibility.

## Promotion and rollback decisions

- Promoted: none.
- Eligible but held: none; the gate does not authorize review because enforced regressions and missing coverage remain.
- Rejected: structure, measure geometry, Piano grouping, Guitar fusion, and full V3.
- Reverted: none; no V3 stage was ever enabled in production.
- Production serializer/path: unchanged and authoritative.
- Rollback: available and tested; it prevents shadow capture/analysis.

The dense Piano result is retained as evidence for a future narrowly scoped measure-geometry experiment, not treated as permission to ship the current stage.

## Remaining blockers

1. Grand-staff grouping must reconcile merged ten-line bands and separated five-line staves consistently across systems and scans.
2. Truth-linked system expectations need a layout-aware comparison that distinguishes musical systems from renderer/detector bands without lowering the gate.
3. Measure columns still duplicate when a staff pair is rejected; neighboring-system statistics and stronger spanning evidence must be applied before ownership.
4. Guitar notation/TAB group classification and onset fusion are too weak on live fixtures, especially with large vertical gaps.
5. Six Guitar fused events violate monophonic voice overlap constraints on the paired-chord fixture.
6. The shadow adapter currently starts from legacy event evidence; a raw V3 symbol observation bridge is needed for an independent symbol-stage evaluation.
7. The expected-rejection Guitar scan does not reach post-pipeline shadow execution; a pre-rejection structure-only evaluation hook is needed for full enforced coverage.

## Recommended next phase

Keep V3 shadow-only and focus on structure before symbols:

1. add a pre-rejection page-structure shadow hook so every enforced fixture has V3 structural coverage;
2. learn page-consistent grand-staff and notation/TAB pairing from repeated geometry and reconciled barline clusters;
3. gate a measure-geometry-only candidate first, using dense Piano as a positive case and the current grand/scan/TAB regressions as hard canaries;
4. replace adapter-derived note/TAB evidence with raw detected-symbol observations after structure and measures are stable;
5. rerun the same no-regression gate; only then consider a partial production promotion.

## Verification

- `npm test`: PASS — 233 files; 2,301 passed, 5 skipped.
- `npm run build`: PASS — 1,451 modules; existing large-chunk warning only.
- `npm run omr:benchmark-dashboard`: PASS — 10 enforced pass, 6 diagnostic skipped, 0 failures.
- `npm run mic:accuracy-replay`: PASS — 31 measured, 0 skipped; 100% note hit, 0% false positive.
- `npm run mic:polyphony-replay`: PASS — V2 improves; 94.4% chord hit, 98.2% per-note hit, 0% false positive.
- `npm run mic:browser-qa`: PASS — 27 passed, 0 failed.
- `node scripts/browser-smoke-pass.mjs`: PASS — 17 passed, 0 failed; no console/page errors or viewport overflow.
- V3 focused suite: PASS — 9 files, 49 tests.
- ESLint and `git diff --check`: PASS for changed code/tests/scripts.

## Commit sequence

1. `f6923a8` — OMR V3 IR foundation.
2. `2beae5a` — OMR V3 structure and system grouping.
3. `b356700` — shared measure-column IR.
4. `c926500` — symbol and onset ownership.
5. `2df58e7` — Piano voice candidates.
6. `aa8f0cd` — Guitar notation/TAB fusion.
7. `07c03cd` — serializer and evaluation gates.
8. Safe shadow rollout, final evaluation, and docs — this commit; exact hash is recorded in the final handoff.
