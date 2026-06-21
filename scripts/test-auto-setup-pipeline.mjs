/**
 * End-to-end smoke test for the multi-stage auto score-follow pipeline.
 * Run: node scripts/test-auto-setup-pipeline.mjs
 *
 * Uses synthetic sheet-music images (no PDF rasteriser needed) to verify the
 * cascade produces an approximate cursor automatically across realistic cases.
 */
import {
  blankPage,
  cleanPianoPage,
  densePianoPage,
  multiPageScore,
  renderPagesFromArray,
  weakBarlinePage,
} from '../tests/helpers/syntheticScore.js'
import {
  detectConservativeStaffSystems,
  detectTolerantStaffSystems,
} from '../src/features/score-follow/detectStaffSystems.js'
import {
  analyzeSemiAutoScoreSetup,
  DETECTION_STAGE,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from '../tests/helpers/buildXml.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function timingMap(measureCount, { breakEvery = null } = {}) {
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

function analyze(pages, tm) {
  return analyzeSemiAutoScoreSetup({
    pdfSource: 'synthetic',
    numPages: pages.length,
    timingMap: tm,
    renderPage: renderPagesFromArray(pages),
  })
}

// 1. Dense notation: tolerant detection recovers systems conservative can't.
{
  const dense = densePianoPage({ systems: 5, measuresPerSystem: 6 })
  const cons = detectConservativeStaffSystems(dense).length
  const tol = detectTolerantStaffSystems(dense).length
  assert(tol > cons, `tolerant (${tol}) should beat conservative (${cons}) on dense input`)
  assert(tol >= 4, `tolerant should recover dense systems, got ${tol}`)
}

// 2. Clean one-page → high-confidence conservative auto setup.
{
  const result = await analyze(
    [cleanPianoPage({ systems: 6, measuresPerSystem: 5 })],
    timingMap(30, { breakEvery: 5 }),
  )
  assert(result.ok, 'clean page should produce an auto-setup result')
  assert(result.preview.stage === DETECTION_STAGE.CONSERVATIVE, 'clean page should use conservative stage')
  assert(result.preview.proposedAnchors.length >= 2, 'clean page should produce anchors')
  assert(result.preview.approximate === false, 'clean conservative result should not be flagged approximate')
}

// 3. Weak barlines → system spans, no per-measure anchors, still a cursor.
{
  const result = await analyze(
    [weakBarlinePage({ systems: 3, measuresPerSystem: 4 })],
    timingMap(12, { breakEvery: 4 }),
  )
  assert(result.ok, 'weak-barline page should still produce a result')
  assert(result.preview.proposedAnchors.length >= 2, 'weak-barline page should produce system anchors')
}

// 4. Multi-page → anchors on more than one page.
{
  const pages = multiPageScore({ pages: 2, systemsPerPage: 3, measuresPerSystem: 4 })
  const result = await analyze(pages, timingMap(24))
  assert(result.ok, 'multi-page should produce a result')
  const pageSet = new Set(result.preview.proposedAnchors.map((a) => a.page))
  assert(pageSet.has(1) && pageSet.has(2), 'multi-page anchors should span both pages')
}

// 5. Approximate anchors must drive a visible cursor without manual setup.
{
  const tm = timingMap(12, { breakEvery: 4 })
  const result = await analyze([cleanPianoPage({ systems: 3, measuresPerSystem: 4 })], tm)
  const trust = assessScoreFollowTrust({ anchors: result.preview.proposedAnchors, timingMap: tm })
  assert(trust.showCursor, 'approximate auto anchors should show the cursor')
  assert(trust.needsSetup === false, 'detected systems should not require manual setup')
  const cursor = resolveScoreFollowCursor({
    timingMap: tm,
    practiceTime: 0,
    trustedAnchors: result.preview.proposedAnchors,
    trust,
  })
  assert(cursor.cursor.visible, 'cursor should be visible at playback start')
}

// 6. No usable systems → concise failure (manual fallback path).
{
  const result = await analyze([blankPage()], timingMap(8))
  assert(!result.ok, 'blank page should not produce anchors')
  assert(result.noSystems === true, 'blank page should report noSystems')
}

console.log('auto-setup-pipeline: all checks passed.')
