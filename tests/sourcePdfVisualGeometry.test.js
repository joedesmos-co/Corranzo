import { describe, expect, it } from 'vitest'
import {
  mapSourceRectIntoCrop,
  resolveSourceCropTransform,
  resolveSourceSystemCrop,
  resolveSourceVisualSystem,
  rotateSourceRect,
} from '../src/features/practice/sourcePdfVisualGeometry.js'

const measureGrid = {
  measures: [
    { page: 1, systemIndex: 0, measureNumber: 1, xStart: 0.08, xEnd: 0.48, yTop: 0.12, yBottom: 0.29 },
    { page: 1, systemIndex: 0, measureNumber: 2, xStart: 0.48, xEnd: 0.92, yTop: 0.12, yBottom: 0.29 },
    { page: 1, systemIndex: 1, measureNumber: 3, xStart: 0.08, xEnd: 0.92, yTop: 0.48, yBottom: 0.65 },
    { page: 2, systemIndex: 0, measureNumber: 4, xStart: 0.06, xEnd: 0.94, yTop: 0.1, yBottom: 0.3 },
  ],
}

function anchor(id, {
  page,
  systemIndex,
  measureNumber,
  bbox,
  representation = 'notation',
  alternates = [],
}) {
  return {
    sourceNoteheadId: `sfnh-${id}`,
    page,
    systemIndex,
    measureNumber,
    representation,
    sourceBBox: bbox,
    sourceCenter: {
      x: (bbox.x0 + bbox.x1) / 2,
      y: (bbox.y0 + bbox.y1) / 2,
    },
    alternates,
  }
}

const sourceVisualMap = {
  anchorCount: 4,
  anchors: [
    anchor('m1', { page: 1, systemIndex: 0, measureNumber: 1, bbox: { x0: 0.18, y0: 0.18, x1: 0.2, y1: 0.2 } }),
    anchor('m2', { page: 1, systemIndex: 0, measureNumber: 2, bbox: { x0: 0.7, y0: 0.22, x1: 0.72, y1: 0.24 } }),
    anchor('m3', { page: 1, systemIndex: 1, measureNumber: 3, bbox: { x0: 0.3, y0: 0.54, x1: 0.32, y1: 0.56 } }),
    anchor('m4', { page: 2, systemIndex: 0, measureNumber: 4, bbox: { x0: 0.24, y0: 0.18, x1: 0.26, y1: 0.2 } }),
  ],
}

describe('source-PDF Visual system selection', () => {
  it('selects the exact owned source page/system and keeps one crop for consecutive notes', () => {
    const firstTarget = {
      visible: true,
      measureNumber: 1,
      sourceAnchors: [{ page: 1, systemIndex: 0, sourceNoteheadId: 'sfnh-m1' }],
    }
    const secondTarget = {
      visible: true,
      measureNumber: 2,
      sourceAnchors: [{ page: 1, systemIndex: 0, sourceNoteheadId: 'sfnh-m2' }],
    }
    const firstSystem = resolveSourceVisualSystem({
      noteTarget: firstTarget,
      sourceVisualMap,
      omrMeasureGrid: measureGrid,
    })
    const secondSystem = resolveSourceVisualSystem({
      noteTarget: secondTarget,
      sourceVisualMap,
      omrMeasureGrid: measureGrid,
    })
    const firstCrop = resolveSourceSystemCrop({
      targetSystem: firstSystem,
      sourceVisualMap,
      omrMeasureGrid: measureGrid,
    })
    const secondCrop = resolveSourceSystemCrop({
      targetSystem: secondSystem,
      sourceVisualMap,
      omrMeasureGrid: measureGrid,
    })

    expect(firstSystem).toMatchObject({ page: 1, systemIndex: 0, source: 'source-ownership' })
    expect({ x0: firstCrop.x0, y0: firstCrop.y0, x1: firstCrop.x1, y1: firstCrop.y1, key: firstCrop.key }).toEqual(
      { x0: secondCrop.x0, y0: secondCrop.y0, x1: secondCrop.x1, y1: secondCrop.y1, key: secondCrop.key },
    )
    expect(firstCrop.key).toBe('1:0')
    expect(firstCrop.x0).toBeLessThanOrEqual(0.18)
    expect(firstCrop.y0).toBeLessThanOrEqual(0.18)
    expect(firstCrop.x1).toBeGreaterThanOrEqual(0.72)
    expect(firstCrop.y1).toBeGreaterThanOrEqual(0.24)
  })

  it('changes crop at a system boundary and page at a page boundary', () => {
    const systemTwo = resolveSourceVisualSystem({
      activeMeasureNumber: 3,
      sourceVisualMap,
      omrMeasureGrid: measureGrid,
    })
    const pageTwo = resolveSourceVisualSystem({
      activeMeasureNumber: 4,
      sourceVisualMap,
      omrMeasureGrid: measureGrid,
    })
    const cropTwo = resolveSourceSystemCrop({ targetSystem: systemTwo, sourceVisualMap, omrMeasureGrid: measureGrid })
    const cropPageTwo = resolveSourceSystemCrop({ targetSystem: pageTwo, sourceVisualMap, omrMeasureGrid: measureGrid })

    expect(cropTwo.key).toBe('1:1')
    expect(cropTwo.y0).toBeGreaterThan(0.35)
    expect(cropPageTwo.key).toBe('2:0')
    expect(cropPageTwo.page).toBe(2)
  })

  it('uses active measure for rests, seek, loop wrap, and repeated written measures', () => {
    const systemFor = (measureNumber) =>
      resolveSourceVisualSystem({
        noteTarget: { visible: false, measureNumber },
        activeMeasureNumber: measureNumber,
        sourceVisualMap,
        omrMeasureGrid: measureGrid,
      })

    expect(systemFor(3)).toMatchObject({ page: 1, systemIndex: 1 })
    expect(systemFor(4)).toMatchObject({ page: 2, systemIndex: 0 })
    expect(systemFor(1)).toMatchObject({ page: 1, systemIndex: 0 })
    expect(systemFor(1)).toEqual(systemFor(1))
  })

  it('stays source-backed when ownership is incomplete', () => {
    const target = resolveSourceVisualSystem({
      noteTarget: { visible: true, page: 2, measureNumber: 999, sourceAnchors: [] },
      visiblePageNumber: 2,
      sourceVisualMap: null,
      omrMeasureGrid: null,
      scoreAnchors: [],
    })
    const crop = resolveSourceSystemCrop({ targetSystem: target })
    expect(target.source).toBe('source-page-fallback')
    expect(crop).toMatchObject({ page: 2, source: 'full-source-page', x0: 0, y0: 0, x1: 1, y1: 1 })
  })

  it('selects a coherent TAB band rather than mixing notation/TAB anchor boxes', () => {
    const guitarMap = {
      anchorCount: 1,
      anchors: [
        anchor('guitar', {
          page: 1,
          systemIndex: 0,
          measureNumber: 1,
          bbox: { x0: 0.25, y0: 0.2, x1: 0.28, y1: 0.23 },
          alternates: [{
            representation: 'tab',
            sourceBBox: { x0: 0.25, y0: 0.68, x1: 0.29, y1: 0.71 },
            sourceCenter: { x: 0.27, y: 0.695 },
          }],
        }),
      ],
    }
    const crop = resolveSourceSystemCrop({
      targetSystem: { page: 1, systemIndex: 0, measureNumber: 1 },
      sourceVisualMap: guitarMap,
      preferredRepresentation: 'tab',
    })
    expect(crop.source).toBe('source-anchor-system')
    expect(crop.y0).toBeGreaterThan(0.55)
    expect(crop.y1).toBeGreaterThan(0.7)
  })
})

