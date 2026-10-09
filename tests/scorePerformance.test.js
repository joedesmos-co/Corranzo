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
  it('performs strum/hammer/pull/mute/let-ring, recognizes bends/slides/vibrato only', () => {
    const { performed, recognizedOnly } = splitPerformedTechniques([
      { kind: 'hammer-on' },
      { kind: 'bend' },
      { kind: 'slide' },
      { kind: 'vibrato' },
      'pull-off',
      'muted',
    ])
    expect(performed).toEqual(['hammer-on', 'pull-off', 'muted'])
    expect(recognizedOnly).toEqual(['bend', 'slide', 'vibrato'])
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
      timingNote({ guitarTechniques: [{ kind: 'hammer-on' }, { kind: 'bend' }] }),
    ]))
    expect(event.techniques).toEqual(['hammer-on', 'bend'])
    expect(event.performedTechniques).toEqual(['hammer-on'])
    expect(event.recognizedOnlyTechniques).toEqual(['bend'])
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
})
