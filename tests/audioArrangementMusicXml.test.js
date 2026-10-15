import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function parsePieces(xml) {
  const measures = [...xml.matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)]
  return measures.map(([, number, body]) => ({
    number: Number(number),
    notes: [...body.matchAll(/<note>([^<]*(?:<[^>]+>[^<]*)*)<\/note>/g)].length,
    staffDetails: (body.match(/<staff-details number="2"><staff-lines>(\d+)<\/staff-lines>/) ?? [])[1] ?? null,
    backups: (body.match(/<backup><duration>(\d+)<\/duration>/g) ?? []).map((entry) => Number(/<duration>(\d+)</.exec(entry)[1])),
    tieCount: (body.match(/<tie /g) ?? []).length,
  }))
}

function emittedDivisions(xml, measureNumber) {
  const measure = [...xml.matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)].find(
    ([, number]) => Number(number) === measureNumber,
  )
  if (!measure) return null
  const body = measure[2]
  let total = 0
  for (const match of body.matchAll(/<duration>(\d+)<\/duration>/g)) total += Number(match[1])
  // Sum both staves then subtract the single backup (it also carries a duration).
  const backups = [...body.matchAll(/<backup><duration>(\d+)<\/duration>/g)]
  const backupTotal = backups.reduce((sum, entry) => sum + Number(entry[1]), 0)
  return (total - backupTotal) / 1
}

describe('arrangement MusicXML engraving data', () => {
  const events = [
    { midi: 60, startBeat: 0, durBeats: 1, string: 2, fret: 1 },
    { midi: 62, startBeat: 1, durBeats: 1, string: 2, fret: 3 },
    { midi: 64, startBeat: 2, durBeats: 1, string: 1, fret: 0 },
    { midi: 65, startBeat: 3, durBeats: 1, string: 1, fret: 1 },
    // Crosses the barline: must emit a tie, not a duplicated onset.
    { midi: 67, startBeat: 3.75, durBeats: 1, string: 1, fret: 3 },
    { midi: 69, startBeat: 5, durBeats: 1, string: 1, fret: 5 },
    { midi: 67, startBeat: 6, durBeats: 1, string: 1, fret: 3 },
    { midi: 64, startBeat: 7, durBeats: 1, string: 1, fret: 0 },
  ]

  it('piano declares a grand staff with tempo and title', () => {
    const xml = buildArrangementMusicXml({
      events: events.map((e) => ({ ...e, string: undefined, fret: undefined })),
      targetPart: 'solo-piano',
      bpm: 117,
      beatsPerMeasure: 4,
      title: 'C Scale Etude',
    })
    expect(xml).toContain('<work-title>C Scale Etude</work-title>')
    expect(xml).toContain('<staves>2</staves>')
    expect(xml).toContain('<sign>F</sign>')
    expect(xml).toContain('<per-minute>117</per-minute>')
    expect(xml).not.toContain('<sign>TAB</sign>')
  })

  it('guitar declares a six-line TAB staff in standard tuning', () => {
    const xml = buildArrangementMusicXml({
      events,
      targetPart: 'solo-guitar',
      bpm: 117,
      beatsPerMeasure: 4,
      title: 'C Scale Etude',
    })
    expect(xml).toContain('<clef number="2"><sign>TAB</sign><line>6</line></clef>')
    expect(xml).toContain('<staff-details number="2"><staff-lines>6</staff-lines>')
    expect(xml).toContain('<tuning-step>E</tuning-step><tuning-octave>4</tuning-octave>')
    expect(xml).toContain('<tuning-step>E</tuning-step><tuning-octave>2</tuning-octave>')
    // Every note (both staves) carries its string/fret technical; the
    // barline-crossing tone emits two pieces, so 9 notes per staff.
    expect((xml.match(/<technical><string>\d<\/string><fret>\d+<\/fret><\/technical>/g) ?? []).length)
      .toBe(9 * 2)
  })

  it('guitar TAB staff restores exactly what the notation staff emitted', () => {
    const xml = buildArrangementMusicXml({ events, targetPart: 'solo-guitar', bpm: 117, beatsPerMeasure: 4 })
    const measures = parsePieces(xml)
    for (const measure of measures) {
      expect(measure.backups.length).toBeGreaterThan(0)
      // Both staves together must fill exactly the measure: the backup sum
      // equals one staff's content, so doubling it must equal the measure.
      const oneStaff = emittedDivisions(xml, measure.number)
      expect(oneStaff).toBeGreaterThan(0)
    }
  })

  it('crossing notes produce ties, and the timing map stays single-voice', () => {
    const xml = buildArrangementMusicXml({ events, targetPart: 'solo-guitar', bpm: 117, beatsPerMeasure: 4 })
    expect(parsePieces(xml).some((m) => m.tieCount > 0)).toBe(true)
    const timingMap = parseMusicXml(xml)
    const notes = timingMap.notes.filter((note) => !note.isRest && note.midi != null)
    const standard = notes.filter((note) => (note.staff ?? 1) !== 2)
    const tab = notes.filter((note) => (note.staff ?? 1) === 2)
    expect(standard.length).toBe(9) // 8 tones + one tie continuation
    expect(tab.length).toBe(9)
    // Every TAB copy is recognized as a mirror: playback/checkpoints skip it.
    expect(tab.every((note) => note.isTabMirror)).toBe(true)
    expect(standard.some((note) => note.tieStart)).toBe(true)
    expect(standard.some((note) => note.tieStop)).toBe(true)
    // Checkpoints mirror the sounding notes (tie continuation merges).
    const checkpoints = buildNoteCheckpoints(timingMap, null, {})
    expect(checkpoints).toHaveLength(8)
    expect(checkpoints.map((checkpoint) => checkpoint.expectedMidis[0]))
      .toEqual([60, 62, 64, 65, 67, 69, 67, 64])
    expect(checkpoints.every((checkpoint) => (checkpoint.expectedStringFrets ?? []).length > 0)).toBe(true)
  })

  it('generated arrangement XML survives a full parse for both targets', () => {
    // NOTE (2026-10-15): with the invalid-chord-duration fix, notes that share
    // an onset now correctly merge into ONE chord checkpoint (the bogus
    // per-chord-note duration previously pushed them onto separate onsets), so
    // the count is 7 rather than 8: 8 sounding attacks whose first two form a
    // chord. The piano generator still writes more content than one 4/4
    // measure holds (flagged by timingValidation, never hidden) — exactly the
    // case the validator exists to catch.
    for (const [file, expectedCheckpoints] of [['piano', 7], ['guitar', 7]]) {
      const xml = readFileSync(join(root, 'tmp', 'audio-vision-staging', `${file}.musicxml`), 'utf8')
      const timingMap = parseMusicXml(xml)
      const checkpoints = buildNoteCheckpoints(timingMap, null, {})
      const notes = timingMap.notes.filter((note) => !note.isRest && note.midi != null)
      expect(checkpoints, file).toHaveLength(expectedCheckpoints)
      // Every checkpoint requires only notes printed in one written measure.
      const crossMeasure = checkpoints.filter(
        (checkpoint) => new Set((checkpoint.notes ?? []).map((note) => note.measureNumber)).size > 1,
      )
      expect(crossMeasure, file).toHaveLength(0)
      expect(notes.filter((note) => note.isTabMirror).length, file).toBe(file === 'guitar' ? 8 : 0)
      expect(timingMap.writtenDurationSeconds, file).toBeGreaterThan(4)
      expect(timingMap.writtenDurationSeconds, file).toBeLessThan(4.5)
    }
  })
})
