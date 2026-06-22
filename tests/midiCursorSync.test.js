/**
 * MIDI-backing → score-clock alignment, the Guren cursor-sync fix.
 *
 * Guren desynced because MIDI backing was mapped with an EQUAL-SLICE
 * measure-aligned mapping (every written measure assumed the same duration).
 * Guren changes tempo at m8 (90→180 BPM), so measures after the change are half
 * as long — equal slices placed notes up to ~8s away from where the cursor
 * (driven by the MusicXML timeline) expected them, worst in the fast section.
 *
 * The fix maps each MIDI note by its OWN bar position (tempo/time-signature
 * aware, `measurePosition`) onto the matching performed-timeline entry, so audio
 * note times and cursor positions agree even with unequal measures and repeats.
 *
 * These tests reproduce that structure with synthetic fixtures (no dependency on
 * uploaded files) and prove: correct placement in unequal measures, audio↔cursor
 * agreement, fast-note beat positions, repeat safety, and that constant-tempo
 * pieces (Gymnopédie-style) are unchanged.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import { getMeasureAtTime, getBeatAtTime } from '../src/features/musicxml/timingQuery.js'
import {
  mapMidiEventsMeasureAligned,
  mapMidiEventsToPerformedTimeline,
  MIDI_MAP_METHOD,
} from '../src/features/playback/midiToPerformedMapping.js'
import { ALIGNMENT_ASSESSMENT } from '../src/features/practice/computeAlignmentDiagnostics.js'
import * as F from './helpers/buildXml.js'

/** A MIDI note carrying its bar-grid position (what the fix relies on). */
function midiNote(measurePosition, time, { name = 'C4', duration = 0.25, velocity = 0.8 } = {}) {
  return { measurePosition, time, name, duration, velocity }
}

// ─── tempo-change piece: unequal measure durations ────────────────────────────

describe('MIDI bar-grid mapping (tempo change → unequal measures)', () => {
  // m1 @120 (2s), m2 & m3 @60 (4s each): the Guren-style unequal-measure case.
  const timingMap = parseMusicXml(F.measureStartTempoChange())
  const total = getTimeline(timingMap).performedDurationSeconds

  it('the fixture really has unequal measure durations', () => {
    const dur = (m) => m.endTimeSeconds - m.startTimeSeconds
    expect(dur(timingMap.measures[1])).toBeGreaterThan(dur(timingMap.measures[0]) + 0.5)
  })

  it('places notes by bar position, honoring each measure’s real duration', () => {
    const notes = [
      midiNote(0.5, 1.0), // halfway through m1  → 1.0s
      midiNote(1.0, 2.0), // downbeat of m2      → 2.0s
      midiNote(1.5, 4.0), // halfway through m2  → 4.0s
      midiNote(2.0, 6.0), // downbeat of m3      → 6.0s
    ]
    const { events, method } = mapMidiEventsMeasureAligned(notes, total, timingMap)

    expect(method).toBe(MIDI_MAP_METHOD.MEASURE_ALIGNED)
    expect(events[0].scoreTimeSeconds).toBeCloseTo(1.0, 6)
    expect(events[1].scoreTimeSeconds).toBeCloseTo(2.0, 6)
    expect(events[1].measureNumber).toBe(2)
    expect(events[2].scoreTimeSeconds).toBeCloseTo(4.0, 6)
    expect(events[3].scoreTimeSeconds).toBeCloseTo(6.0, 6)
    expect(events[3].measureNumber).toBe(3)
  })

  it('the old equal-slice path (no bar grid) mis-times the same note — regression guard', () => {
    // A note truly on the m2 downbeat (real time 2.0s). Equal slices (total/3 ≈
    // 3.33s) wrongly place it well away from 2.0s.
    const noPos = [{ time: 2.0, duration: 0.25, name: 'C4', velocity: 0.8 }]
    const { events } = mapMidiEventsMeasureAligned(noPos, total, timingMap)
    expect(Math.abs(events[0].scoreTimeSeconds - 2.0)).toBeGreaterThan(0.4)
  })

  it('audio score-time and cursor measure agree for every note', () => {
    const notes = [
      midiNote(0.0, 0.0),
      midiNote(0.5, 1.0),
      midiNote(1.0, 2.0),
      midiNote(1.5, 4.0),
      midiNote(1.75, 5.0),
      midiNote(2.0, 6.0),
      midiNote(2.5, 8.0),
    ]
    const { events } = mapMidiEventsMeasureAligned(notes, total, timingMap)
    for (const ev of events) {
      // The measure the cursor shows at the audio's score-time must equal the
      // measure the note was assigned to.
      const cursorMeasure = getMeasureAtTime(timingMap, ev.scoreTimeSeconds + 1e-3)
      expect(cursorMeasure.number).toBe(ev.measureNumber)
    }
  })

  it('fast-note grid inside one measure → monotonic, in-window score-times on correct beats', () => {
    // 8 sixteenth positions across m2 [2,6): 1.0, 1.125, … 1.875.
    const positions = [1.0, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875]
    const notes = positions.map((p) => midiNote(p, 2 + (p - 1) * 4))
    const { events } = mapMidiEventsMeasureAligned(notes, total, timingMap)
    const times = events.map((e) => e.scoreTimeSeconds)

    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1]) // strictly forward
    }
    for (const ev of events) {
      expect(ev.scoreTimeSeconds).toBeGreaterThanOrEqual(2)
      expect(ev.scoreTimeSeconds).toBeLessThan(6)
      expect(ev.measureNumber).toBe(2)
      expect(getMeasureAtTime(timingMap, ev.scoreTimeSeconds + 1e-3).number).toBe(2)
    }
    // Halfway through m2 is exactly its time-midpoint (4.0s) and lands on beat 3.
    expect(events[4].scoreTimeSeconds).toBeCloseTo(4.0, 6)
    expect(getBeatAtTime(timingMap, 4.0).beat).toBe(3)
  })

  it('mapMidiEventsToPerformedTimeline uses the bar grid for a likely match', () => {
    const notes = [midiNote(1.0, 2.0), midiNote(2.0, 6.0)]
    const mapped = mapMidiEventsToPerformedTimeline(notes, total, timingMap, {
      assessment: ALIGNMENT_ASSESSMENT.LIKELY_MATCH,
    })
    expect(mapped.method).toBe(MIDI_MAP_METHOD.MEASURE_ALIGNED)
    expect(mapped.events[0].scoreTimeSeconds).toBeCloseTo(2.0, 6)
    expect(mapped.events[1].scoreTimeSeconds).toBeCloseTo(6.0, 6)
  })
})

