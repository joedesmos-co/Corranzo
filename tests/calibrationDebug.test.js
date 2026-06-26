import { describe, expect, it } from 'vitest'
import {
  buildCalibrationDebugSnapshot,
  buildCalibrationDebugSnapshotFromPreview,
  buildCalibrationExportReport,
  CALIBRATION_LOW_CONFIDENCE_THRESHOLD,
  CALIBRATION_OVERLAY_DEFAULT_VISIBLE,
  collectCalibrationWarnings,
  isLowConfidenceSystem,
  normalizeCalibrationOverlayPage,
} from '../src/features/score-follow/calibrationDebug.js'
import { BETA_VERSION } from '../src/features/beta/betaInfo.js'

function makePreview() {
  return {
    proposedAnchors: [
      { id: 'a1', page: 1, measureNumber: 1, x: 0.12, y: 0.3, source: 'auto' },
      { id: 'a2', page: 1, measureNumber: 5, x: 0.88, y: 0.3, source: 'auto' },
    ],
    supplementalMeasureAnchors: [],
    debugReport: {
      confidence: 0.82,
      allocationMode: 'barline',
      allocationDiagnostics: {
        measureCount: 8,
        detectedCountsTotal: 8,
        countsOverTotal: false,
      },
      stage: 'conservative',
      systems: [
        {
          index: 0,
          page: 1,
          y0: 0.25,
          y1: 0.35,
          center: 0.3,
          contentBounds: { x0: 0.08, y0: 0.25, x1: 0.92, y1: 0.35 },
          inkBounds: { left: 0.1, right: 0.9, found: true },
          measureStart: 1,
          measureEnd: 4,
        },
        {
          index: 1,
          page: 1,
          y0: 0.45,
          y1: 0.55,
          center: 0.5,
          contentBounds: { x0: 0.08, y0: 0.45, x1: 0.92, y1: 0.55 },
          inkBounds: { left: 0.1, right: 0.9, found: true },
          measureStart: 5,
          measureEnd: 8,
        },
      ],
    },
    smartCalibration: {
      chosenStrategy: 'B',
      chosenStrategyLabel: 'Margin-normalized',
      overallConfidence: 0.84,
      calibrationMs: 42,
      perPageConfidence: [{ page: 1, confidence: 0.84 }],
      perSystemConfidence: [
        { index: 0, confidence: 0.9 },
        { index: 1, confidence: 0.42 },
      ],
      pageLayout: [
        {
          page: 1,
          offsetPx: 12,
          offsetNormalized: 0.02,
          contentScale: 0.82,
          rotationDeg: 0.15,
          cropped: false,
        },
      ],
      strategyScores: [
        { strategy: 'A', label: 'Baseline', overall: 0.7 },
        { strategy: 'B', label: 'Margin-normalized', overall: 0.84 },
      ],
      improvedOverBaseline: true,
    },
  }
}

describe('calibrationDebug — snapshot + warnings', () => {
  it('builds a debug snapshot from preview data', () => {
    const snapshot = buildCalibrationDebugSnapshotFromPreview(makePreview())
    expect(snapshot).toMatchObject({
      debugReport: expect.objectContaining({ stage: 'conservative' }),
      smartCalibration: expect.objectContaining({ chosenStrategy: 'B' }),
      fallbacks: expect.objectContaining({ chosenStrategy: 'B', improvedOverBaseline: true }),
    })
    expect(snapshot.fallbacks.allocationDiagnostics).toMatchObject({
      measureCount: 8,
      detectedCountsTotal: 8,
    })
    expect(snapshot.anchorSummary).toHaveLength(2)
    expect(snapshot.warnings.some((w) => w.code === 'low-system-confidence')).toBe(true)
  })

  it('builds a snapshot from orientation diagnostics when anchors are sparse', () => {
    const snapshot = buildCalibrationDebugSnapshot({
      orientation: {
        anyRotated: true,
        anyAutoCorrected: true,
        maxRotation: 90,
        correctionPaths: ['auto-detect'],
        pages: [
          {
            page: 1,
            rotation: 90,
            correctionPath: 'auto-detect',
            detectedSideways: true,
            horizontalLineScore: 0.0002,
            verticalLineScore: 0.0018,
          },
        ],
      },
      proposedAnchors: [],
      setupPhase: 'needs-setup',
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot.orientation.anyAutoCorrected).toBe(true)
  })

  it('collects layout and fallback warnings', () => {
    const warnings = collectCalibrationWarnings({
      debugReport: { layoutMismatch: true, layoutConfidence: 'low', weakestSystemIndex: 1 },
      smartCalibration: { improvedOverBaseline: true, chosenStrategy: 'C' },
      orientation: { anyRotated: true, pages: [{ page: 1, rotation: 90 }] },
      pageViewRotations: { 1: 90 },
    })
    expect(warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'page-rotated',
        'layout-mismatch',
        'low-layout-confidence',
        'weak-system',
        'strategy-fallback',
      ]),
    )
  })
})

