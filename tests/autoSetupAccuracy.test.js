/**
 * Auto score-follow setup ACCURACY tests.
 *
 * These assert the generated anchors map to the CORRECT visual location — not
 * merely that anchors exist. Regression cover for "cursor appears but is far
 * from the correct measure/system".
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import {
  cleanPianoPage,
  multiPageScore,
  renderPagesFromArray,
  titledFirstSystemPage,
} from './helpers/syntheticScore.js'
import {
  analyzeSemiAutoScoreSetup,
  DETECTION_STAGE,
  selectMeasureAllocationForSystems,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { allocateMeasureSpansToSystems } from '../src/features/score-follow/allocateMeasuresToSystems.js'
import { detectTolerantStaffSystems, detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { getMeasureAtTime } from '../src/features/musicxml/timingQuery.js'

// ─── helpers ────────────────────────────────────────────────────────────────

/** N 4/4 measures @120 with explicit `new-system` breaks before given measures. */
function timingWithBreaks(measureCount, breakBeforeMeasures = []) {
  const breaks = new Set(breakBeforeMeasures)
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) xml += F.attributes() + F.soundTempo(120)
    if (breaks.has(m)) xml += '<print new-system="yes"/>'
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

function analyze(pages, timingMap) {
  return analyzeSemiAutoScoreSetup({
    pdfSource: 'synthetic',
    numPages: pages.length,
    timingMap,
    renderPage: renderPagesFromArray(pages),
  })
}

const ranges = (preview) =>
  preview.debugReport.systems.map((s) => [s.measureStart, s.measureEnd])

// ─── 1. MusicXML system breaks → exact measure ranges per system ─────────────

describe('measure allocation accuracy', () => {
  it('allocates EXACT measure ranges from MusicXML system breaks', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      timingWithBreaks(12, [5, 9]),
    )
    expect(result.ok).toBe(true)
    expect(ranges(result.preview)).toEqual([
      [1, 4],
      [5, 8],
      [9, 12],
    ])
  })

  it('32 measures over 6 systems uses PDF barline counts, not a flat 32/6 split', async () => {
    // Real engraving: systems hold a non-uniform 5,5,6,5,5,6 measures. The PDF's
    // own barlines (not MusicXML breaks, which can disagree with the engraving)
    // recover the exact ranges.
    const page = cleanPianoPage({ measuresPerSystemList: [5, 5, 6, 5, 5, 6] })
    const result = await analyze([page], timingWithBreaks(32))
    expect(result.ok).toBe(true)
    expect(result.preview.allocationMode).toBe('barline-counts')
    expect(ranges(result.preview)).toEqual([
      [1, 5],
      [6, 10],
      [11, 16],
      [17, 21],
      [22, 26],
      [27, 32],
    ])
  })

  it('rejects over-total partial barline counts when matching MusicXML breaks are available', () => {
    // Winter regression: dense systems produced extra accepted barlines. The
    // partial detected counts summed to 148 for a 125-measure score, and the old
    // reconciliation squeezed early systems down, shifting the whole piece.
    const winterSystemStarts = [
      1, 5, 10, 15, 20, 23, 25, 28, 30, 33, 35, 38, 41, 44, 46, 48, 50, 52,
      54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 80, 85, 91, 94, 96, 99,
      102, 105, 108, 111, 113, 115, 117, 119, 121, 123,
    ]
    const winterDetectedCounts = [
      4, 5, 5, 5, 3, 2, 3, 3, 3, 2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 4, 5, 2, 6,
      7, null, null, 10, 3, 2, 5, null, 11, 4, 2, 3, 3, 3, 3, 3, 3, 2, 2, 7,
      2, null, null,
    ]
    const timingMap = timingWithBreaks(125, winterSystemStarts.slice(1))
    const systemEntries = winterDetectedCounts.map((measureEstimate, index) => ({
      page: Math.floor(index / 6) + 1,
      measureEstimate,
      inkWidth: 1,
    }))

    const result = selectMeasureAllocationForSystems({
      systemEntries,
      measureNumbers: timingMap.measures.map((m) => m.number),
      timingMap,
      systemCountHint: winterSystemStarts.length,
    })

    expect(result.allocationMode).toBe('breaks-or-even')
    expect(result.diagnostics.detectedCountsTotal).toBe(148)
    expect(result.diagnostics.rejectedBarlineCountReason).toBe(
      'barline-counts-over-measure-total-with-matching-musicxml-system-breaks',
    )
    expect(result.spans.map((s) => s.measureStart)).toEqual(winterSystemStarts)
  })

  it('unit: breaks beat even distribution when system count matches', () => {
    const timingMap = timingWithBreaks(12, [4, 7]) // groups 1-3, 4-6, 7-12
    const bounds = { x0: 0.07, x1: 0.93 }
    const entries = [0.25, 0.5, 0.75].map((c) => ({
      page: 1,
      system: { y0: c - 0.05, y1: c + 0.05, center: c, contentBounds: bounds },
      contentBounds: bounds,
      inkWidth: 0.8,
    }))
    const spans = allocateMeasureSpansToSystems(
      entries,
      timingMap.measures.map((m) => m.number),
      timingMap,
    )
    expect(spans.map((s) => [s.measureStart, s.measureEnd])).toEqual([
      [1, 3],
      [4, 6],
      [7, 12],
    ])
  })
})

