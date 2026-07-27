import { describe, expect, it } from 'vitest'
import {
  detectRepeatBarline,
  detectVoltaEnding,
  finalizeEndingStops,
  shouldEmitEnding,
  shouldEmitRepeat,
} from '../src/features/omr/detectOmrRepeatBarline.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { musicalPianoPage } from './helpers/syntheticScore.js'
import * as F from './helpers/buildXml.js'

function blankPage(width = 120, height = 80) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { width, height, data }
}

function inkRect(img, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * img.width + x) * 4
      img.data[i] = 0
      img.data[i + 1] = 0
      img.data[i + 2] = 0
    }
  }
}

describe('interpretation sprint 1 — repeats and endings', () => {
  it('detects a synthetic backward repeat and ignores ordinary double bars', () => {
    const page = musicalPianoPage()
    const band = page.systemBands[0]
    const x0 = Math.floor(page.width * 0.08)
    const x1 = Math.floor(page.width * 0.92)
    const measureWidth = (x1 - x0) / 3
    const barX = Math.floor(x0 + measureWidth * 2) - 2

    const backward = detectRepeatBarline(
      page,
      {
        x0: (barX - 24) / page.width,
        x1: barX / page.width,
        y0: band.top / page.height,
        y1: band.bottom / page.height,
      },
      170,
      'right',
    )
    expect(backward?.backwardRepeat).toBe(true)
    expect(shouldEmitRepeat(backward)).toBe(true)

    // Ordinary double bar without colon dots must not be a repeat.
    const plain = blankPage(200, 120)
    inkRect(plain, 150, 20, 151, 100)
    inkRect(plain, 156, 20, 159, 100)
    const noRepeat = detectRepeatBarline(
      plain,
      { x0: 0.6, x1: 0.8, y0: 0.1, y1: 0.9 },
      170,
      'right',
    )
    expect(noRepeat).toBeNull()
  })

  it('does not treat articulation-like dots alone as a repeat colon', () => {
    const page = blankPage(200, 120)
    // Single thick bar + one articulation blob (not a colon pair).
    inkRect(page, 150, 20, 152, 100)
    inkRect(page, 156, 20, 158, 100)
    inkRect(page, 140, 48, 142, 50)
    const marking = detectRepeatBarline(
      page,
      { x0: 0.55, x1: 0.8, y0: 0.1, y1: 0.9 },
      170,
      'right',
    )
    expect(marking).toBeNull()
  })

  it('binds volta labels from PDF text and finalizes ending stops', () => {
    const imageData = { width: 1000, height: 1000, data: new Uint8ClampedArray(1000 * 1000 * 4) }
    const pageText = [
      {
        text: '1.',
        x: 320,
        y: 620,
        width: 8,
        height: 10,
        pageWidth: 1000,
        pageHeight: 1000,
      },
      {
        text: '2.',
        x: 520,
        y: 620,
        width: 8,
        height: 10,
        pageWidth: 1000,
        pageHeight: 1000,
      },
    ]
    const m7 = detectVoltaEnding(
      imageData,
      { x0: 0.3, x1: 0.5, y0: 0.38, y1: 0.55 },
      170,
      pageText,
    )
    const m8 = detectVoltaEnding(
      imageData,
      { x0: 0.5, x1: 0.7, y0: 0.38, y1: 0.55 },
      170,
      pageText,
    )
    expect(m7?.endingStartNumbers).toEqual([1])
    expect(m8?.endingStartNumbers).toEqual([2])
    expect(shouldEmitEnding(m7)).toBe(true)

    const records = [
      { endingMarking: { ...m7 } },
      { endingMarking: { ...m8 } },
    ]
    finalizeEndingStops(records)
    expect(records[0].endingMarking.endingStop).toBe(true)
    expect(records[1].endingMarking.endingStop).toBe(true)
  })

  it('emits written repeat/ending MusicXML without rewriting note pitches', () => {
    const xml = buildOmrMusicXml({
      measures: [
        {
          measureNumber: 1,
          repeatMarking: { forwardRepeat: true, confidence: 0.84 },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 60 }],
            },
          ],
        },
        {
          measureNumber: 2,
          endingMarking: {
            endingStartNumbers: [1],
            endingStop: true,
            confidence: 0.88,
          },
          repeatMarking: { backwardRepeat: true, confidence: 0.84 },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 62 }],
            },
          ],
        },
        {
          measureNumber: 3,
          endingMarking: {
            endingStartNumbers: [2],
            endingStop: true,
            confidence: 0.88,
          },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 64 }],
            },
          ],
        },
      ],
    })
    expect(xml).toContain('repeat direction="forward"')
    expect(xml).toContain('repeat direction="backward"')
    expect(xml).toContain('ending number="1" type="start"')
    expect(xml).toContain('ending number="1" type="stop"')
    expect(xml).toContain('<step>C</step>')
    expect(xml).toContain('<octave>4</octave>')

    const timing = parseMusicXml(xml)
    expect(
      timing.performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber).join(','),
    ).toBe('1,2,1,3')
  })

  it('expands simple, implicit-begin, four-bar, volta, and pickup fixtures', () => {
    expect(
      parseMusicXml(F.oneRepeat())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,1,2,3,4')

    expect(
      parseMusicXml(F.repeatToBeginning())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,1,2,3')

    expect(
      parseMusicXml(F.twoRepeatSections())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,1,2,3,4,3,4')

    expect(
      parseMusicXml(F.singleMeasureVoltas())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,1,3,4')

    expect(
      parseMusicXml(F.voltaBackwardOnSecondEnding())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,3,1,2,4,5')

    expect(
      parseMusicXml(F.pickupThenRepeat())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,3,2,3,4')
  })

  it('fails safely on malformed repeat graphs without infinite loops', () => {
    const tl = parseMusicXml(F.malformedRepeats()).performedMeasureTimeline
    expect(tl.entries.length).toBeLessThan(4 * 40)
    expect(tl.diagnostics.fullyInterpreted).toBe(false)
  })
})
