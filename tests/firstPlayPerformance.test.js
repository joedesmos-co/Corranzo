import { describe, expect, it, vi } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'
import * as F from './helpers/buildXml.js'

vi.mock('tone', () => ({
  now: vi.fn(() => 0),
  getContext: vi.fn(() => ({ state: 'running' })),
  start: vi.fn(() => Promise.resolve()),
  gainToDb: vi.fn((value) => value),
  Gain: vi.fn(function Gain() {
    this.gain = { value: 1 }
    this.toDestination = () => this
    this.dispose = vi.fn()
  }),
  MembraneSynth: vi.fn(function MembraneSynth() {
    this.volume = { value: 0 }
    this.toDestination = () => this
    this.triggerAttackRelease = vi.fn()
    this.dispose = vi.fn()
  }),
}))

describe('first-Play performance guards', () => {
  it('expands performed notes once per timing map and reuses the array', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const timeline = getTimeline(timingMap)
    const first = timeline.performedNotes()
    const second = timeline.performedNotes()
    expect(second).toBe(first)
    // Cache must not change the repeat expansion result.
    const fresh = getTimeline(parseMusicXml(F.oneRepeat())).performedNotes()
    expect(first).toEqual(fresh)
    expect(first).toHaveLength(24)
    expect(
      first.filter((note) => note.measureNumber === 1 && note.quarterTime === 0)
        .map((note) => note.performedSeconds),
    ).toEqual([0, 4])
  })

  it('does not rebuild the voice on a stopped engine with nothing scheduled', () => {
    const engine = new ScorePlaybackEngine()
    engine.flushPendingAudio = vi.fn()
    engine.playing = false
    engine.scheduledEvents = new Set()
    engine.releaseAll()
    expect(engine.flushPendingAudio).not.toHaveBeenCalled()
  })

  it('still flushes queued audio on pause/seek and while notes are sounding', () => {
    const engine = new ScorePlaybackEngine()
    engine.flushPendingAudio = vi.fn()
    engine.playing = false
    engine.scheduledEvents = new Set([{ type: 'note' }])
    engine.releaseAll()
    expect(engine.flushPendingAudio).toHaveBeenCalledTimes(1)

    engine.flushPendingAudio.mockClear()
    engine.playing = true
    engine.scheduledEvents = new Set()
    engine.releaseAll()
    expect(engine.flushPendingAudio).toHaveBeenCalledTimes(1)
  })
})
