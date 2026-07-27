/**
 * Digit-gated 3:2 tuplet recovery tests.
 */
import { describe, expect, it } from 'vitest'
import {
  collectTupletDigitThrees,
  recoverDigitGatedTripletEvents,
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

  it('emits time-modification in MusicXML', () => {
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
    const timing = parseMusicXml(xml, 'triplet-test.musicxml')
    expect(timing.measures.length).toBeGreaterThan(0)
  })
})
