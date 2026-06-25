import { describe, expect, it, beforeEach } from 'vitest'
import { parseMidiMessage } from '../src/features/midi-input/parseMidiMessage.js'
import {
  pickActiveDevice,
  deviceStatusLabel,
  createMidiActivity,
  applyParsedMessage,
  activeNoteList,
  updateLatencyEstimate,
  loadLastMidiDeviceName,
  saveLastMidiDeviceName,
} from '../src/features/midi-input/webMidiEngine.js'
import {
  evaluateNoteInput,
  createChordMatchState,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings, WFY_MATCH_DEFAULTS } from '../src/features/practice/waitForYouMatchSettings.js'
import { buildCursorMotionTimeline, resolveCursorMotion } from '../src/features/score-follow/cursorMotionTimeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'

// Minimal localStorage shim for the node test env (exercises the persistence path).
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

const noteOn = (midi, vel = 80, ch = 0) => new Uint8Array([0x90 | ch, midi, vel])
const noteOff = (midi, ch = 0) => new Uint8Array([0x80 | ch, midi, 0])
const cc = (controller, value, ch = 0) => new Uint8Array([0xb0 | ch, controller, value])

describe('parseMidiMessage', () => {
  it('parses note-on with velocity', () => {
    expect(parseMidiMessage(noteOn(64, 99))).toEqual({ type: 'noteon', midi: 64, velocity: 99, channel: 0 })
  })

  it('treats note-on velocity 0 as note-off (fast repeats / releases)', () => {
    expect(parseMidiMessage(noteOn(64, 0)).type).toBe('noteoff')
  })

  it('parses note-off', () => {
    expect(parseMidiMessage(noteOff(64)).type).toBe('noteoff')
  })

  it('parses CC64 sustain pedal (>=64 = down)', () => {
    expect(parseMidiMessage(cc(64, 127))).toMatchObject({ type: 'sustain', on: true })
    expect(parseMidiMessage(cc(64, 64))).toMatchObject({ type: 'sustain', on: true })
    expect(parseMidiMessage(cc(64, 0))).toMatchObject({ type: 'sustain', on: false })
  })

  it('sustain is NOT a note (Wait For You will never see it as input)', () => {
    expect(parseMidiMessage(cc(64, 127)).type).not.toBe('noteon')
  })

  it('keeps the channel and ignores empty data', () => {
    expect(parseMidiMessage(noteOn(60, 80, 3)).channel).toBe(3)
    expect(parseMidiMessage(new Uint8Array([]))).toBeNull()
  })
})

describe('webMidiEngine — device selection / reconnect', () => {
  const A = { id: 'a1', name: 'Roland FP-30X' }
  const B = { id: 'b1', name: 'Casio CDP' }

  it('picks the first device when nothing is selected (single keyboard just works)', () => {
    expect(pickActiveDevice([A], null, null)).toBe(A)
    expect(pickActiveDevice([], null, null)).toBeNull()
  })

  it('honors an explicit current selection', () => {
    expect(pickActiveDevice([A, B], 'b1', null)).toBe(B)
  })

  it('auto-reconnects to the remembered device by name after a re-plug (new id)', () => {
    const reconnected = { id: 'a1-NEW', name: 'Roland FP-30X' }
    // selection id is stale, but the remembered name still matches.
    expect(pickActiveDevice([reconnected, B], 'a1', 'Roland FP-30X')).toBe(reconnected)
  })

  it('simulated hot-plug / unplug / re-plug sequence', () => {
    let remembered = null
    const choose = (devices, selected) => {
      const active = pickActiveDevice(devices, selected, remembered)
      if (active) remembered = active.name
      return active
    }
    expect(choose([], null)).toBeNull() // nothing connected
    expect(choose([A], null)).toBe(A) // plug in A
    expect(remembered).toBe('Roland FP-30X')
    expect(choose([], null)).toBeNull() // unplug
    const replug = { id: 'a-2', name: 'Roland FP-30X' }
    expect(choose([replug, B], null)).toBe(replug) // re-plug → reconnect by name
  })
})

