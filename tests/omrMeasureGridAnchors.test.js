import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import { buildOmrMeasureGridAnchors } from '../src/features/score-follow/omrMeasureGridAnchors.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { buildCursorMappingDebug } from '../src/features/score-follow/scoreFollowCursorMappingDebug.js'
import * as F from './helpers/buildXml.js'

function cleanGrid() {
  return {
    schemaVersion: 1,
    source: 'vector-glyphs',
    measures: [
      {
        page: 1,
        systemIndex: 0,
        measureIndex: 0,
        measureNumber: 1,
        xStart: 0.05,
        xEnd: 0.25,
        yTop: 0.12,
        yBottom: 0.28,
        measureStartX: 0.05,
        playableStartX: 0.14,
        playableEndX: 0.25,
        confidence: 0.92,
      },
      {
        page: 1,
        systemIndex: 0,
        measureIndex: 1,
        measureNumber: 2,
        xStart: 0.25,
        xEnd: 0.48,
        yTop: 0.12,
        yBottom: 0.28,
        measureStartX: 0.25,
        playableStartX: 0.26,
        playableEndX: 0.48,
        confidence: 0.94,
      },
      {
        page: 1,
        systemIndex: 0,
        measureIndex: 2,
        measureNumber: 3,
        xStart: 0.48,
        xEnd: 0.72,
        yTop: 0.12,
        yBottom: 0.28,
        measureStartX: 0.48,
        playableStartX: 0.49,
        playableEndX: 0.72,
        confidence: 0.94,
      },
      {
        page: 1,
        systemIndex: 0,
        measureIndex: 3,
        measureNumber: 4,
        xStart: 0.72,
        xEnd: 0.93,
        yTop: 0.12,
        yBottom: 0.28,
        measureStartX: 0.72,
        playableStartX: 0.73,
        playableEndX: 0.93,
        confidence: 0.9,
      },
    ],
  }
}

