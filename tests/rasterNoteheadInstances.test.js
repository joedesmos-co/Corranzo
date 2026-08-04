import { describe, expect, it } from 'vitest'
import {
  detectRasterNoteheadInstances,
  fuseRasterNoteheadInstances,
  mergeRasterDetectionPasses,
} from '../src/features/omr/detectRasterNoteheadInstances.js'

const WIDTH = 220
const HEIGHT = 180
const TREBLE = [44, 52, 60, 68, 76]
const BASS = [108, 116, 124, 132, 140]

function image() {
  return { width: WIDTH, height: HEIGHT, data: new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255) }
}
function ink(page, x, y) {
  if (x < 0 || y < 0 || x >= page.width || y >= page.height) return
  const index = (y * page.width + x) * 4
  page.data[index] = page.data[index + 1] = page.data[index + 2] = 20
}
function rect(page, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) ink(page, x, y)
  }
}
function line(page, y, x0 = 20, x1 = 200) {
  for (let x = x0; x <= x1; x += 1) ink(page, x, y)
}
function box() {
  return {
    measureNumber: 1,
    page: 1,
    x0: 10 / WIDTH,
    x1: 210 / WIDTH,
    playableX0: 30 / WIDTH,
    y0: 34 / HEIGHT,
    y1: 150 / HEIGHT,
    staffLines: {
      treble: TREBLE.map((y) => y / HEIGHT),
      bass: BASS.map((y) => y / HEIGHT),
      splitY: 92 / HEIGHT,
    },
  }
}

