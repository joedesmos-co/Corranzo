/**
 * Guren visual measure anchors: page/system allocation, stale-anchor
 * regeneration, and the anchor debug table.
 *
 * Root cause (proven by scripts/debug-guren-anchors.mjs): Guren's MusicXML
 * system-break hints (systems at 1,6,10,14,…) disagree with the printed PDF
 * (1,6,11,15,19 on page 1; 23,27,31,35,38,41 on page 2). Allocating by the
 * MusicXML breaks drifts a measure per system; the PDF barline-derived
 * per-system counts must be used instead.
 */
import { describe, expect, it } from 'vitest'
import {
  allocateSpansByCounts,
  groupMeasuresBySystemBreaks,
} from '../src/features/score-follow/allocateMeasuresToSystems.js'
import {
  ANCHOR_SOURCE,
  AUTO_MEASURE_ANCHOR_SCHEMA_VERSION,
  dropStaleAutoAnchors,
} from '../src/features/score-follow/anchorUtils.js'
import { buildAnchorDebugTable } from '../src/features/score-follow/scoreFollowDebug.js'

const PRINTED_STARTS = [1, 6, 11, 15, 19, 23, 27, 31, 35, 38, 41]
const MUSICXML_BREAKS = [1, 6, 10, 14, 18, 22, 26, 30, 34, 37, 40, 44, 48, 52, 56, 60, 64, 68, 72]
const measureNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
const entries = (n) => Array.from({ length: n }, (_, i) => ({ page: i < 5 ? 1 : 2 }))

function countsFromStarts(starts, lastMeasure) {
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : lastMeasure
    return end - start + 1
  })
}

describe('Guren page/system allocation', () => {
  it('printed per-system counts reproduce the printed system starts', () => {
    const counts = countsFromStarts(PRINTED_STARTS, 75)
    const spans = allocateSpansByCounts(entries(PRINTED_STARTS.length), measureNumbers, counts)
    expect(spans.map((s) => s.measureStart)).toEqual(PRINTED_STARTS)
    // Contiguous, no gaps or overlaps, covering all measures.
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].measureStart).toBe(spans[i - 1].measureEnd + 1)
    }
    expect(spans[0].measureStart).toBe(1)
    expect(spans.at(-1).measureEnd).toBe(75)
  })

  it('MusicXML system breaks do NOT match the printed layout', () => {
    const timingMap = {
      measures: measureNumbers.map((n) => ({
        number: n,
        systemBreakBefore: MUSICXML_BREAKS.includes(n),
      })),
    }
    const starts = groupMeasuresBySystemBreaks(measureNumbers, timingMap).map((g) => g[0])
    // Agrees on system 1, then drifts: 10≠11, 14≠15, 18≠19 …
    expect(starts.slice(0, 5)).toEqual([1, 6, 10, 14, 18])
    expect(starts.slice(0, 5)).not.toEqual(PRINTED_STARTS.slice(0, 5))
  })

  it('assigns each system to its detected page', () => {
    const counts = countsFromStarts(PRINTED_STARTS, 75)
    const spans = allocateSpansByCounts(entries(PRINTED_STARTS.length), measureNumbers, counts)
    expect(spans.slice(0, 5).every((s) => s.page === 1)).toBe(true)
    expect(spans.slice(5).every((s) => s.page === 2)).toBe(true)
  })

  it('reconciles slightly-off detected counts back to the exact measure total', () => {
    // Detection a little noisy (sums to 74, not 75) → still covers all measures.
    const noisy = [5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 34]
    const spans = allocateSpansByCounts(entries(11), measureNumbers, noisy)
    expect(spans[0].measureStart).toBe(1)
    expect(spans.at(-1).measureEnd).toBe(75)
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].measureStart).toBe(spans[i - 1].measureEnd + 1)
    }
  })
})

