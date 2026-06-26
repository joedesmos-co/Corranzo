import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_STRATEGY,
  buildStrategyAnchors,
  scoreSystemBoundaries,
  selectCalibration,
  analyzePageLayout,
  calibrateScoreAnchors,
} from '../src/features/score-follow/smartScoreCalibration.js'

// Build one synthetic per-system geometry record (what buildCalibrationGeometry
// would produce from detection) so strategies/scoring are tested without a PDF.
function makeSystem(over = {}) {
  return {
    index: 0,
    page: 1,
    y: 0.3,
    y0: 0.25,
    y1: 0.35,
    pageWidthPx: 1000,
    contentLeft: 0.1,
    contentRight: 0.9,
    contentBoundsX0: 0.08,
    contentBoundsX1: 0.92,
    inkLeft: 0.1,
    inkRight: 0.9,
    inkFound: true,
    barlines: [],
    measureNumbers: [1, 2, 3, 4],
    widths: [1, 1, 1, 1],
    haveWidths: true,
    count: 4,
    ...over,
  }
}
function geom(systems, defaultX = new Map()) {
  return { systems: systems.map((s, i) => ({ ...s, index: i })), defaultXByMeasure: defaultX }
}

describe('smartScoreCalibration — scoring', () => {
  it('scores barline-aligned boundaries high and non-monotonic at zero', () => {
    const sys = makeSystem({ barlines: [0.1, 0.3, 0.5, 0.7, 0.9] })
    expect(scoreSystemBoundaries([0.1, 0.3, 0.5, 0.7, 0.9], sys)).toBeGreaterThan(0.95)
    expect(scoreSystemBoundaries([0.1, 0.3, 0.25, 0.7, 0.9], sys)).toBe(0) // backward
  })

  it('gives medium confidence with no barline ground truth but clean ink coverage', () => {
    const sys = makeSystem({ barlines: [], inkLeft: 0.2, inkRight: 0.8 })
    const conf = scoreSystemBoundaries([0.2, 0.35, 0.5, 0.65, 0.8], sys)
    expect(conf).toBeGreaterThan(0.4)
    expect(conf).toBeLessThan(0.8)
  })

  it('penalizes boundaries that spill outside the system ink', () => {
    const sys = makeSystem({ barlines: [], inkLeft: 0.5, inkRight: 0.9 })
    // span 0.1..0.9 spills far left of the ink at 0.5
    expect(scoreSystemBoundaries([0.1, 0.3, 0.5, 0.7, 0.9], sys)).toBeLessThan(0.2)
  })
})

describe('smartScoreCalibration — strategy selection', () => {
  it('clean centered score: all strategies agree on barlines → Strategy A kept (no regression)', () => {
    const g = geom([makeSystem({ barlines: [0.1, 0.3, 0.5, 0.7, 0.9] })])
    const baseline = buildStrategyAnchors(g, CALIBRATION_STRATEGY.A)
    const { best } = selectCalibration(g, baseline)
    expect(best.strategy).toBe(CALIBRATION_STRATEGY.A)
    expect(best.score.overall).toBeGreaterThan(0.95)
  })

  it('offset page (no barlines, music shifted right): margin/offset strategy beats baseline', () => {
    // Global content spans wide (e.g. a title block), but the system ink is far
    // right. Strategy A (global content) spills left; B/C (per-system ink) fit.
    const g = geom([
      makeSystem({ barlines: [], contentLeft: 0.1, contentRight: 0.9, inkLeft: 0.55, inkRight: 0.9 }),
    ])
    const baseline = buildStrategyAnchors(g, CALIBRATION_STRATEGY.A)
    const { best, baseline: baselineScored } = selectCalibration(g, baseline)
    expect(best.strategy).not.toBe(CALIBRATION_STRATEGY.A)
    expect(best.score.overall).toBeGreaterThan(baselineScored.score.overall)
  })

  it('wide margins (no barlines, narrow centered ink): ink-normalized strategy chosen', () => {
    const g = geom([
      makeSystem({ barlines: [], contentLeft: 0.05, contentRight: 0.95, inkLeft: 0.35, inkRight: 0.65 }),
    ])
    const baseline = buildStrategyAnchors(g, CALIBRATION_STRATEGY.A)
    const { best } = selectCalibration(g, baseline)
    expect([CALIBRATION_STRATEGY.B, CALIBRATION_STRATEGY.C, CALIBRATION_STRATEGY.E]).toContain(best.strategy)
  })

  it('uneven systems: each system uses its own ink extent', () => {
    const g = geom([
      makeSystem({ index: 0, barlines: [], inkLeft: 0.1, inkRight: 0.5 }),
      makeSystem({ index: 1, page: 1, y: 0.6, y0: 0.55, y1: 0.65, barlines: [], inkLeft: 0.35, inkRight: 0.9 }),
    ])
    const baseline = buildStrategyAnchors(g, CALIBRATION_STRATEGY.A)
    const { best, baseline: b } = selectCalibration(g, baseline)
    expect(best.score.overall).toBeGreaterThanOrEqual(b.score.overall)
  })
})

