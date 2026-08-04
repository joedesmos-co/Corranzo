# Autonomous Corranzo OMR improvement campaign

## Executive outcome

The campaign accepted five separately committed, evidence-driven fixes. The final state is a Pareto improvement over the verified baseline: Overall, Pitch, Rhythm, Articulation, Measure structure, high-register recognition, Guitar-standard recognition, and total defect count all improved; Sustain, Interpretation, playback, protected Guitar/TAB fixtures, and generated-note count remained stable.

- Starting HEAD: beeb5f066e7bdcb3043df5fa001c92abdadb0088
- Final HEAD: 50a3ea39ce45d61dde470d636ee27f6ed44a2e21
- Accepted commits: 5
- Frozen corpus: 9/9 at every accepted state
- Evaluator: 2.0.0, unchanged
- Schema: 2, unchanged
- Generated-note count: 863 before and after
- Total fixture defects: 803 → 650 (-153, -19.05%)

The strongest remaining high-extreme discrepancy cannot be safely fixed from the visible PDF: the benchmark PDF omits natural-cancellation signs required by its hidden MusicXML. Production continues to follow the printed notation instead of evaluator-only truth.

## Repository verification and integrity

The expected starting HEAD, beeb5f066e7bdcb3043df5fa001c92abdadb0088, was verified before any implementation work. Tracked production and test files were clean. Existing tracked and untracked research artifacts under tmp/ were left in place; none were reset, staged, or committed.

The final HEAD is 50a3ea39ce45d61dde470d636ee27f6ed44a2e21. Final production/test/package status is clean. The five commits change only OMR production code and focused regression tests: 10 files, 2,388 insertions, and 16 deletions. Temporary diagnostics, source PDFs, crops, inventories, private paths, and reports are not committed.

The semantic evaluator implementation, its frozen tolerances, the evaluator CLI, and corpus evaluator have no diff from the starting HEAD. Dedicated tests and CLI self-check independently confirm evaluator 2.0.0 and schema 2.

## Root-cause clusters considered

1. Systematic glyph fallback vertical error after trusted ink anchoring rejects.
2. Accidental ownership using stale glyph-origin Y after a notehead's optical center is corrected.
3. One complete accidental path being emitted both directly and again through fragment clustering.
4. Dense-column accidental ownership requiring a page/type-specific horizontal engraving model.
5. Valid high-confidence ink optical centers being ignored when no fallback calibration was needed.
6. Ledger-line classification, clef/octave handling, and extreme-register quantization.
7. Accidental state propagation and the remaining natural-versus-sharp discrepancies.
8. Local raster anchor and fragment-recovery approaches from earlier campaigns.
9. Scanned-score pitch and articulation recognition.
10. A future joint anchor/ledger/accidental inference architecture.

The first five clusters yielded safe production improvements. Ledger/clef changes were not justified after the accepted fixes eliminated final high-extreme octave and wrong-staff errors. Accidental-state reset was rejected because it contradicted visible notation. The unchanged raster designs were not repeated because their exact prior implementations were source-neutral or harmful and materially slower. Scanned-score recognition remains a separate architectural need.

## Ranked experiment backlog and disposition

| Rank | Candidate | Main target | Final disposition |
|---:|---|---|---|
| 1 | Exact font/glyph notehead fallback calibration from trusted page anchors | Pitch and register errors | Accepted, b75543f |
| 2 | Optical-Y accidental matching | Pitch and chord ownership | Boundary variants rejected; calibrated form accepted, fba1f27 |
| 3 | Duplicate complete/composite accidental suppression | Invented alterations | Accepted, 39eb37e |
| 4 | Page/type vector accidental horizontal calibration | Dense column ownership | Accepted with trust-gate revision, 180be5b |
| 5 | Trusted optical centers for all high-confidence ink anchors | Piano-grand ownership | Accepted, 50a3ea3 |
| 6 | Per-chord accidental reset / inferred unprinted naturals | Residual high-extreme semitones | Rejected as unsupported and evaluator-only |
| 7 | Joint anchor/ledger/accidental inference | Residual register errors | Deferred; current residual is not an octave/staff anchor failure |
| 8 | New raster anchor/fragment recovery | Missing tones | Prior exact forms remain rejected; no stronger safe new signal found |
| 9 | Scanned-score recognition model | Scan fixture Pitch/articulation | Recommended next architectural investment |