describe('OMR measure-grid score-follow anchors', () => {
  it('maps generated MusicXML measures to OMR PDF measure boxes', () => {
    const timingMap = parseMusicXml(F.straight4(), 'generated.omr.musicxml')
    const anchors = buildOmrMeasureGridAnchors({
      measureGrid: cleanGrid(),
      timingMap,
    })

    expect(anchors).toHaveLength(4)
    expect(anchors[0]).toMatchObject({
      source: ANCHOR_SOURCE.OMR,
      page: 1,
      measureNumber: 1,
      x: 0.14,
      y: 0.2,
    })
    expect(anchors[0].meta).toMatchObject({
      role: 'measure',
      xSource: 'omr-measure-grid',
      measureStartX: 0.05,
      rawMeasureXStart: 0.05,
      playableStartX: 0.14,
      playableEndX: 0.25,
      measureBox: { x0: 0.05, y0: 0.12, x1: 0.25, y1: 0.28 },
    })
    expect(anchors[0].meta.measureStartTimeSeconds).toBeCloseTo(
      timingMap.measures[0].startTimeSeconds,
    )
    expect(anchors[0].meta.measureDurationSeconds).toBeGreaterThan(0)
  })

  it('uses OMR anchors ahead of generic auto anchors for the same measure', () => {
    const timingMap = parseMusicXml(F.straight4(), 'generated.omr.musicxml')
    const omrAnchors = buildOmrMeasureGridAnchors({ measureGrid: cleanGrid(), timingMap })
    const genericAuto = {
      id: 'generic-auto-m1',
      page: 1,
      x: 0.05,
      y: 0.2,
      measureNumber: 1,
      source: ANCHOR_SOURCE.AUTO_MEASURE,
      meta: {
        role: 'measure',
        measureStartX: 0.05,
        playableStartX: 0.05,
        playableEndX: 0.25,
      },
    }

    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.01,
      trustedAnchors: [genericAuto, ...omrAnchors],
      trust: { showCursor: true, needsSetup: false },
    })

    expect(result.cursor.visible).toBe(true)
    expect(result.cursor.x).toBeCloseTo(0.14)
    expect(result.cursor.meta.xSource).toBe('omr-measure-grid')
  })

  it('reports matched OMR measure boxes in cursor debug output', () => {
    const timingMap = parseMusicXml(F.straight4(), 'generated.omr.musicxml')
    const anchors = buildOmrMeasureGridAnchors({
      measureGrid: cleanGrid(),
      timingMap,
    })
    const cursor = {
      visible: true,
      page: 1,
      x: 0.18,
      y: 0.2,
      measureNumber: 1,
      interpolationSource: 'motion-timeline:note-to-note-glide',
      fallbackTier: 'motion-timeline',
    }

    const debug = buildCursorMappingDebug({
      timingMap,
      practiceTime: 0.25,
      trustedAnchors: anchors,
      cursor,
      autoSetupReport: { allocationMode: 'omr-measure-grid' },
    })

    expect(debug.currentPlaybackMeasure).toBe(1)
    expect(debug.anchorSource).toBe(ANCHOR_SOURCE.OMR)
    expect(debug.matchedOmrMeasureBox).toMatchObject({
      measureNumber: 1,
      pageNumber: 1,
      systemIndex: 0,
      xStart: 0.05,
      xEnd: 0.25,
      rawMeasureXStart: 0.05,
      visualMeasureXStart: 0.14,
      cursorX: 0.18,
    })
    expect(debug.cursorXWithinMeasureBox).toBeCloseTo(0.65)
  })

  it('anchors the cursor to detected note columns instead of the left barline', () => {
    const timingMap = parseMusicXml(F.straight4(), 'generated.omr.musicxml')
    const measureGrid = {
      schemaVersion: 1,
      source: 'vector-glyphs',
      measures: [
        {
          page: 1,
          systemIndex: 0,
          measureIndex: 0,
          measureNumber: 1,
          xStart: 0.08,
          xEnd: 0.42,
          yTop: 0.12,
          yBottom: 0.28,
          measureStartX: 0.08,
          rawMeasureXStart: 0.08,
          rawMeasureXEnd: 0.42,
          playableStartX: 0.28,
          playableEndX: 0.4,
          visualMeasureStartX: 0.275,
          visualMeasureEndX: 0.4,
          firstNoteX: 0.28,
          lastNoteX: 0.39,
          noteXPositions: [0.28, 0.33, 0.39],
          confidence: 0.9,
        },
      ],
    }
    const anchors = buildOmrMeasureGridAnchors({ measureGrid, timingMap })
    const firstOnset = timingMap.measures[0].startTimeSeconds + 0.06
    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: firstOnset,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })

    expect(result.cursor.x).toBeGreaterThan(0.25)
    expect(result.cursor.x).toBeLessThan(0.31)
    expect(Math.abs(result.cursor.x - 0.28)).toBeLessThan(Math.abs(result.cursor.x - 0.08))
    expect(result.cursor.meta.firstNoteX).toBe(0.28)
    expect(result.cursor.meta.rawMeasureXStart).toBe(0.08)
  })

  it('does not change manual score-follow anchors', () => {
    const timingMap = parseMusicXml(F.straight4(), 'manual.musicxml')
    const manualAnchor = {
      id: 'manual-m1',
      page: 1,
      x: 0.21,
      y: 0.2,
      measureNumber: 1,
      source: 'manual',
      meta: {
        playableStartX: 0.21,
        playableEndX: 0.33,
        systemEndX: 0.9,
      },
    }
    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.2,
      trustedAnchors: [manualAnchor],
      trust: { showCursor: true, needsSetup: false },
    })

    expect(result.cursor.x).toBeGreaterThan(0.2)
    expect(result.cursor.meta?.rawMeasureXStart).toBeUndefined()
  })
})
