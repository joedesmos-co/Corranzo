import { describe, expect, it } from 'vitest'

import {
  buildOmrPipelineStageDiagnostics,
  formatOmrPipelineStageDiagnosticsMarkdown,
  OMR_PIPELINE_STAGE,
} from '../src/features/omr/omrPipelineStageDiagnostics.js'

describe('OMR pipeline-stage diagnostics', () => {
  it('attributes fixture and measure failures without changing metrics', () => {
    const report = {
      totals: {
        truthMeasureCount: 4,
        generatedMeasureCount: 6,
        measureCountDifference: 2,
        missingNoteCount: 3,
        extraNoteCount: 1,
        wrongPitchCount: 5,
        wrongDurationCount: 2,
        wrongOnsetCount: 1,
        chordMismatchCount: 7,
      },
      perMeasure: [
        {
          measureNumber: 2,
          truthNoteCount: 4,
          generatedNoteCount: 3,
          missingNoteCount: 1,
          extraNoteCount: 0,
          wrongPitchCount: 3,
          wrongDurationCount: 1,
          wrongOnsetCount: 0,
          chordMismatchCount: 2,
          errorCount: 7,
        },
      ],
      generatedOmrDiagnostics: {
        pages: 1,
        pagesWithSystems: 1,
        systems: 4,
        preprocessLog: [
          { page: 1, quality: { isLikelyScanned: false }, applied: [] },
        ],
        layoutConsistency: { inconsistent: false },
        measureGridDiagnosticsEntries: [
          { spanWidthPercents: [25, 8, 27, 26] },
        ],
        tablature: {
          tabStaves: 0,
          attachedPositions: 0,
          unpairedNotationNotes: 0,
          unusedTabDigits: 0,
          lowConfidenceMeasures: 0,
        },
        ties: { detectedTieCount: 0, appliedTieCount: 0 },
        runtimeVsScoreGraph: { parity: { noteheads: true, rests: true } },
      },
    }

    const diagnostics = buildOmrPipelineStageDiagnostics(report, {
      fixture: {
        categories: ['scanned-score', 'paired-notation-tab', 'ties-slides-hammer-ons-pull-offs'],
      },
    })

    expect(diagnostics.stages).toHaveLength(11)
    expect(diagnostics.dominantStage).toBe(OMR_PIPELINE_STAGE.VOICE_SERIALIZATION)
    expect(
      diagnostics.stages.find((entry) => entry.stage === OMR_PIPELINE_STAGE.RASTERIZATION)
        ?.errorCount,
    ).toBe(1)
    expect(
      diagnostics.stages.find((entry) => entry.stage === OMR_PIPELINE_STAGE.STAFF_CLASSIFICATION)
        ?.errorCount,
    ).toBe(1)
    expect(
      diagnostics.stages.find((entry) => entry.stage === OMR_PIPELINE_STAGE.MEASURE_SEGMENTATION)
        ?.errorCount,
    ).toBe(3)
    expect(diagnostics.perMeasure[0].primaryStage).toBe(OMR_PIPELINE_STAGE.PITCH_INFERENCE)
    expect(report.totals.wrongPitchCount).toBe(5)
    expect(formatOmrPipelineStageDiagnosticsMarkdown(diagnostics)).toContain(
      'measure hotspots: m2 pitch-inference (7)',
    )
  })
})
