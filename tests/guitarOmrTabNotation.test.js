import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildTabMeasureEvents,
  classifySystemStaves,
  extractTabDigitNotes,
  systemsContainTablature,
} from '../src/features/omr/detectTabNotation.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { getInstrument } from '../src/features/instruments/instruments.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../src/features/omr/omrDiagnosticFlags.js'

function makeWhitePage(width = 1000, height = 700) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  return { width, height, data }
}

function setInk(page, x, y) {
  if (x < 0 || y < 0 || x >= page.width || y >= page.height) {
    return
  }
  const index = (Math.round(y) * page.width + Math.round(x)) * 4
  page.data[index] = 24
  page.data[index + 1] = 24
  page.data[index + 2] = 24
}

function drawHorizontal(page, y, x0, x1) {
  for (let x = x0; x <= x1; x += 1) {
    setInk(page, x, y)
  }
}

function drawVertical(page, x, y0, y1) {
  for (let y = y0; y <= y1; y += 1) {
    setInk(page, x, y)
  }
}

function drawStaff(page, top, lineCount, { x0 = 100, x1 = 900, gap = 10 } = {}) {
  for (let line = 0; line < lineCount; line += 1) {
    drawHorizontal(page, top + line * gap, x0, x1)
  }
  return { top, bottom: top + (lineCount - 1) * gap }
}

describe('guitar OMR tablature detection', () => {
  beforeAll(() => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
  })

  it('uses raw six-line staff positions for TAB even when pitch lineYs are five-line', () => {
    const detectedLineYs = [0.2, 0.28, 0.36, 0.44, 0.52, 0.6]
    const system = {
      lineCount: 6,
      detectedLineYs,
      lineYs: detectedLineYs.slice(0, 5),
    }

    const classified = classifySystemStaves(system, { stringCount: 6 })
    expect(classified.notationStaves).toHaveLength(0)
    expect(classified.tabStaves).toHaveLength(1)
    expect(classified.tabStaves[0].lineYs).toEqual(detectedLineYs)
    expect(systemsContainTablature([system], { stringCount: 6 })).toBe(true)

    const notes = extractTabDigitNotes(
      [{ text: '3', x: 50, y: 60, width: 4 }],
      classified.tabStaves[0],
      [{ measureNumber: 1, x0: 0.1, playableX0: 0.1, x1: 0.9 }],
      { width: 100, height: 100 },
    )

    expect(notes).toEqual([
      expect.objectContaining({
        measureNumber: 1,
        string: 6,
        fret: 3,
      }),
    ])
  })

  it('does not classify five-line notation staves as TAB', () => {
    const system = {
      lineCount: 5,
      detectedLineYs: [0.2, 0.28, 0.36, 0.44, 0.52],
      lineYs: [0.2, 0.28, 0.36, 0.44, 0.52],
    }

    expect(classifySystemStaves(system, { stringCount: 6 }).tabStaves).toHaveLength(0)
    expect(systemsContainTablature([system], { stringCount: 6 })).toBe(false)
  })

  it('reads a paired notation-over-TAB system from the notation measure boxes', () => {
    const page = makeWhitePage()
    const notation = drawStaff(page, 100, 5)
    drawStaff(page, 175, 6)
    for (const x of [100, 300, 500, 700, 900]) {
      drawVertical(page, x, notation.top, notation.bottom)
    }

    const pageText = [200, 400, 600, 800].map((x, index) => ({
      text: String(index),
      x,
      y: page.height - 225,
      width: 8,
      height: 10,
      fontName: 'TabDigit',
      pageWidth: page.width,
      pageHeight: page.height,
    }))

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    expect(result.source).toBe('tab-vector')
    expect(result.stats.measures).toBe(4)
    expect(result.stats.notes).toBe(4)
    expect(result.tabDiagnostics).toEqual(
      expect.objectContaining({
        tabStaves: 1,
        tabNotes: 4,
        tabPositionalMeasures: 4,
      }),
    )
    expect(result.measureRhythms.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
  })

  it('does not let leading unsupported notation bands shift generated TAB measure numbers', () => {
    const page = makeWhitePage(1000, 820)
    const leading = drawStaff(page, 60, 5)
    const notation = drawStaff(page, 240, 5)
    drawStaff(page, 315, 6)
    for (const x of [100, 300, 500, 700, 900]) {
      drawVertical(page, x, leading.top, leading.bottom)
      drawVertical(page, x, notation.top, notation.bottom)
    }

    const pageText = [200, 400, 600, 800].map((x, index) => ({
      text: String(index),
      x,
      y: page.height - 365,
      width: 8,
      height: 10,
      fontName: 'TabDigit',
      pageWidth: page.width,
      pageHeight: page.height,
    }))

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    expect(result.measureRhythms.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
    expect(result.measureGrid.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
    expect(result.nextMeasureNumber).toBe(5)
    expect(result.stats.measures).toBe(4)
  })

  it('merges TAB notes that quantize to the same onset into one chord event', () => {
    const { events } = buildTabMeasureEvents([
      { string: 1, fret: 0, midi: 64, x: 80, positionInMeasure: 0.86 },
      { string: 2, fret: 1, midi: 60, x: 84, positionInMeasure: 0.94 },
    ])

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(
      expect.objectContaining({
        startDivision: 12,
        notes: [
          expect.objectContaining({ string: 1, fret: 0 }),
          expect.objectContaining({ string: 2, fret: 1 }),
        ],
      }),
    )
  })
})
