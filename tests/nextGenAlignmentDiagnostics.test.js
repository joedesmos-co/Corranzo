/**
 * Phase 4 — next-gen alignment diagnostics wiring (flag-gated, diagnostics-only).
 *
 * These tests pin the safety contract for Phase 4:
 *   - the feature flag defaults OFF (public) and never silently turns on;
 *   - the derivation surfaces the right recommendation (auto / confirm / manual),
 *     anchor coverage, missing measures, weak systems, and page/system status;
 *   - generated candidate anchors are display-only and can NEVER drive the
 *     live cursor (they are rejected by `filterTrustedAnchors`).
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { LAYOUT_CONFIDENCE } from '../src/features/score-follow/layoutAssessment.js'
import { FOLLOW_ACTION } from '../src/features/score-follow/alignmentConfidencePolicy.js'
import { ANCHOR_TRUST } from '../src/features/score-follow/generateAnchorsFromLayout.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import {
  decideNextGenAlignmentDiagnostics,
  resolveFlagOverride,
  isNextGenAlignmentDiagnosticsEnabled,
} from '../src/features/score-follow/nextGenAlignmentFlag.js'
import {
  deriveNextGenAlignmentDiagnostics,
  NEXTGEN_CANDIDATE_SOURCE,
} from '../src/features/score-follow/nextGenAlignmentDiagnostics.js'
import { straight4 } from './helpers/buildXml.js'

const timingMap = parseMusicXml(straight4(), 'straight4')

/** Synthetic auto-setup debug report (mirrors `scoreFollow.debug.autoSetup`). */
function autoSetupReport({
  layoutConfidence = LAYOUT_CONFIDENCE.EXACT,
  perSystemBarlines = [2, 2],
} = {}) {
  return {
    layoutConfidence,
    perPage: [{ page: 1, stage: 'staff-lines', systemCount: perSystemBarlines.length }],
    systems: perSystemBarlines.map((barlineCount, index) => ({
      index,
      page: 1,
      center: 0.2 + index * 0.2,
      firstAnchorX: 0.1,
      lastAnchorX: 0.5,
      barlineCount,
      measureCount: barlineCount,
    })),
  }
}

describe('Phase 4 feature flag — defaults off, dev-on, override-able', () => {
  it('coerces raw flag values to a tri-state', () => {
    expect(resolveFlagOverride('1')).toBe(true)
    expect(resolveFlagOverride('on')).toBe(true)
    expect(resolveFlagOverride(true)).toBe(true)
    expect(resolveFlagOverride('0')).toBe(false)
    expect(resolveFlagOverride('off')).toBe(false)
    expect(resolveFlagOverride(false)).toBe(false)
    expect(resolveFlagOverride(undefined)).toBeNull()
    expect(resolveFlagOverride('maybe')).toBeNull()
  })

  it('is OFF by default (no dev mode, no overrides)', () => {
    expect(decideNextGenAlignmentDiagnostics({})).toBe(false)
    expect(decideNextGenAlignmentDiagnostics({ devMode: false })).toBe(false)
  })

  it('is ON in dev/debug builds when nothing overrides it', () => {
    expect(decideNextGenAlignmentDiagnostics({ devMode: true })).toBe(true)
  })

  it('honors precedence: explicit > global > storage > dev default', () => {
    // Explicit override wins even over a dev build.
    expect(decideNextGenAlignmentDiagnostics({ override: false, devMode: true })).toBe(false)
    expect(decideNextGenAlignmentDiagnostics({ override: '1', devMode: false })).toBe(true)
    // Global beats storage + dev.
    expect(
      decideNextGenAlignmentDiagnostics({ globalValue: '0', storageValue: '1', devMode: true }),
    ).toBe(false)
    // Storage beats dev default.
    expect(decideNextGenAlignmentDiagnostics({ storageValue: '1', devMode: false })).toBe(true)
  })

  it('ambient resolver accepts an explicit override', () => {
    expect(isNextGenAlignmentDiagnosticsEnabled(false)).toBe(false)
    expect(isNextGenAlignmentDiagnosticsEnabled(true)).toBe(true)
  })
})

