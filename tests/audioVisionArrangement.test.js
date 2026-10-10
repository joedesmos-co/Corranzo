import { describe, it, expect } from 'vitest'
import {
  quantizeToBeats,
  selectTexture,
  resolveSimultaneous,
  createArrangementModel,
  measureComplexity,
  PART_INSTRUMENTS,
  DIFFICULTIES,
} from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar, GUITAR_MIN, GUITAR_MAX } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

function fakeQuantized(count = 16) {
  const notes = []
  for (let i = 0; i < count; i += 1) {
    // Melody ascending C major + chord tones stacked every 4th onset (polyphonic conflict).
    notes.push({ midi: 60 + (i % 8), startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.8 })
    if (i % 4 === 0) {
      notes.push({ midi: 48, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.6 })
      notes.push({ midi: 55, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.5 })
      notes.push({ midi: 64, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.4 })
    }
  }
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5)
  return quantizeToBeats(notes, beats)
}

const CHORDS = Array.from({ length: 8 }, () => ({ root: 0, quality: 'major', confidence: 0.7 }))

describe('A4 arrangement model', () => {
  it('quantizes to the grid with residuals', () => {
    const q = quantizeToBeats([{ midi: 60, startSeconds: 0.51, endSeconds: 0.9 }], [0, 0.5, 1.0])
    expect(q[0].quantizedStartBeat).toBe(1)
    expect(q[0].provenance).toBeTruthy()
  })
  it('resolves conflicts by keeping melody, not random notes', () => {
    const events = [
      { midi: 76, isMelody: true, strength: 0.9 },
      { midi: 60, strength: 0.9 },
      { midi: 64, strength: 0.9 },
    ]
    const out = resolveSimultaneous(events, { maxVoices: 2, melodyMidi: 76 })
    expect(out.filter((e) => e.kept).map((e) => e.midi)).toContain(76)
    expect(out.filter((e) => e.kept)).toHaveLength(2)
  })
  it('rejects non-V1 parts (future-proof gate)', () => {
    expect(() => createArrangementModel({ targetPart: 'drums', difficulty: 'easy' })).toThrow()
  })
})

describe('A5/A6/A7 solo arrangement + difficulty', () => {
  const quantized = fakeQuantized()

  it('piano distributes two hands with melody in RH', () => {
    const { events, warnings } = arrangeSoloPiano({ quantizedNotes: quantized, chords: CHORDS, difficulty: DIFFICULTIES.INTERMEDIATE })
    expect(events.length).toBeGreaterThan(0)
    const rh = events.filter((e) => e.hand === 'RH')
    const lh = events.filter((e) => e.hand === 'LH')
    expect(rh.length).toBeGreaterThan(0)
    expect(lh.length).toBeGreaterThan(0)
    expect(events.filter((e) => e.role === 'melody').every((e) => e.hand === 'RH')).toBe(true)
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('guitar assigns playable string/fret in range with TAB roles', () => {
    const { events, warnings } = arrangeSoloGuitar({ quantizedNotes: quantized, chords: CHORDS, difficulty: DIFFICULTIES.INTERMEDIATE })
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.midi).toBeGreaterThanOrEqual(GUITAR_MIN)
      expect(e.midi).toBeLessThanOrEqual(GUITAR_MAX)
      expect(e.string).toBeGreaterThanOrEqual(1)
      expect(e.string).toBeLessThanOrEqual(6)
      expect(e.fret).toBeGreaterThanOrEqual(0)
      expect(e.fret).toBeLessThanOrEqual(19)
    }
    // No impossible 6-note grips.
    const byOnset = new Map()
    for (const e of events) {
      const k = Math.round(e.startBeat * 4)
      byOnset.set(k, (byOnset.get(k) ?? 0) + 1)
    }
    expect(Math.max(...byOnset.values())).toBeLessThanOrEqual(4)
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('difficulty levels differ measurably (easy < intermediate < advanced)', () => {
    const levels = [DIFFICULTIES.EASY, DIFFICULTIES.INTERMEDIATE, DIFFICULTIES.ADVANCED]
    const complexities = levels.map((difficulty) => {
      const { events } = arrangeSoloPiano({ quantizedNotes: quantized, chords: CHORDS, difficulty })
      const simplified = simplifyForDifficulty(
        events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
        difficulty,
      )
      return measureComplexity(simplified.map((e) => ({ ...e, startBeat: e.quantizedStartBeat })))
    })
    const density = complexities.map((c) => c.notesPerBeat)
    expect(density[0]).toBeLessThanOrEqual(density[1])
    expect(density[1]).toBeLessThanOrEqual(density[2])
    expect(density[0]).toBeLessThan(density[2])
  })

  it('texture selection prefers melody-only when harmony is uncertain', () => {
    expect(selectTexture({ noteDensity: 5, chordConfidence: 0.1, difficulty: 'intermediate' })).toBe('melody-only')
    expect(selectTexture({ noteDensity: 5, chordConfidence: 0.8, difficulty: 'intermediate' })).not.toBe('melody-only')
  })
})

describe('A8 arrangement MusicXML validity + semantics', () => {
  it('piano output parses with two staves and real notes', () => {
    const { events } = arrangeSoloPiano({ quantizedNotes: fakeQuantized(8), chords: CHORDS, difficulty: DIFFICULTIES.EASY })
    const xml = buildArrangementMusicXml({ events, targetPart: PART_INSTRUMENTS.SOLO_PIANO, bpm: 120, title: 'Test Piano' })
    expect(xml).toContain('<staves>2</staves>')
    expect(xml).toContain('<per-minute>120</per-minute>')
    const parsed = parseMusicXml(xml)
    expect(parsed?.notes?.length ?? 0).toBeGreaterThan(0)
  })
  it('guitar output parses with string/fret TAB and playable range', () => {
    const { events } = arrangeSoloGuitar({ quantizedNotes: fakeQuantized(8), chords: CHORDS, difficulty: DIFFICULTIES.EASY })
    const xml = buildArrangementMusicXml({ events, targetPart: PART_INSTRUMENTS.SOLO_GUITAR, bpm: 100, title: 'Test Guitar' })
    expect(xml).toContain('<technical>')
    expect(xml).toContain('<string>')
    expect(xml).toContain('<fret>')
    const parsed = parseMusicXml(xml)
    expect(parsed?.notes?.length ?? 0).toBeGreaterThan(0)
  })
})