describe('source-PDF crop coordinate math', () => {
  const crop = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.4 }
  const pageSize = { width: 600, height: 900 }
  const containerSize = { width: 800, height: 300 }

  it.each([
    [0, { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.4 }],
    [90, { x0: 0.6, y0: 0.1, x1: 0.8, y1: 0.9 }],
    [180, { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.8 }],
    [270, { x0: 0.2, y0: 0.1, x1: 0.4, y1: 0.9 }],
  ])('rotates a non-square source crop at %i degrees', (rotation, expected) => {
    const rotated = rotateSourceRect(crop, rotation)
    expect(rotated.x0).toBeCloseTo(expected.x0, 10)
    expect(rotated.y0).toBeCloseTo(expected.y0, 10)
    expect(rotated.x1).toBeCloseTo(expected.x1, 10)
    expect(rotated.y1).toBeCloseTo(expected.y1, 10)
    const transform = resolveSourceCropTransform({ crop, pageSize, containerSize, rotation })
    expect(transform.rotation).toBe(rotation)
    expect(transform.renderedCropWidth).toBeLessThanOrEqual(containerSize.width + 0.001)
    expect(transform.renderedCropHeight).toBeLessThanOrEqual(containerSize.height + 0.001)
  })

  it('maps independent chord boxes into the displayed crop without unioning them', () => {
    const transform = resolveSourceCropTransform({ crop, pageSize, containerSize, rotation: 0 })
    const left = mapSourceRectIntoCrop({ x0: 0.2, y0: 0.25, x1: 0.23, y1: 0.28 }, transform)
    const right = mapSourceRectIntoCrop({ x0: 0.26, y0: 0.3, x1: 0.29, y1: 0.33 }, transform)
    expect(left.x1).toBeLessThan(right.x0)
    expect(left.x0).toBeGreaterThanOrEqual(0)
    expect(right.x1).toBeLessThanOrEqual(containerSize.width)
    expect(left.y0).toBeGreaterThanOrEqual(0)
    expect(right.y1).toBeLessThanOrEqual(containerSize.height)
  })

  it('recomputes scale on resize and supports heterogeneous page sizes', () => {
    const small = resolveSourceCropTransform({
      crop,
      pageSize: { width: 600, height: 900 },
      containerSize: { width: 400, height: 150 },
    })
    const large = resolveSourceCropTransform({
      crop,
      pageSize: { width: 600, height: 900 },
      containerSize: { width: 800, height: 300 },
    })
    const landscapePage = resolveSourceCropTransform({
      crop,
      pageSize: { width: 1200, height: 500 },
      containerSize: { width: 800, height: 300 },
      rotation: 90,
    })

    expect(large.scale).toBeCloseTo(small.scale * 2, 8)
    expect(landscapePage.renderedCropWidth).toBeLessThanOrEqual(800.001)
    expect(landscapePage.renderedCropHeight).toBeLessThanOrEqual(300.001)
  })
})
