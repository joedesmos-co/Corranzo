/**
 * Auto score-follow setup pipeline — staged detection, allocation, trust,
 * and end-to-end analysis on synthetic sheet-music fixtures.
 *
 * Covers the product requirement: a normal PDF + matching MusicXML should
 * produce a usable approximate cursor automatically, with manual marking as a
 * rare last resort. Fixtures mirror real user cases (clean / dense / multi-page
 * / weak barlines / no MusicXML hints / no systems).
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import {
  blankPage,
  cleanPianoPage,
  densePianoPage,
  multiPageScore,
  renderPagesFromArray,
  weakBarlinePage,
} from './helpers/syntheticScore.js'
import {
  detectConservativeStaffSystems,
  detectContentBounds,
  detectTolerantStaffSystems,
  estimateSystemBandsFromContent,
} from '../src/features/score-follow/detectStaffSystems.js'
import {
  allocateMeasureSpansToSystems,
  computeWeightedMeasureCounts,
} from '../src/features/score-follow/allocateMeasuresToSystems.js'
import {
  analyzeSemiAutoScoreSetup,
  DETECTION_STAGE,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  assessScoreFollowTrust,
  FOLLOW_TRUST_LEVEL,
} from '../src/features/score-follow/scoreFollowTrust.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'

// ─── helpers ──────────────────────────────────────────────────────────────

/** N 4/4 measures @120, optionally with a `new-system` break every `breakEvery`. */
function buildTimingMap(measureCount, { breakEvery = null } = {}) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) xml += F.attributes() + F.soundTempo(120)
    if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) {
      xml += '<print new-system="yes"/>'
    }
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

async function analyze(pages, timingMap) {
  return analyzeSemiAutoScoreSetup({
    pdfSource: 'synthetic',
    numPages: pages.length,
    timingMap,
    renderPage: renderPagesFromArray(pages),
  })
}

function systemEntriesFromBands(bands, page = 1, inkWidth = 0.8) {
  return bands.map((system) => ({
    page,
    system,
    contentBounds: system.contentBounds ?? { x0: 0.07, x1: 0.93 },
    inkWidth,
  }))
}

// ─── Stage 2: staff-system detection ────────────────────────────────────────

describe('staff-system detection cascade', () => {
  it('conservative detection finds clean grand-staff systems', () => {
    const img = cleanPianoPage({ systems: 6, measuresPerSystem: 5 })
    const systems = detectConservativeStaffSystems(img)
    expect(systems.length).toBe(6)
  })

  it('tolerant detection recovers dense arrangements where conservative fails', () => {
    const img = densePianoPage({ systems: 5, measuresPerSystem: 6 })
    const conservative = detectConservativeStaffSystems(img)
    const tolerant = detectTolerantStaffSystems(img)
    // Dense notation defeats the high-precision pass…
    expect(conservative.length).toBeLessThan(5)
    // …but the tolerant pass still recovers the systems.
    expect(tolerant.length).toBeGreaterThanOrEqual(4)
  })

  it('ignores title/header ink (systems sit below the header cutoff)', () => {
    const img = cleanPianoPage({ systems: 4, measuresPerSystem: 4, header: true })
    const systems = detectTolerantStaffSystems(img)
    expect(systems.length).toBeGreaterThanOrEqual(1)
    for (const system of systems) {
      expect(system.y0).toBeGreaterThan(0.1)
    }
  })

  it('geometric estimate always returns ≥1 band for an inked page', () => {
    const img = cleanPianoPage({ systems: 3, measuresPerSystem: 4 })
    const bounds = detectContentBounds(img)
    const bands = estimateSystemBandsFromContent(img, bounds, { systemCount: 3 })
    expect(bands.length).toBeGreaterThanOrEqual(1)
    expect(bands.length).toBeLessThanOrEqual(6)
    for (const band of bands) {
      expect(band.estimated).toBe(true)
      expect(band.y1).toBeGreaterThan(band.y0)
    }
  })

  it('geometric estimate honours the MusicXML system-count hint', () => {
    const img = cleanPianoPage({ systems: 4, measuresPerSystem: 4 })
    const bounds = detectContentBounds(img)
    const bands = estimateSystemBandsFromContent(img, bounds, { systemCount: 4 })
    expect(bands.length).toBe(4)
  })

  it('geometric estimate returns no bands for a blank page', () => {
    const img = blankPage()
    const bounds = detectContentBounds(img)
    expect(estimateSystemBandsFromContent(img, bounds)).toEqual([])
  })
})

