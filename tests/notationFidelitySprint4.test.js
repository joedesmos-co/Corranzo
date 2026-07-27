import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildVisualLaneGroups,
  resolveVisualKeySignature,
} from '../src/features/practice/visualPracticeLane.js'
import {
  buildKeySignatureMarks,
  buildStaffGeometry,
  buildStaffLaneNotes,
  detectStaves,
  resolveVisualWrittenPitch,
} from '../src/features/practice/staffLaneLayout.js'

function scoreWithKeyChange() {
  return `<?xml version="1.0"?>
    <score-partwise version="3.1">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1">
          <attributes>
            <divisions>4</divisions>
            <key><fifths>-3</fifths><mode>minor</mode></key>
            <time><beats>4</beats><beat-type>4</beat-type></time>
            <clef><sign>G</sign><line>2</line></clef>
          </attributes>
          <note>
            <pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>
            <accidental>flat</accidental>
            <duration>4</duration><voice>1</voice><type>quarter</type>
          </note>
        </measure>
        <measure number="2">
          <attributes>
            <key><cancel>-3</cancel><fifths>2</fifths><mode>major</mode></key>
          </attributes>
          <note>
            <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
            <accidental cautionary="yes" parentheses="yes">sharp</accidental>
            <duration>4</duration><voice>1</voice><type>quarter</type>
          </note>
        </measure>
      </part>
    </score-partwise>`
}