## Experiments attempted

### 1. Self-calibrated glyph fallback

The production model learns the glyph-origin-to-optical-notehead offset only from trustworthy anchors on the same page and the exact same embedded font/glyph/legacy/scale class. It requires at least six independent samples, robust median/MAD consistency, an 80% inlier floor, leave-one-out stability, compatible glyph scale, and an approved ink-rejection reason. Sparse, unstable, mixed, and unknown classes abstain and retain legacy behavior.

This corrected the demonstrated one-diatonic-step fallback family without using expected notes. It improved global metrics and exposed stale accidental coordinates as the next failure stage. Although isolated high-extreme exact accuracy initially fell from 25% to 15%, no fixture regressed overall, generated-note count stayed fixed, and global/source correctness improved. The change was accepted and deliberately combined with the downstream ownership work.

### 2. Geometric accidental guards

Three materially different variants were tested: a simple center-separation guard, a measure-boundary-aware guard, and strict column-first matching. They reached only 20%, 20%, and 10% high-extreme exact accuracy respectively. The boundary variant reassigned a false vector-ink flat to B3 in the Guitar-standard fixture; accidental carry then changed four visibly natural B chords to B-flat. All exact variants were fully reverted.

### 3–4. Optical accidental Y, revised

Using calibrated optical Y while retaining the boundary guard reached 30% high-extreme exact and improved global Pitch, but Guitar-standard Pitch fell from 86.09% to 85.22%. Source inspection isolated the boundary rule, not optical Y, as the regression. Removing that rule and restricting optical Y to calibrated anchors restored and improved Guitar, raised high-extreme exact to 35%, and was accepted.

### 5. Duplicate composite accidental suppression

Tracing showed that a complete directly classified accidental path could also enter fragment clustering and produce a second semantic accidental from the same ink. Complete direct accidentals and augmentation dots are now excluded from the fragment pool, while genuinely fragmented multi-stroke sharps remain eligible. The focused pre-fix failure was reproduced, the corrected behavior was covered, and high-extreme exact reached 40%.

### 6. Page-calibrated vector accidental ownership

The new page/type model learns the horizontal offset between qualifying direct vector accidental paths and trusted optical notehead columns. It isolates sharp, flat, and natural models; normalizes by staff gap; requires path confidence at least 0.85, notehead confidence at least 0.8, at least eight distinct paths and note columns across at least two measures, bounded X/Y residuals, a dominant mode, stable median/MAD/span, runner-up separation, and leave-one-measure-out stability. Sparse, multimodal, unknown, and unstable pages abstain.

A preliminary implementation could apply calibrated scoring to untrusted target noteheads. Review correctly treated that as unsafe. The accepted revision preserves legacy matching for such targets and records the exact Y used for scoring. The unsafe preliminary hash 77e5aec3939527815b40b465db19eff4dd313571 is superseded and is not an accepted commit.

### 7. Trusted optical notehead centers

A final focused fixture demonstrated that a high-confidence ink center already provides better accidental Y evidence than a raw PDF glyph origin, even when no fallback calibration is required. The accepted rule uses optical Y only for ink-notehead-geometry, ledger-masked-ink-notehead-geometry, or self-calibrated anchors at confidence at least 0.8. All untrusted notes retain legacy geometry.

In the piano-grand source, measure 3 visibly prints one sharp aligned with the middle G of an E–G-sharp–B chord. Legacy origin scoring sharpened the upper B into C; trusted optical scoring assigns the sharp to G and restores the printed B. Both the source and evaluator improve.

### 8. Accidental-state reset / inferred naturals

All final high-extreme mismatches are one-semitone natural-to-sharp pairs: D/D-sharp, F/F-sharp, or G/G-sharp. The benchmark renderer emits a sharp when the note's alteration is nonzero, but does not emit natural-cancellation signs or track within-measure accidental state. High-resolution inspection of affected measures confirms sharps and no cancellation signs. Standard notation therefore carries the sharp through the measure.

A reset could increase the hidden-answer score only by inventing naturals absent from the PDF. No production implementation was made; this experiment was rejected as evaluator gaming.

## Revised and combined fixes

