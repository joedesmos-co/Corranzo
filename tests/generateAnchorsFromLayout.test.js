/**
 * Phase 3 — unified automatic anchor generation.
 *
 * Golden requirement: Minuet auto-generated anchors must match the bundled
 * (hand-calibrated) anchors within tolerance before auto generation could ever
 * replace them. Plus per-measure field coverage, system/page transitions, and
 * the confidence gating ladder (trusted / confirm-required / manual).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import { LAYOUT_CONFIDENCE } from '../src/features/score-follow/layoutAssessment.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import {
  generateAnchorsFromLayout,
  ANCHOR_TRUST,
} from '../src/features/score-follow/generateAnchorsFromLayout.js'
import { RUNNABLE_FIXTURES } from './fixtures/alignmentFixtures.js'
import { straight4 } from './helpers/buildXml.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fixtures')
const GEOMETRY_TOLERANCE = 1e-4

function runFixture(id) {
  const fixture = RUNNABLE_FIXTURES.find((f) => f.id === id)
  const reconciliation = reconcilePdfLayoutWithScore(fixture.makeInputs())
  return generateAnchorsFromLayout(reconciliation, fixture.makePageLayout())
}

describe('Phase 3: Minuet auto-generated anchors match the bundled anchors', () => {
  const result = runFixture('minuet-in-g')
  const bundled = JSON.parse(
    readFileSync(join(fixturesDir, 'demo-minuet-in-g.anchors.json'), 'utf8'),
  ).anchors
  const byMeasure = new Map(bundled.map((a) => [a.measureNumber, a]))

  it('generates one trusted anchor per measure (32), full coverage', () => {
    expect(result.trust).toBe(ANCHOR_TRUST.TRUSTED)
    expect(result.anchors).toHaveLength(32)
    expect(result.coverage.missingMeasures).toEqual([])
    expect(result.coverage.measuresCovered).toBe(32)
  })

  it('matches bundled geometry (measureStartX / playableEndX / systemEndX / y) within tolerance', () => {
    for (const anchor of result.anchors) {
      const ref = byMeasure.get(anchor.measureNumber)
      expect(ref).toBeTruthy()
      expect(Math.abs(anchor.measureStartX - ref.meta.measureStartX)).toBeLessThan(GEOMETRY_TOLERANCE)
      expect(Math.abs(anchor.playableEndX - ref.meta.playableEndX)).toBeLessThan(GEOMETRY_TOLERANCE)
      expect(Math.abs(anchor.systemEndX - ref.meta.systemEndX)).toBeLessThan(GEOMETRY_TOLERANCE)
      expect(Math.abs(anchor.y - ref.y)).toBeLessThan(GEOMETRY_TOLERANCE)
      expect(anchor.page).toBe(ref.page)
    }
  })
})

describe('Phase 3: runnable fixtures generate complete, well-formed anchors', () => {
  for (const fixture of RUNNABLE_FIXTURES) {
    describe(fixture.id, () => {
      const result = runFixture(fixture.id)

      it('covers every measure with the required anchor fields', () => {
        expect(result.anchors).toHaveLength(fixture.golden.writtenMeasures)
        expect(result.coverage.missingMeasures).toEqual([])
        for (const anchor of result.anchors) {
          expect(typeof anchor.measureNumber).toBe('number')
          expect(typeof anchor.page).toBe('number')
          expect(typeof anchor.systemIndex).toBe('number')
          expect(Number.isFinite(anchor.measureStartX)).toBe(true)
          expect(Number.isFinite(anchor.playableStartX)).toBe(true)
          expect(Number.isFinite(anchor.playableEndX)).toBe(true)
          expect(Number.isFinite(anchor.systemEndX)).toBe(true)
          expect(Number.isFinite(anchor.confidence)).toBe(true)
          expect(anchor.source).toBe(ANCHOR_SOURCE.AUTO_MEASURE)
        }
      })

      it('places playableStartX/EndX/systemEndX so system transitions are defined', () => {
        const lastBySystem = new Map()
        for (const anchor of result.anchors) {
          const prev = lastBySystem.get(anchor.systemIndex)
          if (!prev || anchor.measureNumber > prev.measureNumber) {
            lastBySystem.set(anchor.systemIndex, anchor)
          }
        }
        // The last measure of each system glides to the system's right edge.
        for (const anchor of lastBySystem.values()) {
          expect(anchor.playableEndX).toBe(anchor.systemEndX)
        }
        // Non-final measures hand off to the next measure's start.
        const bySystem = new Map()
        for (const anchor of result.anchors) {
          const list = bySystem.get(anchor.systemIndex) ?? []
          list.push(anchor)
          bySystem.set(anchor.systemIndex, list)
        }
        for (const list of bySystem.values()) {
          list.sort((a, b) => a.measureNumber - b.measureNumber)
          for (let i = 0; i < list.length - 1; i += 1) {
            expect(list[i].playableEndX).toBeCloseTo(list[i + 1].measureStartX, 6)
          }
        }
      })
    })
  }

  it('multi-page anchors span both pages', () => {
    const result = runFixture('multi-page')
    expect([...new Set(result.anchors.map((a) => a.page))].sort()).toEqual([1, 2])
  })
})

describe('Phase 3: confidence gating ladder', () => {
  it('auto/exact/good confidence yields trusted anchors', () => {
    expect(runFixture('minuet-in-g').trust).toBe(ANCHOR_TRUST.TRUSTED)
  })

  it('medium (approximate) confidence marks anchors confirm-required', () => {
    const fixture = RUNNABLE_FIXTURES.find((f) => f.id === 'multi-page')
    const reconciliation = reconcilePdfLayoutWithScore(fixture.makeInputs())
    const layout = { ...fixture.makePageLayout(), layoutConfidence: LAYOUT_CONFIDENCE.APPROXIMATE }
    const result = generateAnchorsFromLayout(reconciliation, layout)
    expect(result.trust).toBe(ANCHOR_TRUST.CONFIRM_REQUIRED)
    expect(result.anchors.length).toBeGreaterThan(0)
    for (const anchor of result.anchors) {
      expect(anchor.trust).toBe(ANCHOR_TRUST.CONFIRM_REQUIRED)
    }
  })

  it('low confidence returns no trusted anchors and requires manual setup', () => {
    // Detection far off the score → minConfidence below the manual threshold.
    const reconciliation = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(straight4(), 'straight4'),
      perSystemBarlineCounts: [8, 0],
    })
    const layout = {
      layoutConfidence: LAYOUT_CONFIDENCE.GOOD,
      systems: [
        { systemIndex: 0, page: 1, y: 0.2, startX: 0.08, endX: 0.92, barlineXs: [0.1, 0.5] },
        { systemIndex: 1, page: 1, y: 0.5, startX: 0.08, endX: 0.92, barlineXs: [0.1, 0.5] },
      ],
    }
    const result = generateAnchorsFromLayout(reconciliation, layout)
    expect(result.trust).toBe(ANCHOR_TRUST.MANUAL)
    expect(result.anchors).toEqual([])
    expect(result.coverage.missingMeasures.length).toBe(reconciliation.totals.expectedMeasureCount)
  })
})

describe('Phase 3: anchor coverage diagnostics', () => {
  it('reports counts, confidence and trust', () => {
    const coverage = runFixture('minuet-in-g').coverage
    expect(coverage.anchorsGenerated).toBe(32)
    expect(coverage.measuresExpected).toBe(32)
    expect(coverage.measuresCovered).toBe(32)
    expect(coverage.weakSystems).toEqual([])
    expect(coverage.minConfidence).toBe(1)
    expect(coverage.trust).toBe(ANCHOR_TRUST.TRUSTED)
    expect(coverage.estimatedGeometrySystems).toEqual([])
  })
})
