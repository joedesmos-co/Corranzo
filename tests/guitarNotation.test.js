/**
 * Guitar notation model: TAB clefs, <technical> string/fret, staff tuning,
 * mixed notation+TAB mirror handling — and piano scores staying untouched.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getMeasurePlaybackWindow } from '../src/features/musicxml/performedTimeline.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { buildMeasureMusicalEvents } from '../src/features/score-follow/cursorMusicalProgress.js'
import { straight4 } from './helpers/buildXml.js'

function guitarNote(step, octave, duration, { string = null, fret = null, staff = null, voice = 1, chord = false } = {}) {
  const technical =
    string != null || fret != null
      ? `<notations><technical>${string != null ? `<string>${string}</string>` : ''}${
          fret != null ? `<fret>${fret}</fret>` : ''
        }</technical></notations>`
      : ''
  return (
    `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>${voice}</voice><type>quarter</type>` +
    `${staff != null ? `<staff>${staff}</staff>` : ''}${technical}</note>`
  )
}

const STANDARD_TUNING_DETAILS =
  `<staff-details number="2"><staff-lines>6</staff-lines>` +
  `<staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>` +
  `<staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>` +
  `<staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>` +
  `<staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>` +
  `<staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>` +
  `<staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>` +
  `</staff-details>`

function guitarScore({ withTab = false, mirrored = false } = {}) {
  const clefs = withTab
    ? `<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>` +
      `<clef number="2"><sign>TAB</sign><line>5</line></clef>`
    : `<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>`
  const attributesXml =
    `<attributes><divisions>1</divisions>` +
    (withTab ? `<staves>2</staves>` : '') +
    `<time><beats>4</beats><beat-type>4</beat-type></time>${clefs}` +
    (withTab ? STANDARD_TUNING_DETAILS : '') +
    `</attributes>`

  const standardNotes =
    guitarNote('E', 3, 1, { staff: withTab ? 1 : null }) +
    guitarNote('A', 3, 1, { staff: withTab ? 1 : null, string: 3, fret: 2 }) +
    guitarNote('B', 3, 1, { staff: withTab ? 1 : null }) +
    guitarNote('E', 4, 1, { staff: withTab ? 1 : null })

  const tabNotes = mirrored
    ? `<backup><duration>4</duration></backup>` +
      guitarNote('E', 3, 1, { staff: 2, voice: 5, string: 6, fret: 12 }) +
      guitarNote('A', 3, 1, { staff: 2, voice: 5, string: 3, fret: 2 }) +
      guitarNote('B', 3, 1, { staff: 2, voice: 5, string: 2, fret: 0 }) +
      guitarNote('E', 4, 1, { staff: 2, voice: 5, string: 1, fret: 0 })
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Classical Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">${attributesXml}<direction><sound tempo="120"/></direction>${standardNotes}${tabNotes}</measure>
  </part>
</score-partwise>`
}

function tabOnlyScore() {
  const tabTuning = STANDARD_TUNING_DETAILS.replace('number="2"', 'number="1"')
  const attributesXml =
    `<attributes><divisions>1</divisions>` +
    `<time><beats>4</beats><beat-type>4</beat-type></time>` +
    `<clef><sign>TAB</sign><line>5</line></clef>${tabTuning}</attributes>`
  const tabNotes =
    guitarNote('E', 4, 1, { staff: 1, string: 1, fret: 0 }) +
    guitarNote('F', 4, 1, { staff: 1, string: 1, fret: 1 }) +
    guitarNote('G', 4, 1, { staff: 1, string: 1, fret: 3 }) +
    guitarNote('C', 4, 1, { staff: 1, string: 2, fret: 1 })

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar TAB</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">${attributesXml}<direction><sound tempo="120"/></direction>${tabNotes}</measure>
  </part>
</score-partwise>`
}

describe('guitar MusicXML parsing', () => {
  it('reads <technical> string/fret onto notes', () => {
    const map = parseMusicXml(guitarScore(), 'guitar.musicxml')
    const withPosition = map.notes.find((note) => note.string != null)
    expect(withPosition).toBeTruthy()
    expect(withPosition.string).toBe(3)
    expect(withPosition.fret).toBe(2)
    // Notes without <technical> keep their exact legacy shape (no new keys).
    const plain = map.notes.find((note) => note.label === 'E3')
    expect('string' in plain).toBe(false)
    expect('fret' in plain).toBe(false)
  })

  it('suggests guitar from the part name even without a TAB staff', () => {
    const map = parseMusicXml(guitarScore(), 'guitar.musicxml')
    expect(map.notation.hasTabStaff).toBe(false)
    expect(map.notation.hasStandardStaff).toBe(true)
    expect(map.notation.suggestedInstrumentId).toBe('guitar')
  })

  it('parses TAB clefs and standard-tuning staff details', () => {
    const map = parseMusicXml(guitarScore({ withTab: true, mirrored: true }), 'tab.musicxml')
    expect(map.notation.hasTabStaff).toBe(true)
    expect(map.notation.suggestedInstrumentId).toBe('guitar')

    const part = map.parts[0]
    expect(part.staves).toBe(2)
    expect(part.tabStaves).toEqual([2])
    const tabClef = part.clefs.find((clef) => clef.sign === 'TAB')
    expect(tabClef.staff).toBe(2)
    // String 1 (high E) first — MusicXML string-number order.
    expect(part.tuning).toEqual([64, 59, 55, 50, 45, 40])
  })

  it('marks TAB-staff duplicates as mirrors and copies positions to notation notes', () => {
    const map = parseMusicXml(guitarScore({ withTab: true, mirrored: true }), 'tab.musicxml')
    const playable = map.notes.filter((note) => !note.isRest && note.midi != null)
    const mirrors = playable.filter((note) => note.isTabMirror)
    const sounding = playable.filter((note) => !note.isTabMirror)

    expect(mirrors.length).toBe(4)
    expect(sounding.length).toBe(4)
    expect(map.noteCount).toBe(4)

    // The standard-staff E3 had no <technical>; the TAB mirror supplies it.
    const e3 = sounding.find((note) => note.label === 'E3')
    expect(e3.string).toBe(6)
    expect(e3.fret).toBe(12)
    // Explicit notation-staff technical is never overwritten by the mirror.
    const a3 = sounding.find((note) => note.label === 'A3')
    expect(a3.string).toBe(3)
    expect(a3.fret).toBe(2)
  })

  it('plays and checkpoints each mirrored note exactly once', () => {
    const map = parseMusicXml(guitarScore({ withTab: true, mirrored: true }), 'tab.musicxml')
    const schedule = buildScoreNoteSchedule(map)
    expect(schedule.length).toBe(4)

    const checkpoints = buildNoteCheckpoints(map)
    expect(checkpoints.length).toBe(4)
    expect(checkpoints.every((checkpoint) => !checkpoint.isChord)).toBe(true)
  })

  it('builds score-follow events from notation notes, not TAB mirrors', () => {
    const map = parseMusicXml(guitarScore({ withTab: true, mirrored: true }), 'tab.musicxml')
    const window = getMeasurePlaybackWindow(map, 1, 0)
    const events = buildMeasureMusicalEvents(map, 1, window, 0.1, 0.9, {
      includeMeasureEnd: false,
    })
    const noteEvents = events.filter((event) => event.kind === 'note' || event.kind === 'chord')

    expect(noteEvents).toHaveLength(4)
    expect(noteEvents.every((event) => event.kind === 'note')).toBe(true)
  })

  it('keeps TAB-only guitar scores playable', () => {
    const map = parseMusicXml(tabOnlyScore(), 'tab-only.musicxml')
    const notes = map.notes.filter((note) => !note.isRest && note.midi != null)

    expect(map.notation.hasTabStaff).toBe(true)
    expect(map.notation.hasStandardStaff).toBe(false)
    expect(notes).toHaveLength(4)
    expect(notes.every((note) => note.isTabMirror !== true)).toBe(true)
    expect(notes.every((note) => note.string != null && note.fret != null)).toBe(true)
    expect(buildScoreNoteSchedule(map)).toHaveLength(4)
    expect(buildNoteCheckpoints(map)).toHaveLength(4)
  })
})

describe('piano scores are untouched by the guitar notation model', () => {
  it('adds no tab fields and no guitar suggestion to a plain piano score', () => {
    const map = parseMusicXml(straight4(), 'piano.musicxml')
    expect(map.notation.hasTabStaff).toBe(false)
    expect(map.notation.suggestedInstrumentId).toBeNull()
    for (const note of map.notes) {
      expect('string' in note).toBe(false)
      expect('isTabMirror' in note).toBe(false)
    }
    expect(map.parts[0].tabStaves).toEqual([])
    expect(map.parts[0].tuning).toBeNull()
    expect(buildScoreNoteSchedule(map).length).toBe(16)
    expect(buildNoteCheckpoints(map).length).toBe(16)
  })
})
