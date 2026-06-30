# OMR Engine Checkpoint

Last updated: 2026-06-30

This document is the handoff checkpoint for Corranzo/ScoreFlow PDF OMR work. It
exists to prevent future sessions from repeating known failed paths.

## Non-Negotiables

- No servers. OMR must run locally/in-browser.
- No title, file, page, measure, or piece-specific hardcoding.
- Do not lower rejection gates just to make bad output pass.
- Preserve the existing PDF + MusicXML/MIDI workflow.
- Preserve PDF viewer stability, rotation/geometry, score-follow cursor, and
  Wait For You unless a task directly targets them.
- Every OMR change must be benchmark/evaluator-driven.
- If a change does not improve measured metrics or causes regressions, revert it
  or keep it diagnostics/simulation-only.

## Current Architecture

The main successful path is vector/digital OMR. Raster/scanned fallback exists
but is weaker.

High-level runtime flow:

```text
PDF page
  -> PDF text/vector extraction + rendered ImageData
  -> staff/system detection
  -> measure grid/barline detection
  -> vector notehead/rest/accidental/articulation/tie extraction
  -> rhythm inference and local event reconstruction
  -> MusicXML generation
  -> playback, score-follow anchors, diagnostics, evaluator reports
```

Important runtime modules:

| Area | Modules |
| --- | --- |
| Pipeline | `src/features/omr/runPdfOmrPipeline.js`, `src/features/omr/processOmrPage.js` |
| Vector OMR | `src/features/omr/processVectorOmrPage.js` |
| Measure/grid | `src/features/omr/buildOmrMeasureGrid.js`, `src/features/omr/omrMeasureGridDiagnostics.js` |
| Note recovery/dedupe | `src/features/omr/omrNoteDedupe.js`, `src/features/omr/vectorOrphanNoteheads.js` |
| Rhythm/events | `src/features/omr/reconstructMusicalEvents.js`, `src/features/omr/vectorRhythmDiagnostics.js` |
| MusicXML | `src/features/omr/buildOmrMusicXml.js` |
| Evaluation | `src/features/omr/omrAccuracyEvaluator.js`, `src/features/omr/omrBenchmarkDashboard.js` |
| Beam/stem diagnostics | `src/features/omr/beamStemReconstructionDiagnostics.js` |
| Beam ownership simulations | `src/features/omr/beamOwnershipSimulation.js`, `src/features/omr/beamOwnershipVoiceSimulation.js` |

Experimental beam/stem and beam ownership work is currently diagnostic or
simulation-only. Runtime MusicXML remains on the diagnostics-only baseline.

## Current Benchmark Snapshot

Source: `tmp/omr-benchmark-dashboard/report.md`, generated 2026-06-30.

| Fixture | Pitch | Duration | Onset | Chord | F1 | Measures | Notes | Wrong pitch | Wrong duration | Wrong onset | Chord mismatches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Gymnopedie clean | 100% | 100% | 100% | 100% | 100% | 78, delta 0 | 469, delta 0 | 0 | 1 | 0 | 0 |
| Cruel Angel dense | 34% | 81% | 72% | 66% | 89% | 127, delta +2 | 2808, delta -2 | 1533 | 223 | 480 | 1134 |

Dense benchmark interpretation:

- Note detection is nearly solved for the dense fixture: generated `2808` vs
  truth `2810`.
- Measure count is close: generated `127` vs truth `125`.
- Remaining errors are mostly musical-event/rhythm/voice interpretation and
  downstream matching artifacts.
- Pitch accuracy is low, but diagnosis showed many "pitch" errors are coupled to
  chord/onset/event grouping rather than direct staff-step mapping.

Clean benchmark interpretation:

- Clean Gymnopedie is a regression guard. Treat any clean metric movement as a
  serious warning unless the task is explicitly clean-score focused.

## Successful Improvements To Preserve

- Vector rhythm gap-to-next-onset fixed note durations stretching to barlines.
- Accidentals: improved local binding and hybrid key-relative carry-forward.
- Ties: conservative vector tie detection, MusicXML tie emission, and sustained
  playback.
- Rests: vector rest detection and mixed-measure rest insertion without shifting
  notes.
- Staccato: MusicXML parsing, sound-only playback shortening, vector detection.
- Accent: vector detection and playback velocity boost only.
- Dense barline filtering: false stem/chord barlines filtered; Cruel Angel
  measure count improved from about `162` to `127` vs truth `125`.
- Dense note dedupe: spatial dedupe replaced MIDI-only dedupe; generated notes
  improved from about `2686` to `2790`.
- Orphan notehead reassignment: recovered noteheads just outside measure boxes;
  generated notes improved to about `2808` vs truth `2810`.
- Dense chord/onset tuning: chord grouping improved from about `47.15%` to
  `65.92%`; onset from about `60.85%` to `70.68%`.
- Evaluator matching fix: pitch-prioritized global matching fixed a false pitch
  regression; dense pitch reported about `34.31%`.
- Per-clef voice duration extension: dense duration improved from about
  `74.31%` to `79.93%`.
- Terminal/sparse harmonic half-note fix: dense duration improved to about
  `80.25%`.
- Opening-bass/sparse-half and upper-staff chord overhang fixes lifted dense
  duration to the current `80.96%` baseline without clean/onset/chord/note-count
  regression.
- Musical Event Reconstruction produced small but measured chord improvements:
  chord grouping reached about `66.41%`, mismatch count `1134`.
- Beam/stem Phase 1 diagnostics proved that stem extraction is reliable enough
  to keep investing in diagnostics: dense stem attachment `99.96%`, beam
  attachment `32.76%`, average confidence about `0.8617`.

## Failed Or Reverted Approaches

