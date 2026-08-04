import { describe, expect, it } from 'vitest'
import {
  classifyAugmentationDotPathGeometry,
  classifyAccidentalInkBlob,
  classifyAccidentalPathGeometry,
  detectVectorPathAccidentals,
  extractPdfVectorPathSymbolsFromOperatorList,
  PATH_ACCIDENTAL_GLYPHS,
} from '../src/features/omr/detectVectorPathAccidentals.js'
import { assignLocalAccidentals } from '../src/features/omr/omrPitchAlteration.js'

const ACCIDENTAL_GLYPHS = new Map([
  [PATH_ACCIDENTAL_GLYPHS.sharp, { alter: 1, type: 'sharp' }],
  [PATH_ACCIDENTAL_GLYPHS.natural, { alter: 0, type: 'natural' }],
  [PATH_ACCIDENTAL_GLYPHS.flat, { alter: -1, type: 'flat' }],
])

function blankImage(width = 400, height = 200) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { data, width, height }
}

function fillRect(imageData, x0, y0, w, h, value = 10) {
  const left = Math.round(x0)
  const top = Math.round(y0)
  const right = Math.round(x0 + w)
  const bottom = Math.round(y0 + h)
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) continue
      const i = (y * imageData.width + x) * 4
      imageData.data[i] = value
      imageData.data[i + 1] = value
      imageData.data[i + 2] = value
      imageData.data[i + 3] = 255
    }
  }
}

function drawSharp(imageData, cx, cy, size = 14) {
  const hw = Math.max(2, Math.round(size * 0.14))
  const gap = Math.round(size * 0.28)
  fillRect(imageData, cx - gap - hw / 2, cy - size * 0.55, hw, size * 1.1)
  fillRect(imageData, cx + gap - hw / 2, cy - size * 0.55, hw, size * 1.1)
  fillRect(imageData, cx - size * 0.42, cy - size * 0.22, size * 0.84, hw)
  fillRect(imageData, cx - size * 0.42, cy + size * 0.14, size * 0.84, hw)
}

function drawFlat(imageData, cx, cy, size = 14) {
  const stem = Math.max(2, Math.round(size * 0.16))
  fillRect(imageData, cx - size * 0.28, cy - size * 0.55, stem, size * 1.15)
  fillRect(imageData, cx - size * 0.1, cy - size * 0.05, size * 0.55, size * 0.55)
}

function drawNatural(imageData, cx, cy, size = 14) {
  const hw = Math.max(2, Math.round(size * 0.15))
  fillRect(imageData, cx - size * 0.32, cy - size * 0.55, hw, size * 1.1)
  fillRect(imageData, cx + size * 0.12, cy - size * 0.55, hw, size * 1.1)
  fillRect(imageData, cx - size * 0.32, cy + size * 0.08, size * 0.6, hw)
  fillRect(imageData, cx - size * 0.18, cy - size * 0.22, size * 0.6, hw)
}

function completeSharpPath(x, y) {
  return [
    0, x + 2, y,
    1, x + 2, y + 16,
    0, x + 8, y,
    1, x + 8, y + 16,
    0, x, y + 5,
    1, x + 10, y + 6,
    0, x, y + 11,
    1, x + 10, y + 12,
  ]
}

function rectanglePath(x0, y0, x1, y1) {
  return [
    0, x0, y0,
    1, x1, y0,
    1, x1, y1,
    1, x0, y1,
    1, x0, y0,
    3,
  ]
}

function filledCirclePath(x, y) {
  return [
    0, x, y + 2.5,
    2, x, y + 1.1, x + 1.1, y, x + 2.5, y,
    2, x + 3.9, y, x + 5, y + 1.1, x + 5, y + 2.5,
    2, x + 5, y + 3.9, x + 3.9, y + 5, x + 2.5, y + 5,
    2, x + 1.1, y + 5, x, y + 3.9, x, y + 2.5,
    3,
  ]
}

const measureBox = {
  x0: 0.05,
  playableX0: 0.12,
  x1: 0.95,
  y0: 0.1,
  y1: 0.9,
  staffLines: {
    treble: [0.2, 0.28, 0.36, 0.44, 0.52],
    bass: [0.62, 0.7, 0.78, 0.86, 0.94],
  },
}

