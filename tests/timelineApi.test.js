import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import * as F from './helpers/buildXml.js'

describe('timeline API — written/performed conversions', () => {
  it('locate() round-trips every performed entry', () => {
    for (const build of [F.straight4, F.oneRepeat, F.twoRepeatSections, F.multiMeasureVoltas]) {
      const tl = getTimeline(parseMusicXml(build()))
      for (const entry of tl.entries) {
        const mid = (entry.startTimeSeconds + entry.endTimeSeconds) / 2
        const located = tl.locate(mid)
        expect(located.measureNumber).toBe(entry.writtenMeasureNumber)
        expect(located.occurrenceIndex).toBe(entry.performedIndex)
        expect(located.repeatPass).toBe(entry.repeatPass)
      }
    }
  })

  it('performedStartForMeasure returns first occurrence by default and pass-specific on request', () => {
    const tl = getTimeline(parseMusicXml(F.oneRepeat()))
    expect(tl.performedStartForMeasure(1)).toBeCloseTo(0, 6)
    expect(tl.performedStartForMeasure(1, { pass: 2 })).toBeCloseTo(4, 6)
    expect(tl.performedStartForMeasure(3)).toBeCloseTo(8, 6)
    expect(tl.performedStartForMeasure(99)).toBeNull()
  })

  it('windowsForMeasure lists every occurrence', () => {
    const tl = getTimeline(parseMusicXml(F.oneRepeat()))
    const windows = tl.windowsForMeasure(2)
    expect(windows).toHaveLength(2)
    expect(windows[0].startTimeSeconds).toBeCloseTo(2, 6)
    expect(windows[1].startTimeSeconds).toBeCloseTo(6, 6)
    expect(windows.map((w) => w.repeatPass)).toEqual([1, 2])
  })

  it('performedBeats cover the performed duration with occurrence identity', () => {
    const tl = getTimeline(parseMusicXml(F.oneRepeat()))
    expect(tl.performedBeats).toHaveLength(24)
    const last = tl.performedBeats[tl.performedBeats.length - 1]
    expect(last.timeSeconds).toBeCloseTo(11.5, 6)
    const m1pass2 = tl.performedBeats.filter(
      (b) => b.measureNumber === 1 && b.repeatPass === 2,
    )
    expect(m1pass2).toHaveLength(4)
    expect(m1pass2[0].timeSeconds).toBeCloseTo(4, 6)
  })

  it('performedNotes expands notes across repeat passes', () => {
    const tl = getTimeline(parseMusicXml(F.oneRepeat()))
    const notes = tl.performedNotes()
    // 16 written notes; measures 1–2 play twice → 8 extra
    expect(notes).toHaveLength(24)
    const firstNoteOccurrences = notes.filter(
      (n) => n.measureNumber === 1 && n.quarterTime === 0,
    )
    expect(firstNoteOccurrences.map((n) => n.performedSeconds)).toEqual([0, 4])
    expect(firstNoteOccurrences.map((n) => n.repeatPass)).toEqual([1, 2])
  })

  it('locate() reports beat and measure progress', () => {
    const tl = getTimeline(parseMusicXml(F.straight4()))
    const at = tl.locate(2.5)
    expect(at.measureNumber).toBe(2)
    expect(at.beat).toBe(2)
    expect(at.measureProgress).toBeCloseTo(0.25, 6)
  })

  it('locate() clamps before-start and past-end times', () => {
    const tl = getTimeline(parseMusicXml(F.straight4()))
    expect(tl.locate(-1).measureNumber).toBe(1)
    expect(tl.locate(999).measureNumber).toBe(4)
  })

  it('mid-measure tempo changes inside a repeated section replay identically', () => {
    const tl = getTimeline(parseMusicXml(F.repeatWithTempoChange()))
    // m1@120 (2s) + m2@60 (4s) = pass1 6s; pass2 the same → m3 starts at 12s
    expect(tl.performedStartForMeasure(3)).toBeCloseTo(12, 6)
    expect(tl.performedDurationSeconds).toBeCloseTo(14, 6)
  })

  it('straight scores still expose a timeline (1:1)', () => {
    const tl = getTimeline(parseMusicXml(F.straight4()))
    expect(tl.entries).toHaveLength(4)
    expect(tl.performedDurationSeconds).toBeCloseTo(8, 6)
    expect(tl.locate(5).measureNumber).toBe(3)
  })

  it('is cached per timing map', () => {
    const t = parseMusicXml(F.straight4())
    expect(getTimeline(t)).toBe(getTimeline(t))
  })
})
