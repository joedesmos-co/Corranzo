/**
 * Mixed source-dimension documents: pages whose RAW source boxes differ
 * (landscape scans vs portrait scans) must end in one corrected upright
 * orientation and render at one shared scale. Covers the Library "huge
 * landscape / tiny portrait" regression. Pure model math — no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  correctedOrientationForRecord,
  reconcileDocumentPageOrientations,
} from '../src/features/score-follow/pageOrientation.js'
import {
  buildPageGeometryReport,
  computeDocumentDisplayReference,
} from '../src/utils/pdfPageGeometry.js'
import { getPageDimensions } from '../src/utils/pdfFit.js'

function record(page, over = {}) {
  return {
    page,
    rotation: 0,
    uncertain: false,
    confidence: 0.9,
    sourceWidth: 700,
    sourceHeight: 1000,
    ...over,
  }
}

describe('document-dominant corrected orientation', () => {
  it('flips a landscape-corrected outlier to match the portrait-dominant document', () => {
    const records = [
      record(1),
      record(2),
      record(3),
      // A landscape-source page detected as upright → corrected landscape (the outlier).
      record(4, { sourceWidth: 1000, sourceHeight: 700 }),
    ]
    const reconciled = reconcileDocumentPageOrientations(records)

    const orientations = reconciled.map((page) => correctedOrientationForRecord(page))
    expect(new Set(orientations)).toEqual(new Set(['portrait']))
    expect(reconciled[3].rotation).not.toBe(0) // outlier was turned upright
    expect(reconciled[3].correctionPath).toBe('document-dominant-orientation')
  })

  it('leaves a uniform-orientation document unchanged (normal PDFs)', () => {
    const reconciled = reconcileDocumentPageOrientations([record(1), record(2), record(3)])
    expect(reconciled.every((page) => page.rotation === 0)).toBe(true)
    expect(reconciled.every((page) => correctedOrientationForRecord(page) === 'portrait')).toBe(true)
  })

  it('unifies a mix of portrait and quarter-turned landscape scans to portrait', () => {
    const records = [
      record(1), // portrait source, upright
      record(2, { sourceWidth: 1000, sourceHeight: 700, rotation: 90 }), // landscape source already turned → portrait
      record(3, { sourceWidth: 1000, sourceHeight: 700, rotation: 0 }), // landscape source NOT turned → outlier
    ]
    const reconciled = reconcileDocumentPageOrientations(records)
    expect(reconciled.every((page) => correctedOrientationForRecord(page) === 'portrait')).toBe(true)
  })
})

describe('shared scale across a unified document', () => {
  const CONTAINER = { width: 900, height: 700 }

  it('every page that corrects to the same upright paper renders at one scale/height', () => {
    // Page A: portrait source upright. Page B: landscape source turned 90 → portrait.
    const PORTRAIT = { width: 700, height: 1000 }
    const LANDSCAPE = { width: 1000, height: 700 }
    const orientation = {
      pages: [
        { page: 1, rotation: 0 },
        { page: 2, rotation: 90 },
      ],
    }
    const reference = computeDocumentDisplayReference(
      { 1: PORTRAIT, 2: LANDSCAPE },
      { 1: 0, 2: 90 },
      orientation,
    )
    expect(reference).toEqual({ correctedWidth: 700, correctedHeight: 1000 })

    const a = getPageDimensions('page', PORTRAIT, CONTAINER, 0, 32, reference)
    const b = getPageDimensions('page', LANDSCAPE, CONTAINER, 90, 32, reference)
    expect(a.scale).toBeCloseTo(b.scale, 6)
    expect(a.displayHeight).toBeCloseTo(b.displayHeight, 4)
    expect(a.displayWidth).toBeCloseTo(b.displayWidth, 4)
  })
})

describe('buildPageGeometryReport (verifiable per-page values)', () => {
  it('emits source, rotation, corrected, render and display per page', () => {
    const report = buildPageGeometryReport({
      numPages: 2,
      pageSizesByPage: { 1: { width: 700, height: 1000 }, 2: { width: 1000, height: 700 } },
      orientation: { pages: [{ page: 1, rotation: 0 }, { page: 2, rotation: 90 }] },
      pageViewRotations: { 1: 0, 2: 90 },
      containerSize: { width: 900, height: 700 },
      fitMode: 'page',
      canvasPadding: 32,
      referenceDisplaySize: { correctedWidth: 700, correctedHeight: 1000 },
    })

    expect(report.rows).toHaveLength(2)
    const [p1, p2] = report.rows
    expect(p1.viewerRotation).toBe(0)
    expect(p2.viewerRotation).toBe(90)
    // Landscape source corrected to portrait by the 90° turn.
    expect(p2.correctedWidth).toBe(700)
    expect(p2.correctedHeight).toBe(1000)
    // Both pages occupy the same display box (consistent scale).
    expect(p1.displayWidth).toBeCloseTo(p2.displayWidth, 4)
    expect(p1.displayHeight).toBeCloseTo(p2.displayHeight, 4)
  })

  it('flags a manual override distinctly from the auto-detected turn', () => {
    const report = buildPageGeometryReport({
      numPages: 1,
      pageSizesByPage: { 1: { width: 700, height: 1000 } },
      orientation: { pages: [{ page: 1, rotation: 90 }] },
      pageViewRotations: { 1: 180 }, // user overrode the auto 90 with 180
      containerSize: { width: 900, height: 700 },
      fitMode: 'page',
      canvasPadding: 32,
    })
    expect(report.rows[0].autoRotation).toBe(90)
    expect(report.rows[0].manualRotation).toBe(180)
    expect(report.rows[0].viewerRotation).toBe(180)
  })
})
