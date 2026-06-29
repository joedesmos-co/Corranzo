import { describe, expect, it } from 'vitest'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildMetronomeSchedule,
  buildScoreNoteSchedule,
  displayTempoAtTime,
} from '../src/features/playback/scorePlaybackSchedule.js'
import {
  mapMidiEventsMeasureAligned,
  mapMidiEventsProportional,
  mapMidiEventsToPerformedTimeline,
  MIDI_MAP_METHOD,
} from '../src/features/playback/midiToPerformedMapping.js'
import { ALIGNMENT_ASSESSMENT } from '../src/features/practice/computeAlignmentDiagnostics.js'
import * as F from './helpers/buildXml.js'

function measure(t, n) {
  return t.measures.find((m) => m.number === n)
}

describe('tempo fixture integrity', () => {
  it('repeatWithTempoChange restores 120 BPM in m3 (explicit test-data correction)', () => {
    // m3 includes <sound tempo="120"/> — prior failure was incomplete fixture data.
    // Written m3 starts at 6s; performed m3 (after repeat) starts at 12s.
    const t = parseMusicXml(F.repeatWithTempoChange())
    expect(measure(t, 3).startTimeSeconds).toBeCloseTo(6, 6)
    expect(measure(t, 3).endTimeSeconds - measure(t, 3).startTimeSeconds).toBeCloseTo(2, 6)
    const tl = getTimeline(t)
    expect(tl.performedStartForMeasure(3)).toBeCloseTo(12, 6)
    expect(tl.performedDurationSeconds).toBeCloseTo(14, 6)
  })

  it('tempo persists into following measures when no later restoration exists', () => {
    const t = parseMusicXml(F.repeatWithTempoChangeNoRestore())
    // m2 sets 60 BPM; m3 inherits → 4 quarters at 60 = 4 written seconds
    expect(measure(t, 3).startTimeSeconds).toBeCloseTo(6, 6)
    expect(measure(t, 3).endTimeSeconds).toBeCloseTo(10, 6)
    expect(t.tempoChanges.filter((c) => c.bpm === 60)).toHaveLength(1)
    const tl = getTimeline(t)
    expect(tl.performedStartForMeasure(3)).toBeCloseTo(12, 6)
    expect(tl.performedDurationSeconds).toBeCloseTo(16, 6)
  })

  it('mid-measure tempo from midMeasureTempoChange still persists into m3', () => {
    const t = parseMusicXml(F.midMeasureTempoChange())
    expect(measure(t, 3).startTimeSeconds).toBeCloseTo(5, 6)
    const change = t.tempoChanges.find((c) => c.bpm === 60)
    expect(change?.quarterTime).toBeCloseTo(6, 6)
  })
})

describe('MIDI-to-performed mapping', () => {
  const timingMap = parseMusicXml(F.straight4())
  const midiNotes = [
    { time: 0, duration: 0.5, name: 'C4', velocity: 0.8 },
    { time: 2, duration: 0.5, name: 'E4', velocity: 0.8 },
    { time: 6, duration: 0.5, name: 'G4', velocity: 0.8 },
  ]
  const midiDuration = 8

  it('uses measure-aligned mapping when alignment is not unlikely', () => {
    const result = mapMidiEventsToPerformedTimeline(midiNotes, midiDuration, timingMap, {
      assessment: ALIGNMENT_ASSESSMENT.LIKELY_MATCH,
    })
    expect(result.method).toBe(MIDI_MAP_METHOD.MEASURE_ALIGNED)
    expect(result.events[0].scoreTimeSeconds).toBeCloseTo(0, 6)
    expect(result.events[2].scoreTimeSeconds).toBeCloseTo(6, 6)
  })

  it('falls back to proportional mapping with warning when alignment is unlikely', () => {
    const result = mapMidiEventsToPerformedTimeline(midiNotes, midiDuration, timingMap, {
      assessment: ALIGNMENT_ASSESSMENT.UNLIKELY_MATCH,
    })
    expect(result.method).toBe(MIDI_MAP_METHOD.PROPORTIONAL)
    expect(result.warning).toMatch(/proportional/i)
    expect(result.events[2].scoreTimeSeconds).toBeCloseTo(6, 6)
  })

  it('measure-aligned maps note within measure proportionally', () => {
    const aligned = mapMidiEventsMeasureAligned(midiNotes, midiDuration, timingMap)
    expect(aligned.events[1].scoreTimeSeconds).toBeCloseTo(2, 6)
    expect(aligned.events[1].measureNumber).toBe(2)
  })

  it('proportional mapping is explicitly low confidence', () => {
    const prop = mapMidiEventsProportional(midiNotes, midiDuration, 8)
    expect(prop.confidence).toBe('low')
  })
})

