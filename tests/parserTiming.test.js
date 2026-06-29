import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'

function measure(t, n) {
  return t.measures.find((m) => m.number === n)
}

function partNotes(t, partId) {
  return t.notes.filter((n) => n.partId === partId && !n.isRest)
}

describe('MusicXML parsing — timing correctness', () => {
  it('parses a straight score', () => {
    const t = parseMusicXml(F.straight4())
    expect(t.measures).toHaveLength(4)
    expect(t.writtenDurationSeconds).toBeCloseTo(8, 6)
    expect(t.notes.filter((n) => !n.isRest)).toHaveLength(16)
    expect(t.notes[0].timeSeconds).toBe(0)
  })

  it('applies measure-start tempo changes', () => {
    const t = parseMusicXml(F.measureStartTempoChange())
    expect(measure(t, 2).startTimeSeconds).toBeCloseTo(2, 6)
    expect(measure(t, 3).startTimeSeconds).toBeCloseTo(6, 6)
  })

  it('keeps mid-measure tempo changes at their true position', () => {
    const t = parseMusicXml(F.midMeasureTempoChange())
    const change = t.tempoChanges.find((c) => c.bpm === 60)
    expect(change).toBeTruthy()
    expect(change.quarterTime).toBeCloseTo(6, 6)
    // m2: beats 1–2 at 120 (1s), beats 3–4 at 60 (2s) → m3 starts at 2 + 1 + 2 = 5s? No:
    // m1 = 4 quarters @120 = 2s. m2 = 1s + 2s = 3s. m3 starts at 5s.
    expect(measure(t, 3).startTimeSeconds).toBeCloseTo(5, 6)
    // notes of m2: E (beat 3) starts at 2 + 1 = 3s, F (beat 4) at 4s
    const m2notes = t.notes.filter((n) => n.measureNumber === 2 && !n.isRest)
    expect(m2notes.map((n) => n.timeSeconds)).toEqual([2, 2.5, 3, 4])
  })

  it('scales metronome beat-unit (half = 60 → 120 quarter BPM)', () => {
    const t = parseMusicXml(F.beatUnitMetronome())
    expect(t.tempoChanges.some((c) => Math.abs(c.bpm - 120) < 1e-9)).toBe(true)
    expect(measure(t, 2).startTimeSeconds).toBeCloseTo(2, 6)
  })

  it('scales dotted beat-units (dotted quarter = 40 → 60 quarter BPM)', () => {
    const t = parseMusicXml(F.dottedBeatUnitMetronome())
    expect(t.tempoChanges.some((c) => Math.abs(c.bpm - 60) < 1e-9)).toBe(true)
  })

  it('applies dynamics markings to subsequent notes in the measure', () => {
    const xml = F.scoreWrap(
      `<part id="P1">` +
        `<measure number="1">${F.attributes()}${F.soundTempo(120)}${F.dynamicsDirection('ff')}${F.note('C')}${F.note('D')}</measure>` +
        `</part>`,
    )
    const t = parseMusicXml(xml)
    const velocities = t.notes.filter((note) => !note.isRest).map((note) => note.velocity)
    expect(velocities).toEqual([0.91, 0.91])
  })

  it('parses each part with its own divisions', () => {
    const t = parseMusicXml(F.twoPartsDifferentDivisions())
    const p1 = partNotes(t, 'P1')
    const p2 = partNotes(t, 'P2')
    expect(p1.map((n) => n.timeSeconds)).toEqual([0, 0.5, 1, 1.5])
    expect(p2.map((n) => n.timeSeconds)).toEqual([0, 0.5, 1, 1.5])
    expect(p2.map((n) => n.durationSeconds)).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('processes backup and forward in document order', () => {
    const t = parseMusicXml(F.backupForwardVoices())
    const v1 = t.notes.filter((n) => n.voice === 1 && !n.isRest)
    const v2 = t.notes.filter((n) => n.voice === 2 && !n.isRest)
    const v3 = t.notes.filter((n) => n.voice === 3 && !n.isRest)
    expect(v1.map((n) => n.quarterTime)).toEqual([0, 1, 2, 3])
    expect(v2.map((n) => n.quarterTime)).toEqual([0, 2])
    expect(v3.map((n) => n.quarterTime)).toEqual([2])
  })

  it('records system and page breaks', () => {
    const t = parseMusicXml(F.systemsAndPages())
    const breaks = t.measures.filter((m) => m.systemBreakBefore).map((m) => m.number)
    expect(breaks).toEqual([1, 3, 5])
    const pageBreaks = t.measures.filter((m) => m.pageBreakBefore).map((m) => m.number)
    expect(pageBreaks).toEqual([5])
  })

  it('groups chord notes at one onset', () => {
    const t = parseMusicXml(F.chordFixture())
    const atZero = t.notes.filter((n) => !n.isRest && n.timeSeconds === 0)
    expect(atZero).toHaveLength(3)
    expect(atZero.map((n) => n.midi).sort((a, b) => a - b)).toEqual([60, 64, 67])
    const second = t.notes.filter((n) => !n.isRest && Math.abs(n.timeSeconds - 0.5) < 1e-9)
    expect(second).toHaveLength(1)
  })

  it('reads staccato articulation without changing written duration', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.staccatoNote('E', 4, 1)}</measure></part>`,
    )
    const t = parseMusicXml(xml)
    expect(t.notes[0].staccato).toBe(true)
    expect(t.notes[0].durationSeconds).toBeCloseTo(0.5, 6)
    expect(t.notes[0].durationQuarters).toBe(1)
  })

  it('reads accent articulation without changing written duration', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.accentNote('G', 4, 1)}</measure></part>`,
    )
    const t = parseMusicXml(xml)
    expect(t.notes[0].accent).toBe(true)
    expect(t.notes[0].staccato).toBe(false)
    expect(t.notes[0].durationQuarters).toBe(1)
  })

  it('rejects score-timewise with a clear error', () => {
    const xml = `<?xml version="1.0"?><score-timewise version="3.1"><part-list/><measure/></score-timewise>`
    expect(() => parseMusicXml(xml)).toThrow(/score-timewise/)
  })

  it('throws on files with no parts', () => {
    const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list/></score-partwise>`
    expect(() => parseMusicXml(xml)).toThrow(/part/i)
  })
})
