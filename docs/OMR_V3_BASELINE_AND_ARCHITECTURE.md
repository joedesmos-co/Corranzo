# Corranzo OMR V3 — Baseline and Architecture Map

Date: 2026-07-16  
Branch: `codex/omr-v3-staff-system-ir`  
Status: Phase 0 baseline; no OMR runtime behavior changed.

## Read-first audit

The audit covered the accuracy-expansion report, dashboard policy, overnight hard stop, OMR Engine V2 plan and architecture note, Phase 3 solver designs, Phase 6B/7 qualifications, rollout/stop decisions, the enforced fixture manifest, fixture provenance, current staff/system and barline detectors, notation/TAB classification and pairing, ScoreGraph, the document pipeline, and the MusicXML serializer.

`PROJECT_BRIEF.md` is named in the sprint brief but is not present anywhere in this worktree. No substitute assumptions were made for it.

## Baseline verification

Commands were run before implementation:

- `npm test`: PASS — 224 files, 2,252 passed, 5 skipped (2,257 total), 31.22 s.
- `npm run build`: PASS — Vite 8.0.13, 1,441 modules. The pre-existing large main-chunk warning remains.
- `npm run omr:benchmark-dashboard`: PASS — 16 fixtures, 10 enforced pass, 6 diagnostics skipped, 0 failures. Largest aggregate bucket: chord, 9,000 errors (31%).

The dashboard rewrites generated V2 qualification timestamps while running; it did not promote a V2 candidate or change production OMR output.

## Enforced fixture baseline

Measure and note columns are `generated/truth (delta)`. The paired Guitar scan has an expected honest-rejection outcome and therefore has no transcription metrics.

| Fixture | Pitch | Duration | Onset | Chord | Note F1 | Measures | Notes | Dominant stage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Piano beginner single | 25.00% | 87.50% | 84.38% | 93.94% | 96.88% | 8/8 (0) | 32/32 (0) | pitch inference |
| Piano grand voices | 62.50% | 81.82% | 97.73% | 97.75% | 98.86% | 8/8 (0) | 88/88 (0) | pitch inference |
| Piano rhythm/tuplets | 41.27% | 77.78% | 55.56% | 77.46% | 88.89% | 8/8 (0) | 63/63 (0) | pitch inference |
| Piano articulation scan | 31.53% | 46.85% | 61.26% | 60.48% | 80.40% | 8/8 (0) | 111/88 (+23) | voice serialization |
| Piano dense advanced | 14.77% | 39.39% | 33.33% | 28.92% | 45.63% | 19/8 (+11) | 262/264 (-2) | voice serialization |
| Guitar TAB-only | 70.00% | 72.50% | 57.50% | 80.00% | 88.89% | 8/8 (0) | 40/32 (+8) | onset/rhythm inference |
| Guitar standard chords | 0.00% | 15.65% | 13.91% | 20.61% | 35.44% | 16/8 (+8) | 43/115 (-72) | symbol detection |
| Guitar notation+TAB chords | 11.21% | 36.21% | 51.72% | 47.86% | 68.60% | 10/8 (+2) | 91/116 (-25) | symbol detection |
| Guitar notation+TAB techniques | 3.13% | 50.00% | 65.63% | 53.85% | 70.00% | 12/8 (+4) | 28/32 (-4) | pitch inference |
| Guitar paired scan | expected rejection | expected rejection | expected rejection | expected rejection | expected rejection | n/a | n/a | honest rejection |

Aggregate absolute enforced measure-count error is 25. The nine transcribed enforced fixtures have macro pitch/duration/onset/chord/F1 of 28.82/56.41/57.89/62.32/74.84%, matching the frozen accuracy-expansion checkpoint.

## Diagnostic fixture baseline

| Fixture | Pitch | Duration | Onset | Chord | Note F1 | Measures | Notes | Dominant stage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Gymnopedie clean | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 78/78 (0) | 469/469 (0) | none |
| Cruel Angel dense | 94.00% | 96.00% | 96.00% | 94.00% | 99.00% | 125/125 (0) | 2810/2810 (0) | voice serialization |
| Twinkle simple | 100.00% | 97.00% | 93.00% | 100.00% | 100.00% | 12/12 (0) | 86/86 (0) | onset/rhythm inference |
| Wet Hands guitar | 4.00% | 40.00% | 30.00% | 56.00% | 69.00% | 37/32 (+5) | 196/223 (-27) | pitch inference |
| Campanella grandes | 25.00% | 65.00% | 39.00% | 52.00% | 77.00% | 160/150 (+10) | 4089/4375 (-286) | voice serialization |
| Campanella alternate | 11.00% | 26.00% | 18.00% | 20.00% | 37.00% | 222/146 (+76) | 3874/4273 (-399) | voice serialization |

These six files remain diagnostic-only because their edition/file redistribution status does not satisfy the vendored CC0 enforcement policy.

## Current failure and attribution snapshot

