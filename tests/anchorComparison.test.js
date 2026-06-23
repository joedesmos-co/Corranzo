/**
 * Phase 5a — anchor comparison framework + golden promotion validation.
 *
 * Proves the unified generator (`generateAnchorsFromLayout`) lands close enough
 * to the trusted bundled anchors to *eventually* replace them — WITHOUT changing
 * any runtime behaviour. The golden test fails loudly if generation drifts past
 * the explicit, documented tolerances in `ANCHOR_PROMOTION_TOLERANCES`.
 */
import { describe, expect, it } from 'vitest'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import {
  generateAnchorsFromLayout,
  ANCHOR_TRUST,
} from '../src/features/score-follow/generateAnchorsFromLayout.js'
import {
  ANCHOR_COMPARISON_FIELDS,
  ANCHOR_PROMOTION_TOLERANCES,
  PROMOTION_STATUS,
  compareAnchorSets,
  assessPromotionReadiness,
  summarizeConfidenceDistribution,
  readAnchorGeometry,
  formatAnchorComparisonText,
} from '../src/features/score-follow/anchorComparison.js'
import { RUNNABLE_FIXTURES } from './fixtures/alignmentFixtures.js'

function runFixture(id) {
  const fixture = RUNNABLE_FIXTURES.find((f) => f.id === id)
  const reconciliation = reconcilePdfLayoutWithScore(fixture.makeInputs())
  const generated = generateAnchorsFromLayout(reconciliation, fixture.makePageLayout())
  const reference = fixture.makeReferenceAnchors ? fixture.makeReferenceAnchors() : null
  return { fixture, generated, reference }
}

describe('Phase 5a: anchor geometry reader (generated + bundled shapes)', () => {
  it('reads top-level fields from generated anchors', () => {
    const geom = readAnchorGeometry({
      measureNumber: 3,
      page: 1,
      systemIndex: 0,
      measureStartX: 0.2,
      playableStartX: 0.21,
      playableEndX: 0.4,
      systemEndX: 0.95,
      confidence: 1,
      trust: ANCHOR_TRUST.TRUSTED,
    })
    expect(geom.measureStartX).toBe(0.2)
    expect(geom.systemEndX).toBe(0.95)
    expect(geom.systemIndex).toBe(0)
  })

  it('reads meta.* fields from bundled anchors', () => {
    const geom = readAnchorGeometry({
      measureNumber: 1,
      page: 1,
      meta: {
        systemIndex: 0,
        measureStartX: 0.1194,
        playableStartX: 0.1194,
        playableEndX: 0.3563,
        systemEndX: 0.9515,
      },
    })
    expect(geom.measureStartX).toBeCloseTo(0.1194, 6)
    expect(geom.playableEndX).toBeCloseTo(0.3563, 6)
    expect(geom.systemEndX).toBeCloseTo(0.9515, 6)
    expect(geom.systemIndex).toBe(0)
  })
})

describe('Phase 5a: GOLDEN — Minuet generated anchors stay within promotion tolerance', () => {
  const { generated, reference } = runFixture('minuet-in-g')
  const comparison = compareAnchorSets(generated.anchors, reference)

  it('compares all 32 measures with no structural gaps', () => {
    expect(comparison.comparable).toBe(true)
    expect(comparison.measuresCompared).toBe(32)
    expect(comparison.missingFromGenerated).toEqual([])
    expect(comparison.missingFromReference).toEqual([])
    expect(comparison.pageMismatchCount).toBe(0)
    expect(comparison.systemMismatchCount).toBe(0)
  })

  it('keeps every geometry field within the READY tolerance', () => {
    // The generator currently reproduces the bundled anchors exactly (max 0).
    // This guard fails if a future change drifts past the documented bound.
    expect(comparison.maxError).toBeLessThanOrEqual(ANCHOR_PROMOTION_TOLERANCES.ready.maxError)
    expect(comparison.avgError).toBeLessThanOrEqual(ANCHOR_PROMOTION_TOLERANCES.ready.avgError)
    for (const field of ANCHOR_COMPARISON_FIELDS) {
      expect(comparison.perField[field].maxError).toBeLessThanOrEqual(
        ANCHOR_PROMOTION_TOLERANCES.ready.maxError,
      )
    }
  })

  it('classifies the Minuet as READY for promotion', () => {
    const readiness = assessPromotionReadiness(comparison)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
    expect(readiness.label).toBeTruthy()
  })

  it('reports an all-trusted confidence distribution', () => {
    const dist = comparison.confidenceDistribution
    expect(dist.total).toBe(32)
    expect(dist.trust[ANCHOR_TRUST.TRUSTED]).toBe(32)
    expect(dist.trust[ANCHOR_TRUST.CONFIRM_REQUIRED]).toBe(0)
    expect(dist.trust[ANCHOR_TRUST.MANUAL]).toBe(0)
    expect(dist.minConfidence).toBe(1)
  })

  it('renders a readable comparison summary', () => {
    const text = formatAnchorComparisonText(comparison, assessPromotionReadiness(comparison))
    expect(text).toMatch(/Anchor comparison: 32 measures/)
    expect(text).toMatch(/Promotion: Ready for promotion/)
  })
})

