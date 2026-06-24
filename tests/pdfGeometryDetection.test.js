/**
 * Real PDF-geometry detection quality, scored against synthetic pages whose
 * printed measure geometry is KNOWN. Runs the actual pixel pipeline
 * (analyzeSemiAutoScoreSetup → buildPerMeasureSystemAnchors) and compares the
 * detected measure boundaries / system ends to ground truth.
 *
 * Geometry-only fields (measureStartX / playableEndX / systemEndX) isolate PDF
 * geometry detection from the beat-1 onset heuristic (playableStartX, which
 * legitimately sits a little right of the boundary, further on a clef-bearing
 * first measure).
 */
import { describe, expect, it } from 'vitest'
import {
  cleanPianoPage,
  densePianoPage,
  groundTruthAnchors,
  lightClassicalPage,
  multiPageScore,
  renderPagesFromArray,
  unevenMeasurePage,
} from './helpers/syntheticScore.js'
import {
  assessBarlineReliability,
  detectStaffLineSystems,
} from '../src/features/score-follow/detectStaffLines.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  assessPromotionReadiness,
  compareAnchorSets,
  GEOMETRY_COMPARISON_FIELDS,
  PROMOTION_STATUS,
} from '../src/features/score-follow/anchorComparison.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'

const PIANO_ATTRIBUTES =
  '<attributes><divisions>1</divisions><staves>2</staves>' +
  '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'

function pianoTimingMap(measureCount, breakEvery) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) xml += PIANO_ATTRIBUTES + F.soundTempo(120)
    if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) xml += '<print new-system="yes"/>'
    xml += F.fourQuarters() + '</measure>'
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

async function detectGeometry(pages, measureCount, breakEvery) {
  const res = await analyzeSemiAutoScoreSetup({
    pdfSource: 'synthetic',
    numPages: pages.length,
    timingMap: pianoTimingMap(measureCount, breakEvery),
    renderPage: renderPagesFromArray(pages),
  })
  const detected = res.preview.supplementalMeasureAnchors
  const truth = groundTruthAnchors(pages)
  const comparison = compareAnchorSets(detected, truth, { fields: GEOMETRY_COMPARISON_FIELDS })
  return { res, detected, truth, comparison, readiness: assessPromotionReadiness(comparison) }
}

