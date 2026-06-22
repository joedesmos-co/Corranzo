/**
 * Uploaded-score auto-setup accuracy — the product requirement that ScoreFlow
 * works for REAL user uploads, not just the bundled demo.
 *
 * The bundled demo's hardcoded anchors are treated as INVALID proof here. These
 * tests use only the automatic pipeline (staff-line detection + barline-counted
 * measure ranges + MusicXML staves-per-system) on uploaded-style inputs.
 *
 * The headline case reproduces the real "Guren no Yumiya" layout (4 pages;
 * 5/6/5/3 systems) and asserts the exact page/system measure ranges from the
 * acceptance targets. A guarded test runs the genuine uploaded PDF when present.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  analyzeSemiAutoScoreSetup,
  DETECTION_STAGE,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  areBundledDemoAnchorsDisabled,
  setBundledDemoAnchorsDisabled,
} from '../src/features/demo/demoBundledAnchors.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { multiPageScoreWithCounts, renderPagesFromArray } from './helpers/syntheticScore.js'
import * as F from './helpers/buildXml.js'

/** Piano MusicXML (2 staves), N 4/4 measures @120, NO layout breaks. */
function pianoTimingMap(measureCount) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) {
      xml +=
        '<attributes><divisions>1</divisions><staves>2</staves>' +
        '<time><beats>4</beats><beat-type>4</beat-type></time>' +
        '<clef><sign>G</sign><line>2</line></clef></attributes>' +
        F.soundTempo(120)
    }
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

function analyze(pages, timingMap) {
  return analyzeSemiAutoScoreSetup({
    pdfSource: 'uploaded',
    numPages: pages.length,
    timingMap,
    renderPage: renderPagesFromArray(pages),
  })
}

/** System index within its page (1-based). */
function pageSystemOf(systems, measure) {
  const sys = systems.find((s) => measure >= s.measureStart && measure <= s.measureEnd)
  if (!sys) return null
  const onPage = systems.filter((s) => s.page === sys.page)
  return { page: sys.page, system: onPage.indexOf(sys) + 1 }
}

// Guren layout: page 1 = 5 systems (5,5,4,4,4), page 2 = 6 (4,4,4,3,3,4),
// page 3 = 5 (4,4,4,4,4), page 4 = 3 (4,5,2). Total 75 measures.
const GUREN_PAGES = [
  [5, 5, 4, 4, 4],
  [4, 4, 4, 3, 3, 4],
  [4, 4, 4, 4, 4],
  [4, 5, 2],
]
const GUREN_EXPECTED_STARTS = [
  1, 6, 11, 15, 19, 23, 27, 31, 35, 38, 41, 45, 49, 53, 57, 61, 65, 69, 74,
]

describe('uploaded score auto-setup — Guren layout (4 pages)', () => {
  it('maps each written measure to the correct page/system (exact ranges)', async () => {
    const pages = multiPageScoreWithCounts(GUREN_PAGES)
    const result = await analyze(pages, pianoTimingMap(75))

    expect(result.ok).toBe(true)
    expect(result.preview.stage).toBe(DETECTION_STAGE.STAFF_LINES)
    expect(result.preview.allocationMode).toBe('barline-counts')
    expect(result.preview.systemCount).toBe(19)

    const starts = result.preview.debugReport.systems.map((s) => s.measureStart)
    expect(starts).toEqual(GUREN_EXPECTED_STARTS)

    // Per-page system counts match the real engraving (5,6,5,3).
    expect(result.preview.debugReport.perPage.map((p) => p.systemCount)).toEqual([5, 6, 5, 3])
  })

  it('satisfies every acceptance checkpoint', async () => {
    const pages = multiPageScoreWithCounts(GUREN_PAGES)
    const result = await analyze(pages, pianoTimingMap(75))
    const systems = result.preview.debugReport.systems

    // [measure, expectedPage, expectedSystemOnPage]
    const checks = [
      [1, 1, 1],
      [6, 1, 2],
      [15, 1, 4],
      [23, 2, 1],
      [45, 3, 1],
      [65, 4, 1],
      [70, 4, 2],
      [74, 4, 3],
    ]
    for (const [measure, page, system] of checks) {
      expect(pageSystemOf(systems, measure)).toEqual({ page, system })
    }
  })

  it('measure 1 lands on the first system, never the title/header', async () => {
    const pages = multiPageScoreWithCounts(GUREN_PAGES)
    const result = await analyze(pages, pianoTimingMap(75))
    const firstSystem = result.preview.debugReport.systems[0]
    expect(firstSystem.measureStart).toBe(1)
    expect(firstSystem.page).toBe(1)
    // Above the header cutoff → not in the title block.
    expect(firstSystem.center).toBeGreaterThan(0.08)
  })
})

describe('bundled-demo-anchor honesty switch', () => {
  it('can be toggled so the demo must use the real auto-setup path', () => {
    expect(areBundledDemoAnchorsDisabled()).toBe(false)
    setBundledDemoAnchorsDisabled(true)
    expect(areBundledDemoAnchorsDisabled()).toBe(true)
    setBundledDemoAnchorsDisabled(false)
    expect(areBundledDemoAnchorsDisabled()).toBe(false)
  })

  it('uploaded-style score (no bundled anchors) auto-maps via the real pipeline', async () => {
    // This is a true auto-setup success: no demo bundle involved at all.
    const pages = multiPageScoreWithCounts([[4, 4, 4], [4, 4, 4]])
    const result = await analyze(pages, pianoTimingMap(24))
    expect(result.ok).toBe(true)
    expect(result.preview.stage).toBe(DETECTION_STAGE.STAFF_LINES)
    const trust = assessScoreFollowTrust({
      anchors: result.preview.proposedAnchors,
      timingMap: pianoTimingMap(24),
    })
    expect(trust.showCursor).toBe(true)
    expect(trust.needsSetup).toBe(false)
  })
})

