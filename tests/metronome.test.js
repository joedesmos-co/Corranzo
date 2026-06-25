import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import {
  METRONOME_COUNT_IN,
  METRONOME_SUBDIVISION,
} from '../src/features/playback/metronomeConstants.js'
import {
  buildCountInSchedule,
  buildMetronomeSchedule,
  expandSubdivisionClicks,
  getCountInDurationSeconds,
} from '../src/features/playback/metronomeSchedule.js'
import { metronomeLevelToDb } from '../src/features/playback/metronomeVoice.js'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'
import * as F from './helpers/buildXml.js'

const straight = () => parseMusicXml(F.straight4())

describe('metronome schedule', () => {
  it('accents downbeat 1 on quarter-note clicks', () => {
    const clicks = buildMetronomeSchedule(straight())
    expect(clicks.filter((event) => event.accent)).toHaveLength(4)
    expect(clicks[0].accent).toBe(true)
    expect(clicks[1].accent).toBe(false)
  })

  it('schedules eighth-note subdivisions between quarter beats', () => {
    const beats = getTimeline(straight()).performedBeats.slice(0, 2)
    const clicks = expandSubdivisionClicks(beats, METRONOME_SUBDIVISION.EIGHTH)
    expect(clicks).toHaveLength(4)
    expect(clicks[1].isSubdivision).toBe(true)
    expect(clicks[1].scoreTimeSeconds).toBeCloseTo(0.25, 6)
  })

  it('schedules triplet subdivisions', () => {
    const beats = getTimeline(straight()).performedBeats.slice(0, 1)
    const clicks = expandSubdivisionClicks(beats, METRONOME_SUBDIVISION.TRIPLET)
    expect(clicks).toHaveLength(3)
    expect(clicks[2].isSubdivision).toBe(true)
  })

  it('schedules sixteenth subdivisions', () => {
    const beats = getTimeline(straight()).performedBeats.slice(0, 1)
    const clicks = expandSubdivisionClicks(beats, METRONOME_SUBDIVISION.SIXTEENTH)
    expect(clicks).toHaveLength(4)
  })

  it('builds a one-measure count-in ending at the playhead', () => {
    const timingMap = straight()
    const duration = getCountInDurationSeconds(timingMap, 0, METRONOME_COUNT_IN.ONE_MEASURE)
    expect(duration).toBeCloseTo(2, 6)
    const countIn = buildCountInSchedule(
      timingMap,
      0,
      METRONOME_COUNT_IN.ONE_MEASURE,
      { subdivision: METRONOME_SUBDIVISION.QUARTER },
    )
    expect(countIn.length).toBeGreaterThan(0)
    expect(countIn[0].scoreTimeSeconds).toBeLessThan(0)
    expect(countIn.at(-1).scoreTimeSeconds).toBeLessThan(0)
    expect(countIn.every((event) => event.isCountIn)).toBe(true)
  })
})

describe('metronome voice level', () => {
  it('maps UI level to dB without affecting piano output', () => {
    expect(metronomeLevelToDb(0)).toBeLessThan(metronomeLevelToDb(1))
    expect(metronomeLevelToDb(0.6)).toBeGreaterThan(-30)
  })
})

vi.mock('tone', () => ({
  now: vi.fn(() => globalThis.__TEST_TONE_NOW__ ?? 100),
  getContext: vi.fn(() => ({ state: 'running' })),
  start: vi.fn(() => Promise.resolve()),
  gainToDb: vi.fn((value) => value),
  Gain: vi.fn(function Gain() {
    this.gain = { value: 1 }
    this.connect = vi.fn(() => this)
    this.toDestination = vi.fn(() => this)
    this.dispose = vi.fn()
  }),
  Volume: vi.fn(function Volume() {
    this.volume = { value: 0 }
    this.connect = vi.fn(() => this)
    this.toDestination = vi.fn(() => this)
    this.dispose = vi.fn()
  }),
  Filter: vi.fn(function Filter() {
    this.connect = vi.fn(() => this)
    this.dispose = vi.fn()
  }),
  MetalSynth: vi.fn(function MetalSynth() {
    this.connect = vi.fn(() => this)
    this.triggerAttackRelease = vi.fn()
    this.triggerRelease = vi.fn()
    this.dispose = vi.fn()
  }),
}))

function makeEngineWithMocks() {
  const pianoVoice = {
    output: { connect: vi.fn() },
    triggerAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    whenReady: () => Promise.resolve('synth'),
  }
  const engine = new ScorePlaybackEngine({ loadPianoInstrument: () => Promise.resolve({
    createPianoInstrument: () => pianoVoice,
    preloadPianoSampleBuffers: vi.fn(),
  }) })
  engine.timingMap = straight()
  engine.duration = 8
  engine.noteEvents = [
    { type: 'note', scoreTimeSeconds: 0.1, name: 'C4', baseDurationSeconds: 0.5, trackId: 0 },
  ]
  engine.rebuildMetronomeEvents()
  engine.voice = pianoVoice
  engine.output = { gain: { value: 1 } }
  engine.metronome = {
    volume: { volume: { value: 0 } },
    triggerClick: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    toDestination: vi.fn(),
  }
  engine.createPianoInstrument = vi.fn(() => pianoVoice)
  return engine
}

describe('ScorePlaybackEngine metronome transport', () => {
  beforeEach(() => {
    globalThis.__TEST_TONE_NOW__ = 100
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn((fn) => {
        fn()
        return 1
      }),
      clearTimeout: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies metronome volume independently from piano output gain', () => {
    const engine = makeEngineWithMocks()
    engine.output.gain.value = 1
    engine.setMetronomeLevel(0.2)
    expect(engine.metronome.volume.volume.value).toBe(metronomeLevelToDb(0.2))
    expect(engine.output.gain.value).toBe(1)
  })

  it('seek clears scheduled metronome clicks', () => {
    const engine = makeEngineWithMocks()
    const metronomeDispose = engine.metronome.dispose
    engine.metronomeEnabled = true
    engine.playing = false
    engine.seek(2)
    expect(metronomeDispose).toHaveBeenCalled()
    expect(metronomeDispose.mock?.calls?.length ?? 0).toBeGreaterThan(0)
  })

  it('count-in delays score scheduling until after the count-in window', async () => {
    const engine = makeEngineWithMocks()
    engine.metronomeCountIn = METRONOME_COUNT_IN.ONE_MEASURE
    const scheduleSpy = vi.spyOn(engine, 'scheduleWindow')
    const countInSpy = vi.spyOn(engine, 'scheduleCountInClicks')

    await engine.playFromUserGesture()

    expect(countInSpy).toHaveBeenCalled()
    expect(scheduleSpy).toHaveBeenCalled()
    expect(engine.countInActive).toBe(false)
  })

  it('reschedule does not double-schedule the same metronome event', () => {
    const engine = makeEngineWithMocks()
    engine.metronomeEnabled = true
    engine.playing = true
    engine.playStartedAt = 100
    engine.offsetScoreSeconds = 0
    engine.scheduleWindow(0, 2)
    const firstCalls = engine.metronome.triggerClick.mock.calls.length
    engine.scheduleWindow(0, 2)
    expect(engine.metronome.triggerClick.mock.calls.length).toBe(firstCalls)
  })
})
