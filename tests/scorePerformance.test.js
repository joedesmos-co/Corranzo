/**
 * Canonical performance layer (Stage S4/S5/S6): score-path pedal,
 * technique evidence, strum staggering, and legato/mute shaping.
 *
 * All pure (no AudioContext): timing maps are hand-built minimal
 * fixtures so each behavior is pinned without XML parsing overhead
 * (parsing is covered by musicxml tests).
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  applyGuitarStrum,
  buildScoreNoteSchedule,
  splitPerformedTechniques,
} from '../src/features/playback/scorePlaybackSchedule.js'
import * as F from './helpers/buildXml.js'

function pedalScore() {
  const pedal = (type) => `<direction><direction-type><pedal type="${type}"/></direction-type></direction>`
  const xml =
    `<measure number="1">${F.attributes()}${pedal('start')}${F.fourQuarters(['C', 'D', 'E', 'F'])}</measure>` +
    `<measure number="2">${F.fourQuarters(['G', 'A', 'B', 'C'])}${pedal('stop')}</measure>`
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

describe('score pedal marks', () => {
  it('parses damper start/stop into second-spans on the timing map', () => {
    const timing = parseMusicXml(pedalScore())
    expect(timing.pedalSpans.length).toBe(1)
    const [span] = timing.pedalSpans
    expect(span.endSeconds).toBeGreaterThan(span.startSeconds)
    expect(span.startSeconds).toBeCloseTo(0, 6)
  })

  it('renders pedalled score notes with ringing releases end to end', () => {
    const timing = parseMusicXml(pedalScore())
    const events = buildScoreNoteSchedule(timing, { sustainPedal: true })
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(event.performedDurationSeconds).toBeGreaterThanOrEqual(event.writtenDurationSeconds)
    }
    const first = events.find((event) => event.midi === 60)
    expect(first.performedDurationSeconds).toBeGreaterThan(first.writtenDurationSeconds)
  })

  it('ignores a dangling pedal-down gracefully (no infinite hold)', () => {
    const xml =
      `<measure number="1">${F.attributes()}<direction><direction-type><pedal type="start"/></direction-type></direction>${F.fourQuarters()}</measure>`
    const timing = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const events = buildScoreNoteSchedule(timing, { sustainPedal: true })
    for (const event of events) {
      expect(Number.isFinite(event.performedDurationSeconds)).toBe(true)
    }
  })
})

function timingNote(overrides = {}) {
  return {
    timeSeconds: 0,
    performedSeconds: 0,
    durationSeconds: 1,
    midi: 60,
    label: 'C4',
    measureNumber: 1,
    velocity: 0.7,
    partId: 'P1',
    ...overrides,
  }
}

function timingMap(notes, extra = {}) {
  return {
    fileName: 'test',
    measures: [{ number: 1, startTimeSeconds: 0, endTimeSeconds: 4 }],
    beats: [],
    notes,
    performedMeasureTimeline: { entries: [], performedBeats: [], performedDurationSeconds: 4 },
    ...extra,
  }
}

describe('splitPerformedTechniques', () => {
  it('performs pitch/time techniques, recognizes harmonics only', () => {
    const { performed, recognizedOnly } = splitPerformedTechniques([
      { kind: 'hammer-on' },
      { kind: 'bend' },
      { kind: 'slide' },
      { kind: 'vibrato' },
      { kind: 'harmonic' },
      'pull-off',
      'muted',
    ])
    expect(performed).toEqual(['hammer-on', 'bend', 'slide', 'vibrato', 'pull-off', 'muted'])
    expect(recognizedOnly).toEqual(['harmonic'])
  })

  it('never manufactures techniques from nothing', () => {
    expect(splitPerformedTechniques([])).toEqual({ performed: [], recognizedOnly: [] })
    expect(splitPerformedTechniques(null)).toEqual({ performed: [], recognizedOnly: [] })
  })
})

describe('score-path sustain pedal', () => {
  const notes = () => [timingNote({ midi: 60, timeSeconds: 0.5, performedSeconds: 0.5, durationSeconds: 0.5 })]
  const spans = [{ startSeconds: 0, endSeconds: 3 }]

  it('extends piano note releases while the damper is down', () => {
    const [event] = buildScoreNoteSchedule(timingMap(notes(), { pedalSpans: spans }), {
      sustainPedal: true,
    })
    expect(event.performedDurationSeconds).toBeCloseTo(2.5, 6)
    // Written values are untouched — only the performance changes.
    expect(event.writtenDurationSeconds).toBeCloseTo(0.5, 6)
    expect(event.scoreTimeSeconds).toBeCloseTo(0.5, 6)
  })

  it('does nothing without spans, without the flag, or after release', () => {
    const [plain] = buildScoreNoteSchedule(timingMap(notes(), { pedalSpans: spans }), {})
    expect(plain.performedDurationSeconds).toBeCloseTo(0.5, 6)
    const [noSpans] = buildScoreNoteSchedule(timingMap(notes()), { sustainPedal: true })
    expect(noSpans.performedDurationSeconds).toBeCloseTo(0.5, 6)
    const late = buildScoreNoteSchedule(
      timingMap([timingNote({ timeSeconds: 3.5, performedSeconds: 3.5, durationSeconds: 0.5 })], { pedalSpans: spans }),
      { sustainPedal: true },
    )
    expect(late[0].performedDurationSeconds).toBeCloseTo(0.5, 6)
  })
})

describe('technique evidence on schedule events', () => {
  it('passes techniques through with performed/recognized split', () => {
    const [event] = buildScoreNoteSchedule(timingMap([
      timingNote({ guitarTechniques: [{ kind: 'hammer-on' }, { kind: 'harmonic' }] }),
    ]))
    expect(event.techniques).toEqual(['hammer-on', 'harmonic'])
    expect(event.performedTechniques).toEqual(['hammer-on'])
    expect(event.recognizedOnlyTechniques).toEqual(['harmonic'])
  })

  it('shapes hammer-on notes softer with legato overlap', () => {
    const [event] = buildScoreNoteSchedule(timingMap([
      timingNote({ velocity: 0.8, durationSeconds: 0.5, guitarTechniques: [{ kind: 'hammer-on' }] }),
    ]))
    expect(event.velocity).toBeLessThan(0.8)
    expect(event.performedDurationSeconds).toBeGreaterThan(0.5)
  })

  it('damps muted notes short and soft', () => {
    const [event] = buildScoreNoteSchedule(timingMap([
      timingNote({ velocity: 0.8, durationSeconds: 0.5, muted: true }),
    ]))
    expect(event.muted).toBe(true)
    expect(event.performedDurationSeconds).toBeLessThan(0.5)
    expect(event.velocity).toBeLessThan(0.8)
  })
})

describe('guitar strum staggering', () => {
  const chord = () => [
    timingNote({ midi: 40, timeSeconds: 1, performedSeconds: 1, durationSeconds: 1, velocity: 0.8 }),
    timingNote({ midi: 45, timeSeconds: 1, performedSeconds: 1, durationSeconds: 1, velocity: 0.8 }),
    timingNote({ midi: 52, timeSeconds: 1, performedSeconds: 1, durationSeconds: 1, velocity: 0.8 }),
  ]

  it('staggers simultaneous guitar chord tones low→high with velocity slope', () => {
    const events = buildScoreNoteSchedule(timingMap(chord()), { instrumentId: 'guitar' })
    expect(events.map((event) => event.midi)).toEqual([40, 45, 52])
    expect(events[1].scoreTimeSeconds - events[0].scoreTimeSeconds).toBeCloseTo(0.009, 6)
    expect(events[2].scoreTimeSeconds - events[0].scoreTimeSeconds).toBeCloseTo(0.018, 6)
    expect(events[0].velocity).toBeGreaterThan(events[2].velocity)
    for (const event of events) {
      expect(event.strummed).toBe(true)
      expect(event.performedTechniques).toContain('strum')
    }
  })

  it('leaves piano chords perfectly simultaneous', () => {
    const events = buildScoreNoteSchedule(timingMap(chord()), { instrumentId: 'piano' })
    expect(events[0].scoreTimeSeconds).toBe(events[1].scoreTimeSeconds)
    expect(events[0].strummed).toBeUndefined()
  })

  it('never merges arpeggios into strums', () => {
    const events = buildScoreNoteSchedule(timingMap([
      timingNote({ midi: 40, timeSeconds: 1, performedSeconds: 1 }),
      timingNote({ midi: 45, timeSeconds: 1.2, performedSeconds: 1.2 }),
    ]), { instrumentId: 'guitar' })
    expect(events[0].strummed).toBeUndefined()
    expect(events[1].strummed).toBeUndefined()
  })

  it('applyGuitarStrum is a safe no-op on empty input', () => {
    expect(applyGuitarStrum([])).toEqual([])
  })

  it('strum staggering never rewrites written onsets (score-follow sync source)', () => {
    const events = buildScoreNoteSchedule(timingMap(chord()), { instrumentId: 'guitar' })
    for (const event of events) {
      expect(event.writtenOnsetSeconds).toBe(1)
    }
    // Performed times stagger; written times stay identical for the cursor.
    expect(new Set(events.map((event) => event.scoreTimeSeconds)).size).toBe(3)
  })
})

function techniqueNote(extraNotations) {
  const xml =
    `<measure number="1">${F.attributes()}` +
    `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
    `<notations>${extraNotations}</notations></note></measure>`
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

describe('parsed guitar technique paths (parse → perform)', () => {
  it('parses harmonic markings and keeps them recognized-only (never faked)', () => {
    const timing = parseMusicXml(techniqueNote(`<technical><harmonic/></technical>`))
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.techniques).toContain('harmonic')
    expect(event.recognizedOnlyTechniques).toContain('harmonic')
    expect(event.performedTechniques).not.toContain('harmonic')
  })

  it('parses palm-mute text into performed muted events', () => {
    const timing = parseMusicXml(
      techniqueNote(`<technical><other-technical>palm mute</other-technical></technical>`),
    )
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.techniques).toContain('muted')
    expect(event.muted).toBe(true)
    expect(event.performedTechniques).toContain('muted')
    expect(event.performedDurationSeconds).toBeLessThan(event.writtenDurationSeconds)
  })

  it('does not mute on unrelated technical text', () => {
    const timing = parseMusicXml(
      techniqueNote(`<technical><other-technical>dolce</other-technical></technical>`),
    )
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.muted).toBe(false)
  })

  it('parses let-ring text into extended ringing events', () => {
    const timing = parseMusicXml(
      techniqueNote(`<technical><other-technical>let ring</other-technical></technical>`),
    )
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.performedTechniques).toContain('let-ring')
    expect(event.performedDurationSeconds).toBeGreaterThan(event.writtenDurationSeconds)
  })
  it('gives written-slur notes legato overlap on any instrument', () => {
    const xml =
      `<measure number="1">${F.attributes()}` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slur type="start" number="1"/></notations></note>` +
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slur type="stop" number="1"/></notations></note></measure>`
    const timing = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const events = buildScoreNoteSchedule(timing, { instrumentId: 'piano' })
    expect(events[0].legato).toBe(true)
    expect(events[0].performedTechniques).toContain('legato')
    expect(events[0].performedDurationSeconds).toBeGreaterThan(events[0].writtenDurationSeconds)
    expect(events[1].legato).toBe(false)
  })
})

describe('pitch curves (bend/slide/vibrato)', () => {
  it('builds a bend curve with parsed semitones', () => {
    const xml =
      `<measure number="1">${F.attributes()}` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type>` +
      `<notations><technical><bend><bend-alter>1</bend-alter></bend></technical></notations></note></measure>`
    const timing = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.performedTechniques).toContain('bend')
    expect(event.pitchCurve).toMatchObject({ type: 'bend', semitones: 1 })
  })

  it('builds a bend-release curve when <release/> is present', () => {
    const xml =
      `<measure number="1">${F.attributes()}` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type>` +
      `<notations><technical><bend><bend-alter>2</bend-alter><release/></bend></technical></notations></note></measure>`
    const timing = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.pitchCurve).toMatchObject({ type: 'bend-release', semitones: 2 })
  })

  it('pairs slides start→stop and demotes unpaired starts honestly', () => {
    const xml =
      `<measure number="1">${F.attributes()}` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slide type="start"/></notations></note>` +
      `<note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slide type="stop"/></notations></note></measure>`
    const timing = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const events = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(events[0].pitchCurve).toMatchObject({ type: 'slide', targetMidi: 55 })
    expect(events[0].performedTechniques).toContain('slide')

    const lone =
      `<measure number="1">${F.attributes()}` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slide type="start"/></notations></note></measure>`
    const loneTiming = parseMusicXml(F.scoreWrap(`<part id="P1">${lone}</part>`))
    const [loneEvent] = buildScoreNoteSchedule(loneTiming, { instrumentId: 'guitar' })
    expect(loneEvent.pitchCurve).toBeNull()
    expect(loneEvent.performedTechniques).not.toContain('slide')
    expect(loneEvent.recognizedOnlyTechniques).toContain('slide')
  })

  it('builds a vibrato curve with documented defaults', () => {
    const [event] = buildScoreNoteSchedule(timingMap([
      timingNote({ guitarTechniques: [{ kind: 'vibrato' }] }),
    ]))
    expect(event.performedTechniques).toContain('vibrato')
    expect(event.pitchCurve).toMatchObject({ type: 'vibrato', rateHz: 5.5 })
  })

  it('preserves string/fret information onto schedule events', () => {
    const xml =
      `<measure number="1">${F.attributes()}` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><technical><string>6</string><fret>0</fret></technical></notations></note></measure>`
    const timing = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const [event] = buildScoreNoteSchedule(timing, { instrumentId: 'guitar' })
    expect(event.string).toBe(6)
    expect(event.fret).toBe(0)
  })
})

describe('ornament expansion', () => {
  function ornamentScore(extraNotations) {
    return F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type>` +
      `<notations>${extraNotations}</notations></note></measure></part>`,
    )
  }

  it('expands trills into alternating main/upper attacks (diatonic in C)', () => {
    const timing = parseMusicXml(ornamentScore(`<ornaments><trill-mark/></ornaments>`))
    const events = buildScoreNoteSchedule(timing, { instrumentId: 'piano' })
    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events[0].midi).toBe(60)
    expect(events[1].midi).toBe(62)
    expect(events[0].ornamentKind).toBe('trill')
    expect(events[0].ornamentCount).toBe(events.length)
    for (const event of events) {
      expect(event.performedTechniques).toEqual(['trill'])
    }
  })

  it('expands mordents and turns with exact subdivision counts', () => {
    const mordent = buildScoreNoteSchedule(
      parseMusicXml(ornamentScore(`<ornaments><mordent/></ornaments>`)), { instrumentId: 'piano' },
    )
    expect(mordent.map((event) => event.midi)).toEqual([60, 62, 60])
    const turn = buildScoreNoteSchedule(
      parseMusicXml(ornamentScore(`<ornaments><turn/></ornaments>`)), { instrumentId: 'piano' },
    )
    expect(turn.map((event) => event.midi)).toEqual([62, 60, 59, 60])
  })

  it('staggers arpeggiated chords 12 ms in direction order', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}` +
      `<note><arpeggiate direction="up"/><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>` +
      `<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>` +
      `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>` +
      `</measure></part>`,
    )
    const events = buildScoreNoteSchedule(parseMusicXml(xml), { instrumentId: 'piano' })
    expect(events.map((event) => event.midi)).toEqual([60, 64, 67])
    expect(events[1].scoreTimeSeconds - events[0].scoreTimeSeconds).toBeCloseTo(0.012, 6)
    expect(events[2].scoreTimeSeconds - events[0].scoreTimeSeconds).toBeCloseTo(0.024, 6)
    for (const event of events) {
      expect(event.performedTechniques).toContain('arpeggio')
    }
  })

  it('fermata never shifts later onsets (cursor sync source)', () => {
    const plain = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.note('C')}${F.note('D')}</measure></part>`,
    )
    const held = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>` +
      `<notations><fermata/></notations></note>${F.note('D')}</measure></part>`,
    )
    const plainEvents = buildScoreNoteSchedule(parseMusicXml(plain))
    const heldEvents = buildScoreNoteSchedule(parseMusicXml(held))
    expect(heldEvents[1].scoreTimeSeconds).toBe(plainEvents[1].scoreTimeSeconds)
    expect(heldEvents[1].writtenOnsetSeconds).toBe(plainEvents[1].writtenOnsetSeconds)
    expect(heldEvents[0].performedDurationSeconds).toBeGreaterThan(plainEvents[0].performedDurationSeconds)
  })
})