describe('Phase 5a: drift detection — tolerances gate promotion', () => {
  const { generated, reference } = runFixture('minuet-in-g')

  function withDrift(anchors, measureNumber, field, delta) {
    return anchors.map((anchor) =>
      anchor.measureNumber === measureNumber
        ? { ...anchor, [field]: anchor[field] + delta, meta: { ...anchor.meta } }
        : anchor,
    )
  }

  it('NEEDS_REVIEW when a single anchor drifts past READY but within review bounds', () => {
    const drifted = withDrift(generated.anchors, 5, 'measureStartX', 0.01)
    const comparison = compareAnchorSets(drifted, reference)
    expect(comparison.maxError).toBeGreaterThan(ANCHOR_PROMOTION_TOLERANCES.ready.maxError)
    expect(comparison.maxError).toBeLessThanOrEqual(ANCHOR_PROMOTION_TOLERANCES.needsReview.maxError)
    expect(assessPromotionReadiness(comparison).status).toBe(PROMOTION_STATUS.NEEDS_REVIEW)
  })

  it('NOT_SAFE when an anchor drifts beyond the review tolerance', () => {
    const drifted = withDrift(generated.anchors, 5, 'playableEndX', 0.2)
    const comparison = compareAnchorSets(drifted, reference)
    expect(comparison.maxError).toBeGreaterThan(ANCHOR_PROMOTION_TOLERANCES.needsReview.maxError)
    expect(assessPromotionReadiness(comparison).status).toBe(PROMOTION_STATUS.NOT_SAFE)
  })

  it('NOT_SAFE when a generated anchor is missing (structural gap)', () => {
    const dropped = generated.anchors.filter((anchor) => anchor.measureNumber !== 10)
    const comparison = compareAnchorSets(dropped, reference)
    expect(comparison.missingFromGenerated).toContain(10)
    expect(assessPromotionReadiness(comparison).status).toBe(PROMOTION_STATUS.NOT_SAFE)
  })

  it('counts page and system mismatches', () => {
    const moved = generated.anchors.map((anchor) =>
      anchor.measureNumber === 1
        ? { ...anchor, page: anchor.page + 1, systemIndex: anchor.systemIndex + 3 }
        : anchor,
    )
    const comparison = compareAnchorSets(moved, reference)
    expect(comparison.pageMismatchCount).toBe(1)
    expect(comparison.systemMismatchCount).toBe(1)
    expect(assessPromotionReadiness(comparison).status).toBe(PROMOTION_STATUS.NOT_SAFE)
  })
})

describe('Phase 5a: fixtures without reference anchors are non-comparable (not auto-promotable)', () => {
  for (const id of ['repeats-voltas', 'multi-page', 'dense-fast']) {
    it(`${id}: comparable=false, full trusted coverage, NOT_SAFE for promotion`, () => {
      const { generated, reference } = runFixture(id)
      expect(reference).toBeNull()
      const comparison = compareAnchorSets(generated.anchors, reference)
      expect(comparison.comparable).toBe(false)
      expect(comparison.confidenceDistribution.total).toBe(generated.anchors.length)
      // No trusted ground truth → cannot be promoted on its own evidence.
      expect(assessPromotionReadiness(comparison).status).toBe(PROMOTION_STATUS.NOT_SAFE)
    })
  }
})

describe('Phase 5a: identical sets compare cleanly', () => {
  it('reports zero error and READY when generated === reference', () => {
    const { generated } = runFixture('minuet-in-g')
    const comparison = compareAnchorSets(generated.anchors, generated.anchors)
    expect(comparison.maxError).toBe(0)
    expect(comparison.avgError).toBe(0)
    expect(assessPromotionReadiness(comparison).status).toBe(PROMOTION_STATUS.READY)
  })

  it('summarizeConfidenceDistribution buckets trust levels', () => {
    const dist = summarizeConfidenceDistribution([
      { trust: ANCHOR_TRUST.TRUSTED, confidence: 1 },
      { trust: ANCHOR_TRUST.CONFIRM_REQUIRED, confidence: 0.6 },
      { trust: ANCHOR_TRUST.MANUAL },
      { confidence: 0.5 },
    ])
    expect(dist.total).toBe(4)
    expect(dist.trust[ANCHOR_TRUST.TRUSTED]).toBe(1)
    expect(dist.trust[ANCHOR_TRUST.CONFIRM_REQUIRED]).toBe(1)
    expect(dist.trust[ANCHOR_TRUST.MANUAL]).toBe(1)
    expect(dist.trust.unknown).toBe(1)
    expect(dist.meanConfidence).toBeCloseTo((1 + 0.6 + 0.5) / 3, 6)
  })
})
