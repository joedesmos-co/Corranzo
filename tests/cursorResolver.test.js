import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  resolveScoreFollowCursor,
  START_LOCK_THRESHOLD_SECONDS,
} from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { buildMusicXmlLayoutAnchors } from '../src/features/score-follow/musicxmlLayoutAnchors.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import { buildCursorMappingDebug } from '../src/features/score-follow/scoreFollowCursorMappingDebug.js'
import * as F from './helpers/buildXml.js'

function sweepCursor(timingMap, anchors, { trust = { showCursor: true, needsSetup: false } } = {}) {
  const samples = []
  const duration =
    timingMap.performedMeasureTimeline?.performedDurationSeconds ?? timingMap.durationSeconds
  for (let t = 0; t <= duration; t += 0.25) {
    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust,
    })
    samples.push({ t, ...result })
  }
  return samples
}

describe('resolveScoreFollowCursor', () => {
  const timingMap = parseMusicXml(F.straight4())
  const anchors = [
    { id: 'a1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual' },
    { id: 'a2', page: 1, x: 0.4, y: 0.3, measureNumber: 2, source: 'manual' },
    { id: 'a3', page: 1, x: 0.7, y: 0.3, measureNumber: 3, source: 'manual' },
    { id: 'a4', page: 1, x: 0.9, y: 0.3, measureNumber: 4, source: 'manual' },
  ]

  it('start-locks to measure 1 for t ≤ threshold', () => {
    const atStart = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(atStart.cursor.visible).toBe(true)
    expect(atStart.cursor.measureNumber).toBe(1)
    expect(atStart.cursor.lockExact).toBe(true)
    expect(atStart.needsSetup).toBe(false)
  })

  it('selects exact anchor per measure during playback', () => {
    const at2 = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2.5,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(at2.cursor.measureNumber).toBe(2)
    expect(at2.cursor.lockExact).toBe(false)
  })

  it('keeps cursor visible with interpolation when measure anchor is missing', () => {
    const sparse = [anchors[0], anchors[2], anchors[3]]
    const gap = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2.5,
      trustedAnchors: sparse,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(gap.cursor.visible).toBe(true)
    expect(gap.cursor.interpolated).toBe(true)
    expect(gap.needsSetup).toBe(false)
    expect(gap.cursor.x).toBeGreaterThan(0.1)
    expect(gap.cursor.x).toBeLessThan(0.7)
  })

  it('does not flip needsSetup mid-playback on anchor gap', () => {
    const sparse = [anchors[0], anchors[3]]
    const samples = sweepCursor(timingMap, sparse)
    const midPlayback = samples.filter(
      (s) => s.t > START_LOCK_THRESHOLD_SECONDS + 0.01 && s.t < 7,
    )
    expect(midPlayback.every((s) => s.needsSetup === false)).toBe(true)
    expect(midPlayback.some((s) => s.cursor.visible)).toBe(true)
  })

  it('does not interpolate y/page across a missing cross-system measure gap', () => {
    const sparseMap = parseMusicXml(F.systemsAndPages())
    const sparse = [
      {
        id: 'm1',
        page: 1,
        x: 0.1,
        y: 0.25,
        measureNumber: 1,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: { role: 'system-start', systemIndex: 0, systemEndX: 0.92 },
      },
      {
        id: 'm5',
        page: 2,
        x: 0.12,
        y: 0.72,
        measureNumber: 5,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: { role: 'system-start', systemIndex: 2, systemEndX: 0.9 },
      },
    ]

    const gap = resolveScoreFollowCursor({
      timingMap: sparseMap,
      practiceTime: 4.25,
      trustedAnchors: sparse,
      trust: { showCursor: true, needsSetup: false },
    })

    expect(gap.cursor.measureNumber).toBe(3)
    expect(gap.cursor.page).toBe(1)
    expect(gap.cursor.y).toBeCloseTo(0.25, 5)
    expect(gap.cursor.fallbackTier).toBe('gap-hold-system-y')
  })

  it('interpolates Y across same-page multi-system anchor gaps', () => {
    const sparse = [
      {
        id: 'a1',
        page: 1,
        x: 0.1,
        y: 0.15,
        measureNumber: 1,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
      },
      {
        id: 'a5',
        page: 1,
        x: 0.85,
        y: 0.55,
        measureNumber: 5,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
      },
    ]

    const gap = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 4.25,
      trustedAnchors: sparse,
      trust: { showCursor: true, needsSetup: false },
    })

    expect(gap.cursor.measureNumber).toBe(3)
    expect(gap.cursor.page).toBe(1)
    expect(gap.cursor.y).toBeGreaterThan(0.15)
    expect(gap.cursor.y).toBeLessThan(0.55)
    expect(gap.cursor.fallbackTier).toBe('gap-same-page-system-y')
  })

  it('reports the current time to measure box mapping', () => {
    const mapped = buildCursorMappingDebug({
      timingMap,
      practiceTime: 2.5,
      trustedAnchors: [
        {
          ...anchors[1],
          source: ANCHOR_SOURCE.AUTO_MEASURE,
          meta: {
            role: 'measure',
            systemIndex: 0,
            xSource: 'default-x+barline',
            measureBox: { x0: 0.3, y0: 0.2, x1: 0.5, y1: 0.36 },
          },
        },
      ],
      cursor: {
        visible: true,
        page: 1,
        x: 0.4,
        y: 0.3,
        measureNumber: 2,
        interpolationSource: 'motion-timeline:note-to-note-glide',
        fallbackTier: 'motion-timeline',
      },
      autoSetupReport: { allocationMode: 'barline-counts' },
    })

    expect(mapped.measureIndex).toBe(1)
    expect(mapped.measureNumber).toBe(2)
    expect(mapped.pageNumber).toBe(1)
    expect(mapped.systemIndex).toBe(0)
    expect(mapped.measureBoundingBox).toMatchObject({
      x0: 0.3,
      y0: 0.2,
      x1: 0.5,
      y1: 0.36,
      source: 'measureBox',
    })
    expect(mapped.interpolationSource).toBe('motion-timeline:note-to-note-glide')
    expect(mapped.fallbackTier).toBe('motion-timeline')
  })
})

describe('musicxml layout anchor promotion', () => {
  it('pairs system start/end by role and produces per-measure anchors', () => {
    const timingMap = parseMusicXml(F.layoutRichTwoSystems())
    const systemAnchors = [
      {
        id: 's0-start',
        page: 1,
        x: 0.05,
        y: 0.3,
        measureNumber: 1,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: { role: 'system-start', systemIndex: 0 },
      },
      {
        id: 's0-end',
        page: 1,
        x: 0.95,
        y: 0.3,
        measureNumber: 2,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: { role: 'system-end', systemIndex: 0 },
      },
      {
        id: 's1-start',
        page: 1,
        x: 0.05,
        y: 0.6,
        measureNumber: 3,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: { role: 'system-start', systemIndex: 1 },
      },
      {
        id: 's1-end',
        page: 1,
        x: 0.95,
        y: 0.6,
        measureNumber: 4,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: { role: 'system-end', systemIndex: 1 },
      },
    ]

    const layoutAnchors = buildMusicXmlLayoutAnchors(timingMap, systemAnchors)
    expect(layoutAnchors.length).toBeGreaterThanOrEqual(4)
    const measures = new Set(layoutAnchors.map((anchor) => anchor.measureNumber))
    expect(measures.has(1)).toBe(true)
    expect(measures.has(2)).toBe(true)
    expect(measures.has(3)).toBe(true)
    expect(measures.has(4)).toBe(true)
  })
})