describe('calibrationDebug — overlay normalization', () => {
  const snapshot = buildCalibrationDebugSnapshot({
    debugReport: makePreview().debugReport,
    smartCalibration: makePreview().smartCalibration,
    proposedAnchors: makePreview().proposedAnchors,
  })

  it('normalizes per-page overlay primitives in 0–1 space', () => {
    const layout = normalizeCalibrationOverlayPage(snapshot, 1, [])
    expect(layout.systems).toHaveLength(2)
    expect(layout.systems[0].bounds).toMatchObject({
      left: 0.08,
      top: 0.25,
      right: 0.92,
      bottom: 0.35,
    })
    expect(layout.systems[0].inkBounds).toMatchObject({ left: 0.1, right: 0.9 })
    expect(layout.anchors).toHaveLength(2)
  })

  it('flags low-confidence systems for highlighting', () => {
    const layout = normalizeCalibrationOverlayPage(snapshot, 1, [])
    expect(isLowConfidenceSystem(0.42)).toBe(true)
    expect(isLowConfidenceSystem(CALIBRATION_LOW_CONFIDENCE_THRESHOLD)).toBe(false)
    expect(layout.systems[0].lowConfidence).toBe(false)
    expect(layout.systems[1].lowConfidence).toBe(true)
  })

  it('returns empty overlay data for unknown pages', () => {
    const layout = normalizeCalibrationOverlayPage(snapshot, 9, [])
    expect(layout.systems).toEqual([])
    expect(layout.anchors).toEqual([])
  })
})

describe('calibrationDebug — export report', () => {
  it('matches the corranzo calibration report schema', () => {
    const snapshot = buildCalibrationDebugSnapshotFromPreview(makePreview())
    const report = buildCalibrationExportReport({
      snapshot,
      pieceName: 'Minuet in G',
      anchors: [{ id: 'x', page: 1, measureNumber: 1, x: 0.1, y: 0.2 }],
    })

    expect(report).toMatchObject({
      schema: 'corranzo-calibration-report-v1',
      appVersion: BETA_VERSION,
      pieceName: 'Minuet in G',
      chosenStrategy: 'B',
      overallConfidence: 0.84,
      calibrationMs: 42,
      perPageConfidence: expect.any(Array),
      perSystemConfidence: expect.any(Array),
      pageLayout: expect.any(Array),
      systemBounds: expect.any(Array),
      inkBounds: expect.any(Array),
      anchorsSummary: expect.any(Array),
      allocationDiagnostics: expect.objectContaining({ measureCount: 8 }),
      warnings: expect.any(Array),
      fallbacks: expect.objectContaining({
        chosenStrategy: 'B',
        allocationDiagnostics: expect.objectContaining({ detectedCountsTotal: 8 }),
      }),
      strategyScores: expect.any(Array),
    })
    expect(JSON.stringify(report)).not.toMatch(/imageData|pdfBytes|uploadedFile/i)
  })

  it('downloads JSON without embedding uploaded file contents', () => {
    const report = buildCalibrationExportReport({
      snapshot: buildCalibrationDebugSnapshotFromPreview(makePreview()),
      pieceName: 'Demo',
    })
    const json = JSON.stringify(report, null, 2)
    expect(json).toContain('"schema": "corranzo-calibration-report-v1"')
    expect(json).toContain('"pieceName": "Demo"')
    expect(json).not.toMatch(/imageData|pdfBytes|uploadedFile/i)
  })
})

describe('calibrationDebug — defaults', () => {
  it('keeps the overlay hidden by default', () => {
    expect(CALIBRATION_OVERLAY_DEFAULT_VISIBLE).toBe(false)
  })
})

describe('calibrationDebug — static app behavior', () => {
  it('does not mutate core calibration strategy constants', async () => {
    const { CALIBRATION_STRATEGY } = await import('../src/features/score-follow/smartScoreCalibration.js')
    expect(CALIBRATION_STRATEGY.A).toBe('A')
    expect(CALIBRATION_STRATEGY.E).toBe('E')
  })
})
