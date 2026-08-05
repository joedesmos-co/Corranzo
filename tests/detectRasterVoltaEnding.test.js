import { describe, expect, it } from 'vitest'
import {
  classifyEndingDigitBlob,
  detectVoltaFromRaster,
  findVoltaBracketRow,
  findVoltaStartHook,
} from '../src/features/omr/detectRasterVoltaEnding.js'
import {
  detectVoltaEnding,
  finalizeEndingStops,
  shouldEmitEnding,
} from '../src/features/omr/detectOmrRepeatBarline.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'

const THRESH = 170

function blankImage(width = 200, height = 120) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { width, height, data }
}

function paintInk(imageData, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
        continue
      }
      const i = (y * imageData.width + x) * 4
      imageData.data[i] = 20
      imageData.data[i + 1] = 20
      imageData.data[i + 2] = 20
    }
  }
}

/** Five staff lines so staffTop is well defined. */
function paintStaff(imageData, x0, x1, topY) {
  for (let line = 0; line < 5; line += 1) {
    paintInk(imageData, x0, topY + line * 8, x1, topY + line * 8)
  }
}

function paintVoltaBracket(imageData, { x0, x1, y, hookDepth = 12, rightHook = true }) {
  paintInk(imageData, x0, y, x1, y + 1)
  paintInk(imageData, x0, y, x0 + 1, y + hookDepth)
  if (rightHook) {
    paintInk(imageData, x1 - 1, y, x1, y + hookDepth)
  }
}

/** Thin "1" stem + optional period. */
function paintDigitOne(imageData, x, y) {
  paintInk(imageData, x + 2, y, x + 3, y + 10)
  paintInk(imageData, x + 6, y + 8, x + 7, y + 9) // period
}

/** Blocky "2" with top/mid/bot ink + period. */
function paintDigitTwo(imageData, x, y) {
  paintInk(imageData, x, y, x + 6, y + 1)
  paintInk(imageData, x + 5, y + 1, x + 6, y + 4)
  paintInk(imageData, x, y + 4, x + 6, y + 5)
  paintInk(imageData, x, y + 5, x + 1, y + 8)
  paintInk(imageData, x, y + 8, x + 6, y + 9)
  paintInk(imageData, x + 8, y + 7, x + 9, y + 8)
}

function measureBoxFor(x0, x1, staffTopNorm = 0.55) {
  const staffLines = {
    treble: [0, 1, 2, 3, 4].map((i) => staffTopNorm + i * (8 / 120)),
  }
  return { x0, x1, y0: staffTopNorm, y1: 0.95, staffLines }
}

