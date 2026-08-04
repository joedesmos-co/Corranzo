# Autonomous Corranzo OMR experiment log

## Repository guard and frozen baseline

- Expected and verified starting HEAD: `beeb5f066e7bdcb3043df5fa001c92abdadb0088`
- Tracked production/test state at campaign start: clean
- Pre-existing local state preserved: tracked research changes under `tmp/`, seven untracked research scripts, and a Python cache; none were reset or included in commits
- Evaluator: frozen `2.0.0`
- Schema: frozen `2`
- Frozen corpus: 9/9

| Metric | Starting value |
|---|---:|
| Overall | 69.439% |
| Pitch | 72.329% |
| Rhythm | 80.468% |
| Sustain | 55.556% |
| Articulation | 87.033% |
| Measure structure | 77.343% |
| High-extreme exact | 25% (5/20) |
| High-extreme missing / extra | 23 / 21 |
| Low-extreme exact / missing / extra | 76.47% / 6 / 2 |
| Guitar-standard Pitch / Rhythm | 86.09% / 100% |
| Total fixture defects | 803 |

Fresh autonomous reproduction matched the handoff exactly.

## Ranked experiment backlog

| Rank | Hypothesis / subsystem | Expected metrics | Main risk | Final status |
|---:|---|---|---|---|
| 1 | Page-local exact-font/glyph notehead fallback calibration from trusted ink anchors | Pitch, chord accuracy, register bins, Rhythm alignment | Mixed fonts, circular samples, transformed glyphs | Accepted in `b75543f`; combined with downstream accidental fixes |
| 2 | Optical-Y accidental matching after calibrated notehead correction | Pitch, incorrect chord, high-extreme missing/extra | Reassigning false/weak accidentals | Boundary variants rejected; calibrated-only form accepted in `fba1f27` |
| 3 | Remove duplicate direct-plus-composite vector accidental detections | Incorrect pitch/chord and invented alterations | Losing genuinely fragmented sharps | Accepted in `39eb37e` |
| 4 | Page/type vector-accidental horizontal calibration from trusted noteheads | Dense ownership, Pitch, Measure structure | Applying a page model to weak note targets; runtime | Accepted with trust gate in `180be5b` |
| 5 | Use high-confidence ink optical centers for all accidental matching | Piano-grand Pitch/Measure structure | Broad ownership changes | Accepted in `50a3ea3` |
| 6 | Reset accidental state per dense chord or infer unprinted naturals | Remaining high-extreme semitone errors | Inventing unsupported naturals and violating notation | Rejected: source PDF has no cancellation signs |
| 7 | Joint anchor/ledger/accidental inference | Remaining high-register errors | Complexity and wrong octave/staff changes | Deferred: final residuals are alteration-state/source conflicts, not anchor errors |
| 8 | New local raster anchor or fragment recovery | Missing tones | False ownership and ~2x page time | Not repeated unchanged; prior exact implementations were source-neutral or harmful |
| 9 | Scanned-score pitch overhaul | Global Pitch, articulation scan | Requires a different image-recognition model/training data | Recommended next architectural investment |

## Experiment 1 — self-calibrated glyph fallback

- **Hypothesis:** trusted ink anchors from the same runtime page, exact embedded font, and exact notehead glyph can estimate glyph-origin-to-optical-center offset in staff spaces; rejected anchors can use the stable estimate without evaluator truth.
- **Evidence:** 43/60 high-extreme tones were approximately one diatonic step low after ink anchoring rejected and glyph metrics took over. Trusted centers clustered near 0.50–0.51 staff spaces above origin, while fallback metrics were near 0.23–0.32.
- **Subsystem:** notehead fallback calibration and vector-page orchestration.
- **Expected metrics:** Pitch, incorrect pitch/chord, high-extreme exact/missing/extra, and possible Rhythm alignment.
- **Regression risks:** mixed fonts, self-use, scale mismatch, too few samples, and broad one-step shifts.
- **Implementation:** page-local exact font/glyph/legacy/scale key; trusted ink sources only; minimum six independent samples; median/MAD trimming; 80% inlier floor; leave-one-out stability; glyph-size compatibility; only approved ink-rejection reasons; unknown and legacy fonts retain prior behavior; provenance is recorded.
- **Focused tests:** seven new model tests plus protected pitch/ledger/anchor suites; 59/59 passed at acceptance.
- **Corpus result:** Overall 69.439→70.224%; Pitch 72.329→72.762%; Rhythm 80.468→81.226%; Articulation 87.033→90.598%; Measure 77.343→78.083%; defects 803→732; no fixture regression; generated-note count unchanged.
- **Source-PDF visual result:** corrected staff centers matched printed noteheads. They exposed a downstream failure in which accidentals were matched against stale raw glyph Y.
- **Performance:** post-commit frozen run 3.70s, peak RSS about 399 MiB.
- **Decision:** **ACCEPT + COMBINE**, commit `b75543f` (`fix(omr): calibrate glyph fallback from trusted notehead anchors`). Isolated high-extreme exact moved 25→15%, so accidental ownership became the next root cause rather than a reason to discard the global/source-correct gain.