Do not retry these blindly.

- Global staff-y offsets: regressed or did not help.
- Broad clef/staff remapping: tiny gains only.
- Full voice split pipeline: regressed badly.
- Broad foreign-clef duration extension: regressed.
- Beam guards: mostly neutral.
- Additional broad accidental/key work: tiny gains only.
- Global widening of x-gap reconstruction: regressed onset/pitch.
- Simple beam-based duration capping: reverted.
- Event-level beam caps:
  - Broad cap: duration `80.96% -> 80.11%`, wrong durations `223 -> 244`,
    onset regressed.
  - Tight cap: duration `80.96% -> 80.82%`, wrong durations `223 -> 227`.
  - Reason: beam evidence was valid but applied to the wrong abstraction. A beam
    can belong to one note/voice inside a mixed event, while the event also
    contains sustained or overlapping notes.

## Beam/Stem Diagnostic Findings

Source artifacts:

- `docs/OMR_BEAM_STEM_RECONSTRUCTION.md`
- `tmp/omr-benchmark-iter/beam-stem2/beam-cap-regression-analysis.md`
- `tmp/omr-benchmark-iter/beam-ownership1/beam-ownership-diagnostics.md`
- `tmp/omr-benchmark-iter/beam-ownership2/summary.md`
- `tmp/omr-benchmark-iter/beam-ownership3/summary.md`

Key findings:

- Stems are recoverable in dense vector PDFs with very high attachment.
- Beam attachment is useful but partial; it is not enough to overwrite duration.
- PDF noteheads are exposed through SMuFL text glyphs. Stems, beams, staff
  lines, barlines, and slurs are mostly low-level drawn primitives or rendered
  image evidence.
- The current production pipeline does not consume PDF operator-list primitives
  as semantic stems/beams.
- Rendered image analysis can recover useful stem/beam candidates, but they must
  be connected to notehead ownership and voice separation before runtime
  MusicXML uses them.
- Separate written duration from sounding sustain/playback duration before any
  future beam-derived runtime duration edit.

## Beam Ownership Simulation Outcomes

### Phase 2: Event Splitting Simulation

Source: `tmp/omr-benchmark-iter/beam-ownership2/summary.md`.

This split mixed ownership events into a beamed moving-note event and a
sustained/unbeamed event, without replacing runtime MusicXML.

Result:

- Clean unchanged.
- Dense candidates/applied: `24/24`.
- Notes/measures unchanged: `2808/127`.
- Duration regressed `80.96% -> 80.89%`.
- Wrong durations regressed `223 -> 225`.
- Onset improved slightly `71.81% -> 71.89%`.
- Chord, pitch, and F1 unchanged.

Why not promoted:

- Same-start event splitting was musically under-informed.
- It over-shortened beamed notes in measures where the existing duration was
  already the better matched written duration.
- The small onset gain came from backup/forward ordering, not cleaner chord
  grouping.

### Phase 3: Voice Serialization Simulation

Source: `tmp/omr-benchmark-iter/beam-ownership3/summary.md`.

This assigned offline voice ids using staff/clef, stem direction, beam group id,
and sustained/unbeamed ownership, then emitted separate simulated MusicXML with
backup/forward sequencing.

Result:

- Clean unchanged.
- Dense candidates: `24`; applied `17`; skipped `7` for
  `low-ownership-confidence`.
- Notes/measures unchanged: `2808/127`.
- Duration regressed `80.96% -> 80.89%`.
- Wrong durations regressed `223 -> 225`.
- Onset, chord, pitch, and F1 unchanged.
- Only dense measures `85` and `96` changed, both worsening duration.

Why not promoted:

- Voice serialization preserved onsets and onset cluster sizes, so chord/onset
  metrics did not move.
- The only metric movement came from shortening beam-owned moving notes, and
  that over-shortened the changed measures.
- Runtime XML stayed diagnostics-only. Baseline XML from Phase 2 and Phase 3 was
  byte-identical to `tmp/omr-benchmark-iter/beam-stem2-reverted/*.xml`.

## Benchmark Dashboard

Use the dashboard before and after any OMR work:

```sh
npm run omr:benchmark-dashboard
```

Outputs:

- `tmp/omr-benchmark-dashboard/report.md`
- `tmp/omr-benchmark-dashboard/report.json`
- `tmp/omr-benchmark-dashboard/fixtures/clean.json`
- `tmp/omr-benchmark-dashboard/fixtures/dense.json`

See `docs/OMR_BENCHMARK_DASHBOARD.md` for workflow details.

For simulation-only work, write simulated XML/reports to a separate
`tmp/omr-benchmark-iter/<experiment>/` directory and compare against runtime
baseline XML. Do not replace runtime XML unless the simulated metrics improve
cleanly and tests/build pass.

## Current Best Next Targets

Best next targets are diagnostic-first, not threshold-tuning-first:

1. Better classification of remaining dense rhythm errors after the current
   `223` wrong-duration baseline.
2. Event/voice modeling that changes onset/chord grouping, not only written
   duration.
3. Per-note beam ownership with stronger proof of voice membership before any
   duration edit.
4. Beam group boundary roles: start, continue, end, hook, and per-note beam
   level.
5. Separate written duration vs sounding/sustain duration in the internal model.
6. Pitch diagnosis only after controlling for grouping artifacts; many pitch
   errors are not direct staff mapping errors.

Any future runtime promotion must satisfy:

- Dense main metric improves meaningfully.
- Clean Gymnopedie unchanged.
- Dense note count and measure count unchanged or improved.
- Dense onset/chord/pitch/F1 stable or improved.
- Generated XML changes are explained by applied, generic rules.
- Tests and build pass.