describe('cursor resolver uses explicit measure metadata, not anchor order', () => {
  it('picks the correct measure anchor regardless of array order', () => {
    const timingMap = parseMusicXml(F.straight4())
    // Deliberately shuffled so array order ≠ measure order.
    const anchors = [
      { id: 'a3', page: 1, x: 0.7, y: 0.3, measureNumber: 3, source: 'manual' },
      { id: 'a1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual' },
      { id: 'a4', page: 1, x: 0.9, y: 0.3, measureNumber: 4, source: 'manual' },
      { id: 'a2', page: 1, x: 0.4, y: 0.3, measureNumber: 2, source: 'manual' },
    ]
    const trust = { showCursor: true, needsSetup: false }
    // ~measure 3 (each measure 2s at 120bpm 4/4).
    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 5,
      trustedAnchors: anchors,
      trust,
    })
    // Measure 3 selected by measure number, not by being first in the array.
    expect(result.cursor.measureNumber).toBe(3)
    // x is on measure 3's segment (it glides from m3's 0.7 toward m4's 0.9),
    // never measure 1's 0.1 — proving measure-keyed, not order-keyed, lookup.
    expect(result.cursor.x).toBeGreaterThanOrEqual(0.7)
    expect(result.cursor.x).toBeLessThanOrEqual(0.9)
  })
})

describe('downgrade when mapping is implausible', () => {
  it('flags an unreconcilable page/system mismatch instead of pretending', async () => {
    // Multi-page (reconciliation is single-page only): detected systems can't be
    // reconciled with a MusicXML system-break count that implies far more.
    let xml = ''
    const breaks = new Set([3, 5, 7, 9, 11, 13, 15, 17, 19])
    for (let m = 1; m <= 20; m += 1) {
      xml += `<measure number="${m}">`
      if (m === 1) xml += F.attributes() + F.soundTempo(120)
      if (breaks.has(m)) xml += '<print new-system="yes"/>'
      xml += F.fourQuarters()
      xml += `</measure>`
    }
    const timingMap = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const pages = multiPageScoreWithCounts([[4, 4, 4], [4, 4, 4]]) // ~6 systems
    const result = await analyze(pages, timingMap)
    expect(result.ok).toBe(true)
    expect(result.preview.plausible).toBe(false)
  })
})

// ── Guarded: the genuine uploaded Guren PDF + MXL, when available locally ─────
// Runs against a rendered RGBA dump of the real PDF (produced during
// development; see report). Skips cleanly when absent, e.g. in CI.
let gurenReady = false
let gurenPages = []
let gurenTiming = null
try {
  const meta = JSON.parse(readFileSync('/tmp/guren/r1000/meta.json', 'utf8'))
  gurenPages = meta.map((m) => ({
    width: m.width,
    height: m.height,
    data: new Uint8ClampedArray(readFileSync(`/tmp/guren/r1000/page${m.page}.rgba`)),
  }))
  gurenTiming = parseMusicXml(readFileSync('/tmp/guren/score.xml', 'utf8'))
  gurenReady = gurenPages.length === 4 && gurenTiming.measures.length === 75
} catch {
  gurenPages = []
}
const gurenIt = gurenReady ? it : it.skip

describe('real uploaded Guren PDF + MXL (guarded)', () => {
  gurenIt('produces the exact acceptance system starts', async () => {
    const result = await analyze(gurenPages, gurenTiming)
    expect(result.ok).toBe(true)
    const starts = result.preview.debugReport.systems.map((s) => s.measureStart)
    expect(starts).toEqual(GUREN_EXPECTED_STARTS)
  })
})

// ── Guarded: the genuine uploaded Gymnopédie No. 1 (light classical) ──────────
let gymReady = false
let gymPages = []
let gymTiming = null
try {
  const meta = JSON.parse(readFileSync('/tmp/gym/r1000/meta.json', 'utf8'))
  gymPages = meta.map((m) => ({
    width: m.width,
    height: m.height,
    data: new Uint8ClampedArray(readFileSync(`/tmp/gym/r1000/page${m.page}.rgba`)),
  }))
  gymTiming = parseMusicXml(readFileSync('/tmp/gym/score.xml', 'utf8'))
  gymReady = gymPages.length >= 1 && gymTiming.measures.length > 0
} catch {
  gymPages = []
}
const gymIt = gymReady ? it : it.skip

describe('real uploaded Gymnopédie PDF + MXL (guarded)', () => {
  gymIt('auto-detects systems on this clean light classical score', async () => {
    const result = await analyze(gymPages, gymTiming)
    expect(result.ok).toBe(true) // must NOT be "Auto setup could not find systems"
    expect(result.preview.stage).toBe(DETECTION_STAGE.STAFF_LINES)
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(10)
    // Treble/bass paired into grand-staff systems on every page (≈5 per page).
    expect(result.preview.debugReport.perPage.every((p) => p.systemCount >= 4)).toBe(true)
    // One stable per-measure anchor for every written measure.
    expect(result.preview.supplementalMeasureAnchors.length).toBe(gymTiming.measures.length)
  })
})
