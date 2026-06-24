/**
 * Phase 5b — runtime promotion layer safeguards + fixture verification.
 *
 * Proves the promotion gate is safe:
 *   - generated anchors are used ONLY when readiness is READY;
 *   - everything else (NEEDS_REVIEW / NOT_SAFE / flag off / demo / no anchors)
 *     falls back automatically to existing behavior;
 *   - weak layouts never auto-promote;
 *   - the bundled demo is never promoted (its anchors must not be replaced);
 *   - the active-source diagnostic reflects manual / bundled / semi-auto / generated.
 *
 * No runtime cursor/playback/setup behavior is exercised here — this validates
 * the pure decision layer that the hook consults.
 */
import { describe, expect, it } from 'vitest'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import { generateAnchorsFromLayout } from '../src/features/score-follow/generateAnchorsFromLayout.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { LAYOUT_CONFIDENCE } from '../src/features/score-follow/layoutAssessment.js'
import {
  compareAnchorSets,
  assessPromotionReadiness,
  PROMOTION_STATUS,
} from '../src/features/score-follow/anchorComparison.js'
import {
  decidePromotedAnchorUse,
  resolveActiveAnchorSource,
  buildPromotionDecision,
  ANCHOR_SOURCE_KIND,
  PROMOTION_REASON,
} from '../src/features/score-follow/anchorPromotion.js'
import { RUNNABLE_FIXTURES } from './fixtures/alignmentFixtures.js'
import { straight4 } from './helpers/buildXml.js'

const baseArgs = { enabled: true, isDemoSession: false, hasGeneratedAnchors: true }

describe('Phase 5b: promotion decision — generated used only when READY', () => {
  it('READY → generated anchors allowed', () => {
    const decision = decidePromotedAnchorUse({ ...baseArgs, readinessStatus: PROMOTION_STATUS.READY })
    expect(decision.useGenerated).toBe(true)
    expect(decision.reason).toBe(PROMOTION_REASON.READY)
  })

  it('NEEDS_REVIEW → fall back to existing behavior', () => {
    const decision = decidePromotedAnchorUse({
      ...baseArgs,
      readinessStatus: PROMOTION_STATUS.NEEDS_REVIEW,
    })
    expect(decision.useGenerated).toBe(false)
    expect(decision.reason).toBe(PROMOTION_REASON.NEEDS_REVIEW)
  })

  it('NOT_SAFE → fall back to existing behavior', () => {
    const decision = decidePromotedAnchorUse({
      ...baseArgs,
      readinessStatus: PROMOTION_STATUS.NOT_SAFE,
    })
    expect(decision.useGenerated).toBe(false)
    expect(decision.reason).toBe(PROMOTION_REASON.NOT_SAFE)
  })
})

describe('Phase 5b: automatic fallback safeguards', () => {
  it('flag OFF never promotes (even when READY)', () => {
    const decision = decidePromotedAnchorUse({
      ...baseArgs,
      enabled: false,
      readinessStatus: PROMOTION_STATUS.READY,
    })
    expect(decision.useGenerated).toBe(false)
    expect(decision.reason).toBe(PROMOTION_REASON.DISABLED)
  })

  it('the bundled demo is never promoted (anchors preserved) even when READY', () => {
    const decision = decidePromotedAnchorUse({
      ...baseArgs,
      isDemoSession: true,
      readinessStatus: PROMOTION_STATUS.READY,
    })
    expect(decision.useGenerated).toBe(false)
    expect(decision.reason).toBe(PROMOTION_REASON.DEMO_BUNDLED)
  })

  it('no generated anchors → fall back', () => {
    const decision = decidePromotedAnchorUse({
      ...baseArgs,
      hasGeneratedAnchors: false,
      readinessStatus: PROMOTION_STATUS.READY,
    })
    expect(decision.useGenerated).toBe(false)
    expect(decision.reason).toBe(PROMOTION_REASON.NO_GENERATED)
  })

  it('unknown / missing readiness → fall back', () => {
    expect(decidePromotedAnchorUse({ ...baseArgs, readinessStatus: null }).useGenerated).toBe(false)
    expect(decidePromotedAnchorUse({ ...baseArgs, readinessStatus: 'whatever' }).useGenerated).toBe(
      false,
    )
  })
})

