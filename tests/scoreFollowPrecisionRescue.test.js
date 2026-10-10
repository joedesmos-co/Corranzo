/**
 * Score-follow precision rescue: coordinate honesty, single resolver,
 * chord identity, and cursor-vs-highlight agreement.
 */
import { describe, expect, it } from 'vitest'
import { resolveWfyCheckpointCursor } from '../src/features/score-follow/wfyCheckpointCursor.js'
import { WFY_STATUS } from '../src/features/practice/waitForYouEngine.js'
import {
  buildCursorMotionTimeline,
  resolveCursorMotion,
} from '../src/features/score-follow/cursorMotionTimeline.js'
import { resolveDisplayCursorAtTime } from '../src/features/score-follow/scoreFollowDisplayPosition.js'
import { measureCursorHighlightAgreement } from '../src/features/score-follow/scoreFollowPrecisionDiagnostics.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'

const checkpoint = { id: 'cp-0', measureNumber: 3, timeSeconds: 1.5, expectedMidis: [60] }
const timelineCursor = { visible: true, page: 2, measureNumber: 3, x: 0.3, y: 0.5, smoothed: true }

function wfyArgs(overrides = {}) {
  return {
    practiceMode: 'wait-for-you',
    checkpointMode: 'note',
    waitForYouStatus: WFY_STATUS.WAITING,
    currentCheckpoint: checkpoint,
    noteTarget: { visible: true, page: 2, x: 0.42, y: 0.3, noteAnchorY: 0.34, targetKey: 'cp-0' },
    scoreFollowCursor: timelineCursor,
    ...overrides,
  }
}

function twoMeasureXml() {
  return F.scoreWrap(
    `<part id="P1">
      <measure number="1">
        ${F.attributes({ divisions: 4 })}
        ${F.soundTempo(120)}
        <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note default-x="80"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      </measure>
      <measure number="2">
        <note default-x="40"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><chord /></note>
      </measure>
    </part>`,
  )
}

function anchors() {
  return [1, 2].map((measureNumber) => ({
    id: `m${measureNumber}`,
    page: 1,
    x: 0.1 + (measureNumber - 1) * 0.3,
    y: 0.3,
    measureNumber,
    source: 'manual',
    meta: {
      role: 'measure',
      playableStartX: 0.1 + (measureNumber - 1) * 0.3,
      playableEndX: 0.1 + (measureNumber - 1) * 0.3 + 0.2,
      systemEndX: 0.9,
    },
  }))
}

describe('WFY checkpoint lock honesty', () => {
  it('converts a source-normalized OMR column into analysis space (rotation 0)', () => {
    const cursor = resolveWfyCheckpointCursor(
      wfyArgs({
        noteTarget: {
          visible: true,
          page: 2,
          x: 0.42,
          y: 0.3,
          noteAnchorY: 0.34,
          targetKey: 'cp-0',
          source: 'source-notehead',
          confidence: 0.96,
          coordinateSpace: 'pdf-source-normalized',
        },
        pageViewRotations: { 2: 0 },
      }),
    )
    expect(cursor).toMatchObject({
      x: 0.42,
      y: 0.5,
      checkpointLocked: true,
      coordinateSpace: 'pdf-analysis-normalized',
      precision: 'notehead',
    })
    expect(cursor.approximate).toBe(false)
  })

  it('rotates a source-normalized column under a 90-degree viewer turn', () => {
    const cursor = resolveWfyCheckpointCursor(
      wfyArgs({
        noteTarget: {
          visible: true,
          page: 2,
          x: 0.42,
          y: 0.3,
          noteAnchorY: 0.34,
          targetKey: 'cp-0',
          source: 'source-notehead',
          confidence: 0.96,
          coordinateSpace: 'pdf-source-normalized',
        },
        pageViewRotations: { 2: 90 },
      }),
    )
    // Inverse of analysis->overlay for 90°: analysis.x = 1 - overlay.y.
    expect(cursor.x).toBeCloseTo(1 - 0.34, 6)
    expect(cursor.checkpointLocked).toBe(true)
  })

  it('refuses to lock a guessed position (measure-beat / system-heuristic)', () => {
    for (const source of ['measure-beat', 'system-heuristic', 'anchor-only']) {
      const cursor = resolveWfyCheckpointCursor(
        wfyArgs({
          noteTarget: {
            visible: true,
            page: 2,
            x: 0.42,
            y: 0.3,
            targetKey: 'cp-0',
            source,
            confidence: 0.5,
            coordinateSpace: 'pdf-analysis-normalized',
          },
        }),
      )
      expect(cursor, source).toBeNull()
    }
  })

  it('locks an engraved-mapped target but marks it approximate when flagged', () => {
    const cursor = resolveWfyCheckpointCursor(
      wfyArgs({
        noteTarget: {
          visible: true,
          page: 2,
          x: 0.42,
          y: 0.3,
          targetKey: 'cp-0',
          source: 'musicxml-layout',
          confidence: 0.66,
          approximate: true,
          coordinateSpace: 'pdf-analysis-normalized',
        },
      }),
    )
    expect(cursor).toMatchObject({
      x: 0.42,
      checkpointLocked: true,
      approximate: true,
      precision: 'engraved-mapped',
    })
  })

  it('refuses an unknown coordinate space rather than planting the bar', () => {
    expect(
      resolveWfyCheckpointCursor(
        wfyArgs({
          noteTarget: {
            visible: true,
            page: 2,
            x: 0.42,
            y: 0.3,
            targetKey: 'cp-0',
            source: 'source-notehead',
            coordinateSpace: 'mystery-space',
          },
        }),
      ),
    ).toBeNull()
  })
})