describe('smartScoreCalibration — anchor geometry', () => {
  it('produces monotonic, in-span anchors for a dense system', () => {
    const barlines = Array.from({ length: 17 }, (_, i) => 0.1 + (i / 16) * 0.8)
    const g = geom([
      makeSystem({ barlines, measureNumbers: Array.from({ length: 16 }, (_, i) => i + 1), widths: Array(16).fill(1), count: 16 }),
    ])
    const anchors = buildStrategyAnchors(g, CALIBRATION_STRATEGY.C)
    expect(anchors).toHaveLength(16)
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].meta.measureStartX).toBeGreaterThanOrEqual(anchors[i - 1].meta.measureStartX - 1e-9)
    }
  })

  it('handles a sparse system (2 measures) without collapsing', () => {
    const g = geom([
      makeSystem({ barlines: [0.2, 0.55, 0.9], measureNumbers: [1, 2], widths: [1, 1], count: 2 }),
    ])
    const anchors = buildStrategyAnchors(g, CALIBRATION_STRATEGY.A)
    expect(anchors).toHaveLength(2)
    expect(anchors[1].meta.measureStartX).toBeGreaterThan(anchors[0].meta.measureStartX)
  })

  it('publisher-independent (E) ignores engraved widths → even spacing', () => {
    const g = geom([
      makeSystem({ barlines: [], inkLeft: 0.1, inkRight: 0.9, widths: [3, 1, 1, 1] }),
    ])
    const anchors = buildStrategyAnchors(g, CALIBRATION_STRATEGY.E)
    const starts = anchors.map((a) => a.meta.measureStartX)
    // Even split across [0.1,0.9] → measure starts at 0.1, 0.3, 0.5, 0.7.
    expect(starts[1] - starts[0]).toBeCloseTo(0.2, 2)
    expect(starts[2] - starts[1]).toBeCloseTo(0.2, 2)
  })
})

describe('smartScoreCalibration — page analysis', () => {
  it('reports offset, margins, whitespace and detects a shifted page', () => {
    const pages = analyzePageLayout(geom([makeSystem({ inkLeft: 0.6, inkRight: 0.9 })]))
    expect(pages).toHaveLength(1)
    expect(pages[0].offsetNormalized).toBeCloseTo(0.25, 2)
    expect(pages[0].offsetPx).toBe(250)
    expect(pages[0].leftMargin).toBeCloseTo(0.6, 2)
    expect(pages[0].rightMargin).toBeCloseTo(0.1, 2)
    expect(pages[0].whitespaceRatio).toBeGreaterThan(0.6)
  })

  it('detects a small page rotation/skew from per-system ink drift', () => {
    const pages = analyzePageLayout(
      geom([
        makeSystem({ index: 0, y0: 0.1, y1: 0.2, inkLeft: 0.20 }),
        makeSystem({ index: 1, y0: 0.4, y1: 0.5, inkLeft: 0.23 }),
        makeSystem({ index: 2, y0: 0.7, y1: 0.8, inkLeft: 0.26 }),
      ]),
    )
    expect(Math.abs(pages[0].rotationDeg)).toBeGreaterThan(0)
  })
})

describe('smartScoreCalibration — fallback', () => {
  it('falls back to the baseline anchors when there is no detectable geometry', () => {
    const baseline = [{ id: 'x', measureNumber: 1, x: 0.2, meta: { systemIndex: 0 } }]
    const result = calibrateScoreAnchors({ systemEntries: [], spans: [], timingMap: null, baselineAnchors: baseline })
    expect(result.anchors).toBe(baseline)
    expect(result.report.active).toBe(false)
  })

  it('keeps the baseline when no strategy beats it (clean score)', () => {
    const g = geom([makeSystem({ barlines: [0.1, 0.3, 0.5, 0.7, 0.9] })])
    const baseline = buildStrategyAnchors(g, CALIBRATION_STRATEGY.A)
    const { best } = selectCalibration(g, baseline)
    expect(best.anchors).toBe(baseline)
  })
})