describe('raster notehead morphology instances', () => {
  it('reunites staff-line-split heads and rejects an attached stem and beam', () => {
    const page = image()
    for (const y of [...TREBLE, ...BASS]) line(page, y)
    rect(page, 96, 57, 104, 63)
    rect(page, 96, 49, 104, 55)
    rect(page, 104, 25, 106, 60)
    rect(page, 104, 25, 132, 28)

    const notes = detectRasterNoteheadInstances(page, box(), 170)
    expect(notes).toHaveLength(2)
    expect(notes.map((note) => note.cy).sort((a, b) => a - b)).toEqual([52, 60])
  })

  it('keeps a compact ledger head outside the legacy staff-system box', () => {
    const page = image()
    for (const y of [...TREBLE, ...BASS]) line(page, y)
    rect(page, 96, 161, 104, 167)
    line(page, 164, 91, 109)

    const notes = detectRasterNoteheadInstances(page, box(), 170)
    expect(notes.some((note) => Math.abs(note.cy - 164) <= 2)).toBe(true)
  })

  it('recovers only strong legacy shapes outside morphology ownership', () => {
    const pitchMapping = { lineYs: TREBLE.map((y) => y / HEIGHT) }
    const morphology = [{ cx: 80, cy: 60, clef: 'treble', midi: 72, pitchMapping }]
    const evidence = {
      wideRows: 8,
      midFill: 0.4,
      staffStepResidual: 0.08,
      verticalRun: 7,
    }
    const legacy = [
      { cx: 81, cy: 61, clef: 'treble', midi: 72, pitchMapping, detectionEvidence: evidence },
      { cx: 120, cy: 68, clef: 'treble', midi: 69, pitchMapping, detectionEvidence: evidence },
      {
        cx: 150,
        cy: 68,
        clef: 'treble',
        midi: 69,
        pitchMapping,
        detectionEvidence: { ...evidence, verticalRun: 30 },
      },
    ]
    const fused = fuseRasterNoteheadInstances(legacy, morphology, HEIGHT)
    expect(fused.map((note) => note.cx)).toEqual([80, 120])
    expect(fused[1].detectionEvidence.recoveredBy).toBe(
      'morphology-gap-strong-raster-shape',
    )
  })

  it('recovers a weaker separated tone only inside an owned chord column', () => {
    const pitchMapping = { lineYs: TREBLE.map((y) => y / HEIGHT) }
    const morphology = [{ cx: 80, cy: 60, clef: 'treble', midi: 72, pitchMapping }]
    const chordEvidence = {
      wideRows: 7,
      midFill: 0.28,
      staffStepResidual: 0.29,
      verticalRun: 7,
    }
    const fused = fuseRasterNoteheadInstances(
      [
        {
          cx: 82,
          cy: 84,
          clef: 'treble',
          midi: 65,
          pitchMapping,
          detectionEvidence: chordEvidence,
        },
        {
          cx: 130,
          cy: 84,
          clef: 'treble',
          midi: 65,
          pitchMapping,
          detectionEvidence: chordEvidence,
        },
      ],
      morphology,
      HEIGHT,
    )
    expect(fused.map((note) => note.cx)).toEqual([80, 82])
    expect(fused[1].detectionEvidence.recoveredBy).toBe(
      'morphology-chord-column-raster-shape',
    )
  })

  it('labels dense-only candidates and requires chord-column corroboration', () => {
    const pitchMapping = { lineYs: TREBLE.map((y) => y / HEIGHT) }
    const evidence = {
      wideRows: 8,
      midFill: 0.34,
      staffStepResidual: 0.08,
      verticalRun: 7,
    }
    const ordinary = [
      { cx: 80, cy: 60, clef: 'treble', midi: 72, pitchMapping, detectionEvidence: evidence },
    ]
    const passes = mergeRasterDetectionPasses(
      ordinary,
      [
        { cx: 81, cy: 61, clef: 'treble', midi: 72, pitchMapping, detectionEvidence: evidence },
        { cx: 130, cy: 60, clef: 'treble', midi: 72, pitchMapping, detectionEvidence: evidence },
        { cx: 131, cy: 84, clef: 'treble', midi: 65, pitchMapping, detectionEvidence: evidence },
        { cx: 170, cy: 60, clef: 'treble', midi: 72, pitchMapping, detectionEvidence: evidence },
      ],
      HEIGHT,
    )
    expect(passes).toHaveLength(4)
    expect(passes.filter((note) => note.detectionEvidence.densePassOnly)).toHaveLength(3)

    const fused = fuseRasterNoteheadInstances(passes, ordinary, HEIGHT)
    expect(fused.map((note) => note.cx)).toEqual([80, 130, 131])
    expect(fused.every((note) => note.cx !== 170)).toBe(true)
  })

  it('retains a mutually corroborated compact chord pair at one x column', () => {
    const pitchMapping = { lineYs: TREBLE.map((y) => y / HEIGHT) }
    const pair = mergeRasterDetectionPasses(
      [
        {
          cx: 100,
          cy: 72,
          clef: 'treble',
          midi: 69,
          pitchMapping,
          detectionEvidence: {
            wideRows: 4,
            midFill: 0.31,
            staffStepResidual: 0.46,
            verticalRun: 7,
          },
        },
      ],
      [
        {
          cx: 101,
          cy: 96,
          clef: 'treble',
          midi: 62,
          pitchMapping,
          detectionEvidence: {
            wideRows: 8,
            midFill: 0.31,
            staffStepResidual: 0.3,
            verticalRun: 8,
          },
        },
      ],
      HEIGHT,
    )
    const fused = fuseRasterNoteheadInstances(
      pair,
      [{ cx: 150, cy: 60, clef: 'treble', midi: 72, pitchMapping }],
      HEIGHT,
    )
    expect(fused.map((note) => note.cx)).toEqual([100, 101, 150])
  })

  it('does not turn a closely spaced accidental fragment pair into a chord', () => {
    const pitchMapping = { lineYs: TREBLE.map((y) => y / HEIGHT) }
    const evidence = {
      wideRows: 8,
      midFill: 0.35,
      staffStepResidual: 0.25,
      verticalRun: 7,
      densePassOnly: true,
    }
    const fused = fuseRasterNoteheadInstances(
      [
        { cx: 100, cy: 72, clef: 'treble', midi: 69, pitchMapping, detectionEvidence: evidence },
        { cx: 100, cy: 80, clef: 'treble', midi: 67, pitchMapping, detectionEvidence: evidence },
      ],
      [{ cx: 150, cy: 60, clef: 'treble', midi: 72, pitchMapping }],
      HEIGHT,
    )
    expect(fused.map((note) => note.cx)).toEqual([150])
  })

  it('keeps the precision pass when morphology covers under half its notes', () => {
    const pitchMapping = { lineYs: TREBLE.map((y) => y / HEIGHT) }
    const legacy = [60, 90, 120, 150].map((cx) => ({
      cx,
      cy: 60,
      clef: 'treble',
      midi: 72,
      pitchMapping,
      detectionEvidence: {
        source: 'raster-shape',
        wideRows: 5,
        midFill: 0.4,
        staffStepResidual: 0.1,
        verticalRun: 6,
      },
    }))
    const fused = fuseRasterNoteheadInstances(
      legacy,
      [{ cx: 60, cy: 60, clef: 'treble', midi: 72, pitchMapping }],
      HEIGHT,
    )
    expect(fused.map((note) => note.cx)).toEqual([60, 90, 120, 150])
  })

  it('rejects compact components immediately against the right barline', () => {
    const page = image()
    for (const y of [...TREBLE, ...BASS]) line(page, y)
    rect(page, 96, 57, 104, 63)
    rect(page, 202, 57, 210, 63)

    const notes = detectRasterNoteheadInstances(page, box(), 170)
    expect(notes.map((note) => note.cx)).toEqual([100])
  })
})
