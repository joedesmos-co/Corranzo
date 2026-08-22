import { describe, expect, it } from 'vitest'
import { reconcileSourceSupportedGrandStaffSystems } from '../src/features/omr/reconcileGrandStaffSystems.js'

const WIDTH = 600
const HEIGHT = 500

function imageData() {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  data.fill(255)
  return { width: WIDTH, height: HEIGHT, data }
}

function stave(y0) {
  return {
    y0,
    y1: y0 + 0.04,
    center: y0 + 0.02,
    staveCount: 1,
    lineCount: 5,
    lineYs: [y0, y0 + 0.01, y0 + 0.02, y0 + 0.03, y0 + 0.04],
  }
}

function vectorBar(candidateId, x, y0 = 100, y1 = 180) {
  return {
    candidateId,
    x,
    width: 1,
    height: y1 - y0,
    bounds: { x0: x - 0.5, x1: x + 0.5, y0, y1, width: 1, height: y1 - y0 },
  }
}

function reconcile(vectorBarlines) {
  return reconcileSourceSupportedGrandStaffSystems({
    page: 7,
    systems: [stave(0.2), stave(0.32)],
    contentBounds: { x0: 0.08, x1: 0.92 },
    imageData: imageData(),
    vectorBarlines,
  })
}

describe('source-supported grand-staff system reconciliation', () => {
  it('merges an unresolved five-line pair when printed bars span both staves', () => {
    const result = reconcile([
      vectorBar('start', 80),
      vectorBar('middle', 300),
      vectorBar('end', 520),
    ])

    expect(result.applied).toBe(true)
    expect(result.systems).toHaveLength(1)
    expect(result.systems[0].staveCount).toBe(2)
    expect(result.merges[0]).toMatchObject({
      originalSystemIndices: [0, 1],
      boundaryCount: 3,
      reason: 'source-supported-grand-staff-boundary-graph',
    })
  })

  it('keeps independent staves separate when only aligned fragments exist', () => {
    const result = reconcile([
      vectorBar('upper-start', 80, 100, 120),
      vectorBar('lower-start', 80, 160, 180),
      vectorBar('upper-end', 520, 100, 120),
      vectorBar('lower-end', 520, 160, 180),
    ])

    expect(result.applied).toBe(false)
    expect(result.systems).toHaveLength(2)
  })
})