## Experiment 2 — geometric accidental ownership guards

- **Hypothesis:** center separation, measure-boundary separation, or strict column-first ownership can stop dense accidentals from crossing into neighboring tones.
- **Evidence:** Experiment 1 exposed F→F#, A→A#, and E→E# alterations after natural staff positions were corrected.
- **Subsystem:** local vector accidental ownership.
- **Expected metrics:** high-extreme exact/missing/extra and incorrect pitch/chord.
- **Regression risks:** dropped valid accidentals and Guitar false-flat reassignment.
- **Implementations tried:** (a) simple center guard, (b) boundary-aware separation, and (c) strict column-first matching.
- **Focused/targeted results:** simple and boundary variants reached 20% high-extreme exact; strict column-first fell to 10%. Boundary reduced high-extreme missing/extra to 20/20 but did not solve ownership generally.
- **Corpus/source result:** the boundary guard reassigned a false `vector-ink` flat to B3 in Guitar measure 2; accidental carry changed four visibly natural B chords to B-flat.
- **Performance:** neutral.
- **Decision:** **REJECT/REVERT** all three exact implementations. No code remained.

## Experiment 3 — optical accidental Y with boundary guard

- **Hypothesis:** accidental matching should use the resolved optical notehead Y, not the PDF glyph origin, after notehead calibration.
- **Evidence:** pitch was corrected before accidental assignment, but assignment still scored against stale `cy`.
- **Subsystem:** accidental-to-note geometry.
- **Expected metrics:** Pitch, high-extreme exact/missing/extra, incorrect chord.
- **Regression risks:** broader accidental reassignment and interaction with the boundary guard.
- **Implementation:** optical Y for calibrated anchors while retaining the Experiment 2 boundary restriction.
- **Focused tests:** calibrated optical-position regression passed.
- **Corpus result:** Overall 70.792%, Pitch 74.987%, Measure 79.839%; high-extreme exact 30%, missing/extra 14/14; global register exact 54.35%.
- **Source/Guitar result:** Guitar Overall 81.27→80.92%, Pitch 86.09→85.22%, Measure 82.81→81.25%; printed natural B chords regressed.
- **Performance:** neutral.
- **Decision:** **REVISE**. Optical Y was supported; the boundary restriction was removed.

## Experiment 4 — calibrated optical Y without boundary guard

- **Hypothesis:** retain source-supported optical Y only for page-calibrated anchors and otherwise preserve legacy ownership.
- **Evidence:** Experiment 3 isolated the boundary guard as the Guitar regression.
- **Subsystem:** accidental-to-note matching and provenance.
- **Expected metrics:** recover Guitar, keep global and high-register gains.
- **Regression risks:** accidental reassignment outside calibrated notes.
- **Implementation:** calibrated anchors use `yNorm`; uncalibrated anchors preserve legacy geometry; boundary restriction removed; exact optical provenance recorded.
- **Focused tests:** current alteration/vector/calibration suite passed.
- **Corpus result:** Overall 70.851%; Pitch 75.034%; Rhythm 81.226%; Measure 80.204%; incorrect pitch 126; incorrect chord 133; no fixture regression.
- **Register result:** global exact 54.35%; high-extreme 35%, missing/extra 13/13; low-extreme unchanged.
- **Source/Guitar result:** Guitar Pitch 89.57%, Rhythm 100%, Measure 89.06%; the natural B chords were restored.
- **Performance:** 3.74s frozen run, peak RSS about 396 MiB.
- **Decision:** **ACCEPT**, commit `fba1f27` (`fix(omr): match accidentals to calibrated notehead anchors`).

## Experiment 5 — duplicate composite accidental suppression