describe('Phase 5b: active anchor-source diagnostics (manual / bundled / semi-auto / generated)', () => {
  it('generated wins when promotion allowed it', () => {
    expect(resolveActiveAnchorSource({ useGenerated: true, anchorCounts: { demo: 5 } })).toBe(
      ANCHOR_SOURCE_KIND.GENERATED,
    )
  })

  it('manual markers take precedence over everything else when not promoted', () => {
    expect(
      resolveActiveAnchorSource({ useGenerated: false, anchorCounts: { manual: 2, demo: 5, auto: 9 } }),
    ).toBe(ANCHOR_SOURCE_KIND.MANUAL)
  })

  it('bundled is reported for the demo', () => {
    expect(resolveActiveAnchorSource({ useGenerated: false, anchorCounts: { demo: 32 } })).toBe(
      ANCHOR_SOURCE_KIND.BUNDLED,
    )
  })

  it('semi-auto is reported for auto-detected anchors', () => {
    expect(resolveActiveAnchorSource({ useGenerated: false, anchorCounts: { autoMeasure: 12 } })).toBe(
      ANCHOR_SOURCE_KIND.SEMI_AUTO,
    )
    expect(resolveActiveAnchorSource({ useGenerated: false, anchorCounts: { auto: 6 } })).toBe(
      ANCHOR_SOURCE_KIND.SEMI_AUTO,
    )
  })

  it('none when there are no anchors', () => {
    expect(resolveActiveAnchorSource({ useGenerated: false, anchorCounts: {} })).toBe(
      ANCHOR_SOURCE_KIND.NONE,
    )
  })
})

describe('Phase 5b: weak layouts never auto-promote', () => {
  it('a weak/mismatched reconciliation yields NOT_SAFE → fall back', () => {
    // Detected barlines [8, 0] disagree with the score → manual/low confidence.
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
    const generated = generateAnchorsFromLayout(reconciliation, layout)
    const comparison = compareAnchorSets(generated.anchors, [])
    const readiness = assessPromotionReadiness(comparison)
    const promotion = buildPromotionDecision({
      enabled: true,
      isDemoSession: false,
      comparison,
      readiness,
      anchorCounts: { auto: 0 },
      generatedAnchors: generated.anchors,
    })
    expect(readiness.status).toBe(PROMOTION_STATUS.NOT_SAFE)
    expect(promotion.useGenerated).toBe(false)
  })
})

describe('Phase 5b: FIXTURE VERIFICATION — promotion result per runnable fixture', () => {
  // Documented expectations. `minuet-in-g` has trusted bundled reference anchors
  // (generated reproduces them exactly → READY → generated allowed when treated
  // as a non-demo session). The synthetic fixtures have no trusted reference, so
  // they are non-comparable → NOT_SAFE → existing behavior (safe fallback).
  const EXPECTED = {
    'minuet-in-g': { status: PROMOTION_STATUS.READY, useGenerated: true },
    'repeats-voltas': { status: PROMOTION_STATUS.NOT_SAFE, useGenerated: false },
    'multi-page': { status: PROMOTION_STATUS.NOT_SAFE, useGenerated: false },
    'dense-fast': { status: PROMOTION_STATUS.NOT_SAFE, useGenerated: false },
  }

  for (const fixture of RUNNABLE_FIXTURES) {
    it(`${fixture.id}: ${EXPECTED[fixture.id].status} → useGenerated=${EXPECTED[fixture.id].useGenerated}`, () => {
      const reconciliation = reconcilePdfLayoutWithScore(fixture.makeInputs())
      const generated = generateAnchorsFromLayout(reconciliation, fixture.makePageLayout())
      const reference = fixture.makeReferenceAnchors ? fixture.makeReferenceAnchors() : null
      const comparison = compareAnchorSets(generated.anchors, reference)
      const readiness = assessPromotionReadiness(comparison)
      const promotion = buildPromotionDecision({
        enabled: true,
        isDemoSession: false,
        comparison,
        readiness,
        anchorCounts: { auto: generated.anchors.length },
        generatedAnchors: generated.anchors,
      })

      expect(readiness.status).toBe(EXPECTED[fixture.id].status)
      expect(promotion.useGenerated).toBe(EXPECTED[fixture.id].useGenerated)
    })
  }

  it('the Minuet, treated as its real demo session, keeps bundled anchors (never promoted)', () => {
    const fixture = RUNNABLE_FIXTURES.find((f) => f.id === 'minuet-in-g')
    const reconciliation = reconcilePdfLayoutWithScore(fixture.makeInputs())
    const generated = generateAnchorsFromLayout(reconciliation, fixture.makePageLayout())
    const comparison = compareAnchorSets(generated.anchors, fixture.makeReferenceAnchors())
    const readiness = assessPromotionReadiness(comparison)
    const promotion = buildPromotionDecision({
      enabled: true,
      isDemoSession: true, // real runtime: the Minuet IS the bundled demo
      comparison,
      readiness,
      anchorCounts: { demo: 32 },
      generatedAnchors: generated.anchors,
    })
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
    expect(promotion.useGenerated).toBe(false)
    expect(promotion.reason).toBe(PROMOTION_REASON.DEMO_BUNDLED)
    expect(promotion.activeSource).toBe(ANCHOR_SOURCE_KIND.BUNDLED)
  })
})
