# OMR V3 Cursor Handoff

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`

## Decision to preserve

OMR V3 is **not production-ready**. Keep V2 authoritative.

The strict detector-independent gate has six enforced regressions:

- `piano-grand-voices-vector`
- `piano-rhythm-tuplets-vector`
- `piano-articulation-scan`
- `piano-dense-advanced-vector`
- `guitar-paired-chords-vector`
- `guitar-techniques-paired-vector`

Do not use the zero-regression compatibility shadow as replacement evidence. It begins with V2 runtime events. Use `omrV3IndependentShadow` and `omrV3Shadow.productionGate` in dashboard JSON.

Do not lower thresholds, edit truth to match output, weaken `assessOmrV3ProductionGate`, add fixture-ID branches, or enable a runtime promotion while any independent regression remains.

## Reproduce the final state

```bash
npm run omr:benchmark-dashboard -- \
  --json tmp/cursor-qualification/report.json \
  --md tmp/cursor-qualification/report.md

jq '.omrV3Shadow.productionGate' tmp/cursor-qualification/report.json
```

Expected gate core:

```json
{
  "pass": false,
  "status": "blocked",
  "evaluatedRecognitionFixtureCount": 9,
  "independentRecognitionFixtureCount": 9,
  "independentlyRejectedFixtureCount": 1,
  "regressionCount": 6,
  "policyViolations": []
}
```

The exact final evidence is already in:

- `tmp/omr-v3-production-qualification-final/report.json`
- `tmp/omr-v3-production-qualification-final/report.md`
- `tmp/omr-v3-production-profile/`
- `tmp/browser-smoke/report.json`

Read [OMR_V3_PRODUCTION_QUALIFICATION_REPORT.md](./OMR_V3_PRODUCTION_QUALIFICATION_REPORT.md) before changing code.

## Relevant files

| Area | Files |
| --- | --- |
| Strict gate and evaluation | `src/features/omr/v3/omrV3Evaluation.js`, `scripts/omr-benchmark-dashboard.mjs`, `tests/omrV3Evaluation.test.js` |
| Raw-symbol handoff | `src/features/omr/processOmrPage.js`, `src/features/omr/runPdfOmrPipeline.js`, `src/features/omr/v3/omrV3Shadow.js` |
| IR and ownership | `src/features/omr/v3/omrV3Ir.js`, `src/features/omr/v3/omrV3Structure.js`, `src/features/omr/v3/omrV3Measures.js`, `src/features/omr/v3/omrV3Ownership.js` |
| Piano rhythm/voices | `src/features/omr/v3/omrV3Voices.js`, `src/features/omr/beamStemReconstructionDiagnostics.js`, `tests/omrV3Voices.test.js`, `tests/omrBeamStemReconstruction.test.js` |
| Guitar fusion | `src/features/omr/v3/omrV3Guitar.js`, `tests/omrV3Guitar.test.js` |
| Serialization | `src/features/omr/v3/omrV3MusicXml.js`, `tests/omrV3MusicXml.test.js` |
| Shadow and rollback behavior | `src/features/omr/v3/omrV3Rollout.js`, `tests/omrV3Shadow.test.js`, `tests/omrV3Rollout.test.js` |
| Fixtures and provenance | `benchmarks/omr-benchmark.manifest.json`, `benchmarks/omr-fixtures/`, `docs/OMR_V3_STRESS_CORPUS.md` |

## Recommended order

### 1. Dense Piano duration first

Why first: independent V3 already improves F1, onset, chord grouping, and measure count. Only duration regresses (.3409 vs .3939). The raw vector beam graph is now available.

Implement a bounded measure-local duration solver that considers:

- high-confidence `beamGroupId` and `beamExpectedDivisions`;
- lane and stem continuity;
- next onset in the same voice, not merely the next geometric item;
- measure capacity and existing voice-overlap constraints;
- an explicit abstain path when evidence conflicts.

Do not restore the rejected general next-onset duration rule in `tmp/omr-v3-independent-lane-duration/`; it hurt grand staff and scans.

Focused command:

```bash
npm run omr:benchmark-dashboard -- \
  --only-fixtures piano-dense-advanced-vector \
  --json tmp/cursor-dense/report.json \
  --md tmp/cursor-dense/report.md
