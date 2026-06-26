/**
 * Audio-clock ↔ cursor alignment — same timebase as Tone scheduling.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { resolveMusicalXInMeasure } from '../src/features/score-follow/cursorMusicalProgress.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import {
  getScoreFollowCursorSnapshot,
  publishScoreFollowCursor,
  resetScoreFollowCursorRuntime,
  subscribeScoreFollowCursor,
} from '../src/features/score-follow/scoreFollowCursorRuntime.js'
import { resolveTrustedAnchorForMeasure } from '../src/features/score-follow/trustedAnchors.js'
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
        role: 'measure',
        playableStartX: x,
        playableEndX: x + playableSpan,
        systemEndX: 0.95,
      },
    }
  })
}

describe('scoreFollowCursorRuntime', () => {
  afterEach(() => {
    resetScoreFollowCursorRuntime()
  })

  it('publishes cursor snapshots to subscribers without duplicate writes', () => {
    const listener = vi.fn()
    const unsub = subscribeScoreFollowCursor(listener)
    expect(listener).toHaveBeenCalledTimes(1)

    publishScoreFollowCursor({ visible: true, page: 1, x: 0.2, y: 0.3 })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(getScoreFollowCursorSnapshot().x).toBe(0.2)

    publishScoreFollowCursor({ visible: true, page: 1, x: 0.2, y: 0.3 })
    expect(listener).toHaveBeenCalledTimes(2)

    publishScoreFollowCursor({ visible: true, page: 1, x: 0.21, y: 0.3 })
    expect(listener).toHaveBeenCalledTimes(3)
    unsub()
  })
})

describe('audio clock cursor resolution', () => {
  const timingMap = parseMusicXml(F.straight4())
  const anchors = anchorsForMeasures(4)
  const trust = { showCursor: true, needsSetup: false }

  function resolveAtAudioTime(t) {
    return resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust,
    }).cursor
  }

  it('cursor at note onset matches musical ideal x (no early snap)', () => {
    const notes = getTimeline(timingMap)
      .performedNotes()
      .filter((note) => !note.isRest && note.midi != null)

    for (const note of notes.slice(0, 12)) {
      const t = note.performedSeconds
      const cursor = resolveAtAudioTime(t)
      const anchor = resolveTrustedAnchorForMeasure(anchors, note.measureNumber)
      const xEnd = anchor.meta.playableEndX
      const musical = resolveMusicalXInMeasure({
        timingMap,
        practiceTime: t,
        measureNumber: note.measureNumber,
        xStart: anchor.x,
        xEnd,
      })
      expect(Math.abs(cursor.x - musical.x)).toBeLessThan(0.001)
    }
  })

  it('simulated audio clock stays ahead of stale React practiceTime', () => {
    const stalePracticeTime = 1.0
    const audioTime = 1.04
    const stale = resolveScoreFollowCursor({
      timingMap,
      practiceTime: stalePracticeTime,
      trustedAnchors: anchors,
      trust,
    }).cursor
    const live = resolveAtAudioTime(audioTime)
    expect(live.x).toBeGreaterThan(stale.x)
    publishScoreFollowCursor({ ...live, smoothed: false })
    expect(getScoreFollowCursorSnapshot().x).toBe(live.x)
  })

  it('measure-only anchors still interpolate between beats', () => {
    const sparse = [anchors[0]]
    const mid = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.75,
      trustedAnchors: sparse,
      trust,
    }).cursor
    expect(mid.visible).toBe(true)
    expect(mid.x).toBeGreaterThan(sparse[0].x)
    expect(mid.x).toBeLessThan(sparse[0].x + 0.15)
  })

  it('keeps moving across the barline after the final note of a measure', () => {
    const atBeat4 = resolveAtAudioTime(1.5)
    const lateTail = resolveAtAudioTime(1.88)
    expect(lateTail.x).toBeGreaterThan(atBeat4.x + 0.001)
    expect(lateTail.progressMode).toMatch(/bridge|note/)
    const nextDownbeat = resolveAtAudioTime(2)
    expect(nextDownbeat.measureNumber).toBe(2)
    expect(nextDownbeat.x).toBeGreaterThanOrEqual(lateTail.x - 0.0001)
  })

  it('page transition happens at the next measure anchor, not inside the gap', () => {
    const crossPage = [
      { id: 'a1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual', meta: { playableEndX: 0.22 } },
      { id: 'a3', page: 2, x: 0.1, y: 0.3, measureNumber: 3, source: 'manual', meta: { playableEndX: 0.22 } },
    ]
    const beforeFlip = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 3,
      trustedAnchors: crossPage,
      trust,
    }).cursor
    const afterFlip = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 3.85,
      trustedAnchors: crossPage,
      trust,
    }).cursor
    expect(beforeFlip.page).toBe(1)
    expect(afterFlip.page).toBe(1)
    expect(afterFlip.x).toBeGreaterThanOrEqual(beforeFlip.x - 0.01)
    const atNextMeasure = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 4.05,
      trustedAnchors: crossPage,
      trust,
    }).cursor
    expect(atNextMeasure.measureNumber).toBe(3)
    expect(atNextMeasure.page).toBe(2)
  })
})
