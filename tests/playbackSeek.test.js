/**
 * Playback seek / transport flush — cancel queued Tone events on timeline jump.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'
import { MidiPlaybackEngine } from '../src/features/playback/midiPlaybackEngine.js'

vi.mock('tone', () => ({
  now: vi.fn(() => globalThis.__TEST_TONE_NOW__ ?? 100),
  getContext: vi.fn(() => ({ state: 'running' })),
  start: vi.fn(() => Promise.resolve()),
  gainToDb: vi.fn((value) => value),
  Gain: vi.fn(function Gain() {
    this.gain = { value: 1 }
    this.toDestination = () => this
    this.connect = () => this
    this.dispose = vi.fn()
  }),
  Volume: vi.fn(function Volume() {
    this.volume = { value: 0 }
    this.toDestination = () => this
    this.connect = () => this
    this.dispose = vi.fn()
  }),
  Filter: vi.fn(function Filter() {
    this.connect = () => this
    this.dispose = vi.fn()
  }),
  MetalSynth: vi.fn(function MetalSynth() {
    this.connect = () => this
    this.triggerAttackRelease = vi.fn()
    this.triggerRelease = vi.fn()
    this.dispose = vi.fn()
  }),
}))

function makeScoreEngine() {
  const voiceDispose = vi.fn()
  const metronomeDispose = vi.fn()
  const engine = new ScorePlaybackEngine()
  engine.duration = 120
  engine.noteEvents = [
    { type: 'note', scoreTimeSeconds: 1, name: 'C4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
    { type: 'note', scoreTimeSeconds: 5, name: 'E4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
  ]
  engine.metronomeEvents = [
    { type: 'metronome', scoreTimeSeconds: 0.5, accent: true },
    { type: 'metronome', scoreTimeSeconds: 2, accent: false },
  ]
  engine.output = { gain: { value: 1 } }
  engine.voice = {
    triggerAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: voiceDispose,
    output: { connect: vi.fn() },
  }
  engine.metronome = {
    volume: { volume: { value: 0 } },
    triggerClick: vi.fn(),
    triggerAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: metronomeDispose,
    toDestination: vi.fn(),
  }
  engine.createPianoInstrument = vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    output: { connect: vi.fn() },
    whenReady: () => Promise.resolve('synth'),
  }))
  return { engine, voiceDispose, metronomeDispose }
}

describe('ScorePlaybackEngine seek flush', () => {
  beforeEach(() => {
    globalThis.__TEST_TONE_NOW__ = 100
    vi.stubGlobal('window', {
      setInterval: vi.fn((fn) => {
        fn()
        return 1
      }),
      clearInterval: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('seek while paused flushes metronome and piano without rescheduling', () => {
    const { engine, metronomeDispose } = makeScoreEngine()
    const scheduleSpy = vi.spyOn(engine, 'scheduleWindow')
    engine.playing = false
    engine.offsetScoreSeconds = 0

    engine.seek(40)

    expect(engine.playing).toBe(false)
    expect(engine.offsetScoreSeconds).toBe(40)
    expect(metronomeDispose).toHaveBeenCalled()
    expect(scheduleSpy).not.toHaveBeenCalled()
  })

  it('seek while playing flushes and reschedules from the new score time', () => {
    const { engine } = makeScoreEngine()
    const scheduleSpy = vi.spyOn(engine, 'scheduleWindow')
    engine.playing = true
    engine.playStartedAt = 100
    engine.offsetScoreSeconds = 10

    engine.seek(25)

    expect(engine.playing).toBe(true)
    expect(engine.offsetScoreSeconds).toBe(25)
    expect(scheduleSpy).toHaveBeenCalledWith(25, 27.5)
  })

  it('rapid seeks bump schedule generation so stale interval callbacks noop', () => {
    const { engine } = makeScoreEngine()
    engine.playing = true
    const firstGen = engine.scheduleGeneration

    engine.seek(10)
    engine.seek(20)
    engine.seek(30)

    expect(engine.scheduleGeneration).toBeGreaterThan(firstGen + 2)
    expect(engine.offsetScoreSeconds).toBe(30)
  })

  it('metronome is recreated on seek so old clicks cannot fire', () => {
    const { engine, metronomeDispose } = makeScoreEngine()
    const oldTrigger = engine.metronome.triggerClick
    engine.metronomeEnabled = true
    engine.playing = false

    engine.seek(50)

    expect(metronomeDispose).toHaveBeenCalled()
    expect(oldTrigger).not.toHaveBeenCalled()
  })

  it('pause does not leave playback marked as playing', () => {
    const { engine } = makeScoreEngine()
    engine.playing = true
    engine.playStartedAt = 100
    engine.offsetScoreSeconds = 12

    engine.pause()

    expect(engine.playing).toBe(false)
    expect(engine.offsetScoreSeconds).toBe(12)
  })
})

describe('MidiPlaybackEngine seek flush', () => {
  it('seek rebuilds instruments to drop queued future notes', () => {
    const disposed = []
    const instrument = {
      triggerAttackRelease: vi.fn(),
      releaseAll: vi.fn(),
      dispose: () => disposed.push(1),
      output: { connect: vi.fn() },
      status: 'synth',
    }
    const engine = new MidiPlaybackEngine()
    engine.midi = { tracks: [], duration: 60 }
    engine.playbackDuration = 60
    engine.createPianoInstrument = vi.fn(() => ({
      triggerAttackRelease: vi.fn(),
      releaseAll: vi.fn(),
      dispose: vi.fn(),
      output: { connect: vi.fn() },
      status: 'synth',
    }))
    engine.trackStates = [{
      id: 0,
      notes: [{ time: 0, name: 'C4', duration: 1, velocity: 0.8 }],
      instrument,
      output: { gain: { value: 1 }, toDestination: vi.fn() },
      muted: false,
    }]

    engine.playing = false
    engine.seek(15)

    expect(disposed).toHaveLength(1)
    expect(engine.playing).toBe(false)
    expect(engine.offsetSeconds).toBe(15)
  })

  it('seek while paused does not start playback', () => {
    const engine = new MidiPlaybackEngine()
    engine.midi = { tracks: [], duration: 10 }
    engine.playbackDuration = 10
    engine.trackStates = []
    engine.playing = false

    engine.seek(3)

    expect(engine.playing).toBe(false)
  })
})
