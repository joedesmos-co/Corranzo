import { describe, expect, it } from 'vitest'
import {
  canonicalNoteKey,
  collectOsmdNotes,
  cursorPositionFor,
  matchCheckpointNotes,
  measureStartsByNumber,
  musicalQuartersAtTime,
  moveOsmdCursor,
  pairOsmdNotes,
  timingUsesRepeats,
} from '../src/features/practice/osmdEngraving.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

const scaleXml = `<?xml version="1.0"?><score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
<note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
</measure>
<measure number="2">
<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
</measure>
</part></score-partwise>`

function fakeOsmd(notes) {
  const measures = notes.map((note) => ({
    staffEntries: [
      {
        graphicalVoiceEntries: [
          {
            notes: [
              {
                sourceNote: {
                  halfTone: note.midi - 12,  // OSMD model is C0-based
                  voiceEntry: { Timestamp: { RealValue: note.quarterInMeasure } },
                  sourceMeasure: { MeasureNumber: note.measure },
                  length: { RealValue: note.lengthQuarters ?? 1 },
                  isRestFlag: Boolean(note.rest),
                  stringNumberTab: note.string ?? null,
                  fretNumber: note.fret ?? null,
                },
                isTabNote: () => Boolean(note.tab),
              },
            ],
          },
        ],
      },
    ],
  }))
  return { GraphicSheet: { MeasureList: [measures] } }
}

const scaleTimingMap = parseMusicXml(scaleXml)