- **Hypothesis:** a path already classified as a complete accidental must not also enter the fragment cluster pool, which can emit a second accidental from the same ink.
- **Evidence:** dense traces showed direct and composite detections sharing complete path members.
- **Subsystem:** vector path accidental detection.
- **Expected metrics:** incorrect pitch/chord, duplicate alteration false positives, register exactness.
- **Regression risks:** suppressing genuinely fragmented multi-path sharps.
- **Implementation:** complete direct accidentals and augmentation dots are excluded from fragment clustering; separately painted sharp strokes remain eligible; direct `reason` provenance propagates.
- **Focused tests:** reproduced the duplicate before the fix; 32/32 vector path tests passed after it, including genuine fragmented sharps.
- **Corpus result:** Overall 70.983%; Pitch 75.382%; Measure 80.781%; incorrect pitch 117; incorrect chord 126; no regression.
- **Register result:** global exact 57.39%; high-extreme 40%, missing/extra 12/12; low-extreme unchanged.
- **Source-PDF result:** one printed accidental now yields one semantic accidental; no valid note content is deleted.
- **Performance:** 3.64s, peak RSS about 391 MiB.
- **Decision:** **ACCEPT**, commit `39eb37e` (`fix(omr): prevent duplicate composite accidentals`). The frozen comparator's minimum-improvement heuristic said NO, but the change was a source-correct Pareto improvement with no gate regression.

## Experiment 6 — page-calibrated vector accidental ownership

- **Hypothesis:** direct vector accidentals have a stable page/type engraving offset from their owning note column that can be learned from trusted optical noteheads without truth.
- **Evidence:** nearest-X ownership still chose the wrong dense column after optical pitch correction; the dense page supplied repeated direct sharp paths and trusted noteheads.
- **Subsystem:** new `accidentalPathCalibration` model, page orchestration, matching, and diagnostics.
- **Expected metrics:** dense Pitch/Measure structure, incorrect pitch/chord, high-normal exactness.
- **Regression risks:** repeated-spacing alias modes, mixed engraving, scaling, weak note targets, unknown fonts, page runtime.
- **Implementation:** direct `-opN` vector paths only; sharp/flat/natural models isolated; confidence ≥0.85; trusted notehead confidence ≥0.8; 0.5–3.2 staff-space candidate range; optical-Y residual ≤0.2; minimum eight distinct paths and note columns across at least two measures; dominant-mode, runner-up, MAD/span, and leave-one-measure-out gates; scale normalization; unknown/sparse/multimodal pages abstain. Accepted models rescore horizontal residuals. A review follow-up preserved legacy matching for untrusted target noteheads and made diagnostic Y exactly match the scored Y.
- **Focused tests:** failure reproduced before implementation; scale, sparse, multimodal, leave-one-measure-out, unknown-type, untrusted-anchor, page integration, and ownership tests added; 63/63 focused tests passed after the safety amendment.
- **Corpus result:** Overall 71.051%; Pitch 75.613%; Measure 81.028%; incorrect pitch 111; incorrect chord 123; other classes stable; eight fixtures unchanged.
- **Register result:** before the final optical expansion, global exact 58.26%; high-extreme 40%, missing/extra 12/12.
- **Held-out result:** on six unrelated user PDFs / 22 pages, the path model abstained because those PDFs exposed accidentals as font glyphs rather than qualifying direct paths; no notes/measures/failures changed.
- **Performance:** post-commit frozen run 1.99s in the final environment, peak RSS about 392 MiB. The implementation can perform a second measure reconstruction on a qualifying page; heavy-score validation is required.
- **Decision:** **ACCEPT WITH SAFETY REVISION**, final commit `180be5b` (`fix(omr): calibrate vector accidental ownership from page geometry`). The preliminary `77e5aec` hash was amended and is not an accepted final hash.

## Experiment 7 — all high-confidence optical notehead centers

- **Hypothesis:** a high-confidence ink notehead center is already stronger vertical evidence than raw glyph origin, even when a page fallback calibration was unnecessary.
- **Evidence:** the path-calibration review made trust explicit; a piano-grand sharp was still assigned to the upper B rather than the visually aligned G-sharp when legacy `cy` was used.
- **Subsystem:** accidental matching trust policy.
- **Expected metrics:** piano-grand Pitch/Measure structure and high-normal exactness.
- **Regression risks:** weak ink anchors and Guitar ownership.
- **Implementation:** use optical Y for `ink-notehead-geometry`, `ledger-masked-ink-notehead-geometry`, or self-calibrated anchors only when confidence is at least 0.8; all other notes retain legacy geometry.
- **Focused tests:** a failing competing-note fixture was added; 64/64 campaign-focused tests passed.
- **Corpus result:** Overall 71.051→71.094%; Pitch 75.613→75.740%; Measure 81.028→81.201%; incorrect pitch 111→110; incorrect chord 123→122; all other fixtures/classes stable.
- **Register result:** global exact 58.70%; high-normal 52.13%; high-extreme unchanged at 40%; low-extreme unchanged.
- **Source-PDF visual result:** piano-grand measure 3 visibly prints one sharp aligned to the middle G of an E–G-sharp–B chord. Legacy origin scoring sharpened the B to C; trusted optical Y assigns the sharp to G and restores the printed B. The affected chord and evaluator both improve.
- **Performance:** 1.96s frozen run, peak RSS about 400 MiB; no extra pass is introduced.
- **Decision:** **ACCEPT**, commit `50a3ea3` (`fix(omr): match accidentals to trusted optical notehead centers`).