// ─── Stage 3/4: measure allocation across systems ────────────────────────────

describe('measure allocation', () => {
  it('distributes measures evenly when widths are equal', () => {
    expect(computeWeightedMeasureCounts([1, 1, 1], 9)).toEqual([3, 3, 3])
  })

  it('weights wider systems with more measures (Stage 4 width distribution)', () => {
    const counts = computeWeightedMeasureCounts([2, 1, 1], 12)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(12)
    expect(counts[0]).toBeGreaterThan(counts[1])
  })

  it('gives every system ≥1 measure and never exceeds the total', () => {
    const counts = computeWeightedMeasureCounts([0.5, 0.9, 0.7, 0.6], 10)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10)
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1)
  })

  it('falls back to even weighting when widths are missing', () => {
    expect(computeWeightedMeasureCounts([undefined, null, NaN], 9)).toEqual([3, 3, 3])
  })

  it('uses MusicXML system breaks when present', () => {
    const timingMap = buildTimingMap(12, { breakEvery: 4 })
    const bounds = { x0: 0.07, x1: 0.93 }
    const entries = systemEntriesFromBands(
      [
        { y0: 0.2, y1: 0.3, center: 0.25, contentBounds: bounds },
        { y0: 0.4, y1: 0.5, center: 0.45, contentBounds: bounds },
        { y0: 0.6, y1: 0.7, center: 0.65, contentBounds: bounds },
      ],
    )
    const measureNumbers = timingMap.measures.map((m) => m.number)
    const spans = allocateMeasureSpansToSystems(entries, measureNumbers, timingMap)
    expect(spans.length).toBe(3)
    // Breaks before m5 and m9 → 3 systems of 4 measures each.
    expect(spans[0].measureNumbers).toEqual([1, 2, 3, 4])
    expect(spans[1].measureNumbers).toEqual([5, 6, 7, 8])
    expect(spans[2].measureNumbers).toEqual([9, 10, 11, 12])
  })

  it('distributes by width when MusicXML has no break hints', () => {
    const timingMap = buildTimingMap(12)
    const bounds = { x0: 0.07, x1: 0.93 }
    const entries = systemEntriesFromBands(
      [
        { y0: 0.2, y1: 0.3, center: 0.25, contentBounds: bounds },
        { y0: 0.4, y1: 0.5, center: 0.45, contentBounds: bounds },
      ],
    )
    entries[0].inkWidth = 0.9
    entries[1].inkWidth = 0.45
    const measureNumbers = timingMap.measures.map((m) => m.number)
    const spans = allocateMeasureSpansToSystems(entries, measureNumbers, timingMap)
    expect(spans.length).toBe(2)
    expect(spans[0].measuresInSpan + spans[1].measuresInSpan).toBe(12)
    // Wider first system gets more measures.
    expect(spans[0].measuresInSpan).toBeGreaterThan(spans[1].measuresInSpan)
  })
})

// ─── End-to-end pipeline on synthetic fixtures ───────────────────────────────