// ─── 2. First system near header is preserved, not dropped ───────────────────

describe('first-system preservation', () => {
  it('keeps the first system when the title merges with it (straddles header)', () => {
    const img = titledFirstSystemPage({ systems: 4, measuresPerSystem: 4 })
    const systems = detectTolerantStaffSystems(img, detectContentBounds(img))
    // All four systems detected — the title-merged first system is NOT dropped.
    expect(systems.length).toBe(4)
    // Topmost detected system sits near the first drawn staff, not the second.
    const first = systems[0].center
    expect(first).toBeLessThan(0.2)
    expect(Math.abs(first - img.firstStaffCenterNorm)).toBeLessThan(
      Math.abs(first - 0.258),
    )
  })

  it('first anchor maps to the top system, not a lower one (end to end)', async () => {
    const img = titledFirstSystemPage({ systems: 4, measuresPerSystem: 4 })
    const result = await analyze([img], timingWithBreaks(16, [5, 9, 13]))
    expect(result.ok).toBe(true)
    const firstSystem = result.preview.debugReport.systems[0]
    expect(firstSystem.measureStart).toBe(1)
    // Measure 1 anchor near the top of the page, not pushed a system down.
    expect(firstSystem.center).toBeLessThan(0.22)
  })
})

// ─── 3. System-count reconciliation with MusicXML ────────────────────────────

describe('system-count reconciliation', () => {
  it('rebuilds to the MusicXML-expected count when detection disagrees', async () => {
    // 3 detected systems, but MusicXML breaks imply 6.
    const result = await analyze(
      [cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      timingWithBreaks(12, [3, 5, 7, 9, 11]),
    )
    expect(result.ok).toBe(true)
    expect(result.preview.expectedSystemCount).toBe(6)
    expect(result.preview.reconciled).toBe(true)
    expect(result.preview.systemCount).toBe(6)
    expect(result.preview.stage).toBe(DETECTION_STAGE.GEOMETRIC)
  })

  it('does not reconcile when detection already matches MusicXML', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      timingWithBreaks(12, [5, 9]),
    )
    expect(result.preview.reconciled).toBe(false)
    expect(result.preview.systemCount).toBe(3)
  })
})

// ─── 7. Implausible mappings are downgraded, not shown as confident ──────────

describe('plausibility guardrail', () => {
  it('flags an unreconcilable system-count mismatch as implausible', async () => {
    // Multi-page (reconciliation is single-page only): 6 detected vs hint 10.
    const result = await analyze(
      multiPageScore({ pages: 2, systemsPerPage: 3, measuresPerSystem: 4 }),
      timingWithBreaks(20, [3, 5, 7, 9, 11, 13, 15, 17, 19]),
    )
    expect(result.ok).toBe(true)
    expect(result.preview.expectedSystemCount).toBe(10)
    expect(result.preview.plausible).toBe(false)
  })

  it('a clean reconciled/ matched mapping stays plausible', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 6, measuresPerSystem: 5 })],
      timingWithBreaks(30, [6, 11, 16, 21, 26]),
    )
    expect(result.preview.plausible).toBe(true)
  })
})

// ─── 5 & 6. Repeats use WRITTEN visual measure numbering ─────────────────────