describe('score playback schedule', () => {
  it('builds performed note events', () => {
    const t = parseMusicXml(F.straight4())
    const events = buildScoreNoteSchedule(t)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].baseDurationSeconds).toBeGreaterThan(0)
  })

  it('display tempo scales with playback rate', () => {
    const t = parseMusicXml(F.straight4())
    expect(displayTempoAtTime(t, 0, 1)).toBeCloseTo(120, 6)
    expect(displayTempoAtTime(t, 0, 0.5)).toBeCloseTo(60, 6)
  })

  it('metronome ticks align with performed beats', () => {
    const t = parseMusicXml(F.straight4())
    const clicks = buildMetronomeSchedule(t)
    expect(clicks[0].scoreTimeSeconds).toBe(0)
    expect(clicks[1].scoreTimeSeconds).toBeCloseTo(0.5, 6)
    expect(clicks.filter((c) => c.accent)).toHaveLength(4)
  })

  it('display tempo follows tempo regions during playback', () => {
    const t = parseMusicXml(F.measureStartTempoChange())
    expect(displayTempoAtTime(t, 0, 1)).toBeCloseTo(120, 6)
    expect(displayTempoAtTime(t, 1.9, 1)).toBeCloseTo(120, 6)
    expect(displayTempoAtTime(t, 2, 1)).toBeCloseTo(60, 6)
    expect(displayTempoAtTime(t, 6, 1)).toBeCloseTo(60, 6)
    expect(displayTempoAtTime(t, 2, 0.5)).toBeCloseTo(30, 6)
  })

  it('schedules note onsets at tempo-adjusted times across regions', () => {
    const t = parseMusicXml(F.measureStartTempoChange())
    const events = buildScoreNoteSchedule(t)
    const m2 = events
      .filter((event) => event.measureNumber === 2)
      .map((event) => event.scoreTimeSeconds)
    expect(m2).toEqual([2, 3, 4, 5])
  })

  it('carries MusicXML dynamics velocity into the note schedule', () => {
    const xml = F.scoreWrap(
      `<part id="P1">` +
        `<measure number="1">${F.attributes()}${F.soundTempo(120)}${F.dynamicsDirection('p')}${F.fourQuarters()}</measure>` +
        `</part>`,
    )
    const t = parseMusicXml(xml)
    const softNote = t.notes.find((note) => !note.isRest)
    expect(softNote.velocity).toBeCloseTo(0.46, 6)
    const [event] = buildScoreNoteSchedule(t)
    expect(event.velocity).toBeCloseTo(0.46, 6)
  })

  it('duplicates notes across repeat passes', () => {
    const t = parseMusicXml(F.oneRepeat())
    const events = buildScoreNoteSchedule(t)
    const m1FirstBeats = events.filter(
      (e) => e.measureNumber === 1 && Math.abs(e.scoreTimeSeconds % 4) < 1e-6,
    )
    expect(m1FirstBeats.map((e) => e.repeatPass).sort()).toEqual([1, 2])
  })

  it('shortens playback duration for staccato without changing written timing', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.staccatoNote('C', 4, 1)}${F.note('D', 4, 1)}</measure></part>`,
    )
    const t = parseMusicXml(xml)
    const staccato = t.notes.find((note) => note.label === 'C4')
    const ordinary = t.notes.find((note) => note.label === 'D4')
    expect(staccato.staccato).toBe(true)
    expect(ordinary.staccato).toBe(false)
    expect(staccato.durationSeconds).toBeCloseTo(0.5, 6)
    expect(staccato.timeSeconds).toBe(0)
    expect(ordinary.durationSeconds).toBeCloseTo(0.5, 6)

    const events = buildScoreNoteSchedule(t)
    const staccatoEvent = events.find((event) => event.label === 'C4')
    const ordinaryEvent = events.find((event) => event.label === 'D4')
    expect(staccatoEvent.scoreTimeSeconds).toBe(0)
    expect(staccatoEvent.writtenDurationSeconds).toBeCloseTo(0.5, 6)
    expect(staccatoEvent.baseDurationSeconds).toBeCloseTo(0.25, 6)
    expect(ordinaryEvent.baseDurationSeconds).toBeCloseTo(0.5, 6)

    const performed = getTimeline(t).performedNotes()
    expect(performed.find((note) => note.label === 'C4')?.durationSeconds).toBeCloseTo(0.5, 6)
    expect(performed.find((note) => note.label === 'D4')?.durationSeconds).toBeCloseTo(0.5, 6)
  })

  it('applies staccato playback to OMR-generated MusicXML when articulation is emitted', async () => {
    const { buildOmrMusicXml } = await import('../src/features/omr/buildOmrMusicXml.js')
    const xml = buildOmrMusicXml({
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 60, articulation: { type: 'staccato', confidence: 0.8 } }],
            },
          ],
        },
      ],
      includeDisclaimer: false,
    })
    const t = parseMusicXml(xml, 'staccato.omr.musicxml')
    const note = t.notes.find((entry) => entry.midi === 60)
    expect(note.staccato).toBe(true)
    expect(note.durationSeconds).toBeCloseTo(0.5, 6)
    const [event] = buildScoreNoteSchedule(t)
    expect(event.baseDurationSeconds).toBeCloseTo(0.25, 6)
    expect(event.writtenDurationSeconds).toBeCloseTo(0.5, 6)
  })

  it('boosts playback velocity for accented notes without changing onset or written duration', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.accentNote('C', 4, 1)}${F.note('D', 4, 1)}</measure></part>`,
    )
    const t = parseMusicXml(xml)
    const events = buildScoreNoteSchedule(t)
    const accented = events.find((event) => event.label === 'C4')
    const ordinary = events.find((event) => event.label === 'D4')
    expect(accented?.accent).toBe(true)
    expect(ordinary?.accent).toBe(false)
    expect(accented?.scoreTimeSeconds).toBe(0)
    expect(accented?.writtenDurationSeconds).toBeCloseTo(ordinary?.writtenDurationSeconds, 6)
    expect(accented?.velocity).toBeGreaterThan(ordinary?.velocity)
  })
})
