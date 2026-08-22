import { describe, expect, it } from 'vitest'
import {
  buildCanonicalMeasureBoundaryGraph,
  MEASURE_BOUNDARY_TYPE,
} from '../src/features/omr/canonicalMeasureBoundaryGraph.js'

const WIDTH = 600
const HEIGHT = 500

function imageData() {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  data.fill(255)
  return { width: WIDTH, height: HEIGHT, data }
}

function paintVertical(image, x, y0, y1, value = 0) {
  for (let y = y0; y <= y1; y += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const index = (y * image.width + x + dx) * 4
      image.data[index] = value
      image.data[index + 1] = value
      image.data[index + 2] = value
      image.data[index + 3] = 255
    }
  }
}

function vectorBar(candidateId, x, y0 = 100, y1 = 180, width = 1) {
  return {
    candidateId,
    x,
    width,
    height: y1 - y0,
    bounds: { x0: x - width / 2, x1: x + width / 2, y0, y1, width, height: y1 - y0 },
  }
}

function grandStaffSystem() {
  return {
    y0: 0.18,
    y1: 0.38,
    staves: [
      { y0: 0.2, y1: 0.24, lineYs: [0.2, 0.21, 0.22, 0.23, 0.24] },
      { y0: 0.32, y1: 0.36, lineYs: [0.32, 0.33, 0.34, 0.35, 0.36] },
    ],
  }
}

function graph(vectorBarlines, image = imageData(), system = grandStaffSystem()) {
  return buildCanonicalMeasureBoundaryGraph({
    page: 1,
    systemIndex: 2,
    system,
    contentBounds: { x0: 0.08, x1: 0.92 },
    imageData: image,
    vectorBarlines,
  })
}

describe('canonical vector measure-boundary graph', () => {
  it('creates one ordered boundary and provenance record per printed grand-staff barline', () => {
    const result = graph([
      vectorBar('start', 80),
      vectorBar('middle', 300),
      vectorBar('end', 520),
    ])

    expect(result.usable).toBe(true)
    expect(result.measureSpans).toHaveLength(2)
    expect(result.boundaries.map((entry) => entry.type)).toEqual([
      MEASURE_BOUNDARY_TYPE.SYSTEM_START,
      MEASURE_BOUNDARY_TYPE.SINGLE,
      MEASURE_BOUNDARY_TYPE.SYSTEM_END,
    ])
    expect(result.boundaries[1].componentIds).toEqual(['middle'])
    expect(result.measureSpans[0].rightBoundaryId).toBe('p1-s2-b1')
  })

  it('recovers a fragmented lower continuation only with raster source corroboration', () => {
    const bars = [
      vectorBar('start', 80, 100, 160),
      vectorBar('middle', 300, 100, 160),
      vectorBar('end', 520, 100, 160),
    ]
    const withoutRaster = graph(bars)
    expect(withoutRaster.usable).toBe(false)

    const raster = imageData()
    for (const x of [80, 300, 520]) {
      paintVertical(raster, x, 160, 180)
    }
    const withRaster = graph(bars, raster)
    expect(withRaster.usable).toBe(true)
    expect(withRaster.boundaries[1].evidence).toContain('raster-source-corroboration')
  })

  it('does not turn aligned upper/lower stems into a printed boundary', () => {
    const result = graph([
      vectorBar('start', 80),
      vectorBar('upper-stem', 300, 100, 120),
      vectorBar('lower-stem', 300, 160, 180),
      vectorBar('end', 520),
    ])

    expect(result.usable).toBe(true)
    expect(result.measureSpans).toHaveLength(1)
    expect(result.rejectedColumns).toHaveLength(1)
    expect(result.rejectedColumns[0].pairedStaffFragments).toBe(true)
  })

  it('groups adjacent thin and thick strokes as one final-bar boundary', () => {
    const result = graph([
      vectorBar('start', 80),
      vectorBar('final-thin', 514, 100, 180, 1),
      vectorBar('final-thick', 520, 100, 180, 3),
    ])

    expect(result.usable).toBe(true)
    expect(result.measureSpans).toHaveLength(1)
    expect(result.boundaries[1].type).toBe(MEASURE_BOUNDARY_TYPE.SYSTEM_END)
    expect(result.boundaries[1].printedType).toBe(MEASURE_BOUNDARY_TYPE.FINAL)
    expect(result.boundaries[1].componentIds).toEqual(['final-thin', 'final-thick'])
  })

  it('declines unresolved single-stave geometry so the established fallback remains active', () => {
    const singleStaff = {
      y0: 0.2,
      y1: 0.24,
      staves: [{ y0: 0.2, y1: 0.24, lineYs: [0.2, 0.21, 0.22, 0.23, 0.24] }],
    }
    const result = graph(
      [vectorBar('start', 80, 100, 120), vectorBar('end', 520, 100, 120)],
      imageData(),
      singleStaff,
    )

    expect(result.usable).toBe(false)
    expect(result.reason).toBe('not-a-resolved-grand-staff')
  })
})