- The glyph-fallback calibration was retained despite its isolated first-pass high-extreme tradeoff because it fixed the demonstrated visual anchor error and improved the corpus; it was then combined with optical accidental ownership so downstream semantics used the corrected geometry.
- Optical-Y matching was separated from the harmful boundary guard. The evidence-backed optical component landed; the Guitar-regressing guard did not.
- Page/type accidental calibration was safety-revised after review. The accepted commit requires trusted optical target notes, preserves legacy scoring otherwise, and makes its diagnostic provenance match the exact geometry scored.
- The final trusted-optical-center fix generalized the calibrated-anchor result only to independently high-confidence ink anchors. It remained conservative for weak/unknown anchors.

## Accepted fixes and commits

| Commit | Exact fix |
|---|---|
| b75543f78c42d5d2cc2c77f4efa497271807ce4c | Calibrate rejected glyph fallback from stable, same-page, exact-font/glyph trusted notehead anchors |
| fba1f275456d3ab5dc77652700bbee8425eaba73 | Match accidentals to calibrated optical notehead Y while preserving legacy matching elsewhere |
| 39eb37e12090b0f0def41eb4221c5b85c83e0818 | Prevent complete direct accidental paths from being emitted again as composite accidentals |
| 180be5bd8dc7c2e82f965055355f378f04ba94fc | Calibrate direct vector accidental ownership from stable page/type geometry with trust and held-out gates |
| 50a3ea39ce45d61dde470d636ee27f6ed44a2e21 | Match accidentals to high-confidence trusted ink optical centers, preserving legacy geometry for weak targets |

## Per-commit frozen-corpus metrics

Every row is evaluator 2.0.0/schema 2 and 9/9 fixtures.

| State | Overall | Pitch | Rhythm | Measure | Incorrect pitch | Incorrect chord | Total defects |
|---|---:|---:|---:|---:|---:|---:|---:|
| Start beeb5f0 | 69.439% | 72.329% | 80.468% | 77.343% | 168 | 160 | 803 |
| b75543f | 70.224% | 72.762% | 81.226% | 78.083% | 163 | 151 | 732 |
| fba1f27 | 70.851% | 75.034% | 81.226% | 80.204% | 126 | 133 | 677 |
| 39eb37e | 70.983% | 75.382% | 81.226% | 80.781% | 117 | 126 | 661 |
| 180be5b | 71.051% | 75.613% | 81.226% | 81.028% | 111 | 123 | 652 |
| 50a3ea3 | 71.094% | 75.740% | 81.226% | 81.201% | 110 | 122 | 650 |

## Final corpus before/after

| Metric | Start | Final | Delta |
|---|---:|---:|---:|
| Overall | 69.439% | 71.094% | +1.656 pp |
| Pitch | 72.329% | 75.740% | +3.411 pp |
| Rhythm | 80.468% | 81.226% | +0.758 pp |
| Sustain | 55.556% | 55.556% | 0 |
| Articulation | 87.033% | 90.598% | +3.564 pp |
| Measure structure | 77.343% | 81.201% | +3.858 pp |
| Interpretation | 13.333% | 13.333% | 0 |
| Playback | 100% | 100% | 0 |
| Total defects | 803 | 650 | -153 |
| Incorrect pitch | 168 | 110 | -58 |
| Incorrect chord | 160 | 122 | -38 |
| Onset mismatch | 113 | 81 | -32 |
| Extra notes | 105 | 101 | -4 |
| Missing notes | 72 | 68 | -4 |
| Duration mismatch | 83 | 83 | 0 |
| Missing accents | 28 | 11 | -17 |

Only three fixtures changed; the other six were exactly stable:

| Fixture | Overall | Pitch | Rhythm | Measure | Defects |
|---|---:|---:|---:|---:|---:|
| Piano grand voices | 75.80→77.99% | 69.32→78.41% | 100→100% | 81.25→87.50% | 42→30 |
| Piano dense advanced | 65.91→77.23% | 55.48→73.61% | 91.31→98.13% | 46.67→68.89% | 261→128 |
| Guitar standard | 81.27→82.66% | 86.09→89.57% | 100→100% | 82.81→89.06% | 28→20 |

## Register results