describe('stale restored auto anchors are discarded (and regenerated)', () => {
  const manual = { id: 'm1', source: ANCHOR_SOURCE.MANUAL, measureNumber: 1, x: 0.1, y: 0.2 }
  const demo = { id: 'd1', source: ANCHOR_SOURCE.DEMO, measureNumber: 1, x: 0.1, y: 0.2 }
  const freshAuto = (n) => ({
    id: `a${n}`,
    source: ANCHOR_SOURCE.AUTO_MEASURE,
    measureNumber: n,
    x: 0.2,
    y: 0.2,
    meta: {
      role: 'measure',
      autoMeasureSchemaVersion: AUTO_MEASURE_ANCHOR_SCHEMA_VERSION,
      measureStartX: 0.1,
      playableStartX: 0.2,
      playableEndX: 0.3,
      systemEndX: 0.9,
      xSource: 'default-x',
    },
  })
  const staleAuto = (n) => ({
    id: `s${n}`,
    source: ANCHOR_SOURCE.AUTO_MEASURE,
    measureNumber: n,
    x: 0.2,
    y: 0.2,
    meta: { role: 'measure' }, // missing measureStartX/playableStartX/playableEndX
  })
  const oldSchemaAuto = (n) => ({
    ...freshAuto(n),
    id: `old${n}`,
    meta: {
      ...freshAuto(n).meta,
      autoMeasureSchemaVersion: AUTO_MEASURE_ANCHOR_SCHEMA_VERSION - 1,
    },
  })
  const systemAuto = (n) => ({
    id: `sy${n}`,
    source: ANCHOR_SOURCE.AUTO_SYSTEM,
    measureNumber: n,
    x: 0.1,
    y: 0.2,
    meta: { role: 'system-start' },
  })

  it('keeps a fresh per-measure auto set unchanged', () => {
    const set = [manual, freshAuto(1), freshAuto(2)]
    expect(dropStaleAutoAnchors(set)).toEqual(set)
  })

  it('discards stale per-measure auto anchors, preserving manual', () => {
    expect(dropStaleAutoAnchors([manual, staleAuto(1), staleAuto(2)])).toEqual([manual])
  })

  it('discards old-schema per-measure auto anchors, preserving manual', () => {
    expect(dropStaleAutoAnchors([manual, oldSchemaAuto(1), oldSchemaAuto(2)])).toEqual([manual])
  })

  it('discards a system-only auto set (no per-measure anchors → coarse)', () => {
    expect(dropStaleAutoAnchors([manual, systemAuto(1), systemAuto(6)])).toEqual([manual])
  })

  it('preserves bundled demo anchors', () => {
    expect(dropStaleAutoAnchors([demo, staleAuto(1)])).toEqual([demo])
  })

  it('no-ops with no auto anchors', () => {
    expect(dropStaleAutoAnchors([manual])).toEqual([manual])
    expect(dropStaleAutoAnchors([])).toEqual([])
  })
})

describe('anchor debug table', () => {
  it('emits one row per anchor with the requested columns and nearest-barline error', () => {
    const anchors = [
      {
        page: 1,
        measureNumber: 1,
        x: 0.21,
        meta: {
          systemIndex: 0,
          role: 'measure',
          xSource: 'default-x',
          measureStartX: 0.1,
          playableStartX: 0.21,
          playableEndX: 0.35,
        },
      },
      {
        page: 1,
        measureNumber: 6,
        x: 0.18,
        meta: {
          systemIndex: 1,
          role: 'measure',
          xSource: 'system-start-width',
          measureStartX: 0.105,
          playableStartX: 0.18,
          playableEndX: 0.29,
        },
      },
    ]
    const { rows, text } = buildAnchorDebugTable(anchors, { barlinesBySystem: { 0: [0.105, 0.352] } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ page: 1, systemIndex: 0, measure: 1, xSource: 'default-x' })
    expect(rows[0].nearestBarline).toBeCloseTo(0.105, 3)
    expect(rows[0].error).toBeCloseTo(0.005, 3)
    // System 1 has no barlines provided → no nearest/error.
    expect(rows[1].nearestBarline).toBeNull()
    expect(text).toContain('xSource')
    expect(text).toContain('nearBL')
  })
})
