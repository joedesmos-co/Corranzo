import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { buildMeasureBoundaryDiagnostic } from '../src/features/score-follow/measureBoundaryDiagnostics.js'
import {
  applyVisualCursorX,
  isSameSystemCursor,
  resolveVisualMaxX,
  shouldUseVisualCursorMotion,
} from '../src/features/score-follow/cursorVisualMotion.js'
import * as F from './helpers/buildXml.js'

function anchorsForMeasures(count, { playableSpan = 0.12 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const measureNumber = index + 1
    const x = 0.1 + index * 0.18
    return {
      id: `m${measureNumber}`,
      page: 1,
      x,
      y: 0.3,
      measureNumber,
      source: 'manual',
      meta: {
        playableStartX: x,
        playableEndX: x + playableSpan,
        systemEndX: 0.95,
      },
    }
  })
}

describe('cursorVisualMotion', () => {
  it('eases forward toward the musical x without ever leading past it', () => {
    // displayX is behind; with no lead room the follower advances toward musicalX
    // but never overshoots it (forward-only, bounded).
    const x = applyVisualCursorX({
      displayX: 0.19,
      musicalX: 0.22,
      musicalAheadX: 0.22,
      sameSystem: true,
      visualMaxX: 0.22,
    })
    expect(x).toBeGreaterThan(0.19)
    expect(x).toBeLessThanOrEqual(0.22)
  })

  it('leads only up to the TIME-capped target, never beyond it (no fixed-x runaway)', () => {
    // musicalAheadX is the musical x a few ms ahead. The display may approach it
    // but must never exceed it, so the lead is bounded in TIME regardless of how
    // much horizontal room exists to the next note.
    const x = applyVisualCursorX({
      displayX: 0.2,
      musicalX: 0.2,
      musicalAheadX: 0.205,
      sameSystem: true,
      visualMaxX: 0.3, // lots of room ahead
    })
    expect(x).toBeGreaterThanOrEqual(0.2)
    expect(x).toBeLessThanOrEqual(0.205 + 1e-9)
  })

  it('never exceeds visualMaxX / playableEndX', () => {
    const x = applyVisualCursorX({
      displayX: 0.215,
      musicalX: 0.218,
      musicalAheadX: 0.24,
      atOnset: false,
      sameSystem: true,
      visualMaxX: 0.22,
      allowPredictiveLead: true,
    })
    expect(x).toBeLessThanOrEqual(0.22 + 0.0001)
  })

  it('resets to musical x when the next sample is a new system', () => {
    const x = applyVisualCursorX({
      displayX: 0.88,
      musicalX: 0.12,
      musicalAheadX: 0.12,
      atOnset: false,
      sameSystem: false,
      visualMaxX: 0.95,
    })
    expect(x).toBe(0.12)
  })

  it('disables predictive lead near system end', () => {
    const target = {
      visible: true,
      x: 0.948,
      playableEndX: 0.95,
      meta: { systemEndX: 0.95 },
      progressMode: 'velocity-bridge',
    }
    expect(shouldUseVisualCursorMotion(target)).toBe(false)
    expect(resolveVisualMaxX(target)).toBe(0.95)
  })

  it('detects same-system lookahead only when page and y match', () => {
    const current = { visible: true, page: 1, y: 0.3, x: 0.8 }
    const sameLine = { visible: true, page: 1, y: 0.305, x: 0.82 }
    const nextLine = { visible: true, page: 1, y: 0.18, x: 0.1 }
    expect(isSameSystemCursor(current, sameLine)).toBe(true)
    expect(isSameSystemCursor(current, nextLine)).toBe(false)
  })
})

describe('measure boundary velocity', () => {
  const timingMap = parseMusicXml(F.straight4())
  const trust = { showCursor: true, needsSetup: false }

  it('keeps tail velocity above stall threshold before the barline', () => {
    const tightAnchors = [
      {
        id: 'm1',
        page: 1,
        x: 0.1,
        y: 0.3,
        measureNumber: 1,
        source: 'manual',
        meta: { playableStartX: 0.1, playableEndX: 0.22, systemEndX: 0.95 },
      },
      {
        id: 'm2',
        page: 1,
        x: 0.22,
        y: 0.3,
        measureNumber: 2,
        source: 'manual',
        meta: { playableStartX: 0.22, playableEndX: 0.34, systemEndX: 0.95 },
      },
    ]
    const diag = buildMeasureBoundaryDiagnostic({
      timingMap,
      trustedAnchors: tightAnchors,
      measureNumber: 1,
      trust,
    })
    expect(diag.active).toBe(true)
    expect(diag.velocities.xBefore).not.toBeNull()

    const lateTail = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.88,
      trustedAnchors: tightAnchors,
      trust,
    }).cursor
    const atLast = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.5,
      trustedAnchors: tightAnchors,
      trust,
    }).cursor
    expect(lateTail.x).toBeGreaterThanOrEqual(atLast.x)
    expect(lateTail.x).toBeLessThanOrEqual(0.22 + 0.001)
  })

  it('advances across the barline into the next measure on the same system', () => {
    const anchors = anchorsForMeasures(4)
    const before = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.92,
      trustedAnchors: anchors,
      trust,
    }).cursor
    const after = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2.04,
      trustedAnchors: anchors,
      trust,
    }).cursor
    expect(after.measureNumber).toBe(2)
    expect(after.x).toBeGreaterThanOrEqual(before.x - 0.0001)
  })
})

describe('system line transition', () => {
  const timingMap = parseMusicXml(F.straight4())
  const trust = { showCursor: true, needsSetup: false }

  it('never exceeds systemEndX on the last measure of a system', () => {
    const systemEndAnchors = [
      {
        id: 'm1',
        page: 1,
        x: 0.1,
        y: 0.3,
        measureNumber: 1,
        source: 'manual',
        meta: { playableStartX: 0.1, playableEndX: 0.22, systemEndX: 0.88 },
      },
      {
        id: 'm2',
        page: 1,
        x: 0.1,
        y: 0.18,
        measureNumber: 2,
        source: 'manual',
        meta: { playableStartX: 0.1, playableEndX: 0.22, systemEndX: 0.88 },
      },
    ]
    let maxX = 0
    for (let t = 1.5; t <= 2; t += 0.04) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: systemEndAnchors,
        trust,
      })
      maxX = Math.max(maxX, cursor.x)
      expect(cursor.x).toBeLessThanOrEqual(0.88 + 0.001)
    }
    expect(maxX).toBeGreaterThan(0.15)
  })

  it('allows intentional reset to next system start without treating it as overshoot', () => {
    const crossSystem = [
      {
        id: 'm1',
        page: 1,
        x: 0.1,
        y: 0.3,
        measureNumber: 1,
        source: 'manual',
        meta: { playableStartX: 0.1, playableEndX: 0.22, systemEndX: 0.88 },
      },
      {
        id: 'm2',
        page: 1,
        x: 0.1,
        y: 0.18,
        measureNumber: 2,
        source: 'manual',
        meta: { playableStartX: 0.1, playableEndX: 0.22, systemEndX: 0.88 },
      },
    ]
    const endOfSystem = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.95,
      trustedAnchors: crossSystem,
      trust,
    }).cursor
    const nextSystem = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2.05,
      trustedAnchors: crossSystem,
      trust,
    }).cursor
    expect(endOfSystem.y).toBeGreaterThan(nextSystem.y)
    expect(endOfSystem.x).toBeLessThanOrEqual(0.88 + 0.001)
    expect(nextSystem.x).toBeCloseTo(0.1, 2)
    expect(nextSystem.nextSameSystem).toBe(false)
  })
})
