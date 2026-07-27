/**
 * Timing-map tab position derivation: explicit positions win, derived fill
 * the gaps, declared tunings override the default, piano yields nothing.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getInstrument } from '../src/features/instruments/instruments.js'
import {
  getTabPositionsForTimingMap,
  resolveStringsForTimingMap,
} from '../src/features/instruments/timingMapTabPositions.js'
import { midiForStringFret } from '../src/features/instruments/fretboard.js'
import { straight4 } from './helpers/buildXml.js'

const GUITAR = getInstrument('guitar')
const PIANO = getInstrument('piano')

function simpleGuitarXml() {
  const note = (step, octave, technical = '') =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${technical}</note>`
  const explicit =
    '<notations><technical><string>2</string><fret>0</fret></technical></notations>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>
      <direction><sound tempo="120"/></direction>
      ${note('E', 2)}${note('A', 2)}${note('B', 3, explicit)}${note('E', 3)}
    </measure>
  </part>
</score-partwise>`
}

describe('getTabPositionsForTimingMap', () => {
  it('derives playable positions for every sounding guitar note', () => {
    const map = parseMusicXml(simpleGuitarXml(), 'g.musicxml')
    const positions = getTabPositionsForTimingMap(map, GUITAR)

    const playable = map.notes.filter((note) => !note.isRest && note.midi != null)
    expect(positions.size).toBe(playable.length)
    for (const note of playable) {
      const position = positions.get(note.id)
      expect(position).toBeTruthy()
      expect(midiForStringFret(GUITAR.strings, position.string, position.fret)).toBe(note.midi)
    }
  })

  it('keeps explicit MusicXML positions unchanged', () => {
    const map = parseMusicXml(simpleGuitarXml(), 'g.musicxml')
    const positions = getTabPositionsForTimingMap(map, GUITAR)
    const explicitNote = map.notes.find((note) => note.string === 2)
    const position = positions.get(explicitNote.id)
    expect(position).toEqual({ string: 2, fret: 0, derived: false })
  })

  it('returns an empty map for piano', () => {
    const map = parseMusicXml(straight4(), 'p.musicxml')
    expect(getTabPositionsForTimingMap(map, PIANO).size).toBe(0)
  })

  it('caches per timing map + instrument while ownership matches', () => {
    const map = parseMusicXml(simpleGuitarXml(), 'g.musicxml')
    map.contentHash = 'hash-a'
    const first = getTabPositionsForTimingMap(map, GUITAR, {
      ownerPdfIdentity: 'pdf-a',
      epoch: 1,
    })
    const second = getTabPositionsForTimingMap(map, GUITAR, {
      ownerPdfIdentity: 'pdf-a',
      epoch: 1,
    })
    expect(second).toBe(first)
  })

  it('rebuilds when score ownership changes', () => {
    const map = parseMusicXml(simpleGuitarXml(), 'g.musicxml')
    map.contentHash = 'hash-a'
    const first = getTabPositionsForTimingMap(map, GUITAR, {
      ownerPdfIdentity: 'pdf-a',
      epoch: 1,
    })
    const second = getTabPositionsForTimingMap(map, GUITAR, {
      ownerPdfIdentity: 'pdf-b',
      epoch: 2,
      contentHash: 'hash-b',
    })
    expect(second).not.toBe(first)
    expect(second.size).toBe(first.size)
  })
})

describe('resolveStringsForTimingMap', () => {
  it('uses the instrument default when the score declares no tuning', () => {
    const map = parseMusicXml(simpleGuitarXml(), 'g.musicxml')
    expect(resolveStringsForTimingMap(map, GUITAR)).toBe(GUITAR.strings)
  })

  it('prefers a tuning declared in the score', () => {
    const fake = { parts: [{ tuning: [64, 59, 55, 50, 45, 38] }] } // drop D
    const strings = resolveStringsForTimingMap(fake, GUITAR)
    expect(strings.tuning[5]).toBe(38)
    expect(strings.count).toBe(6)
    // Untouched base config values carry over.
    expect(strings.fretCount).toBe(GUITAR.strings.fretCount)
  })

  it('returns null for keyboard instruments', () => {
    expect(resolveStringsForTimingMap({ parts: [] }, PIANO)).toBeNull()
  })
})
