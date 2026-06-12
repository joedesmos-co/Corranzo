import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildMeasureLoopRegion } from '../src/features/practice/practiceLoopRegion.js'
import {
  buildBeatCheckpoints,
  buildNoteCheckpoints,
  findCheckpointIndexAtTime,
} from '../src/features/practice/waitForYouCheckpoints.js'
import { resolveNoteTargetPosition } from '../src/features/practice/noteTargetPosition.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import * as F from './helpers/buildXml.js'

function repeatAnchors() {
  return [
    { page: 1, x: 0.1, y: 0.5, measureNumber: 1, source: 'manual' },
    { page: 1, x: 0.3, y: 0.5, measureNumber: 2, source: 'manual' },
    { page: 1, x: 0.5, y: 0.5, measureNumber: 3, source: 'manual' },
    { page: 1, x: 0.7, y: 0.5, measureNumber: 4, source: 'manual' },
  ]
}

describe('Phase 4 practice experience', () => {
  it('WFY note checkpoints distinguish repeat passes', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const checkpoints = buildNoteCheckpoints(timingMap)
    const m2pass1 = checkpoints.filter((cp) => cp.measureNumber === 2 && cp.repeatPass === 1)
    const m2pass2 = checkpoints.filter((cp) => cp.measureNumber === 2 && cp.repeatPass === 2)
    expect(m2pass1.length).toBeGreaterThan(0)
    expect(m2pass2.length).toBeGreaterThan(0)
    expect(m2pass2[0].timeSeconds).toBeGreaterThan(m2pass1[0].timeSeconds)
  })

  it('WFY seeks to correct occurrence by performed time', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const checkpoints = buildBeatCheckpoints(timingMap)
    const pass2 = checkpoints.find((cp) => cp.measureNumber === 2 && cp.repeatPass === 2)
    expect(pass2).toBeTruthy()
    const index = findCheckpointIndexAtTime(checkpoints, pass2.timeSeconds)
    expect(checkpoints[index].repeatPass).toBe(2)
    expect(checkpoints[index].measureNumber).toBe(2)
  })

  it('loop inside repeated section spans all performed passes for that measure', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const region = buildMeasureLoopRegion(timingMap, 2, 2)
    expect(region.isValid).toBe(true)
    expect(region.startTimeSeconds).toBeCloseTo(2, 6)
    expect(region.endTimeSeconds).toBeCloseTo(8, 6)
  })

  it('loop after repeated section uses post-repeat performed times', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const region = buildMeasureLoopRegion(timingMap, 3, 4)
    expect(region.isValid).toBe(true)
    expect(region.startTimeSeconds).toBeCloseTo(8, 6)
    expect(region.endTimeSeconds).toBeCloseTo(12, 6)
  })

  it('note target shares cursor resolver geometry on repeat pass', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const checkpoints = buildNoteCheckpoints(timingMap)
    const pass2 = checkpoints.find((cp) => cp.measureNumber === 2 && cp.repeatPass === 2)
    expect(pass2).toBeTruthy()
    const anchors = repeatAnchors()

    const cursor = resolveScoreFollowCursor({
      timingMap,
      practiceTime: pass2.timeSeconds,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })

    const target = resolveNoteTargetPosition({
      checkpoint: pass2,
      timingMap,
      anchors,
    })

    expect(cursor.cursor.visible).toBe(true)
    expect(target.visible).toBe(true)
    expect(target.page).toBe(cursor.cursor.page)
    expect(target.x).toBeCloseTo(cursor.cursor.x, 1)
  })
})
