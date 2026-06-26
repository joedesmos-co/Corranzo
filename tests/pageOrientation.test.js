/**
 * Page orientation detection + correction for rotated sheet-music PDFs.
 * Pure pixel math on synthetic pages, plus an end-to-end guard that upright
 * pages are never misdetected (zero regression) and a 90°-rotated page is
 * corrected instead of producing tiny fake systems.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import { cleanPianoPage, renderPagesFromArray, winterLikeMixedScanPages } from './helpers/syntheticScore.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { pageViewRotationsFromOrientation } from '../src/utils/pdfPageViewRotation.js'
import {
  PAGE_ROTATION,
  applyOrientationConfidencePenalty,
  buildPageOrientationRecord,
  detectPageOrientation,
  horizontalLineScore,
  horizontalLineScoreInBand,
  normalizeImageDataOrientation,
  reconcileDocumentPageOrientations,
  rejectTinySystems,
  rotateImageData,
  summarizePageOrientations,
  verticalLineScore,
  verticalLineScoreInBand,
} from '../src/features/score-follow/pageOrientation.js'

function buildTimingMap(measureCount, { breakEvery = null } = {}) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) xml += F.attributes() + F.soundTempo(120)
    if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) xml += '<print new-system="yes"/>'
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

describe('rotateImageData', () => {
  it('swaps dimensions for 90/270 and preserves them for 180', () => {
    const img = { width: 2, height: 3, data: new Uint8ClampedArray(2 * 3 * 4) }
    expect(rotateImageData(img, 90)).toMatchObject({ width: 3, height: 2 })
    expect(rotateImageData(img, 270)).toMatchObject({ width: 3, height: 2 })
    expect(rotateImageData(img, 180)).toMatchObject({ width: 2, height: 3 })
  })

  it('maps the top-left pixel to the top-right under a 90° clockwise turn', () => {
    const img = { width: 2, height: 3, data: new Uint8ClampedArray(2 * 3 * 4) }
    const set = (x, y) => {
      const i = (y * img.width + x) * 4
      img.data[i] = 10
      img.data[i + 3] = 255
    }
    set(0, 0) // top-left
    const r = rotateImageData(img, 90) // 3 wide, 2 tall
    const at = (x, y) => r.data[(y * r.width + x) * 4]
    expect(at(2, 0)).toBe(10) // top-right of the rotated image
  })

  it('a 90° then 270° turn round-trips to the original pixels', () => {
    const img = { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4) }
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) % 256
      img.data[i + 3] = 255
    }
    const round = rotateImageData(rotateImageData(img, 90), 270)
    expect(round.width).toBe(4)
    expect(round.height).toBe(3)
    expect(Array.from(round.data)).toEqual(Array.from(img.data))
  })
})

describe('line-energy scores', () => {
  it('an upright score is horizontal-dominant; rotating it flips the dominance', () => {
    const page = cleanPianoPage({ systems: 3, measuresPerSystem: 4 })
    expect(horizontalLineScore(page)).toBeGreaterThan(verticalLineScore(page))

    const sideways = rotateImageData(page, 90)
    expect(verticalLineScore(sideways)).toBeGreaterThan(horizontalLineScore(sideways))
  })

  it('ignores title/footer bands when scoring staff-line direction', () => {
    const page = cleanPianoPage({ systems: 3, measuresPerSystem: 4, header: false })
    const withEdgeText = winterLikeMixedScanPages(1)[0]
    const sideways = rotateImageData(page, 90)
    const sidewaysWithText = withEdgeText

    expect(horizontalLineScoreInBand(sideways)).toBeLessThan(verticalLineScoreInBand(sideways))
    expect(horizontalLineScoreInBand(sidewaysWithText)).toBeLessThan(
      verticalLineScoreInBand(sidewaysWithText),
    )
  })
})

describe('detectPageOrientation', () => {
  it('reports an upright page as NOT rotated and NOT uncertain', () => {
    const det = detectPageOrientation(cleanPianoPage({ systems: 3 }))
    expect(det.rotation).toBe(PAGE_ROTATION.NONE)
    expect(det.sideways).toBe(false)
    expect(det.uncertain).toBe(false)
  })

  it('detects a 90°-rotated sheet-music page as sideways', () => {
    const det = detectPageOrientation(rotateImageData(cleanPianoPage({ systems: 3 }), 90))
    expect(det.sideways).toBe(true)
    expect(det.verticalScore).toBeGreaterThan(det.horizontalScore)
  })
})

describe('normalizeImageDataOrientation', () => {
  it('is a no-op (same bitmap reference) for an upright page', () => {
    const page = cleanPianoPage({ systems: 3 })
    const result = normalizeImageDataOrientation(page)
    expect(result.rotation).toBe(PAGE_ROTATION.NONE)
    expect(result.imageData).toBe(page)
  })

  it('restores horizontal staff dominance for a sideways page', () => {
    const sideways = rotateImageData(cleanPianoPage({ systems: 3 }), 90)
    const result = normalizeImageDataOrientation(sideways)
    expect(result.sideways).toBe(true)
    expect(result.rotation).not.toBe(PAGE_ROTATION.NONE)
    expect(horizontalLineScore(result.imageData)).toBeGreaterThan(
      verticalLineScore(result.imageData),
    )
  })
})

describe('rejectTinySystems', () => {
  it('drops impossibly thin bands but keeps real systems and unknown geometry', () => {
    const entries = [
      { system: { y0: 0.1, y1: 0.18 } }, // 0.08 tall — real
      { system: { y0: 0.4, y1: 0.405 } }, // 0.005 tall — sliver
      { system: {} }, // unknown — kept
    ]
    const kept = rejectTinySystems(entries)
    expect(kept).toHaveLength(2)
    expect(kept[0].system.y1).toBe(0.18)
  })
})

describe('orientation summary + confidence penalty', () => {
  it('summarizes rotation/uncertainty across pages', () => {
    const summary = summarizePageOrientations([
      { page: 1, rotation: 0, uncertain: false },
      { page: 2, rotation: 90, uncertain: true },
    ])
    expect(summary.anyRotated).toBe(true)
    expect(summary.anyUncertain).toBe(true)
    expect(summary.maxRotation).toBe(90)
  })

  it('penalizes confidence only when rotated or uncertain', () => {
    const clean = { anyRotated: false, anyUncertain: false }
    const rotated = { anyRotated: true, anyUncertain: false }
    const both = { anyRotated: true, anyUncertain: true }
    expect(applyOrientationConfidencePenalty(0.8, clean)).toBe(0.8)
    expect(applyOrientationConfidencePenalty(0.8, rotated)).toBeCloseTo(0.68, 5)
    expect(applyOrientationConfidencePenalty(0.8, both)).toBeCloseTo(0.612, 5)
  })
})

describe('document orientation reconciliation', () => {
  it('aligns uncertain first/last pages to the dominant quarter-turn', () => {
    const pages = winterLikeMixedScanPages(8)
    const preliminary = pages.map((imageData, index) => {
      const page = index + 1
      const oriented = normalizeImageDataOrientation(imageData)
      return buildPageOrientationRecord(page, imageData, oriented)
    })

    const dominantBefore = preliminary[1].rotation
    const reconciled = reconcileDocumentPageOrientations(preliminary)
    const dominant = reconciled[1].rotation
    expect(dominant === PAGE_ROTATION.CW90 || dominant === PAGE_ROTATION.CW270).toBe(true)
    expect(reconciled.every((page) => page.rotation === dominant)).toBe(true)
    expect(reconciled[0].rotation).toBe(dominantBefore)
    expect(reconciled[7].rotation).toBe(dominantBefore)
  })

  it('exports a consistent viewer rotation map for mixed edge pages', () => {
    const pages = winterLikeMixedScanPages(8)
    const reconciled = reconcileDocumentPageOrientations(
      pages.map((imageData, index) =>
        buildPageOrientationRecord(index + 1, imageData, normalizeImageDataOrientation(imageData)),
      ),
    )
    const summary = summarizePageOrientations(reconciled)
    const rotations = pageViewRotationsFromOrientation(summary)
    const values = Object.values(rotations)
    expect(values).toHaveLength(8)
    expect(new Set(values).size).toBe(1)
  })
})

describe('end-to-end orientation handling', () => {
  const timingMap = buildTimingMap(12, { breakEvery: 4 })

  it('upright page: no rotation flagged (zero regression)', async () => {
    const page = cleanPianoPage({ systems: 3, measuresPerSystem: 4 })
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })
    expect(result.ok).toBe(true)
    expect(result.preview.orientation.anyRotated).toBe(false)
  })

  it('90°-rotated page: corrected, flagged, and not exploded into tiny systems', async () => {
    const sideways = rotateImageData(cleanPianoPage({ systems: 3, measuresPerSystem: 4 }), 90)
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([sideways]),
    })
    expect(result.preview?.orientation?.anyRotated ?? result.ok === false).toBeTruthy()
    if (result.ok) {
      // After correction the page yields a sane handful of systems, not a spray
      // of slivers.
      expect(result.preview.systemCount).toBeLessThanOrEqual(6)
    }
  })

  it('mixed edge-page scans reconcile to one upright orientation across the document', async () => {
    const pages = winterLikeMixedScanPages(8)
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 8,
      timingMap: buildTimingMap(24, { breakEvery: 4 }),
      renderPage: renderPagesFromArray(pages),
    })

    expect(result.ok).toBe(true)
    const rotations = (result.preview.orientation.pages ?? []).map((page) => page.rotation)
    expect(rotations).toHaveLength(8)
    expect(new Set(rotations).size).toBe(1)
    expect(rotations[0]).toBe(rotations[1])
    expect(rotations[7]).toBe(rotations[1])
    const viewerRotations = pageViewRotationsFromOrientation(result.preview.orientation)
    expect(new Set(Object.values(viewerRotations)).size).toBe(1)
  })
})
