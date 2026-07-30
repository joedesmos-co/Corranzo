import { describe, expect, it } from 'vitest'
import { packJointPolyphonicRhythm } from '../src/features/omr/jointPolyphonicRhythm.js'

function noteEvent({
  x,
  start = 0,
  duration = 1,
  clef = 'treble',
  direction,
  midis = [60],
  noteheadGlyph = 'black',
  beams = 0,
  dotted = false,
}) {
  return {
    type: 'note',
    cx: x,
    startDivision: start,
    durationDivisions: duration,
    notes: midis.map((midi) => ({
      cx: x,
      midi,
      naturalMidi: midi,
      clef,
      confidence: 0.92,
      stemDirection: direction,
      stem: direction ? { direction } : null,
      noteheadGlyph,
      hollowGlyph: noteheadGlyph === 'half' || noteheadGlyph === 'whole',
      beams,
      dotted,
      durationDivisions:
        dotted ? duration : beams >= 2 ? 1 : beams === 1 ? 2 : duration,
    })),
  }
}

function restEvent({ x, start, duration, direction = 'down' }) {
  return {
    type: 'rest',
    cx: x,
    clef: 'treble',
    rhythmVoice: direction,
    startDivision: start,
    durationDivisions: duration,
    durationType: duration === 2 ? 'eighth' : 'quarter',
  }
}

function lane(result, direction) {
  return result.events
    .filter((event) => event.rhythmVoiceKey === `treble:${direction}`)
    .sort((left, right) => left.startDivision - right.startDivision)
}