| Register | Start exact | Final exact | Start missing / extra | Final missing / extra |
|---|---:|---:|---:|---:|
| Low-extreme | 76.47% | 76.47% | 6 / 2 | 6 / 2 |
| Low-normal | 65.22% | 72.46% | 31 / 36 | 25 / 30 |
| Middle | 40.00% | 50.00% | 15 / 21 | 12 / 18 |
| High-normal | 24.47% | 52.13% | 103 / 122 | 63 / 80 |
| High-extreme | 25.00% | 40.00% | 23 / 21 | 12 / 12 |
| All bins | 42.61% (98/230) | 58.70% (135/230) | 178 / 202 | 118 / 142 |

High-extreme incorrect pitches fell from 44 to 24. Final high-extreme output has zero octave errors, zero wrong-staff errors, zero duplicate physical-notehead ownership, and zero dropped physical candidates. The remaining 12 chords are the unsupported-natural family described above.

## Guitar/TAB safety and improvements

| Fixture | Pitch start→final | Rhythm start→final | Measure start→final |
|---|---:|---:|---:|
| Guitar TAB sparse | 70→70% | 17.19→17.19% | 92.31→92.31% |
| Guitar standard | 86.09→89.57% | 100→100% | 82.81→89.06% |
| Guitar paired | 58.45→58.45% | 92.78→92.78% | 55→55% |
| Guitar techniques | 100→100% | 100→100% | 100→100% |

The transient Guitar regression from the rejected boundary guard did not land.

## Source-PDF visual findings

- High-extreme benchmark crops confirm that accepted vertical calibration moves fallback centers onto printed noteheads rather than merely changing semantic labels.
- Piano-grand measure 3 confirms the corrected sharp belongs to G, not the upper B.
- Dense measures 5–8 confirm that the remaining expected naturals have no printed cancellation signs.
- The supplied real-world PDFs were used as an unrelated, source-stable held-out set. Their pages were not used as evaluator truth or runtime hardcodes.
- No physical-device, audible-speaker, manual browser-interaction, or exhaustive human transcription validation is claimed.

## Anti-overfitting and held-out validation

Synthetic tests cover scale changes, sparse samples, multimodal samples, unknown accidental types, leave-one-measure-out instability, untrusted targets, exact font/glyph isolation, genuine fragmented sharps, and unknown-font conservative fallback.

The final code was rerun source-stably on all six user-supplied PDFs:

| PDF | Pages | Notes | Measures | Confidence | Uncertain | Failures | Time | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Twinkle chord substitutions | 1 | 112 | 32 | 0.8531 | 1 | 0 | 0.467s | 217.4 MiB |
| Ao no Sumika | 4 | 1,123 | 73 | 0.8528 | 2 | 0 | 2.332s | 426.3 MiB |
| Aria Math | 6 | 1,745 | 194 | 0.8592 | 1 | 0 | 3.088s | 540.3 MiB |
| AIZO | 3 | 1,075 | 61 | 0.8650 | 0 | 0 | 1.857s | 375.9 MiB |
| Merry-Go-Round of Life | 7 | 2,594 | 229 | 0.8551 | 2 | 0 | 3.964s | 576.2 MiB |
| Sweden | 1 | 263 | 24 | 0.8650 | 0 | 0 | 0.560s | 210.5 MiB |
| Total | 22 | 6,912 | 613 | — | 6 | 0 | 12.268s | — |

The final output fingerprint was stable from start to end. All 22 pages processed and no page had a fatal or partial failure. These PDFs exposed only two eligible notehead calibration samples; both were singleton insufficient-samples rejections. They exposed zero qualifying direct accidental paths. Therefore the new models safely abstained: zero notehead models/corrections and zero accidental-path models/attachments. Notes, measures, uncertainty, and failures are identical to the preliminary held-out run.

Because no reference MusicXML was supplied for these six PDFs, this is a robustness, determinism, and abstention audit—not a semantic-accuracy claim.

## Performance

- Final frozen corpus: approximately 1.96s, peak RSS 418,906,112 bytes (about 399.5 MiB).
- Final six-PDF held-out run: 12.268s total; largest isolated-process peak RSS 576.2 MiB.
- Heavy-score harness passed all assertions.
- Dense score: 802 notes / 49 measures; cold parse 20.354 ms; cached parse 0.480 ms; cold visual groups 2.074 ms; cached visual groups 0.002708 ms; 35 windowed groups in 0.008459 ms.
- Harness assertions passed for hot parse cache use, smaller visual window, dense relative parse budget, and visual cache speedup.