describe('PDF geometry detection — boundaries/system-ends match ground truth (READY)', () => {
  it('clean single page: detected geometry is READY-accurate', async () => {
    const { res, comparison, readiness } = await detectGeometry(
      [cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      12,
      4,
    )
    expect(res.preview.systemCount).toBe(3)
    expect(comparison.measuresCompared).toBe(12)
    expect(comparison.pageMismatchCount).toBe(0)
    expect(comparison.systemMismatchCount).toBe(0)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
  })

  it('clean multi-page: anchors span both pages and geometry is READY-accurate', async () => {
    const { detected, comparison, readiness } = await detectGeometry(
      multiPageScore({ pages: 2, systemsPerPage: 3, measuresPerSystem: 4 }),
      24,
      4,
    )
    const pages = new Set(detected.map((a) => a.page))
    expect(pages.has(1) && pages.has(2)).toBe(true)
    expect(comparison.pageMismatchCount).toBe(0)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
  })

  it('light-classical (thin staff lines, two-staff systems): READY-accurate', async () => {
    const { res, comparison, readiness } = await detectGeometry(
      [lightClassicalPage({ systems: 4, measuresPerSystem: 4 })],
      16,
      4,
    )
    expect(res.preview.systemCount).toBe(4)
    expect(comparison.systemMismatchCount).toBe(0)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
  })
})

describe('PDF geometry detection — uneven measures: detected barlines beat even distribution', () => {
  // The headline improvement: measures of differing widths. Even distribution
  // (the prior behaviour when no MusicXML widths exist) mis-places the inner
  // boundaries; using the detected intermediate barlines places them exactly.
  const fracs = [
    [0.08, 0.34, 0.5, 0.66, 0.92],
    [0.08, 0.3, 0.52, 0.74, 0.92],
  ]

  it('improves an uneven-measure page from NOT_SAFE (even) to READY (detected barlines)', async () => {
    const page = unevenMeasurePage({ systemBarlineFracs: fracs })
    const { detected, truth, comparison, readiness } = await detectGeometry([page], 8, 4)

    // Detected boundaries track the true (uneven) barlines.
    expect(comparison.maxError).toBeLessThanOrEqual(0.005)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
    expect(detected.every((a) => a.meta.xSource === 'barline-boundaries')).toBe(true)

    // BASELINE: what plain even distribution across the system span would score
    // against the same truth — far outside READY (proves the improvement is real).
    const evenAnchors = []
    let measureNumber = 1
    fracs.forEach((f, systemIndex) => {
      const left = f[0]
      const right = f[f.length - 1]
      const n = f.length - 1
      for (let i = 0; i < n; i += 1) {
        evenAnchors.push({
          page: 1,
          measureNumber: measureNumber++,
          meta: {
            systemIndex,
            measureStartX: left + (right - left) * (i / n),
            playableEndX: left + (right - left) * ((i + 1) / n),
            systemEndX: right,
          },
        })
      }
    })
    const evenComparison = compareAnchorSets(evenAnchors, truth, {
      fields: GEOMETRY_COMPARISON_FIELDS,
    })
    expect(evenComparison.maxError).toBeGreaterThan(0.02)
    expect(assessPromotionReadiness(evenComparison).status).toBe(PROMOTION_STATUS.NOT_SAFE)
  })
})

describe('Barline reliability — dense stem grids never yield a confident-but-wrong count', () => {
  it('flags a dense stem-grid as unreliable (no confident measure count)', () => {
    const dense = densePianoPage({ systems: 5, measuresPerSystem: 6 })
    const bounds = detectContentBounds(dense)
    const { systems } = detectStaffLineSystems(dense, bounds, { stavesPerSystem: 2 })
    expect(systems.length).toBe(5)
    for (const system of systems) {
      // Many false-positive "barlines" from stacked stems/noteheads…
      expect(system.barlineCount).toBeGreaterThan(16)
      // …but the count is correctly marked unreliable, so measureEstimate is null
      // (the pipeline then falls back to MusicXML breaks instead of a wrong count).
      expect(system.barlineConfident).toBe(false)
      expect(system.measureEstimate).toBeNull()
    }
  })

  it('keeps a clean barline set as a confident, accurate count', () => {
    const clean = cleanPianoPage({ systems: 3, measuresPerSystem: 4 })
    const bounds = detectContentBounds(clean)
    const { systems } = detectStaffLineSystems(clean, bounds, { stavesPerSystem: 2 })
    for (const system of systems) {
      expect(system.barlineConfident).toBe(true)
      expect(system.measureEstimate).toBe(4)
    }
  })

  it('assessBarlineReliability: rejects too-dense grids and too-many barlines', () => {
    const bounds = { x0: 0.08, x1: 0.92 }
    // 4 evenly spaced measures → confident.
    expect(
      assessBarlineReliability([0.08, 0.29, 0.5, 0.71, 0.92], bounds).confident,
    ).toBe(true)
    // A tight grid (≈3% measure width) → unreliable.
    const grid = Array.from({ length: 25 }, (_, i) => 0.08 + (0.84 * i) / 24)
    const dense = assessBarlineReliability(grid, bounds)
    expect(dense.confident).toBe(false)
  })

  it('dense notation still produces READY geometry (system span is correct)', async () => {
    const { comparison, readiness } = await detectGeometry(
      [densePianoPage({ systems: 5, measuresPerSystem: 6 })],
      30,
      6,
    )
    expect(comparison.systemMismatchCount).toBe(0)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
  })
})

describe('No regression — evenly engraved scores are unchanged by the boundary change', () => {
  it('clean pages still use even spacing identical to the system span', async () => {
    const { detected } = await detectGeometry(
      [cleanPianoPage({ systems: 2, measuresPerSystem: 4 })],
      8,
      4,
    )
    // Evenly drawn barlines → detected boundaries are ~evenly spaced.
    const sys0 = detected.filter((a) => a.meta.systemIndex === 0).sort((a, b) => a.measureNumber - b.measureNumber)
    const widths = sys0.map((a) => a.meta.playableEndX - a.meta.measureStartX)
    const maxW = Math.max(...widths)
    const minW = Math.min(...widths)
    expect(maxW - minW).toBeLessThan(0.01)
  })
})