describe('detectRasterVoltaEnding', () => {
  it('detects a one-measure first ending with right vertical stroke', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintVoltaBracket(image, { x0: 40, x1: 110, y: 48, rightHook: true })
    paintDigitOne(image, 44, 34)
    const box = measureBoxFor(0.2, 0.55, 70 / 120)
    const hit = detectVoltaFromRaster(image, box, THRESH)
    expect(hit?.endingStartNumbers).toEqual([1])
    expect(hit?.endingStop).toBe(true)
    expect(shouldEmitEnding(hit)).toBe(true)
  })

  it('detects a second ending without requiring a right vertical stroke', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintVoltaBracket(image, { x0: 40, x1: 160, y: 48, rightHook: false })
    paintDigitTwo(image, 44, 34)
    const box = measureBoxFor(0.2, 0.8, 70 / 120)
    const hit = detectVoltaFromRaster(image, box, THRESH)
    expect(hit?.endingStartNumbers).toEqual([2])
    expect(hit?.endingStop).toBeUndefined()
  })

  it('assigns adjacent first and second endings and finalizes stops', () => {
    const image = blankImage(400, 120)
    paintStaff(image, 10, 390, 70)
    paintVoltaBracket(image, { x0: 40, x1: 190, y: 48, rightHook: true })
    paintDigitOne(image, 44, 34)
    paintVoltaBracket(image, { x0: 200, x1: 360, y: 48, rightHook: true })
    paintDigitTwo(image, 204, 34)
    const m1 = detectVoltaFromRaster(image, measureBoxFor(0.1, 0.48, 70 / 120), THRESH)
    const m2 = detectVoltaFromRaster(image, measureBoxFor(0.5, 0.9, 70 / 120), THRESH)
    expect(m1?.endingStartNumbers).toEqual([1])
    expect(m2?.endingStartNumbers).toEqual([2])
    const records = [{ endingMarking: { ...m1 } }, { endingMarking: { ...m2 } }]
    finalizeEndingStops(records)
    expect(records[0].endingMarking.endingStop).toBe(true)
    expect(records[1].endingMarking.endingStop).toBe(true)
  })

  it('spans a multi-measure first ending without splitting on an internal barline', () => {
    // Bracket drawn across two measure boxes; label only on the first.
    const image = blankImage(400, 120)
    paintStaff(image, 10, 390, 70)
    paintVoltaBracket(image, { x0: 40, x1: 360, y: 48, rightHook: true })
    paintDigitOne(image, 44, 34)
    // Internal barline ink under the bracket must not invent a new ending.
    paintInk(image, 199, 70, 200, 110)
    const start = detectVoltaFromRaster(image, measureBoxFor(0.1, 0.5, 70 / 120), THRESH)
    const mid = detectVoltaFromRaster(image, measureBoxFor(0.5, 0.9, 70 / 120), THRESH)
    expect(start?.endingStartNumbers).toEqual([1])
    // Mid measure has bracket+hook-ish geometry at its left but no digit label → abstain.
    expect(mid).toBeNull()
  })

  it('reads ending labels from conservative local raster evidence', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintVoltaBracket(image, { x0: 40, x1: 150, y: 48 })
    paintDigitTwo(image, 44, 34)
    const hit = detectVoltaFromRaster(image, measureBoxFor(0.2, 0.75, 70 / 120), THRESH)
    expect(hit?.endingStartNumbers).toEqual([2])
    expect(hit?.source).toBe('raster')
  })

  it('prefers PDF text labels over raster when text is present', () => {
    const image = blankImage()
    // Deliberately paint a "2" so raster would say 2 if consulted.
    paintStaff(image, 10, 190, 70)
    paintVoltaBracket(image, { x0: 40, x1: 150, y: 48 })
    paintDigitTwo(image, 44, 34)
    // PDF text y is bottom-up; place "1." just above staffTop≈0.583.
    const pageText = [
      {
        text: '1.',
        x: 42,
        y: 50,
        width: 8,
        height: 8,
        pageWidth: 200,
        pageHeight: 120,
      },
    ]
    const hit = detectVoltaEnding(
      image,
      measureBoxFor(0.2, 0.75, 70 / 120),
      THRESH,
      pageText,
    )
    expect(hit?.endingStartNumbers).toEqual([1])
  })

  it('rejects a bare measure number without a volta bracket', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintDigitOne(image, 44, 34)
    expect(detectVoltaFromRaster(image, measureBoxFor(0.2, 0.55, 70 / 120), THRESH)).toBeNull()
  })

  it('rejects a fingering-sized digit near a notehead (inside staff)', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    // Digit inside staff band, no bracket above.
    paintDigitOne(image, 80, 78)
    expect(detectVoltaFromRaster(image, measureBoxFor(0.2, 0.55, 70 / 120), THRESH)).toBeNull()
  })

  it('rejects a long staff/system line as a volta', () => {
    const image = blankImage()
    // Only staff lines — findVoltaBracketRow looks above staffTop.
    paintStaff(image, 10, 190, 70)
    const box = measureBoxFor(0.1, 0.95, 70 / 120)
    expect(findVoltaBracketRow(image, box, THRESH)).toBeNull()
    expect(detectVoltaFromRaster(image, box, THRESH)).toBeNull()
  })

  it('rejects a beam-like thick line inside the staff', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintInk(image, 40, 86, 150, 88)
    expect(detectVoltaFromRaster(image, measureBoxFor(0.2, 0.75, 70 / 120), THRESH)).toBeNull()
  })

  it('rejects a text underline without a start hook or digit', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintInk(image, 40, 48, 150, 49)
    expect(detectVoltaFromRaster(image, measureBoxFor(0.2, 0.75, 70 / 120), THRESH)).toBeNull()
  })

  it('rejects a slur/tie arc fragment without a digit label', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    // Sparse curved-ish crumbs above staff.
    for (let x = 50; x <= 140; x += 3) {
      const y = 50 + Math.round(Math.sin((x - 50) / 20) * 3)
      paintInk(image, x, y, x + 1, y)
    }
    expect(detectVoltaFromRaster(image, measureBoxFor(0.2, 0.75, 70 / 120), THRESH)).toBeNull()
  })

  it('assigns the bracket start to the first measure under the label', () => {
    const image = blankImage(400, 120)
    paintStaff(image, 10, 390, 70)
    paintVoltaBracket(image, { x0: 40, x1: 190, y: 48 })
    paintDigitOne(image, 44, 34)
    const first = detectVoltaFromRaster(image, measureBoxFor(0.1, 0.48, 70 / 120), THRESH)
    const prior = detectVoltaFromRaster(image, measureBoxFor(0.0, 0.09, 70 / 120), THRESH)
    expect(first?.endingStartNumbers).toEqual([1])
    expect(prior).toBeNull()
  })

  it('keeps stop on the terminal measure via finalizeEndingStops', () => {
    const records = [
      { endingMarking: { endingStartNumbers: [1], confidence: 0.84 } },
      { endingMarking: { endingStartNumbers: [1], confidence: 0.84 } },
      { endingMarking: { endingStartNumbers: [2], confidence: 0.84 } },
    ]
    finalizeEndingStops(records)
    expect(records[0].endingMarking.endingStop).toBeUndefined()
    expect(records[1].endingMarking.endingStop).toBe(true)
    expect(records[2].endingMarking.endingStop).toBe(true)
  })

  it('preserves forward and backward repeats alongside endings in MusicXML', () => {
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
            confidence: 0.86,
          },
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
            confidence: 0.86,
          },
          repeatMarking: { backwardRepeat: true, confidence: 0.84 },
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
    expect(xml).toContain('ending number="2" type="start"')
    expect(xml).toContain('ending number="2" type="stop"')
    expect((xml.match(/ending number="1" type="start"/g) || []).length).toBe(1)
    expect((xml.match(/ending number="2" type="stop"/g) || []).length).toBe(1)
  })

  it('abstains when digit blob geometry is ambiguous', () => {
    const image = blankImage()
    const digit = { minx: 0, maxx: 8, miny: 0, maxy: 8, w: 9, h: 9, area: 20 }
    // Empty ink → classify fails.
    expect(classifyEndingDigitBlob(image, 0, 0, digit, THRESH)).toBeNull()
  })

  it('requires a start hook even when a long line and digit exist', () => {
    const image = blankImage()
    paintStaff(image, 10, 190, 70)
    paintInk(image, 40, 48, 150, 49) // line without hook
    paintDigitOne(image, 44, 34)
    const box = measureBoxFor(0.2, 0.75, 70 / 120)
    const bracket = findVoltaBracketRow(image, box, THRESH)
    expect(bracket).not.toBeNull()
    expect(findVoltaStartHook(image, bracket, THRESH)).toBeNull()
    expect(detectVoltaFromRaster(image, box, THRESH)).toBeNull()
  })
})