Campaign timings were recorded under differing process conditions and are treated as safety observations, not as a controlled speedup claim. No severe runtime or memory regression was observed.

## Complete validation

| Gate | Result |
|---|---|
| Frozen semantic corpus | 9/9; Overall 71.094%; evaluator 2.0.0/schema 2 |
| Campaign-focused tests | 64/64 passed |
| All OMR regression tests | 101/101 files; 1,007/1,007 tests passed; 0 skipped |
| Evaluator tests | 2/2 files; 27/27 tests passed |
| Evaluator CLI self-check | 100% Overall/alignment; 0 defects; 16/16 notes; 4/4 measures |
| Protected subsystems combined | 68/68 files; 802/802 tests passed; 0 skipped |
| Guitar/TAB subset | 175 passed |
| Microphone recognition subset | 284 passed |
| Playback/audio subset | 162 passed |
| Instrument ownership/switching subset | 128 passed |
| Report/export subset | 39 passed |
| Acceptance/warning subset | 14 passed |
| Full unit suite | 284/284 files; 2,878 passed; 5 skipped; 0 failed |
| Production build | Passed; 1,497 modules transformed |
| Heavy-score harness | Passed; all four assertions true |
| Final held-out PDFs | 22/22 pages; 0 failures; source fingerprint stable |

Automated microphone, playback, ownership, switching, report, and warning tests passed. No physical microphone, audible playback, browser download gesture, or manual UI-session validation is claimed. The production build retains its pre-existing large-chunk warning; it is not an OMR correctness failure.

## Rejected fixes and exact reasons

- Simple center, boundary-aware, and strict column-first accidental guards: weak high-extreme results and a source-visible Guitar B→B-flat regression.
- Optical Y plus boundary guard: global/high-extreme gain, but the guard caused Guitar regression; revised by dropping the guard and keeping evidence-backed optical Y.
- Unsafe preliminary page calibration 77e5aec: could score untrusted target noteheads; replaced by trust-gated 180be5b.
- Per-chord accidental reset / inferred naturals: contradicts the visible source and would use evaluator-only knowledge.
- Previously tested static optical profiles, local raster anchors, dense ledger erasure, and component recovery: exact implementations were neutral or harmful, created false positives, or imposed excessive page cost. Their general ideas remain revisitable only with materially new evidence.

## Remaining limitations and blocker

The residual high-extreme score is limited by a source/ground-truth inconsistency, not a safe production-time signal: hidden MusicXML expects naturals that the benchmark PDF does not print. Correcting those 12 chords would require changing the benchmark source renderer/answers, adding missing natural signs, or deliberately violating the visible PDF. All are outside this campaign's permitted production fix.

Other material limitations remain:

- The raster-scanned articulation fixture remains the weakest Pitch fixture and needs symbol-instance recognition beyond the current vector-centric architecture.
- Dense scores still contain chord/onset/duration errors, though the accepted changes reduced them substantially.
- The page accidental-path model only activates for qualifying direct vector paths; font-glyph accidentals correctly remain outside that model.
- Interpretation and sustain did not move because this campaign found no safe evidence-driven intervention in those classes.

## Recommended next architectural investment

Build a joint visual symbol-instance graph for scanned and mixed scores. It should infer notehead center, staff/clef ownership, ledger evidence, stem/beam/voice, accidental instance and state, and chord column together, with uncertainty and provenance on every edge. Train or validate it from source-labeled symbol geometry rather than evaluator answers, retain the current conservative vector fallbacks, and add real held-out PDFs with independently transcribed MusicXML. That investment addresses the remaining raster weakness and gives future accidental/state work actual printed-symbol evidence instead of forcing semantic guesses.

## Artifacts

- AUTONOMOUS_EXPERIMENT_LOG.md — chronological backlog and experiment decisions
- commit-50a3ea3-semantic.json — final frozen-corpus evidence
- final-register/PHASE_1_HIGH_EXTREME_BASELINE.md — final register inventory
- heldout-final-summary.md and heldout-final-summary.json — final six-PDF robustness audit
