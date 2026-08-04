import { describe, expect, it } from 'vitest'
import {
  detectAccidentalNearNote,
  detectRasterSharpTopology,
  refineMeasurePitches,
  snapRecoveredNoteToCrossingLine,
} from '../src/features/omr/detectOmrAccidentals.js'

const WIDTH = 150
const HEIGHT = 120
const STAFF_LINES = [40, 52, 64, 76, 88]

function image() {
  return {
    width: WIDTH,
    height: HEIGHT,
    data: new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255),
  }
}

function ink(page, x, y) {
  const index = (y * page.width + x) * 4
  page.data[index] = page.data[index + 1] = page.data[index + 2] = 20
}

function line(page, x0, y0, x1, y1) {
  if (x0 === x1) {
    for (let y = y0; y <= y1; y += 1) ink(page, x0, y)
    return
  }
  for (let x = x0; x <= x1; x += 1) ink(page, x, y0)
}

function sharp(page, cx, cy) {
  line(page, cx - 5, cy - 14, cx - 5, cy + 14)
  line(page, cx + 5, cy - 14, cx + 5, cy + 14)
  line(page, cx - 9, cy - 4, cx + 9, cy - 4)
  line(page, cx - 9, cy + 4, cx + 9, cy + 4)
}

function note(cx, cy, midi, source = 'raster-morphology-core') {
  return {
    cx,
    cy,
    midi,
    clef: 'treble',
    pitchMapping: { lineYs: STAFF_LINES.map((y) => y / HEIGHT) },
    detectionEvidence: { source },
  }
}

describe('raster accidental ownership', () => {
  it('recognizes paired sharp posts at scan scale', () => {
    const page = image()
    sharp(page, 60, 64)
    expect(detectRasterSharpTopology(page, 60, 64, 170, 12)).toMatchObject({
      type: 'sharp',
      alter: 1,
      source: 'raster-paired-post-topology',
    })
  })

  it('anchors a recovered peak to a visibly crossing staff line', () => {
    const page = image()
    for (let x = 0; x < WIDTH; x += 1) ink(page, x, 64)
    const treble = STAFF_LINES.map((y) => y / HEIGHT)
    const bass = [94, 100, 106, 112, 118].map((y) => y / HEIGHT)
    const recovered = {
      ...note(100, 60, 72),
      pitchMapping: {
        lineYs: treble,
        staffClefs: { upper: 'treble', lower: 'bass' },
        staffBounds: { treble: { lines: treble }, bass: { lines: bass } },
      },
      detectionEvidence: {
        source: 'raster-shape',
        recoveredBy: 'morphology-gap-strong-raster-shape',
      },
    }
    const anchored = snapRecoveredNoteToCrossingLine(recovered, page, 170)
    expect(anchored.midi).toBe(71)
    expect(anchored.pitchAnchorCorrection.source).toBe(
      'recovered-head-crossing-line',
    )
  })

  it('finds a sharp farther left than the legacy fixed pixel window', () => {
    const page = image()
    sharp(page, 60, 64)
    expect(detectAccidentalNearNote(page, note(84, 64, 65), 170)).toMatchObject({
      type: 'sharp',
      alter: 1,
    })
  })

  it('converts an accidental-shaped note candidate into owned pitch evidence', () => {
    const page = image()
    sharp(page, 60, 64)
    const refined = refineMeasurePitches(
      [note(60, 64, 65), note(84, 64, 65)],
      { imageData: page, inkThreshold: 170 },
    )
    expect(refined).toHaveLength(1)
    expect(refined[0]).toMatchObject({ midi: 66, alter: 1 })
    expect(refined[0].accidental.source).toBe('raster-paired-post-topology')
  })

  it('keeps the notehead staff step when an accidental center maps beside it', () => {
    const page = image()
    sharp(page, 60, 59)
    const refined = refineMeasurePitches(
      [note(60, 59, 67), note(84, 64, 65)],
      { imageData: page, inkThreshold: 170 },
    )
    expect(refined).toHaveLength(1)
    expect(refined[0]).toMatchObject({ midi: 66, alter: 1 })
  })
})