```

Acceptance:

- duration accuracy >= .3939;
- F1 >= .6987, onset >= .3561, chord >= .5740 from the current independent result;
- absolute measure-count error <= 2;
- zero invalid events, duplicates, or voice overlaps;
- full enforced gate has no new regression.

### 2. Joint grand-staff onset and voice solving

Current diagnostics: 88/88 independent events, eight ambiguous measures, 30 measure-end recoveries, 88 approximate quantizations.

Build one onset-column graph for both staves before assigning voice duration. Use beam/stem groups, aligned x columns, staff membership, and measure capacity. Cross-staff evidence must be a relation, not a request to merge pitches or chord voices indiscriminately.

Do not broaden the single-staff uniform grid in `omrV3Voices.js`; the rejected trial under `tmp/omr-v3-uniform-grid-trial/` damaged grand-staff grouping.

Acceptance for `piano-grand-voices-vector`:

- F1 >= .9886;
- duration >= .8182;
- onset >= .9773;
- chord >= .9775;
- pitch >= .6250;
- absolute measure-count error 0;
- no regression on beginner or dense Piano.

### 3. Add explicit tuplet group evidence

The current raw handoff approximately quantizes all 67 events. Geometric spacing is insufficient.

Carry a detector-owned relation with group identity and written/played ratio through `omrV3Shadow.js` into `omrV3Ir.js`. Apply the ratio only when the full group is structurally owned and measure capacity agrees; otherwise abstain.

Acceptance for `piano-rhythm-tuplets-vector`:

- F1 >= .8889;
- duration >= .7778;
- onset >= .5556;
- chord >= .7746;
- pitch >= .4127;
- absolute measure-count error 0;
- no regression on beginner, grand, or dense Piano.

### 4. Reconstruct raster beam/stem relations conservatively

`piano-articulation-scan` has intact note detection but weak relations: eight ambiguous measures, 31 measure-end recoveries, and 89 approximate events.

Add a raster relation graph parallel to the vector beam/stem graph. Require strong notehead-to-stem attachment, bounded beam geometry, and an abstain result for noise or touching glyphs. Do not change scan confidence thresholds.

Acceptance:

- F1 >= .8040;
- duration >= .4685;
- onset >= .6126;
- chord >= .6048;
- pitch >= .3153;
- absolute measure-count error 0;
- no vector Piano regression.

### 5. Replace independent paired-Guitar fusion with a joint onset graph

Current evidence:

- paired chords: 207 source symbols -> 68 events; 18 pairs; 105 unpaired diagnostics; .2647 pair recall;
- techniques: 60 source symbols -> 25 events; 0 pairs; 60 unpaired diagnostics.

Create notation and TAB onset columns within each owned staff pair and measure before pitch/string/fret matching. Pair using shared onset, normalized horizontal position, pitch compatibility, and technique/continuation relations. Preserve unmatched notation events when safe; never invent a fret.

Do not pass Piano beam evidence into Guitar. The rejected evidence is under `tmp/omr-v3-beam-evidence-all/` and regressed standard and paired Guitar.

Acceptance for `guitar-paired-chords-vector`:

- F1 >= .6860, duration >= .3621, onset >= .5172, chord >= .4786, pitch >= .1121;
- absolute measure-count error <= 2;
- pair recall >= .8901;
- zero duplicates, invalid events, and voice overlaps.

Acceptance for `guitar-techniques-paired-vector`:

- F1 >= .7000, duration >= .5000, onset >= .6563, chord >= .5385, pitch >= .0313;
- absolute measure-count error <= 4;
- pair recall 1.0;
- zero duplicates, invalid events, and voice overlaps.

Also require no regression on `guitar-tab-sparse-vector`, `guitar-standard-chords-vector`, or diagnostic `wet-hands-guitar`.

### 6. Add real-PDF truth and negative-page evidence

This is required before production even if the enforced gate reaches zero.

Minimum useful additions:

1. A redistribution-safe historical scan music-page crop with independently verified MusicXML.
2. The historical Twinkle decorative cover as an expected `no-music` or isolated-page fixture.
3. At least one clean beginner workbook page with licensed truth, or a newly created equivalent if the local workbook cannot be redistributed.
4. One dense Piano and one orchestral slice with verified expected rejection or symbolic truth.

Acceptance:

- decorative/non-musical pages cannot create playable events;
- healthy music pages are not damaged by the negative-page classifier;
- real-score truth metrics are recorded separately from import-completion status;
- fixture checksum/provenance checks pass.

### 7. Rollout tooling only after zero regressions

When, and only when, the strict full gate reports zero regressions:

- implement a default-off runtime candidate;
- preserve a synchronous kill switch to V2;
- verify V2 MusicXML remains byte-identical when V3 is off or rolled back;
- run V3 in shadow before any cohort receives it;
- record category, decision, confidence, latency, and diff telemetry without retaining PDFs;
- promote by a small cohort/category, not globally.

The existing gate must require `runtimeCandidateImplemented: true` and `rollbackVerified: true`; do not remove those blockers.

## Test loop after every material fix

```bash
npx vitest run \
  tests/omrV3Shadow.test.js \
  tests/omrV3Voices.test.js \
  tests/omrV3Guitar.test.js \
  tests/omrV3MusicXml.test.js \
  tests/omrV3Evaluation.test.js \
  tests/omrV3Rollout.test.js \
  tests/omrBeamStemReconstruction.test.js

