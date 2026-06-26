import { describe, expect, it } from 'vitest'
import {
  computeDocumentDisplayReference,
  getCorrectedPageGeometry,
  getCorrectedPageSize,
  viewerRotationFromAnalysisRotation,
} from '../src/utils/pdfPageGeometry.js'
import { getPageDimensions, isRenderablePageLayout, resolvePdfPageLayout } from '../src/utils/pdfFit.js'
import {
  pageViewRotationsFromOrientation,
  resolveEffectivePageRotations,
} from '../src/utils/pdfPageViewRotation.js'

const PORTRAIT = { width: 1000, height: 1415 }
const LANDSCAPE = { width: 1000, height: 706 }
const CONTAINER = { width: 900, height: 700 }

describe('pdfPageGeometry', () => {
  it('maps analysis rotation to viewer rotation without inversion', () => {
    expect(viewerRotationFromAnalysisRotation(90)).toBe(90)
    expect(viewerRotationFromAnalysisRotation(270)).toBe(270)
    expect(viewerRotationFromAnalysisRotation(180)).toBe(180)
  })

  it('swaps corrected dimensions for quarter-turn pages', () => {
    expect(getCorrectedPageSize(LANDSCAPE, 90)).toEqual({ width: 706, height: 1000 })
    expect(getCorrectedPageSize(LANDSCAPE, 270)).toEqual({ width: 706, height: 1000 })
    expect(getCorrectedPageSize(PORTRAIT, 0)).toEqual(PORTRAIT)
  })

  it('uses source dimensions for react-pdf render props and corrected box for display', () => {
    const geometry = getCorrectedPageGeometry({
      sourceSize: LANDSCAPE,
      viewRotation: 90,
      fitMode: 'page',
      containerSize: CONTAINER,
      canvasPadding: 32,
    })

    expect(geometry.pageRenderProps).toEqual({ width: geometry.renderWidth })
    expect(geometry.renderWidth).toBeCloseTo(LANDSCAPE.width * geometry.scale, 4)
    expect(geometry.renderHeight).toBeCloseTo(LANDSCAPE.height * geometry.scale, 4)
    expect(geometry.displayWidth).toBeCloseTo(geometry.renderHeight, 4)
    expect(geometry.displayHeight).toBeCloseTo(geometry.renderWidth, 4)
    expect(geometry.displayWidth / geometry.displayHeight).toBeCloseTo(706 / 1000, 4)
  })

  it('applies the same visual scale across mixed portrait and rotated landscape pages', () => {
    const reference = computeDocumentDisplayReference(
      { 1: PORTRAIT, 2: LANDSCAPE },
      { 2: 90 },
    )
    expect(reference).toEqual({ correctedWidth: 1000, correctedHeight: 1415 })

    const portraitDims = getPageDimensions('page', PORTRAIT, CONTAINER, 0, 32, reference)
    const landscapeDims = getPageDimensions('page', LANDSCAPE, CONTAINER, 90, 32, reference)

    expect(portraitDims.scale).toBeCloseTo(landscapeDims.scale, 6)
    expect(portraitDims.displayWidth / portraitDims.scale).toBeCloseTo(1000, 2)
    expect(landscapeDims.displayWidth / landscapeDims.scale).toBeCloseTo(706, 2)
  })

  it('leaves upright portrait pages unchanged relative to corrected geometry', () => {
    const withoutRef = getPageDimensions('page', PORTRAIT, CONTAINER)
    const withRef = getPageDimensions('page', PORTRAIT, CONTAINER, 0, 32, {
      correctedWidth: PORTRAIT.width,
      correctedHeight: PORTRAIT.height,
    })

    expect(withoutRef.width).toBeCloseTo(withRef.width, 4)
    expect(withoutRef.displayWidth).toBeCloseTo(withRef.displayWidth, 4)
    expect(withoutRef.displayHeight).toBeCloseTo(withRef.displayHeight, 4)
  })

  it('maps explicit 90° and 270° viewer rotations to the same upright display aspect', () => {
    const reference = { correctedWidth: 1000, correctedHeight: 1415 }
    const at90 = getPageDimensions('page', LANDSCAPE, CONTAINER, 90, 32, reference)
    const at270 = getPageDimensions('page', LANDSCAPE, CONTAINER, 270, 32, reference)

    expect(at90.scale).toBeCloseTo(at270.scale, 6)
    expect(at90.displayWidth / at90.displayHeight).toBeCloseTo(706 / 1000, 4)
    expect(at270.displayWidth / at270.displayHeight).toBeCloseTo(706 / 1000, 4)
  })

  it('builds pageViewRotations for explicit 90° and 270° orientation entries', () => {
    expect(
      pageViewRotationsFromOrientation({
        pages: [
          { page: 1, rotation: 90 },
          { page: 2, rotation: 270 },
        ],
      }),
    ).toEqual({ 1: 90, 2: 270 })
  })

  describe('resolveEffectivePageRotations (auto + manual layering)', () => {
    const orientation = {
      anyRotated: true,
      pages: [
        { page: 1, rotation: 90 },
        { page: 2, rotation: 90 },
        { page: 3, rotation: 0 },
      ],
    }

    it('derives auto rotations from the reconciled orientation', () => {
      expect(resolveEffectivePageRotations(orientation, {})).toEqual({ 1: 90, 2: 90 })
    })

    it('lets a manual override win over the auto-detected turn', () => {
      expect(resolveEffectivePageRotations(orientation, { 2: 180 })).toEqual({ 1: 90, 2: 180 })
    })

    it('lets a manual upright (0) override an auto turn', () => {
      expect(resolveEffectivePageRotations(orientation, { 1: 0 })).toEqual({ 1: 0, 2: 90 })
    })

    it('is empty for an upright document — no stale carryover', () => {
      expect(resolveEffectivePageRotations(null, {})).toEqual({})
    })
  })

  it('uses a bounding-box reference so no page overflows the shared scale (mixed sizes)', () => {
    // Neither page has both the max width and the max height, so a single
    // largest-area reference would let the other page overflow. The bounding box
    // bounds both, giving one shared scale at which every page fits (Rule 3).
    const WIDE = { width: 1000, height: 800 }
    const TALL = { width: 600, height: 1500 }
    const reference = computeDocumentDisplayReference({ 1: WIDE, 2: TALL })
    expect(reference).toEqual({ correctedWidth: 1000, correctedHeight: 1500 })

    const wideDims = getPageDimensions('page', WIDE, CONTAINER, 0, 32, reference)
    const tallDims = getPageDimensions('page', TALL, CONTAINER, 0, 32, reference)
    expect(wideDims.scale).toBeCloseTo(tallDims.scale, 6) // one shared scale
    const inner = { width: CONTAINER.width - 32, height: CONTAINER.height - 32 }
    for (const dims of [wideDims, tallDims]) {
      expect(dims.displayWidth).toBeLessThanOrEqual(inner.width + 0.01)
      expect(dims.displayHeight).toBeLessThanOrEqual(inner.height + 0.01)
    }
  })

  it('resolves bootstrap layout before cached source sizes exist', () => {
    const bootstrap = resolvePdfPageLayout({
      fitMode: 'page',
      pageNumber: 1,
      slotPageNumber: 1,
      pageSize: null,
      pageSizesByPage: {},
      containerSize: CONTAINER,
    })
    expect(isRenderablePageLayout(bootstrap)).toBe(true)
    expect(bootstrap.height).toBe(CONTAINER.height - 32)
  })
})
