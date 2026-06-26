import { describe, expect, it } from 'vitest'
import {
  analyzeCalibrationCoverage,
  buildCalibrationCoverageWarnings,
  computeAdjustedOverallConfidence,
  enrichSmartCalibrationReport,
  isWeakConfidencePage,
  isWeakConfidenceSystem,
} from '../src/features/score-follow/calibrationConfidenceDiagnostics.js'
import { buildCalibrationDebugSnapshotFromPreview } from '../src/features/score-follow/calibrationDebug.js'

function makeSyntheticCalibrationReport({
  overall = 0.97,
  pages = [],
  systems = [],
  pageLayout = [],
}) {
  return {
    active: true,
    chosenStrategy: 'A',
    overallConfidence: overall,
    perPageConfidence: pages,
    perSystemConfidence: systems,
    pageLayout,
    calibrationMs: 12,
  }
}

describe('calibrationConfidenceDiagnostics', () => {
  it('flags page-count mismatch and missing final-page calibration', () => {
    const report = makeSyntheticCalibrationReport({
      pages: [
        { page: 1, confidence: 0.99 },
        { page: 2, confidence: 0.99 },
        { page: 3, confidence: 0.72 },
      ],
      systems: [
        { index: 0, page: 1, confidence: 0.99 },
        { index: 1, page: 2, confidence: 0.99 },
        { index: 2, page: 3, confidence: 0.45 },
        { index: 3, page: 3, confidence: 0.63 },
      ],
      pageLayout: [
        { page: 1, contentScale: 0.9 },
        { page: 2, contentScale: 0.9 },
        { page: 3, contentScale: 0.9 },
      ],
    })

    const coverage = analyzeCalibrationCoverage({
      smartCalibration: report,
      orientation: {
        pages: [
          { page: 1, rotation: 0 },
          { page: 2, rotation: 0 },
          { page: 3, rotation: 0 },
          { page: 4, rotation: 0 },
        ],
      },
      pdfPageCount: 4,
    })

    expect(coverage.pageCountMismatch).toBe(true)
    expect(coverage.missingPages).toEqual([4])
    expect(coverage.weakPages.map((page) => page.page)).toContain(3)
    expect(coverage.lowSystems.map((system) => system.index)).toContain(2)

    const warnings = buildCalibrationCoverageWarnings(coverage)
    expect(warnings.some((warning) => warning.code === 'page-count-mismatch')).toBe(true)
    expect(warnings.some((warning) => warning.code === 'missing-page-calibration')).toBe(true)
    expect(warnings.some((warning) => warning.code === 'weak-page-confidence')).toBe(true)
    expect(warnings.some((warning) => warning.code === 'low-system-confidence')).toBe(true)
  })

  it('lowers adjusted overall confidence below the raw measure-weighted score', () => {
    const adjusted = computeAdjustedOverallConfidence({
      rawOverall: 0.977,
      perPageConfidence: [
        { page: 1, confidence: 0.99 },
        { page: 6, confidence: 0.784 },
      ],
      perSystemConfidence: [
        { index: 25, page: 6, confidence: 1 },
        { index: 26, page: 6, confidence: 0.635 },
        { index: 28, page: 6, confidence: 0.453 },
      ],
      missingPages: [11],
      expectedPageCount: 11,
    })

    expect(adjusted).toBeLessThan(0.9)
    expect(adjusted).toBeLessThan(0.977)
  })

  it('enriches smart calibration reports with coverage metadata', () => {
    const enriched = enrichSmartCalibrationReport(
      makeSyntheticCalibrationReport({
        pages: [{ page: 1, confidence: 0.99 }],
        systems: [{ index: 0, page: 1, confidence: 0.66 }],
      }),
      {
        pdfPageCount: 2,
        orientation: { pages: [{ page: 1 }, { page: 2 }] },
      },
    )

    expect(enriched.coverage.missingPages).toEqual([2])
    expect(enriched.adjustedOverallConfidence).toBeLessThan(enriched.rawOverallConfidence)
  })

  it('builds debug snapshot warnings for weak systems and missing pages', () => {
    const snapshot = buildCalibrationDebugSnapshotFromPreview({
      proposedAnchors: [
        { id: 'a1', page: 1, measureNumber: 1, x: 0.1, y: 0.2 },
        { id: 'a2', page: 1, measureNumber: 2, x: 0.5, y: 0.2 },
      ],
      debugReport: { confidence: 0.9, stage: 'conservative', systems: [] },
      smartCalibration: makeSyntheticCalibrationReport({
        pages: [{ page: 1, confidence: 0.99 }],
        systems: [{ index: 0, page: 1, confidence: 0.66 }],
      }),
      orientation: { pages: [{ page: 1 }, { page: 2 }] },
      pdfPageCount: 2,
      plausible: true,
      approximate: true,
    })

    expect(snapshot.warnings.some((warning) => warning.code === 'missing-page-calibration')).toBe(
      true,
    )
    expect(snapshot.warnings.some((warning) => warning.code === 'weak-system-confidence')).toBe(
      true,
    )
    expect(snapshot.smartCalibration.adjustedOverallConfidence).toBeLessThan(0.97)
  })

  it('classifies weak vs low system confidence bands', () => {
    expect(isWeakConfidencePage(0.84)).toBe(true)
    expect(isWeakConfidenceSystem(0.7)).toBe(true)
    expect(isWeakConfidenceSystem(0.45)).toBe(false)
  })
})
