/**
 * Digit-gated 3:2 tuplet recovery tests — full-bar and local groups.
 */
import { describe, expect, it } from 'vitest'
import {
  collectTupletDigitThrees,
  recoverDigitGatedTripletEvents,
  recoverLocalDigitGatedTripletGroups,
  recoverVectorTupletEvents,
} from '../src/features/omr/recoverDigitGatedTriplets.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

describe('recoverDigitGatedTripletEvents', () => {
  const measureBox = { x0: 0.1, x1: 0.9, y0: 0.2, y1: 0.5, measureNumber: 3 }
  const imageData = { width: 1000, height: 1000 }

  function twelveEighthEvents() {
    return Array.from({ length: 12 }, (_, index) => ({
      type: 'note',
      startDivision: index,
      durationDivisions: 1,
      durationType: 'sixteenth',
      cx: 200 + index * 40,
      notes: [{ midi: 60 + (index % 3), cx: 200 + index * 40, cy: 400, clef: 'treble' }],
    }))
  }

  it('recovers 3:2 when digit threes and equal columns are present', () => {
    const glyphs = [0, 1, 2, 3].map((beat) => ({
      text: '3',
      x: 220 + beat * 120,
      y: 360,
    }))
    const result = recoverDigitGatedTripletEvents(twelveEighthEvents(), {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(true)
    expect(result.events.filter((e) => e.type === 'note')).toHaveLength(12)
    expect(result.events[0].timeModification).toMatchObject({
      actualNotes: 3,
      normalNotes: 2,
    })
    expect(result.events[0].durationType).toBe('eighth')
  })

  it('abstains without tuplet digits', () => {
    const result = recoverDigitGatedTripletEvents(twelveEighthEvents(), {
      glyphs: [],
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(false)
    expect(result.reason).toBe('insufficient-digits')
  })

  it('ignores measure-number threes far above the staff', () => {
    const glyphs = [{ text: '3', x: 250, y: 120 }]
    expect(
      collectTupletDigitThrees(glyphs, measureBox, imageData, twelveEighthEvents()),
    ).toHaveLength(0)
  })

  it('accepts digits below the note cluster', () => {
    const glyphs = [{ text: '3', x: 250, y: 480 }]
    expect(
      collectTupletDigitThrees(glyphs, measureBox, imageData, twelveEighthEvents()),
    ).toHaveLength(1)
  })

  it('rejects left-margin digits', () => {
    const glyphs = [{ text: '3', x: 40, y: 360 }]
    expect(
      collectTupletDigitThrees(glyphs, measureBox, imageData, twelveEighthEvents()),
    ).toHaveLength(0)
  })

  it('emits time-modification and balanced tuplet start/stop in MusicXML', () => {
    const glyphs = [0, 1, 2, 3].map((beat) => ({
      text: '3',
      x: 220 + beat * 120,
      y: 360,
    }))
    const recovered = recoverDigitGatedTripletEvents(twelveEighthEvents(), {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    const xml = buildOmrMusicXml({
      title: 'triplet-test',
      measures: [
        {
          measureNumber: 1,
          events: recovered.events,
          keySignature: { fifths: 0 },
          timeSignature: { beats: 4, beatType: 4 },
        },
      ],
    })
    expect(xml).toContain('<time-modification>')
    expect(xml).toContain('<actual-notes>3</actual-notes>')
    expect(xml).toContain('<normal-notes>2</normal-notes>')
    expect(xml).toContain('<tuplet type="start"/>')
    expect(xml).toContain('<tuplet type="stop"/>')
    const starts = (xml.match(/<tuplet type="start"\/>/g) || []).length
    const stops = (xml.match(/<tuplet type="stop"\/>/g) || []).length
    expect(starts).toBe(stops)
    expect(starts).toBeGreaterThan(0)
    const timing = parseMusicXml(xml, 'triplet-test.musicxml')
    expect(timing.measures.length).toBeGreaterThan(0)
  })
})

describe('recoverLocalDigitGatedTripletGroups', () => {
  const measureBox = { x0: 0.05, x1: 0.95, y0: 0.2, y1: 0.6, measureNumber: 5 }
  const imageData = { width: 1000, height: 1000 }

  function mixedMeasureWithLocalTriplet() {
    // Ordinary eighths, then three local eighths under a "3", then more notes.
    const events = []
    // beat 0-1 ordinary
    for (let i = 0; i < 2; i += 1) {
      events.push({
        type: 'note',
        startDivision: i * 2,
        durationDivisions: 2,
        durationType: 'eighth',
        cx: 150 + i * 40,
        notes: [{ midi: 64, cx: 150 + i * 40, cy: 400, clef: 'treble' }],
      })
    }
    // local triplet columns near x=320
    for (let i = 0; i < 3; i += 1) {
      events.push({
        type: 'note',
        startDivision: 4 + i,
        durationDivisions: 2,
        durationType: 'eighth',
        cx: 300 + i * 30,
        notes: [{ midi: 67 - i, cx: 300 + i * 30, cy: 400, clef: 'treble' }],
      })
    }
    // trailing
    events.push({
      type: 'note',
      startDivision: 10,
      durationDivisions: 4,
      durationType: 'quarter',
      cx: 450,
      notes: [{ midi: 60, cx: 450, cy: 400, clef: 'treble' }],
    })
    return events
  }

  it('recovers three eighths in the time of two from a local digit', () => {
    const glyphs = [{ text: '3', x: 330, y: 360 }]
    const result = recoverLocalDigitGatedTripletGroups(mixedMeasureWithLocalTriplet(), {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(true)
    expect(result.groups).toBe(1)
    const tupleted = result.events.filter((e) => e.timeModification)
    expect(tupleted).toHaveLength(3)
    expect(tupleted[0].timeModification).toMatchObject({
      actualNotes: 3,
      normalNotes: 2,
      tupletStart: true,
    })
    expect(tupleted[2].timeModification.tupletStop).toBe(true)
    const span = tupleted.reduce((s, e) => s + e.durationDivisions, 0)
    expect(span).toBeCloseTo(4, 5)
  })

  it('recovers a bracketed triplet below the staff', () => {
    const events = [0, 1, 2].map((i) => ({
      type: 'note',
      startDivision: i * 2,
      durationDivisions: 2,
      durationType: 'eighth',
      cx: 400 + i * 28,
      notes: [{ midi: 48, cx: 400 + i * 28, cy: 520, clef: 'bass' }],
    }))
    const glyphs = [{ text: '3', x: 428, y: 580 }]
    const result = recoverLocalDigitGatedTripletGroups(events, {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(true)
    expect(result.events.every((e) => e.timeModification?.actualNotes === 3)).toBe(true)
  })

  it('recovers quarter+eighth written as 3:2', () => {
    const events = [
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        durationType: 'quarter',
        cx: 500,
        notes: [{ midi: 72, cx: 500, cy: 380, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 12,
        durationDivisions: 2,
        durationType: 'eighth',
        cx: 540,
        notes: [{ midi: 74, cx: 540, cy: 380, clef: 'treble' }],
      },
    ]
    const glyphs = [{ text: '3', x: 520, y: 340 }]
    const result = recoverLocalDigitGatedTripletGroups(events, {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(true)
    const tupleted = result.events.filter((e) => e.timeModification)
    expect(tupleted).toHaveLength(2)
    expect(tupleted[0].durationType).toBe('quarter')
    expect(tupleted[1].durationType).toBe('eighth')
    expect(tupleted.reduce((s, e) => s + e.durationDivisions, 0)).toBeCloseTo(4, 5)
  })

  it('keeps a second voice without a digit ordinary', () => {
    const events = [
      ...[0, 1, 2].map((i) => ({
        type: 'note',
        startDivision: i * 2,
        durationDivisions: 2,
        durationType: 'eighth',
        cx: 300 + i * 30,
        notes: [{ midi: 67, cx: 300 + i * 30, cy: 400, clef: 'treble' }],
      })),
      ...[0, 1, 2].map((i) => ({
        type: 'note',
        startDivision: i * 2,
        durationDivisions: 2,
        durationType: 'eighth',
        cx: 300 + i * 30,
        notes: [{ midi: 48, cx: 300 + i * 30, cy: 560, clef: 'bass' }],
      })),
    ]
    const glyphs = [{ text: '3', x: 330, y: 360 }]
    const result = recoverLocalDigitGatedTripletGroups(events, {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(true)
    const bass = result.events.filter((e) => e.notes?.[0]?.clef === 'bass')
    expect(bass.every((e) => !e.timeModification)).toBe(true)
    const treble = result.events.filter((e) => e.notes?.[0]?.clef === 'treble')
    expect(treble.every((e) => e.timeModification)).toBe(true)
  })

  it('abstains on ambiguous bracket-less digit far from equal group', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        durationType: 'quarter',
        cx: 200,
        notes: [{ midi: 60, cx: 200, cy: 400, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        durationType: 'quarter',
        cx: 500,
        notes: [{ midi: 62, cx: 500, cy: 400, clef: 'treble' }],
      },
    ]
    const glyphs = [{ text: '3', x: 350, y: 360 }]
    const result = recoverLocalDigitGatedTripletGroups(events, {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(false)
  })

  it('rejects fingering-like digits coplanar with noteheads', () => {
    const events = [0, 1, 2].map((i) => ({
      type: 'note',
      startDivision: i * 2,
      durationDivisions: 2,
      durationType: 'eighth',
      cx: 300 + i * 30,
      notes: [{ midi: 64, cx: 300 + i * 30, cy: 400, clef: 'treble' }],
    }))
    const glyphs = [{ text: '3', x: 330, y: 405 }]
    const result = recoverLocalDigitGatedTripletGroups(events, {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(false)
  })
})

describe('recoverVectorTupletEvents', () => {
  it('falls back to local when full-bar abstains', () => {
    const measureBox = { x0: 0.05, x1: 0.95, y0: 0.2, y1: 0.6 }
    const imageData = { width: 1000, height: 1000 }
    const events = [0, 1, 2].map((i) => ({
      type: 'note',
      startDivision: i * 2,
      durationDivisions: 2,
      durationType: 'eighth',
      cx: 300 + i * 30,
      notes: [{ midi: 64, cx: 300 + i * 30, cy: 400, clef: 'treble' }],
    }))
    const glyphs = [{ text: '3', x: 330, y: 360 }]
    const result = recoverVectorTupletEvents(events, {
      glyphs,
      measureBox,
      imageData,
      beats: 4,
      totalDivisions: 16,
    })
    expect(result.recovered).toBe(true)
    expect(result.mode).toBe('local')
  })
})