describe('detectVectorPathAccidentals geometry', () => {
  it('extracts a filled circular PDF path as an augmentation-dot candidate', () => {
    const circlePath = [
      0, 0, 2.5,
      2, 0, 1.1, 1.1, 0, 2.5, 0,
      2, 3.9, 0, 5, 1.1, 5, 2.5,
      2, 5, 3.9, 3.9, 5, 2.5, 5,
      2, 1.1, 5, 0, 3.9, 0, 2.5,
      3,
    ]
    const symbols = extractPdfVectorPathSymbolsFromOperatorList({
      operatorList: {
        fnArray: [11],
        argsArray: [[21, [circlePath]]],
      },
      ops: {
        constructPath: 11,
        fill: 21,
      },
      viewportTransform: [1, 0, 0, 1, 0, 0],
      pageNumber: 2,
      targetWidth: 1000,
    })

    expect(symbols.accidentalPaths).toHaveLength(0)
    expect(symbols.augmentationDotPaths).toHaveLength(1)
    expect(symbols.augmentationDotPaths[0]).toMatchObject({
      candidateId: 'pdf-dot-p2-op0',
      source: 'vector-path',
      reason: 'filled-circular-path',
    })
  })

  it('rejects notehead-sized and stroked circular paths as augmentation dots', () => {
    const circular = {
      bounds: { width: 5, height: 5, x0: 0, x1: 5, y0: 0, y1: 5 },
      curveCount: 4,
      closeCount: 1,
      moveCount: 1,
      lineCount: 0,
    }
    expect(
      classifyAugmentationDotPathGeometry(circular, {
        staffGap: 14,
        filled: true,
      }),
    ).not.toBeNull()
    expect(
      classifyAugmentationDotPathGeometry(
        {
          ...circular,
          bounds: { width: 12, height: 10, x0: 0, x1: 12, y0: 0, y1: 10 },
        },
        { staffGap: 14, filled: true },
      ),
    ).toBeNull()
    expect(
      classifyAugmentationDotPathGeometry(circular, {
        staffGap: 14,
        filled: false,
      }),
    ).toBeNull()
  })

  it('does not reuse independently classified complete paths in sharp clusters', () => {
    const paths = [
      completeSharpPath(100, 90),
      completeSharpPath(101, 90),
      completeSharpPath(102, 90),
    ]
    const symbols = extractPdfVectorPathSymbolsFromOperatorList({
      operatorList: {
        fnArray: paths.map(() => 11),
        argsArray: paths.map((path) => [21, [path]]),
      },
      ops: {
        constructPath: 11,
        fill: 21,
      },
      viewportTransform: [1, 0, 0, 1, 0, 0],
      pageNumber: 3,
      targetWidth: 1000,
    })

    expect(symbols.accidentalPaths).toHaveLength(3)
    expect(symbols.accidentalPaths.every((candidate) => candidate.reason === 'path-cross')).toBe(
      true,
    )
    expect(
      symbols.accidentalPaths.some((candidate) => candidate.candidateId.includes('-cluster-')),
    ).toBe(false)
  })

  it('still clusters separately painted sharp strokes', () => {
    const paths = [
      rectanglePath(101, 90, 103, 106),
      rectanglePath(107, 90, 109, 106),
      rectanglePath(99, 95, 111, 97),
      rectanglePath(99, 101, 111, 103),
    ]
    const symbols = extractPdfVectorPathSymbolsFromOperatorList({
      operatorList: {
        fnArray: paths.map(() => 11),
        argsArray: paths.map((path) => [21, [path]]),
      },
      ops: {
        constructPath: 11,
        fill: 21,
      },
      viewportTransform: [1, 0, 0, 1, 0, 0],
      pageNumber: 4,
      targetWidth: 1000,
    })

    expect(symbols.accidentalPaths).toHaveLength(1)
    expect(symbols.accidentalPaths[0]).toMatchObject({
      candidateId: 'pdf-acc-p4-cluster-0',
      reason: 'path-cluster-sharp',
      type: 'sharp',
    })
  })

  it('does not reuse a complete augmentation dot to meet the sharp cluster size', () => {
    const paths = [
      rectanglePath(101, 90, 103, 106),
      rectanglePath(99, 95, 111, 97),
      filledCirclePath(103, 96),
    ]
    const symbols = extractPdfVectorPathSymbolsFromOperatorList({
      operatorList: {
        fnArray: paths.map(() => 11),
        argsArray: paths.map((path) => [21, [path]]),
      },
      ops: {
        constructPath: 11,
        fill: 21,
      },
      viewportTransform: [1, 0, 0, 1, 0, 0],
      pageNumber: 5,
      targetWidth: 1000,
    })

    expect(symbols.augmentationDotPaths).toHaveLength(1)
    expect(symbols.accidentalPaths).toHaveLength(0)
  })

  it('classifies a sharp path from cross stroke geometry', () => {
    const classification = classifyAccidentalPathGeometry(
      {
        bounds: { width: 12, height: 18, x0: 0, x1: 12, y0: 0, y1: 18 },
        segments: [
          { x0: 3, y0: 0, x1: 3, y1: 18 },
          { x0: 9, y0: 0, x1: 9, y1: 18 },
          { x0: 0, y0: 6, x1: 12, y1: 8 },
          { x0: 0, y0: 12, x1: 12, y1: 14 },
        ],
        lineCount: 4,
        curveCount: 0,
        closeCount: 0,
        moveCount: 4,
      },
      { staffGap: 12 },
    )
    expect(classification?.type).toBe('sharp')
  })

  it('classifies a flat path from vertical + lobe cues', () => {
    const classification = classifyAccidentalPathGeometry(
      {
        bounds: { width: 9, height: 20, x0: 0, x1: 9, y0: 0, y1: 20 },
        segments: [
          { x0: 2, y0: 0, x1: 2, y1: 20 },
          { x0: 2, y0: 12, x1: 9, y1: 16 },
        ],
        lineCount: 1,
        curveCount: 3,
        closeCount: 1,
        moveCount: 1,
      },
      { staffGap: 12 },
    )
    expect(classification?.type).toBe('flat')
  })

  it('classifies a natural path from dual vertical posts', () => {
    const classification = classifyAccidentalPathGeometry(
      {
        bounds: { width: 10, height: 18, x0: 0, x1: 10, y0: 0, y1: 18 },
        segments: [
          { x0: 2, y0: 0, x1: 2, y1: 18 },
          { x0: 8, y0: 0, x1: 8, y1: 18 },
          { x0: 2, y0: 10, x1: 8, y1: 12 },
        ],
        lineCount: 3,
        curveCount: 0,
        closeCount: 0,
        moveCount: 3,
      },
      { staffGap: 12 },
    )
    expect(classification?.type).toBe('natural')
  })

  it('rejects a barline-like thin tall path', () => {
    expect(
      classifyAccidentalPathGeometry(
        {
          bounds: { width: 2, height: 40, x0: 0, x1: 2, y0: 0, y1: 40 },
          segments: [{ x0: 1, y0: 0, x1: 1, y1: 40 }],
          lineCount: 1,
          curveCount: 0,
          closeCount: 0,
          moveCount: 1,
        },
        { staffGap: 12 },
      ),
    ).toBeNull()
  })

  it('rejects a staff-line scrap', () => {
    expect(
      classifyAccidentalPathGeometry(
        {
          bounds: { width: 40, height: 2, x0: 0, x1: 40, y0: 0, y1: 2 },
          segments: [{ x0: 0, y0: 1, x1: 40, y1: 1 }],
          lineCount: 1,
          curveCount: 0,
          closeCount: 0,
          moveCount: 1,
        },
        { staffGap: 12 },
      ),
    ).toBeNull()
  })

  it('detects a sharp ink mark beside a single note', () => {
    const imageData = blankImage()
    drawSharp(imageData, 120, 100, 16)
    fillRect(imageData, 150, 94, 12, 12) // notehead
    const notes = [{ cx: 156, cy: 100, yNorm: 0.5, clef: 'treble', naturalMidi: 65 }]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      textAccidentalGlyphs: [],
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs.some((glyph) => glyph.text === PATH_ACCIDENTAL_GLYPHS.sharp)).toBe(true)
    const assigned = assignLocalAccidentals(glyphs, imageData, measureBox, notes, ACCIDENTAL_GLYPHS)
    expect(assigned.get(0)?.type).toBe('sharp')
  })

  it('detects a flat ink mark beside a single note', () => {
    const imageData = blankImage()
    drawFlat(imageData, 118, 100, 16)
    fillRect(imageData, 150, 94, 12, 12)
    const notes = [{ cx: 156, cy: 100, yNorm: 0.5, clef: 'treble', naturalMidi: 65 }]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs.some((glyph) => glyph.text === PATH_ACCIDENTAL_GLYPHS.flat)).toBe(true)
  })

  it('detects a natural ink mark beside a single note', () => {
    const imageData = blankImage()
    // Explicit dual posts + one connector (avoid sharp-like double bars).
    fillRect(imageData, 112, 88, 3, 24)
    fillRect(imageData, 124, 88, 3, 24)
    fillRect(imageData, 112, 108, 15, 3)
    fillRect(imageData, 150, 94, 12, 12)
    const notes = [{ cx: 156, cy: 100, yNorm: 0.5, clef: 'treble', naturalMidi: 65 }]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs.some((glyph) => glyph.text === PATH_ACCIDENTAL_GLYPHS.natural)).toBe(true)
  })

  it('binds an accidental to one tone of a chord by staff position', () => {
    const imageData = blankImage()
    fillRect(imageData, 150, 84, 12, 12)
    fillRect(imageData, 150, 114, 12, 12)
    const notes = [
      { cx: 156, cy: 90, yNorm: 90 / 200, clef: 'treble', naturalMidi: 69 },
      { cx: 156, cy: 120, yNorm: 120 / 200, clef: 'treble', naturalMidi: 65 },
    ]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      pathCandidates: [
        {
          candidateId: 'chord-sharp',
          text: PATH_ACCIDENTAL_GLYPHS.sharp,
          type: 'sharp',
          alter: 1,
          confidence: 0.9,
          reason: 'path-cross',
          x: 128,
          y: 120,
          bounds: { x0: 120, x1: 136, y0: 108, y1: 132, width: 16, height: 24 },
        },
      ],
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs[0]).toMatchObject({
      pathCandidateId: 'chord-sharp',
      reason: 'path-cross',
    })
    const assigned = assignLocalAccidentals(glyphs, imageData, measureBox, notes, ACCIDENTAL_GLYPHS)
    expect(assigned.get(1)?.type).toBe('sharp')
    expect(assigned.get(0)).toBeUndefined()
  })

  it('binds two accidentals in one chord to distinct tones', () => {
    const imageData = blankImage()
    fillRect(imageData, 150, 84, 12, 12)
    fillRect(imageData, 150, 124, 12, 12)
    const notes = [
      { cx: 156, cy: 90, yNorm: 90 / 200, clef: 'treble', naturalMidi: 69 },
      { cx: 156, cy: 130, yNorm: 130 / 200, clef: 'treble', naturalMidi: 64 },
    ]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      pathCandidates: [
        {
          candidateId: 'chord-sharp',
          text: PATH_ACCIDENTAL_GLYPHS.sharp,
          type: 'sharp',
          alter: 1,
          confidence: 0.9,
          x: 128,
          y: 90,
          bounds: { x0: 120, x1: 136, y0: 78, y1: 102, width: 16, height: 24 },
        },
        {
          candidateId: 'chord-flat',
          text: PATH_ACCIDENTAL_GLYPHS.flat,
          type: 'flat',
          alter: -1,
          confidence: 0.9,
          x: 128,
          y: 130,
          bounds: { x0: 120, x1: 136, y0: 118, y1: 142, width: 16, height: 24 },
        },
      ],
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    const assigned = assignLocalAccidentals(glyphs, imageData, measureBox, notes, ACCIDENTAL_GLYPHS)
    expect(assigned.get(0)?.type).toBe('sharp')
    expect(assigned.get(1)?.type).toBe('flat')
  })

  it('rejects ambiguous ownership between nearby competing notes', () => {
    const imageData = blankImage()
    drawSharp(imageData, 130, 100, 14)
    fillRect(imageData, 155, 94, 12, 12)
    fillRect(imageData, 175, 94, 12, 12)
    const notes = [
      { cx: 161, cy: 100, yNorm: 0.5, clef: 'treble', naturalMidi: 65 },
      { cx: 181, cy: 100, yNorm: 0.5, clef: 'treble', naturalMidi: 67 },
    ]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    const assigned = assignLocalAccidentals(glyphs, imageData, measureBox, notes, ACCIDENTAL_GLYPHS)
    // Exclusive ownership: at most one note receives the accidental.
    const winners = [...assigned.keys()]
    expect(winners.length).toBeLessThanOrEqual(1)
  })

  it('does not treat key-signature-region path candidates as local accidentals', () => {
    const imageData = blankImage()
    fillRect(imageData, 150, 94, 12, 12)
    const notes = [{ cx: 156, cy: 100, clef: 'treble', naturalMidi: 65 }]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      pathCandidates: [
        {
          candidateId: 'keysig',
          text: PATH_ACCIDENTAL_GLYPHS.sharp,
          type: 'sharp',
          alter: 1,
          confidence: 0.9,
          x: measureBox.playableX0 * imageData.width - 20,
          y: 100,
          bounds: { x0: 20, x1: 32, y0: 90, y1: 110, width: 12, height: 20 },
        },
      ],
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs).toHaveLength(0)
  })

  it('keeps beat-1 path accidentals left of playableStart when a note owns them', () => {
    const imageData = blankImage()
    const playableX = measureBox.playableX0 * imageData.width
    const sharpX = playableX - 8
    const noteX = sharpX + 28
    fillRect(imageData, noteX - 6, 94, 12, 12)
    const notes = [{ cx: noteX, cy: 100, yNorm: 0.5, clef: 'treble', naturalMidi: 65 }]
    const { glyphs, diagnostics } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      pathCandidates: [
        {
          candidateId: 'beat1-sharp',
          text: PATH_ACCIDENTAL_GLYPHS.sharp,
          type: 'sharp',
          alter: 1,
          confidence: 0.9,
          reason: 'path-cross',
          x: sharpX,
          y: 100,
          bounds: {
            x0: sharpX - 6,
            x1: sharpX + 6,
            y0: 90,
            y1: 110,
            width: 12,
            height: 20,
          },
        },
      ],
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(diagnostics.rejected.some((entry) => entry.reason === 'key-signature-region')).toBe(
      false,
    )
    expect(glyphs).toEqual([
      expect.objectContaining({ pathCandidateId: 'beat1-sharp', source: 'vector-path' }),
    ])
  })

  it('keeps deep ledger-line path sharps below the staff band', () => {
    const imageData = blankImage(400, 400)
    const deepMeasureBox = {
      ...measureBox,
      staffLines: { treble: [0.2, 0.22, 0.24, 0.26, 0.28] },
    }
    const staffBottom = 0.28 * imageData.height
    const notes = [
      { cx: 200, cy: staffBottom + 40, yNorm: (staffBottom + 40) / imageData.height, clef: 'treble', naturalMidi: 48 },
      { cx: 200, cy: staffBottom + 70, yNorm: (staffBottom + 70) / imageData.height, clef: 'treble', naturalMidi: 43 },
    ]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox: deepMeasureBox,
      inkThreshold: 170,
      pathCandidates: [
        {
          candidateId: 'ledger-sharp-a',
          text: PATH_ACCIDENTAL_GLYPHS.sharp,
          type: 'sharp',
          alter: 1,
          confidence: 0.9,
          reason: 'path-cross',
          x: 170,
          y: staffBottom + 40,
          bounds: { x0: 164, x1: 176, y0: staffBottom + 30, y1: staffBottom + 50, width: 12, height: 20 },
        },
        {
          candidateId: 'ledger-sharp-b',
          text: PATH_ACCIDENTAL_GLYPHS.sharp,
          type: 'sharp',
          alter: 1,
          confidence: 0.9,
          reason: 'path-cross',
          x: 170,
          y: staffBottom + 70,
          bounds: { x0: 164, x1: 176, y0: staffBottom + 60, y1: staffBottom + 80, width: 12, height: 20 },
        },
      ],
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs.map((glyph) => glyph.pathCandidateId).sort()).toEqual([
      'ledger-sharp-a',
      'ledger-sharp-b',
    ])
  })

  it('emits one ink sharp for a chord stack and assigns it to the aligned tone', () => {
    const imageData = blankImage()
    drawSharp(imageData, 120, 120, 16)
    fillRect(imageData, 150, 84, 12, 12)
    fillRect(imageData, 150, 114, 12, 12)
    fillRect(imageData, 150, 144, 12, 12)
    const notes = [
      { cx: 156, cy: 90, yNorm: 90 / 200, clef: 'treble', naturalMidi: 69 },
      { cx: 156, cy: 120, yNorm: 120 / 200, clef: 'treble', naturalMidi: 65 },
      { cx: 156, cy: 150, yNorm: 150 / 200, clef: 'treble', naturalMidi: 60 },
    ]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    const inkSharps = glyphs.filter(
      (glyph) => glyph.source === 'vector-ink' && glyph.text === PATH_ACCIDENTAL_GLYPHS.sharp,
    )
    expect(inkSharps).toHaveLength(1)
    const assigned = assignLocalAccidentals(glyphs, imageData, measureBox, notes, ACCIDENTAL_GLYPHS)
    expect(assigned.get(1)?.type).toBe('sharp')
    expect(assigned.get(0)).toBeUndefined()
    expect(assigned.get(2)).toBeUndefined()
  })

  it('does not treat a stem as a flat', () => {
    const imageData = blankImage()
    fillRect(imageData, 168, 70, 2, 50) // stem
    fillRect(imageData, 150, 94, 12, 12)
    const blob = { x0: 168, x1: 169, y0: 70, y1: 119, width: 2, height: 50, count: 100 }
    expect(classifyAccidentalInkBlob(imageData, blob, 170, { staffGap: 12 })).toBeNull()
  })

  it('does not treat an articulation dot as an accidental', () => {
    const imageData = blankImage()
    fillRect(imageData, 154, 78, 4, 4)
    const blob = { x0: 154, x1: 157, y0: 78, y1: 81, width: 4, height: 4, count: 16 }
    expect(classifyAccidentalInkBlob(imageData, blob, 170, { staffGap: 12 })).toBeNull()
  })

  it('rejects ambiguous low-confidence ink blobs', () => {
    const imageData = blankImage()
    fillRect(imageData, 120, 98, 3, 5) // tiny scrap
    fillRect(imageData, 150, 94, 12, 12)
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes: [{ cx: 156, cy: 100, clef: 'treble', naturalMidi: 65 }],
      measureBox,
      inkThreshold: 170,
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    expect(glyphs).toHaveLength(0)
  })

  it('lets text-layer accidentals outrank path detection', () => {
    const imageData = blankImage()
    drawSharp(imageData, 120, 100, 16)
    fillRect(imageData, 150, 94, 12, 12)
    const notes = [{ cx: 156, cy: 100, clef: 'treble', naturalMidi: 65 }]
    const textGlyphs = [{ text: PATH_ACCIDENTAL_GLYPHS.flat, x: 130, y: 100 }]
    const { glyphs } = detectVectorPathAccidentals({
      imageData,
      notes,
      measureBox,
      inkThreshold: 170,
      textAccidentalGlyphs: textGlyphs,
      accidentalGlyphs: ACCIDENTAL_GLYPHS,
    })
    // Path/ink synthesis skipped because text candidate already covers the note.
    expect(glyphs.every((glyph) => glyph.source !== 'vector-ink')).toBe(true)
    const assigned = assignLocalAccidentals(
      [...textGlyphs, ...glyphs],
      imageData,
      measureBox,
      notes,
      ACCIDENTAL_GLYPHS,
    )
    expect(assigned.get(0)?.type).toBe('flat')
  })

  it('accepts transformed/scaled path geometry via normalized staffGap', () => {
    const small = classifyAccidentalPathGeometry(
      {
        bounds: { width: 6, height: 9, x0: 0, x1: 6, y0: 0, y1: 9 },
        segments: [
          { x0: 1.5, y0: 0, x1: 1.5, y1: 9 },
          { x0: 4.5, y0: 0, x1: 4.5, y1: 9 },
          { x0: 0, y0: 3, x1: 6, y1: 4 },
          { x0: 0, y0: 6, x1: 6, y1: 7 },
        ],
        lineCount: 4,
        curveCount: 0,
        closeCount: 0,
        moveCount: 4,
      },
      { staffGap: 6 },
    )
    const large = classifyAccidentalPathGeometry(
      {
        bounds: { width: 24, height: 36, x0: 0, x1: 24, y0: 0, y1: 36 },
        segments: [
          { x0: 6, y0: 0, x1: 6, y1: 36 },
          { x0: 18, y0: 0, x1: 18, y1: 36 },
          { x0: 0, y0: 12, x1: 24, y1: 16 },
          { x0: 0, y0: 24, x1: 24, y1: 28 },
        ],
        lineCount: 4,
        curveCount: 0,
        closeCount: 0,
        moveCount: 4,
      },
      { staffGap: 24 },
    )
    expect(small?.type).toBe('sharp')
    expect(large?.type).toBe('sharp')
  })
})
