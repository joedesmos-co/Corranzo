import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildMetronomeSchedule,
  buildScoreNoteSchedule,
} from '../src/features/playback/scorePlaybackSchedule.js'
import * as F from './helpers/buildXml.js'

describe('score playback schedule', () => {
  it('builds performed note events at 1.0× rate', () => {
    const t = parseMusicXml(F.straight4())
    const events = buildScoreNoteSchedule(t, { rate: 1 })
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].scoreTimeSeconds).toBe(0)
    expect(events[0].wallTimeSeconds).toBe(0)
    const last = events[events.length - 1]
    expect(last.scoreTimeSeconds).toBeLessThanOrEqual(8)
  })

  it('scales wall time at 0.5× rate', () => {
    const t = parseMusicXml(F.straight4())
    const full = buildScoreNoteSchedule(t, { rate: 1 })
    const half = buildScoreNoteSchedule(t, { rate: 0.5 })
    expect(half[0].scoreTimeSeconds).toBe(full[0].scoreTimeSeconds)
    expect(half[10].wallTimeSeconds).toBeCloseTo(full[10].wallTimeSeconds * 2, 6)
  })

  it('duplicates notes across repeat passes', () => {
    const t = parseMusicXml(F.oneRepeat())
    const events = buildScoreNoteSchedule(t, { rate: 1 })
    const m1FirstBeats = events.filter(
      (e) => e.measureNumber === 1 && Math.abs(e.scoreTimeSeconds % 4) < 1e-6,
    )
    expect(m1FirstBeats.map((e) => e.repeatPass).sort()).toEqual([1, 2])
  })

  it('aligns metronome ticks with performed beats', () => {
    const t = parseMusicXml(F.straight4())
    const clicks = buildMetronomeSchedule(t, { rate: 1 })
    expect(clicks[0].scoreTimeSeconds).toBe(0)
    expect(clicks[1].scoreTimeSeconds).toBeCloseTo(0.5, 6)
  })
})
