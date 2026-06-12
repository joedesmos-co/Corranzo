import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'

function performedOrder(timingMap) {
  return timingMap.performedMeasureTimeline.entries
    .map((entry) => entry.writtenMeasureNumber)
    .join(',')
}

function passes(timingMap) {
  return timingMap.performedMeasureTimeline.entries
    .map((entry) => entry.repeatPass)
    .join(',')
}

describe('repeat and ending expansion', () => {
  it('straight score has a 1:1 performed timeline', () => {
    const t = parseMusicXml(F.straight4())
    expect(performedOrder(t)).toBe('1,2,3,4')
    expect(t.performedMeasureTimeline.performedDurationSeconds).toBeCloseTo(8, 6)
    expect(t.performedMeasureTimeline.diagnostics.fullyInterpreted).toBe(true)
  })

  it('expands a single repeat', () => {
    const t = parseMusicXml(F.oneRepeat())
    expect(performedOrder(t)).toBe('1,2,1,2,3,4')
    expect(passes(t)).toBe('1,1,2,2,1,1')
    expect(t.performedMeasureTimeline.performedDurationSeconds).toBeCloseTo(12, 6)
  })

  it('expands two independent repeat sections (per-section pass state)', () => {
    const t = parseMusicXml(F.twoRepeatSections())
    expect(performedOrder(t)).toBe('1,2,1,2,3,4,3,4')
    expect(passes(t)).toBe('1,1,2,2,1,1,2,2')
  })

  it('repeats from the beginning when no forward repeat exists', () => {
    const t = parseMusicXml(F.repeatToBeginning())
    expect(performedOrder(t)).toBe('1,2,1,2,3')
    expect(t.performedMeasureTimeline.diagnostics.fullyInterpreted).toBe(true)
  })

  it('honors repeat times attribute', () => {
    const t = parseMusicXml(F.repeatTimes3())
    expect(performedOrder(t)).toBe('1,2,1,2,1,2,3')
    expect(passes(t)).toBe('1,1,2,2,3,3,1')
  })

  it('expands single-measure first/second endings', () => {
    const t = parseMusicXml(F.singleMeasureVoltas())
    expect(performedOrder(t)).toBe('1,2,1,3,4')
  })

  it('keeps every measure of a multi-measure first ending inside the volta', () => {
    const t = parseMusicXml(F.multiMeasureVoltas())
    expect(performedOrder(t)).toBe('1,2,3,1,4,5')
  })

  it('handles voltas in the second of two repeated sections', () => {
    const t = parseMusicXml(F.secondSectionVoltas())
    expect(performedOrder(t)).toBe('1,2,1,2,3,4,3,5')
  })

  it('terminates on malformed repeats and reports diagnostics', () => {
    const t = parseMusicXml(F.malformedRepeats())
    const tl = t.performedMeasureTimeline
    expect(tl.entries.length).toBeGreaterThanOrEqual(4)
    expect(tl.entries.length).toBeLessThan(4 * 40)
    expect(tl.diagnostics.fullyInterpreted).toBe(false)
    expect(tl.diagnostics.warning).toBeTruthy()
  })

  it('repeated entries carry stable occurrence identity', () => {
    const t = parseMusicXml(F.oneRepeat())
    const entries = t.performedMeasureTimeline.entries
    entries.forEach((entry, index) => {
      expect(entry.performedIndex).toBe(index)
    })
    const m1 = entries.filter((entry) => entry.writtenMeasureNumber === 1)
    expect(m1.map((entry) => entry.repeatPass)).toEqual([1, 2])
    expect(m1[1].startTimeSeconds).toBeGreaterThan(m1[0].startTimeSeconds)
  })

  it('keeps written measure times unchanged under expansion', () => {
    const t = parseMusicXml(F.oneRepeat())
    expect(t.measures.map((m) => m.startTimeSeconds)).toEqual([0, 2, 4, 6])
    expect(t.writtenDurationSeconds).toBeCloseTo(8, 6)
  })
})
