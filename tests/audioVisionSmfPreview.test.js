import { describe, it, expect } from 'vitest'
import { writeSmf } from '../scripts/lib/writeSmf.mjs'
import { parseMidiFile } from '../src/features/playback/parseMidiFile.js'

describe('SMF preview writer round-trips through the app parser', () => {
  it('produces a valid format-0 file the playback engine can read', async () => {
    const events = [
      { timeSeconds: 0, midi: 60, durationSeconds: 0.5 },
      { timeSeconds: 0.5, midi: 64, durationSeconds: 0.5 },
      { timeSeconds: 1.0, midi: 67, durationSeconds: 1.0 },
    ]
    const buffer = writeSmf(events, { tempoBpm: 120 })
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('MThd')
    expect(buffer.subarray(14, 18).toString('latin1')).toBe('MTrk')
    const parsed = await parseMidiFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    expect(parsed.duration).toBeCloseTo(2, 1)
    // The app's parser hands back the Tone.js Midi instance plus summary tracks.
    const notes = parsed.midi.tracks[0]?.notes ?? []
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67])
    expect(notes.map((n) => n.time)).toEqual([0, 0.5, 1])
    expect(notes.map((n) => n.duration)).toEqual([0.5, 0.5, 1])
  })

  it('encodes the tempo as microseconds per quarter note', async () => {
    const { expected } = { expected: Math.round(60000000 / 90) }
    const buffer = writeSmf([{ timeSeconds: 0, midi: 72, durationSeconds: 0.25 }], { tempoBpm: 90 })
    // Header(14) + MTrk+length(8) + delta(1) + ff 51 03 => tempo bytes at 26..28.
    expect(buffer[26]).toBe((expected >> 16) & 0xff)
    expect(buffer[27]).toBe((expected >> 8) & 0xff)
    expect(buffer[28]).toBe(expected & 0xff)
    const parsed = await parseMidiFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    expect(Math.round(parsed.midi.header.tempos[0].bpm)).toBe(90)
  })
})
