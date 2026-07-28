import { describe, expect, it, vi } from 'vitest'

vi.mock('tone', () => ({
  now: () => 10,
  Gain: class {
    constructor() {
      this.gain = { value: 1 }
    }
    toDestination() {
      return this
    }
  },
}))

describe('playback scheduler chunking', () => {
  it('schedules dense windows in bounded slices without dropping notes', async () => {
    const { ScorePlaybackEngine } = await import('../src/features/playback/scorePlaybackEngine.js')
    const engine = new ScorePlaybackEngine()
    const triggers = []
    engine.voice = {
      triggerAttackRelease: (name, duration, at, velocity) => {
        triggers.push({ name, duration, at, velocity })
      },
    }
    engine.metronome = { triggerClick: () => {} }
    engine.playing = true
    engine.playStartedAt = 10
    engine.offsetScoreSeconds = 0
    engine.playbackRate = 1
    engine.scheduledUntilScore = 0
    engine.scheduleEventIndex = 0
    engine.scheduledEvents = new Set()
    engine.noteEvents = Array.from({ length: 120 }, (_, index) => ({
      type: 'note',
      scoreTimeSeconds: index * 0.01,
      baseDurationSeconds: 0.2,
      midi: 60 + (index % 12),
      name: 'C4',
      velocity: 0.7,
      trackId: 'P1',
    }))

    engine.scheduleWindow(0, 2.5)
    expect(triggers.length).toBe(48)
    expect(engine.scheduledUntilScore).toBe(0)
    expect(engine.scheduleEventIndex).toBe(48)

    // Drain remaining slices (production uses setTimeout(0); test drives explicitly).
    let guard = 0
    while (engine.scheduledUntilScore < 2.5 && guard < 10) {
      engine.clearScheduleWindowContinuation()
      engine.scheduleWindow(0, 2.5)
      guard += 1
    }

    expect(triggers.length).toBe(120)
    expect(engine.scheduledUntilScore).toBe(2.5)
    engine.clearScheduleWindowContinuation()
  })
})
