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

  it('detects repeat-expanded timing as approximate', () => {
    expect(timingUsesRepeats({ performedMeasureTimeline: { entries: [{ repeatPass: 2 }] } })).toBe(true)
    expect(timingUsesRepeats({ performedMeasureTimeline: { entries: [{ repeatPass: 1 }] } })).toBe(false)
    expect(timingUsesRepeats(null)).toBe(false)
  })
})