npm run omr:benchmark-dashboard -- \
  --json tmp/cursor-full/report.json \
  --md tmp/cursor-full/report.md

jq '.omrV3Shadow.productionGate' tmp/cursor-full/report.json
```

A partial `--only-fixtures` run is for iteration only. Its production gate is incomplete by construction. Every commit needs the full ten-fixture enforced gate plus the available stress corpus.

Before any production recommendation:

```bash
npm test
npm run build
npm run omr:benchmark-dashboard
npm run omr:benchmark-dashboard -- --no-v3-shadow \
  --json tmp/cursor-production-profile/report.json \
  --md tmp/cursor-production-profile/report.md

npm run preview -- --host 127.0.0.1 --port 4173
# in another shell
node scripts/browser-smoke-pass.mjs
```

Perform browser QA with an actual clean PDF and visually confirm:

```text
Upload PDF -> Setting up your music... -> Practice ready
```

## Global acceptance criteria

Production replacement is allowed only when all are true:

- `productionGate.pass === true`;
- `productionGate.regressionCount === 0`;
- 9/9 recognition fixtures have independent primary event rate 1;
- 1/1 expected rejection is independently owned by V3;
- no enforced or stress regression, invalid event, duplicate event, or voice overlap;
- real-PDF negative-page and truth-backed evidence is green;
- production-path speed, memory, and worker responsiveness do not regress materially;
- the runtime candidate is default-off, rollback is verified, and V2 output is byte-identical after rollback;
- full tests, build, dashboard, browser QA, browser smoke, responsive smoke, and PDF visual review pass.

## What Cursor can finish in a week

Reasonable targets:

- dense duration regression eliminated;
- one of grand-staff or paired-Guitar joint solvers substantially advanced or completed;
- richer raw relation diagnostics and focused unit tests;
- real-PDF fixture scaffolding and negative-page tests if licensed source data is available.

Do not promise production promotion without independent truth and human visual review. If the six enforced regressions reach zero but real-scan evidence remains unverified, leave V3 shadow-only and document that blocker exactly.