describe('repeats and written-measure numbering', () => {
  it('anchors are numbered by written measures, not the repeat-expanded timeline', async () => {
    // oneRepeat: 4 written measures, performed order 1,2,1,2,3,4.
    const timingMap = parseMusicXml(F.oneRepeat())
    const result = await analyze([cleanPianoPage({ systems: 1, measuresPerSystem: 4 })], timingMap)
    expect(result.ok).toBe(true)
    const measures = result.preview.proposedAnchors.map((a) => a.measureNumber)
    // Only written measures 1..4 — never 5/6 from the performed expansion.
    expect(Math.max(...measures)).toBeLessThanOrEqual(4)
    expect(measures.every((m) => m >= 1 && m <= 4)).toBe(true)
  })

  it('cursor resolves to the SAME visual anchor on a repeated pass of a measure', () => {
    const timingMap = parseMusicXml(F.oneRepeat()) // performed 1,2,1,2,3,4 @ 2s each
    const anchors = [
      { id: 'm1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual' },
      { id: 'm2', page: 1, x: 0.4, y: 0.3, measureNumber: 2, source: 'manual' },
      { id: 'm3', page: 1, x: 0.6, y: 0.3, measureNumber: 3, source: 'manual' },
      { id: 'm4', page: 1, x: 0.9, y: 0.3, measureNumber: 4, source: 'manual' },
    ]
    const trust = { showCursor: true, needsSetup: false }

    // Sanity: both times fall in a measure-1 performed pass.
    expect(getMeasureAtTime(timingMap, 1).number).toBe(1)
    expect(getMeasureAtTime(timingMap, 5).number).toBe(1)

    const firstPass = resolveScoreFollowCursor({ timingMap, practiceTime: 1, trustedAnchors: anchors, trust })
    const secondPass = resolveScoreFollowCursor({ timingMap, practiceTime: 5, trustedAnchors: anchors, trust })

    expect(firstPass.cursor.measureNumber).toBe(1)
    expect(secondPass.cursor.measureNumber).toBe(1)
    // Same visual location both passes — the repeat does not move the cursor.
    expect(secondPass.cursor.x).toBeCloseTo(firstPass.cursor.x, 5)
    expect(secondPass.cursor.y).toBeCloseTo(firstPass.cursor.y, 5)
  })
})

// ─── 8. Debug report content ─────────────────────────────────────────────────

describe('auto-setup debug report', () => {
  it('summarises page / system / measure-range and hints used', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      timingWithBreaks(12, [5, 9]),
    )
    const report = result.preview.debugReport
    expect(report).toBeTruthy()
    expect(report.stage).toBeTruthy()
    expect(typeof report.confidence).toBe('number')
    expect(report.detectedSystemCount).toBe(3)
    expect(report.hintsUsed.systemBreaks).toBe(true)
    expect(Array.isArray(report.perPage)).toBe(true)
    expect(report.perPage[0]).toHaveProperty('page')
    expect(report.perPage[0]).toHaveProperty('systemCount')
    expect(report.systems).toHaveLength(3)
    for (const system of report.systems) {
      expect(system).toHaveProperty('measureStart')
      expect(system).toHaveProperty('measureEnd')
      expect(system).toHaveProperty('center')
      expect(system).toHaveProperty('page')
    }
  })

  it('reports MusicXML default-x availability', async () => {
    const timingMap = parseMusicXml(F.layoutRichTwoSystems())
    const result = await analyze([cleanPianoPage({ systems: 2, measuresPerSystem: 2 })], timingMap)
    expect(result.preview.debugReport.hintsUsed.defaultX).toBe(true)
  })
})

// ─── anchors carry full location metadata ────────────────────────────────────

describe('anchor metadata', () => {
  it('every anchor has measureNumber, page, x, y, systemIndex, source', async () => {
    const result = await analyze(
      [cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      timingWithBreaks(12, [5, 9]),
    )
    for (const anchor of result.preview.proposedAnchors) {
      expect(typeof anchor.measureNumber).toBe('number')
      expect(typeof anchor.page).toBe('number')
      expect(typeof anchor.x).toBe('number')
      expect(typeof anchor.y).toBe('number')
      expect(typeof anchor.source).toBe('string')
      expect(typeof anchor.meta?.systemIndex).toBe('number')
    }
    const trust = assessScoreFollowTrust({
      anchors: result.preview.proposedAnchors,
      timingMap: timingWithBreaks(12, [5, 9]),
    })
    expect(trust.showCursor).toBe(true)
  })
})
