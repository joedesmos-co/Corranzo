/**
 * Sampled-piano playback realism: sustain pedal (CC64), and the combined
 * schedule builder carrying per-track ids + chord/bass notes + pedal-extended
 * durations. The chord-drop de-dupe fix is covered in playbackEngine.test.js;
 * instrument readiness/fallback is covered in playbackInstrument.test.js.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  collectSustainEvents,
  extractSustainSpans,
  sustainedDuration,
  applySustainToNotes,
} from '../src/features/playback/sustainPedal.js'

// ─── sustain pedal (pure) ──────────────────────────────────────────────────────

describe('sustain pedal CC64 extraction', () => {
  it('pairs down→up into spans (value ≥ 0.5 is down)', () => {
    const spans = extractSustainSpans([
      { time: 1, value: 1 },
      { time: 3, value: 0 },
      { time: 5, value: 0.8 },
      { time: 6.5, value: 0 },
    ])
    expect(spans).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6.5 },
    ])
  })

  it('ignores re-presses while already down and out-of-order events', () => {
    const spans = extractSustainSpans([
      { time: 3, value: 0 }, // up with no prior down → ignored
      { time: 1, value: 1 },
      { time: 1.5, value: 1 }, // already down → no new span
      { time: 2, value: 0 },
    ])
    expect(spans).toEqual([{ start: 1, end: 2 }])
  })

  it('reports a dangling pedal-down as an infinite span, which is not over-held', () => {
    // Default fallback is Infinity; an infinite span is recorded but
    // sustainedDuration ignores it (no over-hold). A finite fallback closes it.
    expect(extractSustainSpans([{ time: 1, value: 1 }])).toEqual([{ start: 1, end: Infinity }])
    expect(extractSustainSpans([{ time: 1, value: 1 }], { endFallback: 10 })).toEqual([
      { start: 1, end: 10 },
    ])
  })

  it('returns [] for empty/missing input', () => {
    expect(extractSustainSpans([])).toEqual([])
    expect(extractSustainSpans(null)).toEqual([])
  })
})

describe('sustainedDuration', () => {
  const spans = [{ start: 0, end: 3 }]

  it('holds a note to pedal release when the pedal is down at its natural end', () => {
    // Note 0→1, pedal down 0→3 → rings until 3.
    expect(sustainedDuration(0, 1, spans)).toBe(3)
  })

  it('does not shorten a note that already outlasts the pedal', () => {
    expect(sustainedDuration(0, 4, spans)).toBe(4)
  })

  it('leaves notes untouched when no pedal covers them', () => {
    expect(sustainedDuration(5, 1, spans)).toBe(1)
    expect(sustainedDuration(0, 1, [])).toBe(1)
  })

  it('never over-holds on an infinite (dangling) span', () => {
    expect(sustainedDuration(0, 1, [{ start: 0, end: Infinity }])).toBe(1)
  })

  it('applySustainToNotes extends durations, preserving other fields', () => {
    const notes = [{ time: 0, duration: 1, name: 'C4' }]
    const [out] = applySustainToNotes(notes, spans)
    expect(out).toMatchObject({ time: 0, name: 'C4' })
    expect(out.duration).toBe(3)
  })
})

describe('collectSustainEvents', () => {
  it('gathers CC64 across tracks (numeric key or `sustain` alias)', () => {
    const midi = {
      tracks: [
        { controlChanges: { 64: [{ time: 0, value: 1 }] } },
        { controlChanges: { sustain: [{ time: 2, value: 0 }] } },
        { controlChanges: {} },
      ],
    }
    const events = collectSustainEvents(midi)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.time).sort()).toEqual([0, 2])
  })
})

// ─── schedule builder: trackId + chords + bass + sustain ───────────────────────

vi.mock('../src/features/playback/parseMidiFile.js', () => ({
  parseMidiFile: vi.fn(),
}))

const { parseMidiFile } = await import('../src/features/playback/parseMidiFile.js')
const { buildCombinedPlaybackSchedule } = await import(
  '../src/features/playback/scorePlaybackSchedule.js'
)
const { parseMusicXml } = await import('../src/features/musicxml/parseMusicXml.js')
const F = await import('./helpers/buildXml.js')
const { ScorePlaybackEngine } = await import('../src/features/playback/scorePlaybackEngine.js')

/** A score engine with a capturing voice + fake metronome, ready to scheduleWindow. */
function makeEngine(noteEvents, tracks = []) {
  const calls = []
  const engine = new ScorePlaybackEngine()
  engine.voice = { triggerAttackRelease: (...args) => calls.push(args) }
  engine.metronome = { volume: { volume: { value: 0 } }, triggerClick: () => {} }
  engine.playbackRate = 1
  engine.playStartedAt = 0
  engine.noteEvents = noteEvents
  engine.tracks = tracks
  return { engine, calls }
}