- Enforced structural count failures are concentrated in dense Piano (+11 measures), standard Guitar (+8), paired Guitar chords (+2), and paired Guitar techniques (+4).
- Dense Piano and the articulation scan are dominated by voice serialization; standard and paired-chord Guitar are dominated by symbol detection; TAB-only Guitar is dominated by onset/rhythm inference.
- The aggregate named buckets are led by chord (9,000), extra/missing notes (7,856), pitch (3,780), slurs (2,825), onset (2,551), and duration (1,025). These counts include diagnostics and are stage-attribution signals, not independent error totals.
- V2 Phase 7 remains unchanged on the enforced canaries: zero structurally applied and zero truth-approved measures. Live candidates still fail voice-overlap/hard constraints before truth evaluation.

## Existing pipeline map

```text
PDF
  -> pdfPageAnalysis: page count, raster render, vector text extraction
  -> preprocessOmrPageImage: contrast/denoise/deskew/staff recovery
  -> detectStaffLineStaves + groupStavesIntoSystems
       (uses caller-supplied stavesPerSystem as a grouping hypothesis)
  -> resolveGuitarSystemRoles
       (notation/TAB roles and adjacent-band pairing)
  -> buildMeasureBoxesForSystemWithDiagnostics
       -> per-detected-system barlines
       -> note-column rejection / narrow merges / oversample collapse
       -> fallback four-column grid when no spans survive
  -> processVectorPageSystems or raster notehead/rhythm path
       -> per-measure symbols, pitch, rhythm, events
       -> beam/stem graph and local event reconstruction
  -> processOmrPage notation/TAB post-attachment
       -> TAB digits reuse the selected notation band's measure boxes
       -> attachTabPositionsToEvents pairs by measure and onset proximity
  -> runPdfOmrPipeline document-level ordered corrections
       -> opening lead, inner-voice phase, phantom/terminal columns,
          terminal chord duration, optional ScoreGraph clip promotion
  -> buildOmrMusicXml
       -> event list sorted by onset, clef mapped directly to voice 1/2
  -> playback validation, diagnostics, accuracy evaluator, dashboard
```

## Structural assumptions that are implicit or duplicated

1. **System identity depends on an external hint.** `stavesPerSystem` comes from the instrument/benchmark caller. `groupStavesIntoSystems` tests fixed-size chunks and otherwise treats every detected band as a full system. The IR does not own the evidence or uncertainty behind that decision.
2. **Raw line evidence is lossy at the architectural boundary.** Staff detection retains candidate rows locally, but downstream code normally consumes already-grouped `systems`; notation/TAB classification may separately collapse doubled rows and infer missing TAB lines.
3. **Notation/TAB pairing is a second system model.** `resolveGuitarSystemRoles` pairs an adjacent TAB band to the previous notation band using proximity or equal barline counts. `processOmrPage` then suppresses one timeline by leaving the paired TAB band's measure boxes empty. This relationship is not represented as a durable score node.
4. **Measures belong to detected bands before staff groups exist.** `buildMeasureBoxesForSystemWithDiagnostics` reconciles barlines only inside the current detector's system band. A mistaken one-staff system therefore creates a separate measure timeline before Piano or Guitar structural pairing can correct it.
5. **Fallback geometry can invent ownership.** When no spans survive, four equal measures are created. TAB-only code later removes ambiguous trailing spans, but equivalent trailing/empty-measure policy is not centralized.
6. **System and measure numbering are mutation-based.** `measureCounter` advances while iterating detected systems. A structural misclassification immediately changes all later ownership and numbering.
7. **Onsets exist in several forms.** Runtime events carry `startDivision`; TAB pairing rebuilds positional clusters; ScoreGraph derives `onsetColumns`; inner-voice and phantom-column passes independently extract/shift onset groups. There is no document-level onset-column identity.
8. **Voice is still partly an emission side effect.** Runtime MusicXML maps treble to voice 1 and bass to voice 2 while ordered post-passes mutate event timing. ScoreGraph has richer lane observations, but they are not rooted in a page/system/staff-group hierarchy.
9. **Chord and cross-staff relationships are not atomic.** Chords are event-array membership or ScoreGraph edges; cross-staff atoms do not survive as a first-class relationship. This is the primary V2 Phase 6/7 blocker.
10. **Provenance stops at local objects.** Detectors carry useful geometry/confidence, but stable IDs from page evidence through staff, measure, onset, event, and emitted MusicXML are absent.
11. **Confidence and diagnostics are aggregated in parallel.** Page/system/measure, TAB, beam/stem, ScoreGraph, and dashboard diagnostics each use separate ownership and naming conventions, making stage attribution possible but structural trace-back difficult.

## V3 boundary decision

OMR V3 will be a pure, serializable shadow document IR built from detection observations before note emission. It will preserve raw staff rows and source geometry, make systems/staff groups/shared measure columns/onset columns explicit, and keep relationships and provenance stable through a separate V3 serializer. The production measure/event/MusicXML path remains authoritative unless a narrowly scoped V3 sub-stage passes the no-regression, cross-fixture promotion gate.