describe('analyzeSemiAutoScoreSetup — fixture matrix', () => {
  it('Fixture 1: clean one-page piano → systems + anchors, no manual needed', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 6, measuresPerSystem: 5 })],
      buildTimingMap(30, { breakEvery: 5 }),
    )
    expect(result.ok).toBe(true)
    expect(result.preview.systemCount).toBe(6)
    expect(result.preview.proposedAnchors.length).toBeGreaterThanOrEqual(2)
    // Clean engraving → high-precision conservative stage → "Auto setup complete".
    expect(result.preview.stage).toBe(DETECTION_STAGE.CONSERVATIVE)
    expect(result.preview.approximate).toBe(false)
    expect(result.preview.autoApplyRecommended).toBe(true)
  })

  it('Fixture 1b: single-system clean page yields barline per-measure anchors', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 1, measuresPerSystem: 4 })],
      buildTimingMap(4),
    )
    expect(result.ok).toBe(true)
    // Stage 3: clear barlines → AUTO_MEASURE supplemental anchors.
    expect(result.preview.supplementalMeasureAnchors.length).toBeGreaterThanOrEqual(2)
    expect(
      result.preview.supplementalMeasureAnchors.every(
        (a) => a.source === ANCHOR_SOURCE.AUTO_MEASURE,
      ),
    ).toBe(true)
  })

  it('Fixture 2: dense arrangement → tolerant stage still produces anchors', async () => {
    const result = await analyze(
      [densePianoPage({ systems: 5, measuresPerSystem: 6 })],
      buildTimingMap(30),
    )
    expect(result.ok).toBe(true)
    expect(result.preview.stage).toBe(DETECTION_STAGE.TOLERANT)
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(4)
    expect(result.preview.proposedAnchors.length).toBeGreaterThanOrEqual(2)
  })

  it('Fixture 3: multi-page score → systems detected across pages', async () => {
    const pages = multiPageScore({ pages: 2, systemsPerPage: 3, measuresPerSystem: 4 })
    const result = await analyze(pages, buildTimingMap(24))
    expect(result.ok).toBe(true)
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(5)
    const pagesWithAnchors = new Set(result.preview.proposedAnchors.map((a) => a.page))
    expect(pagesWithAnchors.has(1)).toBe(true)
    expect(pagesWithAnchors.has(2)).toBe(true)
  })

  it('Fixture 4: visible staves, weak barlines → system spans, no measure anchors', async () => {
    const result = await analyze(
      [weakBarlinePage({ systems: 3, measuresPerSystem: 4 })],
      buildTimingMap(12, { breakEvery: 4 }),
    )
    expect(result.ok).toBe(true)
    expect(result.preview.proposedAnchors.length).toBeGreaterThanOrEqual(2)
    // No reliable barlines → fall back to system-span anchors only.
    expect(result.preview.supplementalMeasureAnchors.length).toBe(0)
  })

  it('Fixture 5: no MusicXML system hints → still maps measures across systems', async () => {
    const timingMap = buildTimingMap(12) // no new-system breaks
    expect(timingMap.measures.every((m) => !m.systemBreakBefore || m.number === 1)).toBe(true)
    const result = await analyze([cleanPianoPage({ systems: 3, measuresPerSystem: 4 })], timingMap)
    expect(result.ok).toBe(true)
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(2)
    expect(result.preview.proposedAnchors.length).toBeGreaterThanOrEqual(2)
  })

  it('Fixture 6: blank page → concise no-systems failure (manual fallback)', async () => {
    const result = await analyze([blankPage()], buildTimingMap(8))
    expect(result.ok).toBe(false)
    expect(result.noSystems).toBe(true)
    expect(result.message).toBe('Auto setup could not find systems. Mark system starts.')
  })
})

// ─── Approximate anchors must drive a visible cursor ─────────────────────────

describe('approximate anchors → trust → cursor', () => {
  it('auto system-span anchors are trusted and show an approximate cursor', async () => {
    const timingMap = buildTimingMap(12, { breakEvery: 4 })
    const result = await analyze([cleanPianoPage({ systems: 3, measuresPerSystem: 4 })], timingMap)
    expect(result.ok).toBe(true)
    const anchors = result.preview.proposedAnchors

    const trust = assessScoreFollowTrust({ anchors, timingMap })
    expect(trust.showCursor).toBe(true)
    expect(trust.needsSetup).toBe(false)
    expect(trust.approximate).toBe(true)
    expect(trust.level).toBe(FOLLOW_TRUST_LEVEL.AUTO)

    const atStart = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: anchors,
      trust,
    })
    expect(atStart.cursor.visible).toBe(true)

    const mid = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 10,
      trustedAnchors: anchors,
      trust,
    })
    expect(mid.cursor.visible).toBe(true)
    expect(mid.needsSetup).toBe(false)
  })

  it('barline per-measure (AUTO_MEASURE) anchors show the cursor', async () => {
    const timingMap = buildTimingMap(4)
    const result = await analyze([cleanPianoPage({ systems: 1, measuresPerSystem: 4 })], timingMap)
    const anchors = result.preview.supplementalMeasureAnchors
    const trust = assessScoreFollowTrust({ anchors, timingMap })
    expect(trust.showCursor).toBe(true)
    expect(trust.label).toBe('Approximate — measure barlines')
  })

  it('a detected score never reports needsSetup (manual not required)', async () => {
    const timingMap = buildTimingMap(20)
    const result = await analyze([cleanPianoPage({ systems: 4, measuresPerSystem: 5 })], timingMap)
    const trust = assessScoreFollowTrust({ anchors: result.preview.proposedAnchors, timingMap })
    expect(trust.needsSetup).toBe(false)
  })
})