## Experiment 8 — accidental-state reset / unprinted naturals

- **Hypothesis:** resetting alteration state at each dense chord could match the remaining hidden expected naturals.
- **Evidence considered:** every final high-extreme mismatch is a one-semitone natural→sharp pair (D→D-sharp, F→F-sharp, or G→G-sharp).
- **Subsystem:** measure accidental-state propagation.
- **Expected metrics:** high-extreme exact could rise sharply against hidden MusicXML.
- **Regression risks:** violating standard accidental carry and inventing unprinted natural signs.
- **Source-PDF/generator verification:** the benchmark renderer calls `draw_path_accidental` only when MIDI `alter` is nonzero. It never emits a natural cancellation for a later natural note and does not track within-measure accidental state. High-resolution measures 5–8 show sharps but no natural signs. Under standard notation, those sharps remain in force for the measure.
- **Focused/corpus/performance:** no production implementation was permitted because the needed PDF evidence does not exist; a truth-only reset would be evaluator gaming.
- **Decision:** **REJECT**. Keep source-correct sharp carry and record the PDF/MusicXML inconsistency as the remaining high-extreme blocker.

## Accepted commit metrics

| Commit | Overall | Pitch | Rhythm | Measure | Incorrect pitch | Incorrect chord |
|---|---:|---:|---:|---:|---:|---:|
| Start `beeb5f0` | 69.439% | 72.329% | 80.468% | 77.343% | 168 | 160 |
| `b75543f` | 70.224% | 72.762% | 81.226% | 78.083% | 163 | 151 |
| `fba1f27` | 70.851% | 75.034% | 81.226% | 80.204% | 126 | 133 |
| `39eb37e` | 70.983% | 75.382% | 81.226% | 80.781% | 117 | 126 |
| `180be5b` | 71.051% | 75.613% | 81.226% | 81.028% | 111 | 123 |
| `50a3ea3` | 71.094% | 75.740% | 81.226% | 81.201% | 110 | 122 |

All accepted states remained 9/9 on evaluator 2.0.0/schema 2. Final generated-note count is unchanged at 863; total fixture defects are 803→650.

## Final register scoreboard

| Register | Start exact | Final exact | Start missing / extra | Final missing / extra |
|---|---:|---:|---:|---:|
| Low-extreme | 76.47% | 76.47% | 6 / 2 | 6 / 2 |
| Low-normal | 65.22% | 72.46% | 31 / 36 | 25 / 30 |
| Middle | 40.00% | 50.00% | 15 / 21 | 12 / 18 |
| High-normal | 24.47% | 52.13% | 103 / 122 | 63 / 80 |
| High-extreme | 25.00% | 40.00% | 23 / 21 | 12 / 12 |
| All bins | 42.61% | 58.70% | 178 / 202 | 118 / 142 |

## Final validation status

- Final HEAD: 50a3ea39ce45d61dde470d636ee27f6ed44a2e21; tracked production/test/package state clean.
- Frozen semantic corpus: 9/9 at Overall 71.094%, evaluator 2.0.0/schema 2.
- Campaign-focused tests: 64/64 passed.
- All OMR regression tests: 101/101 files, 1,007/1,007 tests passed.
- Evaluator tests: 27/27 passed; CLI self-check 100% with zero defects.
- Protected Guitar/TAB, microphone, playback/audio, ownership/switching, report/export, and acceptance/warning tests: 68/68 files, 802/802 tests passed.
- Full suite: 284/284 files, 2,878 passed, 5 skipped, 0 failed.
- Production build: passed; 1,497 modules transformed.
- Heavy-score performance harness: passed all assertions; dense 802-note score cold/hot parse 20.354/0.480 ms.
- Final six-PDF held-out: 22/22 pages, 6,912 notes, 613 measures, six uncertain measures, zero failures, source fingerprint stable; both calibration models safely abstained.
- Complete results and remaining limitations are recorded in AUTONOMOUS_OMR_CAMPAIGN_REPORT.md.