describe('joint polyphonic rhythm packing geometry', () => {
  it('packs two half notes independently from four quarter notes', () => {
    const result = packJointPolyphonicRhythm(
      [
        ...[10, 40, 70, 100].map((x, index) =>
          noteEvent({ x, start: index * 3, duration: 3, direction: 'up', midis: [72 + index] }),
        ),
        ...[10, 70].map((x, index) =>
          noteEvent({
            x,
            start: index * 7,
            duration: 3,
            direction: 'down',
            midis: [48 + index],
            noteheadGlyph: 'half',
          }),
        ),
      ],
      { totalDivisions: 16 },
    )

    expect(result.applied).toBe(true)
    expect(lane(result, 'up').map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 4],
    ])
    expect(lane(result, 'down').map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 8],
      [8, 8],
    ])
  })

  it('preserves a whole note while an opposing voice moves in eighths', () => {
    const result = packJointPolyphonicRhythm(
      [
        noteEvent({
          x: 10,
          start: 2,
          duration: 4,
          direction: 'down',
          midis: [48],
          noteheadGlyph: 'whole',
        }),
        ...Array.from({ length: 8 }, (_, index) =>
          noteEvent({
            x: 10 + index * 15,
            start: 1 + index,
            duration: 1,
            direction: 'up',
            midis: [72 + (index % 3)],
            beams: 1,
          }),
        ),
      ],
      { totalDivisions: 16 },
    )

    expect(result.applied).toBe(true)
    expect(lane(result, 'down').map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 16],
    ])
    expect(lane(result, 'up').map((event) => [event.startDivision, event.durationDivisions])).toEqual(
      Array.from({ length: 8 }, (_, index) => [index * 2, 2]),
    )
  })

  it('keeps explicit rests in one voice while the other voice plays', () => {
    const result = packJointPolyphonicRhythm(
      [
        ...[10, 40, 70, 100].map((x, index) =>
          noteEvent({ x, start: index * 3, duration: 3, direction: 'up', midis: [72 + index] }),
        ),
        restEvent({ x: 10, start: 1, duration: 4 }),
        ...[40, 70, 100].map((x, index) =>
          noteEvent({
            x,
            start: 4 + index * 3,
            duration: 3,
            direction: 'down',
            midis: [52 + index],
          }),
        ),
      ],
      { totalDivisions: 16 },
    )

    expect(result.applied).toBe(true)
    const lower = lane(result, 'down')
    expect(lower.map((event) => event.type)).toEqual(['rest', 'note', 'note', 'note'])
    expect(lower.map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 4],
    ])
  })

  it('splits opposing stems at the same onset into independent lanes', () => {
    const shared = noteEvent({
      x: 10,
      start: 2,
      duration: 2,
      direction: 'up',
      midis: [72],
    })
    shared.notes.push(
      noteEvent({
        x: 10,
        direction: 'down',
        duration: 8,
        midis: [48],
        noteheadGlyph: 'half',
      }).notes[0],
    )
    const result = packJointPolyphonicRhythm(
      [
        shared,
        noteEvent({ x: 40, start: 5, duration: 2, direction: 'up', midis: [74] }),
        noteEvent({ x: 70, start: 8, duration: 2, direction: 'up', midis: [76] }),
        noteEvent({
          x: 70,
          start: 8,
          duration: 4,
          direction: 'down',
          midis: [50],
          noteheadGlyph: 'half',
        }),
        noteEvent({ x: 100, start: 11, duration: 2, direction: 'up', midis: [77] }),
      ],
      { totalDivisions: 16 },
    )

    expect(result.applied).toBe(true)
    expect(lane(result, 'up')[0].notes.map((note) => note.midi)).toEqual([72])
    expect(lane(result, 'down')[0].notes.map((note) => note.midi)).toEqual([48])
    expect(lane(result, 'up')[0].startDivision).toBe(0)
    expect(lane(result, 'down')[0].startDivision).toBe(0)
  })

  it('packs a beamed upper voice over a sustained lower voice', () => {
    const result = packJointPolyphonicRhythm(
      [
        ...Array.from({ length: 8 }, (_, index) =>
          noteEvent({
            x: 10 + index * 15,
            start: 2 + index,
            duration: 1,
            direction: 'up',
            midis: [72 + (index % 4)],
            beams: 1,
          }),
        ),
        ...[10, 70].map((x, index) =>
          noteEvent({
            x,
            start: index * 6,
            duration: 4,
            direction: 'down',
            midis: [48 + index],
            noteheadGlyph: 'half',
          }),
        ),
      ],
      { totalDivisions: 16 },
    )

    expect(lane(result, 'up').every((event) => event.durationDivisions === 2)).toBe(true)
    expect(lane(result, 'down').every((event) => event.durationDivisions === 8)).toBe(true)
  })

  it('packs two moving chord voices without merging them', () => {
    const result = packJointPolyphonicRhythm(
      [
        ...[10, 40, 70, 100].map((x, index) =>
          noteEvent({
            x,
            start: index * 3,
            duration: 3,
            direction: 'up',
            midis: [72 + index, 76 + index],
          }),
        ),
        ...[10, 70].map((x, index) =>
          noteEvent({
            x,
            start: index * 7,
            duration: 3,
            direction: 'down',
            midis: [48 + index, 55 + index],
            noteheadGlyph: 'half',
          }),
        ),
      ],
      { totalDivisions: 16 },
    )

    expect(result.applied).toBe(true)
    expect(result.events).toHaveLength(6)
    expect(result.events.every((event) => event.notes.length === 2)).toBe(true)
    expect(lane(result, 'up')).toHaveLength(4)
    expect(lane(result, 'down')).toHaveLength(2)
  })

  it('honors a dotted sustained voice against shorter counter-voice events', () => {
    const result = packJointPolyphonicRhythm(
      [
        ...[10, 40, 70, 100].map((x, index) =>
          noteEvent({ x, start: index * 3, duration: 3, direction: 'up', midis: [72 + index] }),
        ),
        noteEvent({
          x: 10,
          start: 1,
          duration: 12,
          direction: 'down',
          midis: [48],
          noteheadGlyph: 'half',
          dotted: true,
        }),
        noteEvent({ x: 100, start: 13, duration: 4, direction: 'down', midis: [50] }),
      ],
      { totalDivisions: 16 },
    )

    expect(lane(result, 'down').map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 12],
      [12, 4],
    ])
  })

  it('keeps every tone of a chord in one event', () => {
    const result = packJointPolyphonicRhythm(
      [
        ...[10, 40, 70, 100].flatMap((x, index) =>
          [60 + index, 64 + index, 67 + index].map((midi, toneIndex) =>
            noteEvent({
              x,
              start: index * 3 + toneIndex,
              duration: 3,
              direction: 'up',
              midis: [midi],
            }),
          ),
        ),
        ...[10, 70].map((x, index) =>
          noteEvent({
            x,
            start: index * 7,
            duration: 3,
            direction: 'down',
            midis: [43 + index],
            noteheadGlyph: 'half',
          }),
        ),
      ],
      { totalDivisions: 16 },
    )

    expect(lane(result, 'up').map((event) => event.notes.length)).toEqual([3, 3, 3, 3])
  })

  it('rejects ambiguous opposing stems without continuity', () => {
    const events = [
      noteEvent({ x: 10, start: 2, duration: 5, direction: 'up', midis: [72] }),
      noteEvent({ x: 12, start: 2, duration: 5, direction: 'down', midis: [48] }),
    ]
    const result = packJointPolyphonicRhythm(events, { totalDivisions: 16 })

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('ambiguous-voice-assignment')
    expect(result.events).toEqual(events)
  })

  it('rejects overflow evidence instead of destructive dense snapping', () => {
    const events = [
      noteEvent({ x: 10, start: 0, duration: 4, clef: 'treble', direction: 'up' }),
      noteEvent({ x: 40, start: 17, duration: 4, clef: 'treble', direction: 'up' }),
      noteEvent({
        x: 10,
        start: 0,
        duration: 8,
        clef: 'bass',
        direction: 'down',
        noteheadGlyph: 'half',
      }),
      noteEvent({
        x: 40,
        start: 8,
        duration: 8,
        clef: 'bass',
        direction: 'down',
        noteheadGlyph: 'half',
      }),
    ]
    const result = packJointPolyphonicRhythm(events, { totalDivisions: 16 })

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('event-outside-meter')
    expect(result.events).toEqual(events)
  })
})
