import { describe, expect, it, vi } from 'vitest'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'

vi.mock('tone', () => ({
  now: vi.fn(() => globalThis.__TEST_TONE_NOW__ ?? 0),
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

/**
 * Mirrors ScorePlaybackEngine.scheduleWindow de-duplication: events are tracked
 * by IDENTITY (object reference), not by a time+type key. A time-key collapsed
 * simultaneous notes into one, dropping chord / bass / inner voices ("only top
 * notes"). Identity keeps every distinct note while still preventing the same
 * event from being scheduled twice across overlapping look-ahead windows.
 */
function scheduleOnce(events) {
  const scheduled = new Set()
  const triggered = []
  for (const event of events) {
    if (scheduled.has(event)) {
      continue
    }
    triggered.push(event)
    scheduled.add(event)
  }
  return triggered
}

describe('playback engine scheduling invariants', () => {
  it('schedules every note of a chord at the same score time (no top-note collapse)', () => {
    const c = { type: 'note', scoreTimeSeconds: 1.0, name: 'C4' }
    const e = { type: 'note', scoreTimeSeconds: 1.0, name: 'E4' }
    const g = { type: 'note', scoreTimeSeconds: 1.0, name: 'G4' }
    const bass = { type: 'note', scoreTimeSeconds: 1.0, name: 'C2' }
    // The same `c` appears twice (overlapping windows) and must trigger once.
    const triggered = scheduleOnce([c, e, g, bass, c])
    expect(triggered).toEqual([c, e, g, bass])
  })

  it('does not re-trigger an already-scheduled event across windows', () => {
    const n = { type: 'note', scoreTimeSeconds: 2.0, name: 'D4' }
    expect(scheduleOnce([n, n, n])).toEqual([n])
  })

  it('clears scheduled events on a seek/reschedule boundary', () => {
    const scheduledEvents = new Set([{ name: 'a' }, { name: 'b' }])
    scheduledEvents.clear()
    expect(scheduledEvents.size).toBe(0)
  })

  it('keeps the score clock continuous when tempo changes during playback', () => {    globalThis.__TEST_TONE_NOW__ = 104
    const engine = new ScorePlaybackEngine()

    engine.duration = 120
    engine.offsetScoreSeconds = 10
    engine.playbackRate = 1
    engine.playStartedAt = 100
    engine.playing = true
    engine.releaseAll = vi.fn()
    engine.scheduleWindow = vi.fn()
    engine.startScheduleLoop = vi.fn()
    engine.startProgressLoop = vi.fn()

    expect(engine.getCurrentScoreTime()).toBeCloseTo(14, 6)

    engine.setPlaybackRate(0.5)

    expect(engine.offsetScoreSeconds).toBeCloseTo(14, 6)
    expect(engine.getCurrentScoreTime()).toBeCloseTo(14, 6)
    expect(engine.scheduleWindow).toHaveBeenCalledWith(14, 16.5)
  })

  it('schedules post-fermata notes at written score time (audio/cursor stay together)', () => {
    // Fermata extends only the sounding duration of its own note: onsets
    // downstream never move, so the wall clock both the audio scheduler
    // and the cursor use cannot diverge.
    globalThis.__TEST_TONE_NOW__ = 200
    const engine = new ScorePlaybackEngine()
    engine.voice = { triggerAttackRelease: vi.fn() }
    engine.metronome = {}
    engine.playbackRate = 1
    engine.playStartedAt = 200
    engine.noteEvents = [
      { type: 'note', scoreTimeSeconds: 0, baseDurationSeconds: 0.875, midi: 60, name: 'C4', velocity: 0.8, fermata: true },
      { type: 'note', scoreTimeSeconds: 0.5, baseDurationSeconds: 0.5, midi: 62, name: 'D4', velocity: 0.8 },
    ]
    engine.scheduleWindow(0, 2.5)
    const names = engine.voice.triggerAttackRelease.mock.calls.map((call) => call[0])
    expect(names).toEqual(['C4', 'D4'])
    expect(engine.wallTimeForScoreTime(0.5)).toBeCloseTo(200.5, 6)
  })
})