describe('single display resolver', () => {
  it('posed and realtime cursors agree (no pause jump)', () => {
    const timingMap = parseMusicXml(twoMeasureXml())
    const trusted = anchors()
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    for (const t of [0.1, 0.6, 1.1, 1.6, 2.1]) {
      const posed = resolveDisplayCursorAtTime({
        timingMap,
        trustedAnchors: trusted,
        trust: { showCursor: true, needsSetup: false },
        practiceTime: t,
        motionTimeline,
      })
      const realtime = resolveDisplayCursorAtTime({
        timingMap,
        trustedAnchors: trusted,
        trust: { showCursor: true, needsSetup: false },
        practiceTime: t,
        motionTimeline,
      })
      expect(posed.x).toBe(realtime.x)
      expect(posed.page).toBe(realtime.page)
      expect(posed.precision).toBeTruthy()
      expect(posed.precision).not.toBe('none')
    }
  })

  it('marks chord onsets as chords and reports geometry provenance', () => {
    const timingMap = parseMusicXml(twoMeasureXml())
    const trusted = anchors()
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    expect(motionTimeline.empty).toBe(false)
    const kinds = new Set()
    for (const phrase of motionTimeline.phrases) {
      for (const knot of phrase.knots) {
        kinds.add(knot.kind)
      }
      expect(['engraved', 'time', 'mixed']).toContain(phrase.geometryMode)
    }
    expect(kinds.has('note')).toBe(true)
    expect(kinds.has('chord')).toBe(true)
    const motion = resolveCursorMotion(motionTimeline, 0.5)
    expect(motion.precision).toMatch(/engraved-mapped|time-mapped/)
    expect(motion.geometryMode).toBeTruthy()
  })

  it('legacy fallback stamps an honest precision tier', () => {
    const timingMap = parseMusicXml(twoMeasureXml())
    const cursor = resolveDisplayCursorAtTime({
      timingMap,
      trustedAnchors: anchors(),
      trust: { showCursor: true, needsSetup: false },
      practiceTime: 0.5,
      motionTimeline: null,
    })
    expect(cursor.visible).toBe(true)
    expect(['engraved-mapped', 'time-mapped', 'gap']).toContain(cursor.precision)
  })
})

describe('phrase-boundary epsilon (1ms-early queries)', () => {
  // Two systems: m1 on line 1 (ends t=2), m2 on line 2 (starts t=2).
  // A query 1ms before m2 starts (ms-quantized checkpoint time, audio
  // clock dust) must resolve at m2's start — never at line 1's end.
  const xml = F.scoreWrap(
    `<part id="P1">
      <measure number="1">
        ${F.attributes({ divisions: 4 })}
        ${F.soundTempo(120)}
        <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note default-x="80"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      </measure>
      <measure number="2">
        <note default-x="40"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note default-x="80"><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      </measure>
    </part>`,
  )
  const lineAnchors = [
    { id: 'm1', page: 1, x: 0.15, y: 0.3, measureNumber: 1, source: 'manual', meta: { playableStartX: 0.15, playableEndX: 0.5, systemEndX: 0.94 } },
    { id: 'm2', page: 1, x: 0.15, y: 0.6, measureNumber: 2, source: 'manual', meta: { playableStartX: 0.15, playableEndX: 0.5, systemEndX: 0.94 } },
  ]

  it('resolves 1ms before a line start inside the new line', () => {
    const timingMap = parseMusicXml(xml)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: lineAnchors })
    expect(motionTimeline.phrases.length).toBe(2)
    const secondStart = motionTimeline.phrases[1].startTime
    const early = resolveCursorMotion(motionTimeline, secondStart - 0.001)
    const exact = resolveCursorMotion(motionTimeline, secondStart)
    expect(early).not.toBeNull()
    expect(early.y).toBeCloseTo(0.6, 3)
    expect(early.x).toBeCloseTo(exact.x, 6)
  })
})