describe('Phase 4 derivation — unavailable cases never produce diagnostics', () => {
  it('returns { available: false } without a timing map', () => {
    expect(deriveNextGenAlignmentDiagnostics({ autoSetupReport: autoSetupReport() })).toEqual({
      available: false,
    })
  })

  it('returns { available: false } without an auto-setup report (e.g. bundled demo)', () => {
    expect(deriveNextGenAlignmentDiagnostics({ timingMap })).toEqual({ available: false })
    expect(
      deriveNextGenAlignmentDiagnostics({ timingMap, autoSetupReport: null }),
    ).toEqual({ available: false })
  })

  it('returns { available: false } when the report has no systems', () => {
    expect(
      deriveNextGenAlignmentDiagnostics({
        timingMap,
        autoSetupReport: { layoutConfidence: LAYOUT_CONFIDENCE.EXACT, systems: [] },
      }),
    ).toEqual({ available: false })
  })
})

describe('Phase 4 derivation — recommendation ladder (auto / confirm / manual)', () => {
  it('recommends AUTO with full trusted coverage on an exact, clean layout', () => {
    const result = deriveNextGenAlignmentDiagnostics({
      timingMap,
      autoSetupReport: autoSetupReport({ layoutConfidence: LAYOUT_CONFIDENCE.EXACT }),
    })
    expect(result.available).toBe(true)
    expect(result.decision.action).toBe(FOLLOW_ACTION.AUTO)
    expect(result.trust).toBe(ANCHOR_TRUST.TRUSTED)
    expect(result.coverage.measuresCovered).toBe(4)
    expect(result.coverage.measuresExpected).toBe(4)
    expect(result.coverage.missingMeasures).toEqual([])
    expect(result.coverage.weakSystems).toEqual([])
    expect(result.pageSystem.mismatch).toBe(false)
    expect(result.pageSystem.label).toBe('aligned')
    expect(result.model.some((line) => line.startsWith('Pickup:'))).toBe(true)
  })

  it('recommends CONFIRM on an approximate (but clean) layout', () => {
    const result = deriveNextGenAlignmentDiagnostics({
      timingMap,
      autoSetupReport: autoSetupReport({ layoutConfidence: LAYOUT_CONFIDENCE.APPROXIMATE }),
    })
    expect(result.decision.action).toBe(FOLLOW_ACTION.CONFIRM)
    expect(result.trust).toBe(ANCHOR_TRUST.CONFIRM_REQUIRED)
    expect(result.candidateAnchors.length).toBeGreaterThan(0)
  })

  it('recommends MANUAL (no candidate anchors) when barlines disagree with the score', () => {
    const result = deriveNextGenAlignmentDiagnostics({
      timingMap,
      autoSetupReport: autoSetupReport({
        layoutConfidence: LAYOUT_CONFIDENCE.GOOD,
        perSystemBarlines: [8, 0],
      }),
    })
    expect(result.decision.action).toBe(FOLLOW_ACTION.MANUAL)
    expect(result.trust).toBe(ANCHOR_TRUST.MANUAL)
    expect(result.candidateAnchors).toEqual([])
    expect(result.coverage.missingMeasures.length).toBe(4)
  })
})

describe('Phase 4 safety — candidate anchors can never drive the live cursor', () => {
  const result = deriveNextGenAlignmentDiagnostics({
    timingMap,
    autoSetupReport: autoSetupReport({ layoutConfidence: LAYOUT_CONFIDENCE.EXACT }),
  })

  it('tags every candidate as display-only with a non-cursor source', () => {
    expect(result.candidateAnchors).toHaveLength(4)
    for (const anchor of result.candidateAnchors) {
      expect(anchor.source).toBe(NEXTGEN_CANDIDATE_SOURCE)
      expect(anchor.provenance).toBe(NEXTGEN_CANDIDATE_SOURCE)
      expect(anchor.meta.candidate).toBe(true)
      expect(String(anchor.id)).toMatch(/^nextgen-candidate-/)
    }
  })

  it('is rejected by filterTrustedAnchors even if it leaked into the anchor list', () => {
    expect(filterTrustedAnchors(result.candidateAnchors)).toEqual([])
  })

  it('does not mutate the supplied auto-setup report', () => {
    const report = autoSetupReport({ layoutConfidence: LAYOUT_CONFIDENCE.EXACT })
    const snapshot = JSON.parse(JSON.stringify(report))
    deriveNextGenAlignmentDiagnostics({ timingMap, autoSetupReport: report })
    expect(report).toEqual(snapshot)
  })
})