describe('webMidiEngine — activity model (notes / sustain / velocity)', () => {
  let act
  beforeEach(() => {
    act = createMidiActivity()
  })

  it('tracks a note on/off and preserves velocity', () => {
    applyParsedMessage(act, parseMidiMessage(noteOn(60, 105)))
    expect(act.active.get(60)).toBe(105) // velocity not flattened
    expect(act.noteCount).toBe(1)
    expect(act.lastNote).toMatchObject({ midi: 60, velocity: 105 })
    applyParsedMessage(act, parseMidiMessage(noteOff(60)))
    expect(act.active.has(60)).toBe(false)
  })

  it('a held note is a single note (no duplicate counting)', () => {
    applyParsedMessage(act, parseMidiMessage(noteOn(60)))
    expect(act.noteCount).toBe(1)
    expect(activeNoteList(act)).toEqual([60])
  })

  it('fast repeated notes are each counted (not skipped)', () => {
    applyParsedMessage(act, parseMidiMessage(noteOn(60)))
    applyParsedMessage(act, parseMidiMessage(noteOff(60)))
    applyParsedMessage(act, parseMidiMessage(noteOn(60)))
    applyParsedMessage(act, parseMidiMessage(noteOff(60)))
    applyParsedMessage(act, parseMidiMessage(noteOn(60)))
    expect(act.noteCount).toBe(3)
    expect(activeNoteList(act)).toEqual([60])
  })

  it('tracks chords as multiple active notes, sorted', () => {
    ;[67, 60, 64].forEach((m) => applyParsedMessage(act, parseMidiMessage(noteOn(m))))
    expect(activeNoteList(act)).toEqual([60, 64, 67])
  })

  it('sustain pedal toggles state without adding notes', () => {
    applyParsedMessage(act, parseMidiMessage(cc(64, 127)))
    expect(act.sustain).toBe(true)
    expect(act.noteCount).toBe(0)
    applyParsedMessage(act, parseMidiMessage(cc(64, 0)))
    expect(act.sustain).toBe(false)
  })
})

describe('webMidiEngine — status + latency', () => {
  it('status label is human-readable', () => {
    expect(deviceStatusLabel({ supported: false })).toContain('not supported')
    expect(deviceStatusLabel({ supported: true, granted: false })).toBe('MIDI off')
    expect(deviceStatusLabel({ supported: true, granted: true, activeDevice: null })).toBe('No MIDI device connected.')
    expect(deviceStatusLabel({ supported: true, granted: true, activeDevice: { name: 'Roland FP-30X' } })).toBe('Connected: Roland FP-30X')
  })

  it('latency estimate rolls and rejects garbage samples', () => {
    expect(updateLatencyEstimate(null, 100, 105)).toBe(5)
    const rolled = updateLatencyEstimate(5, 100, 110)
    expect(rolled).toBeGreaterThan(5)
    expect(rolled).toBeLessThan(10)
    expect(updateLatencyEstimate(5, 0, 100)).toBe(5) // zero timestamp ignored
    expect(updateLatencyEstimate(5, 200, 100)).toBe(5) // negative delta ignored
  })

  it('persists and reloads the last device name', () => {
    saveLastMidiDeviceName('Roland FP-30X')
    expect(loadLastMidiDeviceName()).toBe('Roland FP-30X')
  })
})

describe('MIDI → Wait For You integration (unchanged matching)', () => {
  const settings = normalizeMatchSettings(WFY_MATCH_DEFAULTS)
  it('a parsed note-on still matches the expected checkpoint', () => {
    const parsed = parseMidiMessage(noteOn(64, 90))
    const r = evaluateNoteInput({ expectedMidis: [64], expectedMidi: 64, isChord: false }, parsed.midi, createChordMatchState(), settings)
    expect(r.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

describe('Score follow engine untouched', () => {
  it('motion timeline still builds and resolves', () => {
    const tm = parseMusicXml(F.straight4())
    const anchors = [
      { id: 'm1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual', meta: { playableStartX: 0.1, playableEndX: 0.3, systemEndX: 0.95 } },
      { id: 'm2', page: 1, x: 0.3, y: 0.3, measureNumber: 2, source: 'manual', meta: { playableStartX: 0.3, playableEndX: 0.5, systemEndX: 0.95 } },
    ]
    const cursor = resolveCursorMotion(buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors }), 0.5)
    expect(cursor?.visible).toBe(true)
  })
})
