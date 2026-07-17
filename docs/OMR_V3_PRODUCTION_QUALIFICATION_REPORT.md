# Corranzo OMR V3 Production Qualification — Final Report

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`

## 1. Can V3 replace V2 today?

**No. Keep V2 authoritative in production.**

This sprint reached outcome B: every safe autonomous improvement and qualification step available from the repository evidence was completed, but the detector-independent V3 path still regresses six of the ten enforced fixtures. Enabling it would knowingly reduce timing or recognition quality for grand-staff Piano, tuplets, scanned Piano, dense Piano duration, and paired notation/TAB Guitar.

The production decision is not based on the dashboard headline alone:

- The normal dashboard is green: 10 enforced passes, 10 diagnostic skips, no failures or errors. That verifies the existing V2 runtime.
- The compatibility V3 shadow reports zero regressions because it intentionally begins with V2 runtime events. It proves that the V3 IR can preserve legacy evidence; it does not prove independent replacement.
- The new production qualification gate evaluates raw detector symbols owned and interpreted by V3. It is correctly `blocked` with six regressions.

No confidence threshold, metric tolerance, promotion requirement, fixture truth, or production acceptance rule was weakened. V2 output remains authoritative and the V3 runtime candidate remains unimplemented on purpose.

## Qualification result

| Gate requirement | Final evidence | Result |
| --- | ---: | --- |
| Enforced fixtures | 10 | complete |
| Recognition fixtures evaluated by independent V3 | 9/9 | pass |
| Recognition fixtures with 100% independent primary events | 9/9 | pass |
| Expected rejections independently owned by V3 | 1/1 | pass |
| Enforced regressions | **6** | **blocker** |
| Policy violations | 0 | pass |
| Runtime candidate | not implemented | intentionally blocked |
| Rollback verification | not run | intentionally blocked |
| Final production gate | `blocked` | **do not promote** |

At the start of this qualification sprint, the compatibility shadow showed zero regressions but had no detector-independent event evidence. The first strict raw-symbol run exposed nine recognition regressions and no independently owned rejection. The final implementation has nine independently evaluated recognition fixtures, owns the expected empty scan rejection, and reduced the raw regressions from nine to six without changing policy.

`PROJECT_BRIEF.md` is absent from the repository and workspace. The supplied sprint brief, [OMR V3 final report](./OMR_V3_FINAL_REPORT.md), [promotion report](./OMR_V3_PROMOTION_REPORT.md), [promotion baseline](./OMR_V3_PROMOTION_BASELINE.md), [accuracy report](./OMR_V3_ACCURACY_REPORT.md), and current code were used as the governing sources.

## What this sprint changed

### Qualification integrity

- Added an explicit production gate that requires detector-independent recognition, V3-owned rejection decisions, zero enforced regressions, a real runtime candidate, and verified rollback.
- Separated the legacy-event compatibility shadow from the raw-detector independent shadow in dashboard output.
- Made raw evidence capture opt-in to qualification/shadow runs. The production path does not retain raw symbol arrays or run the independent shadow.
- Added `--no-v3-shadow` so the dashboard can profile the production path without developer-only shadow allocations.
- Preserved V3 structural evidence on import-only stress fixtures and on honest rejection paths instead of losing it at early returns.

### Safe recognition improvements

- Recovered a uniform beat grid only for a single notation staff when item count, onset columns, detected beats, and spacing all agree. This removed the independent beginner regression without applying the rule to grand staff.
- Recovered positional timing for TAB-only music with monotonic beat slots. This restored the enforced sparse-TAB fixture to exact V2 timing parity.
- Let V3 independently own a zero-symbol rejection while retaining the V2 failure as observation only.
- Passed high-confidence vector beam/stem graph evidence into independent V3 Piano duration reasoning. This materially improved dense Piano while remaining isolated from Guitar fusion.
- Preserved raw rest, position, measure-end, and rejection diagnostics so remaining failures are measurable at their first-loss subsystem.

### Rejected changes

Three broader changes were tested and reverted because they were unsafe:

- A general next-onset lane duration rule hurt grand staff, scans, and dense Piano.
- A uniform beat grid applied beyond single-staff notation damaged grand-staff chord and voice semantics.
- Applying Piano beam evidence to paired Guitar regressed the standard and paired Guitar fixtures.

These rejected trials are retained under `tmp/` as diagnostic evidence; none is present in production code.

## Enforced benchmark comparison

The table compares current V2 output with the detector-independent V3 shadow. F1, duration, onset, and chord are the primary recognition signals shown here; the gate also checks structure, fusion, duplicates, invalid events, and voice overlap.

| Fixture | V2 F1 | V3 F1 | V2 duration | V3 duration | V2 onset | V3 onset | V2 chord | V3 chord | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `piano-beginner-single-vector` | .9688 | **1.0000** | .8750 | .8750 | .8438 | **.8750** | .9394 | **1.0000** | pass |
| `piano-grand-voices-vector` | .9886 | .9432 | .8182 | .5568 | .9773 | .6136 | .9775 | **1.0000** | regress |
| `piano-rhythm-tuplets-vector` | .8889 | **.9048** | .7778 | .5079 | .5556 | **.5873** | .7746 | **.8000** | regress |
| `piano-articulation-scan` | .8040 | .8040 | .4685 | .3333 | .6126 | .3874 | .6048 | .5191 | regress |
| `piano-dense-advanced-vector` | .4563 | **.6987** | .3939 | .3409 | .3333 | **.3561** | .2892 | **.5740** | regress |
| `guitar-tab-sparse-vector` | .8889 | .8889 | .7250 | .7250 | .5750 | .5750 | .8000 | .8000 | pass |
| `guitar-standard-chords-vector` | .3544 | .3544 | .1565 | **.1739** | .1391 | .1391 | .2061 | **.2154** | pass |
| `guitar-paired-chords-vector` | .6860 | .6196 | .3621 | .3190 | .5172 | .1983 | .4786 | .4264 | regress |
| `guitar-techniques-paired-vector` | .7000 | .5965 | .5000 | .1875 | .6563 | .2500 | .5385 | .4615 | regress |
| `guitar-paired-scan` | expected reject | V3-owned reject | — | — | — | — | — | — | pass |

The compatibility shadow remains useful but must not be used for the production decision. It reports zero enforced regressions and one improvement because it replays V2-owned events through V3. The independent table above is the replacement evidence.

## 2. Exactly why V3 cannot replace V2

### `piano-grand-voices-vector`

- Classification: algorithmic; onset quantization, voice assignment, and cross-staff structural reasoning.
- Evidence: all 88 raw symbols become independent primary events, but all eight measures are rhythm-ambiguous; 30 events require measure-end recovery and all 88 use approximate quantization.
- Root cause: V3 quantizes each raw geometric lane without a joint grand-staff onset/voice solution. Closely spaced inner voices and cross-staff chord columns therefore drift apart even though note detection remains high.
- Required safe fix: solve onset columns and voice lanes jointly across both staves, using beam/stem groups and measure duration constraints while preserving chord columns.

### `piano-rhythm-tuplets-vector`

- Classification: algorithmic and evidence-model; tuplet relation and rhythmic inference.
- Evidence: F1, onset, and chord improve, but duration falls from .7778 to .5079; six of eight measures are ambiguous and all 67 events are approximately quantized.
- Root cause: the raw handoff does not represent a complete tuplet ratio/group relation. Geometric spacing alone cannot safely distinguish written tuplets from ordinary subdivisions.
- Required safe fix: carry tuplet group/ratio evidence into the V3 IR and solve the full group as one rhythmic constraint.

### `piano-articulation-scan`

- Classification: preprocessing/detector evidence plus algorithmic rhythm and chord reasoning.
- Evidence: F1 is unchanged, but duration, onset, and chord regress; all eight measures are ambiguous, 31 events are clipped to measure ends, and 89 of 111 events are approximately quantized.
- Root cause: the raster path does not provide a beam/stem connectivity graph comparable to the vector path. Noise-clean noteheads survive, but their rhythmic and chord relationships do not.
- Required safe fix: add conservative raster beam/stem recovery with confidence and abstention, then feed the same structural relation interface used by vector Piano.

### `piano-dense-advanced-vector`

- Classification: algorithmic duration and voice continuity.
- Evidence: V3 substantially improves F1, onset, chord grouping, and measure count; only duration remains below V2 (.3409 vs .3939). Eight measures remain ambiguous, 33 events use measure-end recovery, and 257 events are approximately quantized.
- Root cause: the newly carried beam graph fixes part of the first-loss evidence, but duration is still selected locally rather than jointly with lane continuity, next onset, beam subdivision, and measure capacity.
- Required safe fix: a bounded joint duration solver is likely the smallest first target. It must retain the current independent gains.

### `guitar-paired-chords-vector`

- Classification: algorithmic notation/TAB fusion and onset grouping.
- Evidence: 207 independent source symbols collapse to 68 primary events; only 18 pairs are recovered, 105 inputs remain unpaired diagnostics, pairing recall is .2647, and 26 events are approximately quantized.
- Root cause: notation and TAB coordinates are owned, but the independent path does not yet create a shared onset grid before pitch/string/fret matching. It discards or fails to fuse valid partners that the compatibility adapter can preserve from V2.
- Required safe fix: create joint notation/TAB onset columns, match within measure/staff-pair constraints, and retain unmatched notation safely instead of using fixture-specific tolerances.

### `guitar-techniques-paired-vector`

- Classification: algorithmic notation/TAB fusion with technique-aware relationships.
- Evidence: 60 source symbols become 25 events; zero pairs are recovered, all 60 inputs are unpaired diagnostics, and all 25 events are approximately quantized.
- Root cause: sparse technical markings and displaced notation/TAB geometry defeat the current position/pitch pairing model. Technique relationships are not represented strongly enough to keep partners on the same structural onset.
- Required safe fix: extend the joint paired-staff graph with technique/continuation relations and test it against both paired Guitar fixtures plus `wet-hands-guitar`.

## Real-PDF stress result

The real-PDF corpus remains diagnostic because it lacks verified symbolic truth. It is evidence about robustness and safety, not accuracy.

| Category | Production observation | Independent V3 evidence | Qualification meaning |
| --- | --- | --- | --- |
| Beethoven Symphony No. 7 orchestral | safe reject, confidence .6419 | 812 events; 92 measures, 80 ambiguous; 538 measure-end recoveries | multi-part structure remains unsafe |
| Beethoven Pathétique dense Piano | safe reject, confidence .6572 | 2,708 events; all 65 measures ambiguous; 1,250 measure-end recoveries | dense beams/voices remain unsafe |
| Historical Twinkle scan | output emitted: 421 notes / 98 measures | 751 sources -> 561 events; 30 ambiguous measures; 412 approximate events | unsafe-accept risk remains; the decorative cover is detected as music |
| Local beginner workbook | output emitted: 585 notes / 113 measures, confidence .9057 | 603 events; 106 ambiguous measures; 581 approximate events | completion is proven, correctness is not |

Representative PDF pages were rendered and visually reviewed. The historical Twinkle cover has ornamental borders and typography but no sheet music; it is nevertheless interpreted as staff systems. The workbook is visibly clean, but its high confidence cannot substitute for truth. These two facts prevent a legitimate real-world correctness claim even after the six enforced regressions are solved.

## Performance

| Path | Command | Wall time | Max RSS | Assessment |
| --- | --- | ---: | ---: | --- |
| Production path, shadows disabled | `npm run omr:benchmark-dashboard -- --no-v3-shadow` | 26.19 s | 1,089,585,152 B | production reference |
| Full qualification shadows | `npm run omr:benchmark-dashboard` | 31.16–32.32 s | about 1.81 GB | developer-only evidence cost |
| Browser PDF import | `node scripts/browser-smoke-pass.mjs` | 299 ms to Practice | — | responsive |

The new raw symbol and beam evidence is captured only when V3 shadow qualification is enabled. Production does not pay the independent-shadow allocation cost. No production speed, memory, or worker-responsiveness regression was observed.

## 3. Remaining blockers ranked by engineering effort

| Rank | Blocker | Type | Estimated effort | Why |
| ---: | --- | --- | --- | --- |
| 1 | Dense vector Piano duration solver | algorithmic | medium | Only duration is below V2 and the beam graph is now available; the solution can be tightly scoped and measured. |
| 2 | Runtime candidate plus kill switch and rollback test | rollout | medium, but contingent | Plumbing is bounded, but implementing it before correctness reaches zero regressions would create unsafe dead code and misleading readiness. |
| 3 | Joint grand-staff onset/voice solver | algorithmic/architectural extension | high | Must coordinate two staves, inner voices, chords, beams, and measure capacity without damaging beginner or dense Piano. |
| 4 | Joint paired notation/TAB fusion | algorithmic | high | Must recover events and pairings across displaced coordinate systems while preserving unmatched music and technique semantics. |
| 5 | Tuplet group representation and solver | IR/evidence/algorithmic | high | Requires a new raw relation carried through ownership, voice reasoning, and serialization. |
| 6 | Raster beam/stem reconstruction | preprocessing/detector/algorithmic | high to very high | Scan noise and touching glyphs require conservative graph recovery and strong abstention behavior. |
| 7 | Non-musical page/region safety qualification | algorithmic plus qualification | high | Needs negative pages, cover isolation, and truth-backed false-accept tests, not a confidence threshold change. |
| 8 | Truth-labeled real-score qualification | source data/manual evidence | externally constrained | Correct MusicXML/page labels and manual visual validation are not derivable safely from current outputs. |

## 4. Remaining blockers ranked by user impact

| Rank | Blocker | User impact |
| ---: | --- | --- |
| 1 | Non-musical scan regions can be accepted as music | Critical: plausible false music is worse than an honest rejection and undermines trust. |
| 2 | Scanned and dense Piano rhythm/voice failures | High: common advanced and historical repertoire can reject or produce incorrect practice timing. |
| 3 | Grand-staff onset and voice regression | High: ordinary Piano music is a core Corranzo category. |
| 4 | Paired notation/TAB fusion regression | High for Guitar users: valid chords and techniques are dropped or mistimed. |
| 5 | Tuplet duration regression | Medium-high: rhythm practice becomes misleading even when notes are detected. |
| 6 | Missing truth on real stress PDFs | High qualification risk: false accepts and subtle wrong timing cannot be measured reliably. |
| 7 | Runtime candidate and rollback plumbing | Low until accuracy clears; critical only at rollout time. |

## 5. Smallest remaining work before production

1. Keep V2 authoritative and run all V3 work in explicit developer shadow mode.
2. Fix `piano-dense-advanced-vector` duration first while retaining its existing F1/onset/chord improvements.
3. Add joint onset/voice solving for grand staff, then tuplets and raster beam/stem evidence.
4. Replace positional paired-Guitar fusion with a joint measure/onset graph; require both paired fixtures and `wet-hands-guitar` to remain stable.
5. Make the strict independent gate report zero regressions across all ten enforced fixtures with 9/9 independent recognition and 1/1 independently owned rejection.
6. Add truth-backed coverage for a historical scan music page and a non-musical cover/page. Do not count import completion as accuracy.
7. Only after steps 5–6, implement a default-off V3 runtime candidate, immediate kill switch, shadow comparison telemetry, and a tested rollback to byte-identical V2 output.
8. Repeat full dashboard, stress, production-path performance, memory, browser import, and manual visual qualification before enabling any cohort.

The smallest gate-clearing code change may be the dense duration solver, but it is not sufficient for production replacement. Full replacement requires all six algorithmic regressions plus the real-PDF safety evidence.

## 6. Can Cursor reasonably finish the remaining work?

**Cursor can make substantial progress during the week, but it should not be expected to legitimately promote V3 by itself unless new truth data and human review are also available.**

Cursor can reasonably:

- implement and test the dense bounded duration solver;
- prototype the grand-staff and paired-Guitar joint graphs;
- add raw relation diagnostics and focused non-fixture-specific tests;
- run the strict gate and reject changes that hurt any enforced or stress fixture;
- prepare, but not enable, default-off rollout and rollback tooling after the accuracy gate reaches zero.

Cursor cannot safely infer ground truth for the historical scan or workbook from the current V2/V3 outputs, and it cannot turn a visually plausible import into qualification evidence without independent MusicXML/page labels and manual review. Therefore the realistic one-week target is fewer or zero enforced regressions plus a stronger evidence package—not automatic production promotion.

Exact next actions are in [OMR_V3_CURSOR_HANDOFF.md](./OMR_V3_CURSOR_HANDOFF.md).

## Final verification

| Verification | Result |
| --- | --- |
| `npm test` | PASS — 236 files; 2,336 passed, 5 skipped |
| `npm run build` | PASS — production build completed in 428 ms |
| `npm run omr:benchmark-dashboard` | PASS for current V2 — 20 fixtures; 10 pass, 10 diagnostic skip, 0 fail/error; strict independent V3 gate blocked at six regressions |
| Browser QA | PASS — uploaded the clean beginner PDF, reached Practice with rendered score, `Piano ready`, and `Following score`; no browser warnings/errors |
| Browser smoke | PASS — 19/19; observed `Setting up your music...`; clean PDF reached Practice in 299 ms; no console/page errors or responsive overflow |
| Fixture integrity and PDF QA | PASS — present stress checksums verified; representative orchestral, Piano, workbook, and historical scan pages rendered and inspected |
| Production behavior | PASS — V2 remains authoritative; raw V3 capture is opt-in; no promotion candidate enabled |
| `git diff --check` | PASS before final commit |

The test run retains existing non-fatal pdf.js font-data and React test warnings. The build retains the existing large-main-chunk warning. The dashboard also reports a pre-existing V2 voice-serialization frozen-baseline drift diagnostic; the command exits successfully and the enforced production fixture policy remains 10/10.

## Evidence and repository state

Primary final artifacts are intentionally preserved but not committed:

- `tmp/omr-v3-production-qualification-final/report.json` and `report.md` — final strict qualification evidence.
- `tmp/omr-v3-production-profile/` — shadow-disabled production-path profile.
- `tmp/omr-benchmark-dashboard/` — exact final dashboard command outputs.
- `tmp/browser-smoke/report.json` — 19/19 browser smoke evidence.
- `tmp/pdfs/omr-stress/` — rendered pages used for visual PDF review.
- `tmp/omr-v3-independent-lane-duration/`, `tmp/omr-v3-uniform-grid-trial/`, and `tmp/omr-v3-beam-evidence-all/` — rejected experiment evidence.

Other existing `tmp/omr-v3-*`, promotion, accuracy, and preprocessing artifacts are preserved because they are generated sprint evidence or pre-existing local data. The exact dashboard and browser-smoke commands refreshed existing tracked evidence files; experiment directories are mostly untracked. All are intentionally excluded from the documentation commit and are the only remaining worktree changes. No generated artifact is used as runtime behavior or benchmark truth.

## Final decision

**Outcome B.** No further safe autonomous promotion step is justified by the current evidence. The repository is stronger: V3 now has an honest independent qualification gate, complete enforced evidence ownership, three fewer raw regressions, better diagnostics, safe recovery improvements, production-path isolation, and an exact continuation plan. Production remains on V2 until the six independent regressions and real-scan truth gap are resolved.
