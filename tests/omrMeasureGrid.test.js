import { describe, expect, it } from 'vitest'
import {
  collapseUniformOversampledSpans,
  mergeNarrowMeasureSpans,
  mergeTrailingNarrowMeasureSpans,
  MIN_MEASURE_SPAN_FRAC,
} from '../src/features/omr/buildOmrMeasureGrid.js'
import {
  formatOmrMeasureGridDiagnosticsReport,
  summarizeOmrMeasureGridDiagnostics,
} from '../src/features/omr/omrMeasureGridDiagnostics.js'
import { cleanPianoPage, densePianoPage } from './helpers/syntheticScore.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { buildMeasureBoxesForSystemWithDiagnostics } from '../src/features/omr/buildOmrMeasureGrid.js'

describe('mergeNarrowMeasureSpans', () => {
  it('merges sub-threshold slivers into neighboring measures', () => {
    const contentWidth = 1
    const spans = [
      { x0: 0, x1: 0.129 },
      { x0: 0.129, x1: 0.161 },
      { x0: 0.161, x1: 0.193 },
      { x0: 0.193, x1: 0.375 },
      { x0: 0.375, x1: 0.615 },
      { x0: 0.615, x1: 0.902 },
    ]
    const { spans: merged, mergedCount } = mergeNarrowMeasureSpans(spans, contentWidth)
    expect(mergedCount).toBe(2)
    expect(merged).toHaveLength(4)
    expect(merged[0].x1 - merged[0].x0).toBeGreaterThan(MIN_MEASURE_SPAN_FRAC)
    expect(merged.every((span) => span.x1 - span.x0 >= MIN_MEASURE_SPAN_FRAC * 0.99)).toBe(true)
  })
})

describe('collapseUniformOversampledSpans', () => {
  it('pairs adjacent spans when widths are uniform and narrow', () => {
    const contentWidth = 1
    const spans = Array.from({ length: 7 }, (_, index) => ({
      x0: index * 0.13,
      x1: (index + 1) * 0.13,
    }))
    const { spans: collapsed, collapsedPairs } = collapseUniformOversampledSpans(spans, contentWidth)
    expect(collapsedPairs).toBe(3)
    expect(collapsed).toHaveLength(4)
    expect(collapsed[0].x0).toBeCloseTo(0)
    expect(collapsed[0].x1).toBeCloseTo(0.26)
  })

  it('leaves varied-width clean layouts unchanged', () => {
    const contentWidth = 1
    const spans = [
      { x0: 0, x1: 0.25 },
      { x0: 0.25, x1: 0.5 },
      { x0: 0.5, x1: 0.75 },
      { x0: 0.75, x1: 1 },
    ]
    const { spans: collapsed, collapsedPairs } = collapseUniformOversampledSpans(spans, contentWidth)
    expect(collapsedPairs).toBe(0)
    expect(collapsed).toEqual(spans)
  })
})

describe('mergeTrailingNarrowMeasureSpans', () => {
  it('merges two narrow trailing spans when they combine to a normal measure width', () => {
    const contentWidth = 1
    const spans = [
      { x0: 0, x1: 0.353 },
      { x0: 0.353, x1: 0.653 },
      { x0: 0.653, x1: 0.81 },
      { x0: 0.81, x1: 0.97 },
    ]
    const { spans: merged, mergedCount } = mergeTrailingNarrowMeasureSpans(spans, contentWidth)
    expect(mergedCount).toBe(1)
    expect(merged).toHaveLength(3)
    expect(merged[2]).toEqual({ x0: 0.653, x1: 0.97 })
  })

  it('requires unreliable barline evidence before merging a single short trailing span', () => {
    const contentWidth = 1
    const spans = [
      { x0: 0, x1: 0.237 },
      { x0: 0.237, x1: 0.524 },
      { x0: 0.524, x1: 0.815 },
      { x0: 0.815, x1: 0.971 },
    ]
    const stable = mergeTrailingNarrowMeasureSpans(spans, contentWidth)
    expect(stable.mergedCount).toBe(0)
    expect(stable.spans).toHaveLength(4)

    const unreliable = mergeTrailingNarrowMeasureSpans(spans, contentWidth, {
      allowSingleTrailingMerge: true,
    })
    expect(unreliable.mergedCount).toBe(1)
    expect(unreliable.spans).toHaveLength(3)
    expect(unreliable.spans[2]).toEqual({ x0: 0.524, x1: 0.971 })
  })
})

describe('buildMeasureBoxesForSystemWithDiagnostics', () => {
  it('keeps clean engraved measure counts stable', () => {
    const page = cleanPianoPage({ systems: 1, measuresPerSystem: 4 })
    const contentBounds = detectContentBounds(page)
    const { systems, inkThreshold } = detectStaffLineSystems(page, contentBounds, {
      stavesPerSystem: 2,
      countBarlines: true,
    })
    const { measureBoxes, diagnostics } = buildMeasureBoxesForSystemWithDiagnostics({
      page: 1,
      systemIndex: 0,
      system: systems[0],
      contentBounds,
      imageData: page,
      measureNumberStart: 1,
      darkThreshold: inkThreshold,
    })
    expect(measureBoxes).toHaveLength(4)
    expect(diagnostics.finalMeasureCount).toBe(4)
    expect(diagnostics.suspiciousShortMeasures).toBe(0)
  })

  it('consolidates dense synthetic oversampled grids and reports diagnostics', () => {
    const page = densePianoPage({ systems: 1, measuresPerSystem: 6 })
    const contentBounds = detectContentBounds(page)
    const { systems, inkThreshold } = detectStaffLineSystems(page, contentBounds, {
      stavesPerSystem: 2,
      countBarlines: true,
    })
    const { measureBoxes, diagnostics } = buildMeasureBoxesForSystemWithDiagnostics({
      page: 1,
      systemIndex: 0,
      system: systems[0],
      contentBounds,
      imageData: page,
      measureNumberStart: 1,
      darkThreshold: inkThreshold,
    })
    expect(measureBoxes.length).toBeLessThanOrEqual(diagnostics.initialMeasureCount)
    expect(diagnostics.barlineCount).toBeGreaterThan(0)
    expect(diagnostics.barlineRejectedSummary).toBeTruthy()
    expect(diagnostics.spanWidthPercents.length).toBe(measureBoxes.length)
  })
})

describe('omrMeasureGridDiagnostics formatting', () => {
  it('summarizes per-system consolidation totals', () => {
    const entries = [
      {
        page: 1,
        systemIndex: 0,
        barlineCount: 8,
        initialMeasureCount: 7,
        finalMeasureCount: 4,
        reliabilityReason: 'density-thinned',
        reliabilityConfident: false,
        mergedNarrowSpans: 2,
        mergedTrailingSpans: 1,
        collapsedPairs: 3,
        suspiciousShortMeasures: 0,
        spanWidthPercents: [25, 25, 25, 25],
        barlineRejectedSummary: 'too-dense=8',
      },
    ]
    const totals = summarizeOmrMeasureGridDiagnostics(entries)
    expect(totals.measureCount).toBe(4)
    expect(totals.collapsedPairs).toBe(3)
    expect(totals.mergedTrailingSpans).toBe(1)
    expect(formatOmrMeasureGridDiagnosticsReport(entries)).toMatch(/measures 7→4/)
    expect(formatOmrMeasureGridDiagnosticsReport(entries)).toMatch(/trailing=1/)
  })
})