describe('Notation Fidelity Sprint 4 — accidentals and key signatures', () => {
  it('emits printed flat/natural semantics without changing sounding MIDI', () => {
    const musicXml = buildOmrMusicXml({
      includeDisclaimer: false,
      musical: {
        keySignature: { fifths: -3, mode: 'major', confidence: 0.9 },
        timeSignature: { beats: 4, beatType: 4 },
      },
      measures: [
        {
          measureNumber: 1,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [
                {
                  midi: 46,
                  naturalMidi: 47,
                  alter: -1,
                  pitchAlteration: { keySignatureFifths: -3 },
                  accidental: { type: 'flat' },
                  clef: 'treble',
                },
              ],
            },
            {
              type: 'note',
              startDivision: 4,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [
                {
                  midi: 60,
                  naturalMidi: 60,
                  alter: null,
                  pitchAlteration: { localAccidental: 'natural' },
                  accidental: { type: 'natural' },
                  clef: 'treble',
                },
              ],
            },
          ],
        },
      ],
    })

    expect(musicXml).toContain(
      '<pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><accidental>flat</accidental>',
    )
    expect(musicXml).toContain(
      '<pitch><step>C</step><octave>4</octave></pitch><accidental>natural</accidental>',
    )
    expect(parseMusicXml(musicXml).notes.map((note) => note.midi)).toEqual([
      46,
      60,
    ])
  })

  it('does not retune a note when staff spelling evidence conflicts with selected MIDI', () => {
    const musicXml = buildOmrMusicXml({
      includeDisclaimer: false,
      musical: {
        keySignature: { fifths: -3, mode: 'major', confidence: 0.9 },
        timeSignature: { beats: 4, beatType: 4 },
      },
      measures: [
        {
          measureNumber: 1,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [
                {
                  midi: 45,
                  naturalMidi: 47,
                  alter: -1,
                  pitchAlteration: {
                    writtenPitch: { step: 'B', octave: 2 },
                    keySignatureFifths: -3,
                  },
                  accidental: null,
                  clef: 'bass',
                },
              ],
            },
          ],
        },
      ],
    })

    expect(parseMusicXml(musicXml).notes[0].midi).toBe(45)
    expect(musicXml).toContain(
      '<pitch><step>A</step><octave>2</octave></pitch>',
    )
    expect(musicXml).not.toContain('<accidental>')
  })

  it('preserves written pitch, printed accidental attributes, and key changes', () => {
    const timing = parseMusicXml(scoreWithKeyChange(), 'key-change.musicxml')
    expect(timing.keySignatures).toEqual([
      expect.objectContaining({
        fifths: -3,
        mode: 'minor',
        measureNumber: 1,
      }),
      expect.objectContaining({
        fifths: 2,
        cancelFifths: -3,
        measureNumber: 2,
      }),
    ])
    expect(timing.notes[0]).toMatchObject({
      midi: 70,
      writtenPitch: { step: 'B', alter: -1, octave: 4 },
      accidental: { type: 'flat', printed: true },
      keySignature: { fifths: -3 },
    })
    expect(timing.notes[1]).toMatchObject({
      midi: 66,
      writtenPitch: { step: 'F', alter: 1, octave: 4 },
      accidental: {
        type: 'sharp',
        cautionary: true,
        parentheses: true,
      },
      keySignature: { fifths: 2, cancelFifths: -3 },
    })
  })

  it('renders written flats instead of respelling sounding pitches as sharps', () => {
    const timing = parseMusicXml(scoreWithKeyChange())
    const groups = buildVisualLaneGroups(timing)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)

    expect(groups[0].notes[0]).toMatchObject({
      writtenPitch: { step: 'B', alter: -1, octave: 4 },
      accidental: { type: 'flat' },
    })
    expect(notes[0]).toMatchObject({
      midi: 70,
      accidentalType: 'flat',
      accidentalGlyph: '♭',
    })
    expect(notes[0].diatonic).toBe(34)
    expect(notes[1].accidentalDisplayGlyph).toBe('(♯)')
  })

  it('stacks accidentals independently for close chord tones', () => {
    const groups = [
      {
        id: 'chord',
        timeSeconds: 0,
        notes: [
          {
            midi: 60,
            staff: 1,
            writtenPitch: { step: 'C', alter: 0, octave: 4 },
            accidental: { type: 'natural' },
          },
          {
            midi: 61,
            staff: 1,
            writtenPitch: { step: 'C', alter: 1, octave: 4 },
            accidental: { type: 'sharp' },
          },
        ],
      },
    ]
    const geometry = buildStaffGeometry({ hasTreble: true, hasBass: false })
    const notes = buildStaffLaneNotes(groups, geometry)
    expect(notes).toHaveLength(2)
    expect(new Set(notes.map((note) => note.accidentalColumn)).size).toBe(2)
    expect(notes.map((note) => note.accidentalType).sort()).toEqual([
      'natural',
      'sharp',
    ])
  })

  it('builds key-signature and cancellation marks on every active staff', () => {
    const geometry = buildStaffGeometry({
      hasTreble: true,
      hasBass: true,
    })
    const marks = buildKeySignatureMarks(
      { fifths: 2, cancelFifths: -3 },
      geometry,
    )
    expect(marks.filter((mark) => mark.type === 'natural')).toHaveLength(6)
    expect(marks.filter((mark) => mark.type === 'sharp')).toHaveLength(4)
    expect(marks.every((mark) => Number.isFinite(mark.y))).toBe(true)
  })

  it('shows cancellation naturals only in the key-change measure', () => {
    const timing = parseMusicXml(scoreWithKeyChange())
    expect(
      resolveVisualKeySignature(
        timing,
        timing.measures[1].startTimeSeconds,
        2,
      ),
    ).toMatchObject({ fifths: 2, cancelFifths: -3 })
    expect(
      resolveVisualKeySignature(
        timing,
        timing.measures[1].startTimeSeconds + 1,
        3,
      ),
    ).toMatchObject({ fifths: 2, cancelFifths: null })
  })

  it('supports double-sharp and double-flat written glyphs without MIDI inference', () => {
    expect(
      resolveVisualWrittenPitch({
        midi: 62,
        writtenPitch: { step: 'C', alter: 2, octave: 4 },
        accidental: { type: 'double-sharp' },
      }),
    ).toMatchObject({ accidentalGlyph: '𝄪', diatonic: 28 })
    expect(
      resolveVisualWrittenPitch({
        midi: 69,
        writtenPitch: { step: 'B', alter: -2, octave: 4 },
        accidental: { type: 'double-flat' },
      }),
    ).toMatchObject({ accidentalGlyph: '𝄫', diatonic: 34 })
  })
})