describe('osmd engraving identity mapping', () => {
  const timingMap = parseMusicXml(scaleXml)
  const checkpoints = buildNoteCheckpoints(timingMap, null, {})
  const starts = measureStartsByNumber(timingMap)

  it('keys canonical and engraved notes identically', () => {
    expect(canonicalNoteKey(1, 0, 60)).toBe('m1|q0.0000|60')
    expect(canonicalNoteKey(2, 0.5, 67)).toBe('m2|q0.5000|67')
  })

  it('collects engraved notes with measure, quarter and MIDI pitch', () => {
    const osmd = fakeOsmd([
      { midi: 60, quarterInMeasure: 0, measure: 1 },
      { midi: 62, quarterInMeasure: 1, measure: 1 },
      { midi: 64, quarterInMeasure: 0, measure: 2, string: 1, fret: 0, tab: true },
    ])
    const notes = collectOsmdNotes(osmd)
    expect(notes).toHaveLength(3)
    expect(notes[0].midi).toBe(60)
    expect(notes[2].isTab).toBe(true)
    expect(notes[2].string).toBe(1)
    expect(notes[2].fret).toBe(0)
  })

  it('matches each checkpoint to its engraved note, chord tones included', () => {
    const osmd = fakeOsmd([
      { midi: 60, quarterInMeasure: 0, measure: 1 },
      { midi: 62, quarterInMeasure: 0.1875, measure: 1 },
      { midi: 64, quarterInMeasure: 0.375, measure: 1 },
      { midi: 65, quarterInMeasure: 0.5625, measure: 1 },
      { midi: 67, quarterInMeasure: 0, measure: 2 },
    ])
    const pairs = pairOsmdNotes(timingMap, collectOsmdNotes(osmd))
    expect(pairs.pairs.size).toBeGreaterThanOrEqual(5)
    for (const checkpoint of checkpoints) {
      const matched = matchCheckpointNotes(pairs, checkpoint)
      expect(matched.notes, checkpoint.id).toHaveLength(1)
      expect(matched.approximate).toBe(false)
      expect(matched.notes[0].midi).toBe(checkpoint.expectedMidis[0])
    }
  })

  it('flags approximate matches instead of inventing anchors', () => {
    // Only the first note is engraved: later checkpoints have no anchor.
    const osmd = fakeOsmd([{ midi: 60, quarterInMeasure: 0, measure: 1 }])
    const pairs = pairOsmdNotes(timingMap, collectOsmdNotes(osmd))
    const missing = matchCheckpointNotes(pairs, checkpoints[3])
    expect(missing.notes).toHaveLength(0)
    expect(missing.missing).toBeGreaterThan(0)
    // A repeat-expanded score never claims exact positions.
    expect(pairOsmdNotes(
      { ...timingMap, performedMeasureTimeline: { entries: [{ repeatPass: 2 }] } },
      collectOsmdNotes(osmd),
    ).approximate).toBe(true)
  })

  it('maps practice time onto written quarters on the note onsets', () => {
    // Two quarters at 120 BPM default (MusicXML without tempo = 120).
    const first = musicalQuartersAtTime(timingMap, 0, starts)
    expect(first).toEqual({ quarter: 0, measureNumber: 1, found: true, approximate: false })
    const mid = musicalQuartersAtTime(timingMap, 0.25, starts)
    expect(mid.quarter).toBeCloseTo(0.5, 3)
    // Between the 3rd (t=1.0, q=2) and 4th (t=1.5, q=3) notes.
    const between = musicalQuartersAtTime(timingMap, 1.1, starts)
    expect(between.quarter).toBeCloseTo(2.2, 3)
    expect(between.measureNumber).toBe(1)
    // Past every note: the final measure's own position.
    const pastEnd = musicalQuartersAtTime(timingMap, 99, starts)
    expect(pastEnd.quarter).toBe(4)
    expect(pastEnd.measureNumber).toBe(2)
  })

  it('positions the cursor inside its own measure', () => {
    const startsMap = new Map([[1, 0], [2, 4], [3, 8]])
    expect(cursorPositionFor(0, startsMap)).toEqual({ measureNumber: 1, quarterInMeasure: 0 })
    expect(cursorPositionFor(5.5, startsMap)).toEqual({ measureNumber: 2, quarterInMeasure: 1.5 })
    expect(cursorPositionFor(Number.NaN, startsMap)).toBeNull()
  })

  it('walks the cursor forward and resets on backward jumps', () => {
    const timestamps = [0, 0.25, 0.5, 0.75, 1, 1.25]
    let index = 0
    let resets = 0
    const cursor = {
      Hidden: false,
      Iterator: { get currentTimeStamp() { return { RealValue: timestamps[index] } } },
      next() { if (index < timestamps.length - 1) index += 1; return true },
      reset() { index = 0; resets += 1 },
      show() {},
      update() {},
    }
    moveOsmdCursor(cursor, { measureNumber: 1, quarterInMeasure: 0.75 })
    expect(cursor.Iterator.currentTimeStamp.RealValue).toBeCloseTo(0.75, 6)
    expect(resets).toBe(0)
    moveOsmdCursor(cursor, { measureNumber: 1, quarterInMeasure: 0.25 })
    expect(cursor.Iterator.currentTimeStamp.RealValue).toBeCloseTo(0.25, 6)
    expect(resets).toBe(1)
  })

  it('pairs repeated same-pitch notes in order through rests', () => {
    // Divisions = 16 per quarter: m1 = C4, D4, rest, C4; m2 = C4.
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
<note><rest/><duration>16</duration><type>quarter</type></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
</measure>
<measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note></measure>
</part></score-partwise>`
    const map = parseMusicXml(xml)
    const engravings = [
      { measureNumber: 1, quarterInMeasure: 0, midi: 60 },
      { measureNumber: 1, quarterInMeasure: 1, midi: 62 },
      { measureNumber: 1, quarterInMeasure: 3, midi: 60 },
      { measureNumber: 2, quarterInMeasure: 0, midi: 60 },
    ]
    const pairs = pairOsmdNotes(map, engravings)
    const ordered = [...pairs.pairs.keys()]
      .sort((a, b) => a.quarterTime - b.quarterTime)
      .map((note) => {
        const engraving = pairs.pairs.get(note)[0]
        return engraving ? `${engraving.measureNumber}:${engraving.quarterInMeasure}` : null
      })
    expect(ordered).toEqual(['1:0', '1:1', '1:3', '2:0'])
    expect(pairs.unmatched).toBe(0)
    expect(pairs.approximate).toBe(false)
  })

  it('normalizes barline-exact notes to the measure they sound in', () => {
    // 5 quarters of content in a 4/4 measure (overfull run): the trailing
    // note sits exactly on the barline and must pair with the engraved note
    // that starts the next measure, not with measure 1.
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
</measure>
<measure number="2"><note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note></measure>
</part></score-partwise>`
    const map = parseMusicXml(xml)
    const engravings = [
      { measureNumber: 1, quarterInMeasure: 0, midi: 60 },
      { measureNumber: 1, quarterInMeasure: 1, midi: 62 },
      { measureNumber: 1, quarterInMeasure: 2, midi: 64 },
      { measureNumber: 1, quarterInMeasure: 3, midi: 60 },
      { measureNumber: 2, quarterInMeasure: 0, midi: 62 },
      { measureNumber: 2, quarterInMeasure: 1, midi: 65 },
    ]
    const pairs = pairOsmdNotes(map, engravings)
    expect(pairs.unmatched).toBe(0)
    expect(pairs.approximate).toBe(false)
    // The barline D4 (written at the end of measure 1) pairs with the
    // engraver's next-measure onset, not with measure 1.
    const barlineD = [...pairs.pairs.keys()].find((note) => note.midi === 62 && note.quarterTime === 4)
    expect(barlineD).toBeTruthy()
    const engraving = pairs.pairs.get(barlineD)[0]
    expect(`${engraving.measureNumber}:${engraving.quarterInMeasure}`).toBe('2:0')
  })

  it('keeps tie continuations with their parent note', () => {
    // A note held across the barline is written as two pieces (3.75 + 1.0)
    // and the parser keeps both; the engraving shows both too.
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>64</duration><type>whole</type></note>
</measure>
<measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note></measure>
</part></score-partwise>`
    const map = parseMusicXml(xml)
    const engravings = [
      { measureNumber: 1, quarterInMeasure: 3, midi: 60 },
      { measureNumber: 2, quarterInMeasure: 0, midi: 64 },
    ]
    const pairs = pairOsmdNotes(map, engravings)
    const cNotes = [...pairs.pairs.keys()].filter((note) => note.midi === 60)
    expect(cNotes).toHaveLength(1) // one sounding C4 (both halves)
    const eNotes = [...pairs.pairs.keys()].filter((note) => note.midi === 64)
    expect(eNotes).toHaveLength(1)
    expect(pairs.unmatched).toBe(0)
    expect(pairs.approximate).toBe(false)
  })

  it('marks approximation when an engraving is missing', () => {
    const pairs = pairOsmdNotes(scaleTimingMap, [
      { measureNumber: 1, quarterInMeasure: 0, midi: 60 },
    ])
    expect(pairs.approximate).toBe(true)
    expect(pairs.unmatched).toBeGreaterThan(0)
  })
})