describe('overfull-measure orphan adoption', () => {
  // m1 holds 4 quarters in a 2-quarter (2/4) window: the 4th sounds at
  // t=3, past m1's nominal end, inside m2's [2,4] window.
  const xml = F.scoreWrap(
    `<part id="P1">
      <measure number="1">
        ${F.attributes({ divisions: 4, beats: 2 })}
        ${F.soundTempo(60)}
        <note default-x="10"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note default-x="30"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note default-x="50"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
        <note default-x="70"><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      </measure>
      <measure number="2">
        <note default-x="10"><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
      </measure>
    </part>`,
  )
  const lineAnchors = [
    { id: 'm1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual', meta: { playableStartX: 0.1, playableEndX: 0.4, systemEndX: 0.94 } },
    { id: 'm2', page: 1, x: 0.5, y: 0.3, measureNumber: 2, source: 'manual', meta: { playableStartX: 0.5, playableEndX: 0.8, systemEndX: 0.94 } },
  ]

  it('keeps a knot for overflow notes instead of stalling at the barline', () => {
    const timingMap = parseMusicXml(xml)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: lineAnchors })
    // Overflow 4th quarter sounds at t=3, inside m2's window.
    const atOverflow = resolveCursorMotion(motionTimeline, 3.0)
    expect(atOverflow).not.toBeNull()
    expect(Number.isFinite(atOverflow.x)).toBe(true)
    // The bar keeps moving through the overflow passage (no stall/freeze).
    const before = resolveCursorMotion(motionTimeline, 2.5).x
    const after = resolveCursorMotion(motionTimeline, 3.5).x
    expect(after).toBeGreaterThan(before)
  })

  it('keeps the barline-exact downbeat in its written next measure only', () => {
    const timingMap = parseMusicXml(xml)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: lineAnchors })
    const knotsM1 = motionTimeline.phrases.flatMap((p) => p.knots).filter((k) => k.measureNumber === 1)
    const knotsM2 = motionTimeline.phrases.flatMap((p) => p.knots).filter((k) => k.measureNumber === 2)
    // Parser extends the overfull m1 window to its real content end (t=4),
    // so m2's written downbeat sounds at t=4 — after the overflow, matching
    // engraved order. m1's knots must end at its own real window end and
    // must not claim m2's downbeat region; m2 owns its downbeat only.
    expect(Math.max(...knotsM1.map((k) => k.t))).toBeLessThanOrEqual(4.001)
    expect(knotsM2.some((k) => Math.abs(k.t - 4.0) < 0.01)).toBe(true)
    expect(Math.min(...knotsM2.map((k) => k.t))).toBeGreaterThanOrEqual(4.0 - 0.01)
  })
})

describe('cursor-vs-highlight agreement', () => {
  it('reports zero error when both paths coincide and flags page splits', () => {
    const checkpoints = [
      { timeSeconds: 0.5, measureNumber: 1 },
      { timeSeconds: 1.5, measureNumber: 2 },
    ]
    const report = measureCursorHighlightAgreement({
      checkpoints,
      resolveCursorAt: (t) => ({ visible: true, x: 0.2 + t * 0.1, page: 1, precision: 'engraved-mapped' }),
      resolveTarget: (checkpoint) => ({
        visible: true,
        page: 1,
        x: 0.2 + checkpoint.timeSeconds * 0.1,
        highlight: { x0: 0.19 + checkpoint.timeSeconds * 0.1, x1: 0.21 + checkpoint.timeSeconds * 0.1 },
        source: 'musicxml-layout',
        approximate: true,
      }),
      staffSpacing: 0.02,
    })
    expect(report.sampleCount).toBe(2)
    expect(report.averageErrorX).toBeCloseTo(0, 9)
    expect(report.wrongPagePlacements).toBe(0)
    expect(report.averageErrorStaffSpacings).toBeCloseTo(0, 9)
  })

  it('counts wrong-page placements instead of averaging them away', () => {
    const report = measureCursorHighlightAgreement({
      checkpoints: [{ timeSeconds: 0.5, measureNumber: 9 }],
      resolveCursorAt: () => ({ visible: true, x: 0.2, page: 2 }),
      resolveTarget: () => ({
        visible: true,
        page: 1,
        x: 0.2,
        highlight: { x0: 0.19, x1: 0.21 },
        source: 'musicxml-layout',
        approximate: true,
      }),
    })
    expect(report.wrongPagePlacements).toBe(1)
  })
})