// ─── repeats: written-measure mapping must not desync ──────────────────────────

describe('MIDI bar-grid mapping across repeats', () => {
  const timingMap = parseMusicXml(F.oneRepeat()) // performed 1,2,1,2,3,4
  const tl = getTimeline(timingMap)

  it('expands to six performed entries', () => {
    expect(tl.entries.length).toBe(6)
  })

  it('a note in the 2nd pass of m1 maps to written m1 at the repeated performed time', () => {
    const secondPassM1 = tl.entries[2] // 3rd played bar = 2nd occurrence of m1
    expect(secondPassM1.writtenMeasureNumber).toBe(1)

    const notes = [midiNote(2.0, secondPassM1.startTimeSeconds)]
    const { events } = mapMidiEventsMeasureAligned(notes, tl.performedDurationSeconds, timingMap)

    expect(events[0].measureNumber).toBe(1) // written measure, not the 3rd
    expect(events[0].scoreTimeSeconds).toBeCloseTo(secondPassM1.startTimeSeconds, 6)
    // Cursor at that performed time is also written m1 → no desync.
    expect(getMeasureAtTime(timingMap, events[0].scoreTimeSeconds + 1e-3).number).toBe(1)
  })

  it('every played bar maps to the matching performed entry', () => {
    const notes = tl.entries.map((entry, idx) => midiNote(idx + 0.0, entry.startTimeSeconds))
    const { events } = mapMidiEventsMeasureAligned(notes, tl.performedDurationSeconds, timingMap)
    events.forEach((ev, idx) => {
      expect(ev.scoreTimeSeconds).toBeCloseTo(tl.entries[idx].startTimeSeconds, 6)
      expect(ev.measureNumber).toBe(tl.entries[idx].writtenMeasureNumber)
    })
  })
})

// ─── constant tempo: Gymnopédie-style pieces are unaffected ────────────────────

describe('MIDI mapping leaves constant-tempo pieces unchanged (Gymnopédie regression)', () => {
  const timingMap = parseMusicXml(F.straight4()) // 4 equal 2s measures @120

  it('bar-grid and legacy equal-slice agree when measures are equal', () => {
    const withPos = [midiNote(0, 0), midiNote(1, 2), midiNote(2, 4), midiNote(3, 6)]
    const noPos = withPos.map((n) => ({
      time: n.time,
      duration: n.duration,
      name: n.name,
      velocity: n.velocity,
    }))

    const a = mapMidiEventsMeasureAligned(withPos, 8, timingMap).events.map((e) => e.scoreTimeSeconds)
    const b = mapMidiEventsMeasureAligned(noPos, 8, timingMap).events.map((e) => e.scoreTimeSeconds)

    expect(a).toEqual([0, 2, 4, 6])
    expect(a).toEqual(b) // the fix is a no-op for equal-duration measures
  })

  it('mid-measure notes still land proportionally and agree with the cursor', () => {
    const notes = [midiNote(0.5, 1.0), midiNote(1.25, 2.5), midiNote(3.75, 7.5)]
    const { events } = mapMidiEventsMeasureAligned(notes, 8, timingMap)
    expect(events[0].scoreTimeSeconds).toBeCloseTo(1.0, 6)
    expect(events[1].scoreTimeSeconds).toBeCloseTo(2.5, 6)
    expect(events[2].scoreTimeSeconds).toBeCloseTo(7.5, 6)
    for (const ev of events) {
      expect(getMeasureAtTime(timingMap, ev.scoreTimeSeconds + 1e-3).number).toBe(ev.measureNumber)
    }
  })
})
