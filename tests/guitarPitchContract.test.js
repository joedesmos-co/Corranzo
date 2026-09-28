import { describe, expect, it } from 'vitest'
import {
  GUITAR_PITCH_CONTRACT_VERSION,
  GUITAR_PITCH_VIOLATIONS,
  GUITAR_WRITTEN_OCTAVE_OFFSET,
  soundingFromTab,
  soundingFromWritten,
  tabPositionsForSounding,
  validateGuitarMusicXml,
  writtenFromSounding,
} from '../src/features/omr/guitar/pitchContract.js'

/** A minimal guitar part whose stored pitch is sounding pitch. */
function guitarPart({ pitch = '<pitch><step>A</step><octave>2</octave></pitch>', extra = '', attributes = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>${attributes}</attributes>
      <note>${pitch}<duration>4</duration><voice>1</voice><type>whole</type>${extra}</note>
    </measure>
  </part>
</score-partwise>`
}

describe('guitar pitch contract', () => {
  it('declares a version so the contract can be referenced and migrated', () => {
    expect(GUITAR_PITCH_CONTRACT_VERSION).toBe('guitar-pitch/1.0')
  })

  it('treats guitar as sounding an octave below written treble-clef pitch', () => {
    expect(GUITAR_WRITTEN_OCTAVE_OFFSET).toBe(-1)
    // Written middle C sounds C3.
    expect(soundingFromWritten(60)).toBe(48)
    // Written top-of-staff E4 sounds E3.
    expect(soundingFromWritten(64)).toBe(52)
  })

  it('round-trips written <-> sounding', () => {
    for (const written of [52, 57, 60, 64, 69, 76]) {
      expect(writtenFromSounding(soundingFromWritten(written))).toBe(written)
    }
  })

  it('derives sounding pitch from a fretted position', () => {
    // Standard tuning string 1..6 = E4 B3 G3 D3 A2 E2 = 64 59 55 50 45 40.
    expect(soundingFromTab(1, 0)).toBe(64)
    expect(soundingFromTab(2, 0)).toBe(59)
    expect(soundingFromTab(6, 0)).toBe(40)
    expect(soundingFromTab(1, 5)).toBe(69)
    expect(soundingFromTab(5, 0)).toBe(45)
    expect(soundingFromTab(5, 3)).toBe(48)
  })

  it('accounts for capo when deriving tab pitch', () => {
    expect(soundingFromTab(1, 0, { capoFret: 2 })).toBe(66)
    expect(soundingFromTab(1, 3, { capoFret: 2 })).toBe(69)
  })

  it('rejects impossible positions instead of guessing', () => {
    expect(soundingFromTab(0, 3)).toBeNull()
    expect(soundingFromTab(7, 0)).toBeNull()
    expect(soundingFromTab(1, -1)).toBeNull()
  })

  it('enumerates every position that can sound a pitch', () => {
    // E3 (52): string 4 fret 2, string 5 fret 7, string 6 fret 12.
    const positions = tabPositionsForSounding(52)
    expect(positions).toEqual([
      { string: 4, fret: 2 },
      { string: 5, fret: 7 },
      { string: 6, fret: 12 },
    ])
    // Open E2 (40) is only reachable on string 6.
    expect(tabPositionsForSounding(40)).toEqual([{ string: 6, fret: 0 }])
  })

  describe('MusicXML validation', () => {
    it('accepts a conforming guitar score', () => {
      // A2 is open string 5 in standard tuning.
      const report = validateGuitarMusicXml(
        guitarPart({ extra: '<notations><technical><string>5</string><fret>0</fret></technical></notations>' }),
      )
      expect(report.ok).toBe(true)
      expect(report.violations).toEqual([])
    })

    it('rejects a clef octave change because it double-counts the transposition', () => {
      const xml = guitarPart({
        attributes:
          '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>',
      })
      const report = validateGuitarMusicXml(xml)
      expect(report.ok).toBe(false)
      expect(report.violations.map((v) => v.rule)).toContain(
        GUITAR_PITCH_VIOLATIONS.CLEF_OCTAVE_CHANGE,
      )
    })

    it('rejects a transpose element for the same reason', () => {
      const xml = guitarPart({
        attributes:
          '<clef><sign>G</sign><line>2</line></clef>' +
          '<transpose><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose>',
      })
      const report = validateGuitarMusicXml(xml)
      expect(report.ok).toBe(false)
      expect(report.violations.map((v) => v.rule)).toContain(GUITAR_PITCH_VIOLATIONS.TRANSPOSE)
    })

    it('detects a string/fret that cannot produce the stored pitch', () => {
      // String 5 open is A2 (45); fret 3 sounds C3 (48), not E3 (52).
      const xml = guitarPart({
        pitch: '<pitch><step>E</step><octave>3</octave></pitch>',
        extra: '<notations><technical><string>5</string><fret>3</fret></technical></notations>',
      })
      const report = validateGuitarMusicXml(xml)
      expect(report.ok).toBe(false)
      const violation = report.violations.find(
        (v) => v.rule === GUITAR_PITCH_VIOLATIONS.STRING_FRET_DISAGREES,
      )
      expect(violation.expectedSoundingMidi).toBe(48)
      expect(violation.pitchMidi).toBe(52)
      expect(violation.deltaSemitones).toBe(4)
    })

    it('ignores notes that carry no position, which is a coverage defect not a contract breach', () => {
      const report = validateGuitarMusicXml(guitarPart())
      expect(report.ok).toBe(true)
    })

    it('reports every occurrence count so one fix can address the whole file', () => {
      const xml = `<?xml version="1.0"?><score-partwise version="4.0">
        <part id="P1"><measure number="1">
          <attributes><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>
          <note><pitch><step>A</step><octave>2</octave></pitch><duration>4</duration></note>
        </measure>
        <measure number="2">
          <attributes><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>
          <note><pitch><step>B</step><octave>2</octave></pitch><duration>4</duration></note>
        </measure></part></score-partwise>`
      const report = validateGuitarMusicXml(xml)
      const violation = report.violations.find(
        (v) => v.rule === GUITAR_PITCH_VIOLATIONS.CLEF_OCTAVE_CHANGE,
      )
      expect(violation.count).toBe(2)
    })
  })
})
