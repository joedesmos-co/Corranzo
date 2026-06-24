/**
 * Dense piano playback: chord alignment, voice-mix ducking, stop/pause cleanup.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('tone', () => ({
  now: vi.fn(() => 100),
  gainToDb: vi.fn((value) => value),
  MembraneSynth: vi.fn(function MembraneSynth() {
    this.volume = { value: 0 }
    this.toDestination = () => this
    this.triggerAttackRelease = vi.fn()
    this.releaseAll = vi.fn()
    this.dispose = vi.fn()
  }),
}))
import {
  alignChordScoreTime,
  createVoiceMixState,
  MAX_SIMULTANEOUS_VOICES,
  planNoteTrigger,
  pruneVoices,
  resetVoiceMix,
} from '../src/features/playback/pianoVoiceMix.js'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'
import { MidiPlaybackEngine } from '../src/features/playback/midiPlaybackEngine.js'

describe('piano voice mix', () => {
  it('reduces velocity when many notes overlap at the same instant', () => {
    const state = createVoiceMixState()
    const t = 1.0
    const results = []
    for (let i = 0; i < 6; i += 1) {
      results.push(
        planNoteTrigger(state, { time: t, velocity: 0.85, duration: 0.5, note: `N${i}` }),
      )
    }
    expect(state.maxSimultaneous).toBe(6)
    expect(results[0].velocity).toBeCloseTo(0.85, 2)
    expect(results[5].velocity).toBeLessThan(results[0].velocity)
    expect(state.densityReduced).toBeGreaterThan(0)
  })

  it('does not duck sparse single-note triggers', () => {
    const state = createVoiceMixState()
    const a = planNoteTrigger(state, { time: 0, velocity: 0.8, duration: 0.4, note: 'C4' })
    const b = planNoteTrigger(state, { time: 0.5, velocity: 0.8, duration: 0.4, note: 'E4' })
    expect(a.velocity).toBeCloseTo(0.8, 2)
    expect(b.velocity).toBeCloseTo(0.8, 2)
    expect(state.densityReduced).toBe(0)
  })

  it('resetVoiceMix clears active voices after releaseAll path', () => {
    const state = createVoiceMixState()
    planNoteTrigger(state, { time: 1, velocity: 0.7, duration: 0.5, note: 'C4' })
    expect(state.active).toHaveLength(1)
    resetVoiceMix(state)
    expect(state.active).toHaveLength(0)
    pruneVoices(state, 10)
    expect(state.active).toHaveLength(0)
  })

  it('skips duplicate identical notes at the same chord instant', () => {
    const state = createVoiceMixState()
    planNoteTrigger(state, { time: 1, velocity: 0.8, duration: 0.5, note: 'C4' })
    const duplicate = planNoteTrigger(state, { time: 1, velocity: 0.8, duration: 0.5, note: 'C4' })
    expect(duplicate.skipped).toBe(true)
    expect(state.duplicatesSkipped).toBe(1)
    expect(state.active).toHaveLength(1)
  })

  it('gracefully steals voices when the polyphony budget is exceeded', () => {
    const state = createVoiceMixState()
    for (let index = 0; index < MAX_SIMULTANEOUS_VOICES; index += 1) {
      planNoteTrigger(state, {
        time: 0,
        velocity: 0.45,
        duration: 2,
        note: `N${index}`,
      })
    }
    const plan = planNoteTrigger(state, {
      time: 0.01,
      velocity: 0.85,
      duration: 0.4,
      note: 'NEW',
    })
    expect(plan.release.length).toBeGreaterThan(0)
    expect(state.voicesStolen).toBeGreaterThan(0)
    expect(state.active.length).toBeLessThanOrEqual(MAX_SIMULTANEOUS_VOICES)
  })

  it('alignChordScoreTime snaps nearby onsets to the same grid', () => {
    expect(alignChordScoreTime(1.0001)).toBe(alignChordScoreTime(1.0009))
    expect(alignChordScoreTime(1.0)).toBe(1.0)
  })
})

function makeEngine(noteEvents, tracks = []) {
  const calls = []
  const engine = new ScorePlaybackEngine()
  engine.voice = {
    triggerAttackRelease: (...args) => calls.push(args),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    getVoiceDiagnostics: () => ({ maxSimultaneous: 0 }),
    output: { connect: vi.fn() },
  }
  engine.createPianoInstrument = vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    output: { connect: vi.fn() },
  }))
  engine.output = { gain: { value: 1 } }
  engine.metronome = {
    volume: { value: 0 },
    triggerAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
  }
  engine.playbackRate = 1
  engine.playStartedAt = 100
  engine.offsetScoreSeconds = 0
  engine.noteEvents = noteEvents
  engine.tracks = tracks
  return { engine, calls }
}

const denseChord = Array.from({ length: 8 }, (_, i) => ({
  type: 'note',
  scoreTimeSeconds: 0.2,
  name: `N${i}`,
  baseDurationSeconds: 0.6,
  velocity: 0.9,
  trackId: 0,
}))

describe('score engine dense scheduling', () => {
  it('schedules every simultaneous note in a dense chord', () => {
    const { engine, calls } = makeEngine(denseChord)
    engine.scheduleWindow(0, 1)
    expect(calls).toHaveLength(8)
    const times = calls.map((c) => c[2])
    expect(new Set(times).size).toBe(1)
  })

  it('does not duplicate triggers across overlapping schedule windows', () => {
    const { engine, calls } = makeEngine(denseChord)
    engine.scheduleWindow(0, 1)
    engine.scheduleWindow(0, 1)
    expect(calls).toHaveLength(8)
  })

  it('releaseAll on pause/stop clears sounding notes', () => {
    const { engine } = makeEngine(denseChord)
    const metronomeDispose = engine.metronome.dispose
    const voiceReleaseAll = engine.voice.releaseAll
    engine.playing = true
    engine.pause()
    expect(metronomeDispose).toHaveBeenCalled()
    expect(voiceReleaseAll).toHaveBeenCalled()
  })

  it('aligns chord score times before computing wall clock', () => {
    const events = [
      { type: 'note', scoreTimeSeconds: 0.10004, name: 'C4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
      { type: 'note', scoreTimeSeconds: 0.10007, name: 'E4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
    ]
    const { engine, calls } = makeEngine(events)
    engine.scheduleWindow(0, 1)
    expect(calls[0][2]).toBe(calls[1][2])
  })
})

describe('midi engine dense scheduling', () => {
  it('pause releases voices and rebuilds track instruments to cancel queued notes', () => {
    const disposed = []
    const instrument = {
      triggerAttackRelease: vi.fn(),
      releaseAll: vi.fn(),
      dispose: () => disposed.push(1),
    }
    const engine = new MidiPlaybackEngine()
    engine.trackStates = [{
      id: 0,
      notes: [],
      instrument,
      output: { gain: { value: 1 } },
      muted: false,
    }]
    engine.createPianoInstrument = vi.fn(() => ({
      triggerAttackRelease: vi.fn(),
      releaseAll: vi.fn(),
      dispose: vi.fn(),
      output: { connect: vi.fn() },
      status: 'synth',
    }))
    engine.playing = true
    engine.pause()
    expect(disposed).toHaveLength(1)
    expect(instrument.releaseAll).toHaveBeenCalled()
  })
})
