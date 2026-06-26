import { describe, expect, it } from 'vitest'
import {
  computeDocumentDisplayReference,
  getCorrectedPageGeometry,
  getCorrectedPageSize,
  viewerRotationFromAnalysisRotation,
} from '../src/utils/pdfPageGeometry.js'
import { getPageDimensions } from '../src/utils/pdfFit.js'
import { pageViewRotationsFromOrientation } from '../src/utils/pdfPageViewRotation.js'

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
})