const chord = [
  { type: 'note', scoreTimeSeconds: 0.1, name: 'C4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
  { type: 'note', scoreTimeSeconds: 0.1, name: 'E4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
  { type: 'note', scoreTimeSeconds: 0.1, name: 'G4', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 0 },
  { type: 'note', scoreTimeSeconds: 0.1, name: 'C2', baseDurationSeconds: 0.5, velocity: 0.8, trackId: 1 },
]

describe('score engine scheduling: chords, bass, per-hand muting, readiness', () => {
  it('triggers every simultaneous note — full chord AND the bass coincident with it', () => {
    const { engine, calls } = makeEngine(chord)
    engine.scheduleWindow(0, 1)
    expect(calls.map((c) => c[0]).sort()).toEqual(['C2', 'C4', 'E4', 'G4'])
  })

  it('mutes only the muted hand (track), leaving the other hand sounding', () => {
    const { engine, calls } = makeEngine(chord, [
      { id: 0, muted: false },
      { id: 1, muted: true }, // left hand / bass muted
    ])
    engine.scheduleWindow(0, 1)
    expect(calls.map((c) => c[0]).sort()).toEqual(['C4', 'E4', 'G4']) // bass C2 dropped
  })

  it('plays both hands when neither is muted', () => {
    const { engine, calls } = makeEngine(chord, [
      { id: 0, muted: false },
      { id: 1, muted: false },
    ])
    engine.scheduleWindow(0, 1)
    expect(calls.map((c) => c[0]).sort()).toEqual(['C2', 'C4', 'E4', 'G4'])
  })

  it('does not re-trigger the same note across overlapping windows', () => {
    const { engine, calls } = makeEngine(chord)
    engine.scheduleWindow(0, 1)
    engine.scheduleWindow(0, 1) // overlapping re-schedule
    expect(calls).toHaveLength(4) // still just the 4 chord/bass notes
  })

  it('whenInstrumentReady waits for the sampled piano (resolves via the voice)', async () => {
    const { engine } = makeEngine([])
    let readyResolved = false
    engine.voice.whenReady = () =>
      Promise.resolve('sampled').then((v) => {
        readyResolved = true
        return v
      })
    await engine.whenInstrumentReady(0) // 0 = no timeout cap → awaits the voice
    expect(readyResolved).toBe(true)
  })

  it('whenInstrumentReady resolves even with no instrument yet', async () => {
    const engine = new ScorePlaybackEngine()
    await expect(engine.whenInstrumentReady(0)).resolves.toBeNull()
  })
})

function fakeMidi({ withPedal }) {
  return {
    midi: {
      // 1 measure ≈ 960 ticks (fake) → ticks 0 = bar 0 start, 240 = quarter in.
      header: { ticksToMeasures: (ticks) => ticks / 960 },
      tracks: [
        {
          // Right hand: a C5+E5 chord on beat 1, then a later D5.
          notes: [
            { midi: 72, name: 'C5', time: 0, duration: 0.5, ticks: 0 },
            { midi: 76, name: 'E5', time: 0, duration: 0.5, ticks: 0 },
            { midi: 74, name: 'D5', time: 1, duration: 0.5, ticks: 240 },
          ],
          controlChanges: withPedal
            ? { 64: [{ number: 64, value: 1, time: 0 }, { number: 64, value: 0, time: 3 }] }
            : {},
        },
        {
          // Left hand: a bass C3 coinciding with the right-hand chord.
          notes: [{ midi: 48, name: 'C3', time: 0, duration: 1, ticks: 0 }],
          controlChanges: {},
        },
      ],
    },
    duration: 8,
    tracks: [
      { id: 0, name: 'Right hand', noteCount: 3, muted: false },
      { id: 1, name: 'Left hand', noteCount: 1, muted: false },
    ],
  }
}

describe('combined schedule: tracks, chords, bass, sustain', () => {
  const timingMap = parseMusicXml(F.straight4()) // 4 equal measures @120 (8s)

  it('keeps both chord notes AND the bass note, each tagged with its trackId', async () => {
    parseMidiFile.mockResolvedValue(fakeMidi({ withPedal: false }))
    const schedule = await buildCombinedPlaybackSchedule(timingMap, new ArrayBuffer(8), {})

    const atDownbeat = schedule.noteEvents.filter((e) => Math.abs(e.scoreTimeSeconds) < 1e-6)
    expect(atDownbeat.map((e) => e.name).sort()).toEqual(['C3', 'C5', 'E5'])
    // Right-hand chord notes on track 0, bass on track 1 — nothing dropped.
    expect(atDownbeat.filter((e) => e.trackId === 0).map((e) => e.name).sort()).toEqual([
      'C5',
      'E5',
    ])
    expect(atDownbeat.filter((e) => e.trackId === 1).map((e) => e.name)).toEqual(['C3'])
  })

  it('extends note release under the sustain pedal (and not without it)', async () => {
    parseMidiFile.mockResolvedValue(fakeMidi({ withPedal: true }))
    const pedalled = await buildCombinedPlaybackSchedule(timingMap, new ArrayBuffer(8), {})
    const c5Pedalled = pedalled.noteEvents.find((e) => e.name === 'C5')
    expect(c5Pedalled.baseDurationSeconds).toBeGreaterThan(2.5) // held to pedal-up (~3s)
    expect(pedalled.sustainSpanCount).toBe(1)

    parseMidiFile.mockResolvedValue(fakeMidi({ withPedal: false }))
    const dry = await buildCombinedPlaybackSchedule(timingMap, new ArrayBuffer(8), {})
    const c5Dry = dry.noteEvents.find((e) => e.name === 'C5')
    expect(c5Dry.baseDurationSeconds).toBeCloseTo(0.5, 2) // natural duration, no over-hold
    expect(dry.sustainSpanCount).toBe(0)
  })
})
