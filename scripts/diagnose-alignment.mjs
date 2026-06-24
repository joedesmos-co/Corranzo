/**
 * Diagnostic: reconcile a score's layout against detected (or known) per-system
 * barline counts and print an exportable alignment report.
 *
 * Pure-logic — no PDF rasterization — so it runs headless in CI. The PDF-side
 * input is per-system barline counts: either passed with --counts, derived from
 * a bundled anchors JSON with --anchors, or (for --check) read from the demo.
 *
 * Usage:
 *   node scripts/diagnose-alignment.mjs --check
 *   node scripts/diagnose-alignment.mjs --fixtures
 *   node scripts/diagnose-alignment.mjs --anchors
 *   node scripts/diagnose-alignment.mjs --compare
 *   node scripts/diagnose-alignment.mjs --detect
 *   node scripts/diagnose-alignment.mjs <score.musicxml> --counts 5,5,6,5,5,6
 *   node scripts/diagnose-alignment.mjs <score.musicxml> --anchors anchors.json [--json report.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import { LAYOUT_CONFIDENCE } from '../src/features/score-follow/layoutAssessment.js'
import {
  buildAlignmentReport,
  formatAlignmentReportText,
  serializeAlignmentReport,
} from '../src/features/score-follow/alignmentReport.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function countsFromAnchors(anchorsJson) {
  const bySystem = new Map()
  for (const anchor of anchorsJson.anchors ?? []) {
    const index = anchor.meta?.systemIndex ?? 0
    bySystem.set(index, (bySystem.get(index) ?? 0) + 1)
  }
  return [...bySystem.keys()].sort((a, b) => a - b).map((key) => bySystem.get(key))
}

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function runCheck() {
  const xml = readFileSync(join(root, 'public/fixtures/demo-minuet-in-g.musicxml'), 'utf8')
  const anchors = JSON.parse(
    readFileSync(join(root, 'public/fixtures/demo-minuet-in-g.anchors.json'), 'utf8'),
  )
  const timingMap = parseMusicXml(xml, 'demo-minuet-in-g.musicxml')
  const counts = countsFromAnchors(anchors)

  const reconciliation = reconcilePdfLayoutWithScore({
    timingMap,
    perSystemBarlineCounts: counts,
    pdfPageCount: 1,
  })
  // The bundled demo anchors are the calibrated ground truth, so the demo's
  // layout confidence is EXACT by construction.
  const report = buildAlignmentReport({
    reconciliation,
    timingMap,
    layoutConfidence: LAYOUT_CONFIDENCE.EXACT,
    pieceId: 'minuet-in-g',
  })
  console.log(formatAlignmentReportText(report))

  const t = reconciliation.totals
  const failures = []
  if (t.expectedMeasureCount !== 32) failures.push(`measures ${t.expectedMeasureCount} != 32`)
  if (t.systemCount !== 6) failures.push(`systems ${t.systemCount} != 6`)
  if (t.minConfidence !== 1) failures.push(`minConfidence ${t.minConfidence} != 1`)
  if (reconciliation.flags.barlineTotalMismatch) failures.push('unexpected barline total mismatch')
  if (reconciliation.perSystem.some((s) => s.delta !== 0)) failures.push('non-zero per-system delta')
  if (report.decision.action !== 'auto') failures.push(`decision ${report.decision.action} != auto`)

  if (failures.length) {
    console.error('\ndiagnose-alignment self-check FAILED:\n  - ' + failures.join('\n  - '))
    process.exit(1)
  }
  console.log('\ndiagnose-alignment: self-check passed (demo Minuet reconciles exactly).')
}

function runFile(args) {
  const file = args[0]
  const timingMap = parseMusicXml(readFileSync(file, 'utf8'), file)

  let counts = []
  const countsArg = argValue(args, '--counts')
  const anchorsArg = argValue(args, '--anchors')
  if (countsArg) {
    counts = countsArg.split(',').map((n) => Number(n.trim()))
  } else if (anchorsArg) {
    counts = countsFromAnchors(JSON.parse(readFileSync(anchorsArg, 'utf8')))
  }

  const reconciliation = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: counts })
  const report = buildAlignmentReport({ reconciliation, timingMap, layoutConfidence: null })
  console.log(formatAlignmentReportText(report))

  const jsonOut = argValue(args, '--json')
  if (jsonOut) {
    writeFileSync(jsonOut, serializeAlignmentReport(report))
    console.log(`\nWrote ${jsonOut}`)
  }
}

async function runFixtures() {
  // Test fixtures live under tests/; load lazily so --check stays self-contained.
  const { RUNNABLE_FIXTURES, METADATA_FIXTURES } = await import(
    '../tests/fixtures/alignmentFixtures.js'
  )

  for (const fixture of RUNNABLE_FIXTURES) {
    const inputs = fixture.makeInputs()
    const reconciliation = reconcilePdfLayoutWithScore(inputs)
    const report = buildAlignmentReport({
      reconciliation,
      timingMap: inputs.timingMap,
      layoutConfidence: inputs.layoutConfidence,
      pieceId: fixture.id,
    })
    console.log('='.repeat(60))
    console.log(`${fixture.title}  [${fixture.license}]`)
    console.log(formatAlignmentReportText(report))
    console.log('')
  }

  console.log('='.repeat(60))
  console.log('Metadata-only fixtures (not bundled — documented):')
  for (const fixture of METADATA_FIXTURES) {
    const d = fixture.documented
    console.log(
      `  ${fixture.title} [${fixture.license}] — expected: ${d.expectedAction}` +
        ` | repeats: ${d.hasRepeats ? 'yes' : 'no'} | pickup: ${d.hasPickup ? 'yes' : 'no'}`,
    )
    console.log(`      reason: ${fixture.reason}`)
  }
}

async function runAnchors() {
  const { RUNNABLE_FIXTURES } = await import('../tests/fixtures/alignmentFixtures.js')
  const { generateAnchorsFromLayout } = await import(
    '../src/features/score-follow/generateAnchorsFromLayout.js'
  )

  for (const fixture of RUNNABLE_FIXTURES) {
    const inputs = fixture.makeInputs()
    const reconciliation = reconcilePdfLayoutWithScore(inputs)
    const generated = generateAnchorsFromLayout(reconciliation, fixture.makePageLayout())
    const report = buildAlignmentReport({
      reconciliation,
      timingMap: inputs.timingMap,
      layoutConfidence: inputs.layoutConfidence,
      pieceId: fixture.id,
      anchorCoverage: generated.coverage,
    })
    console.log('='.repeat(60))
    console.log(`${fixture.title}  [${fixture.license}]`)
    console.log(formatAlignmentReportText(report))
    console.log('')
  }
}

/**
 * Phase 5a — compare generated anchors against trusted reference (bundled)
 * anchors across all runnable fixtures, and print a promotion-readiness report.
 * Proof that generation is accurate enough to *eventually* replace bundled
 * anchors; it does not change any runtime behaviour.
 */
async function runCompare() {
  const { RUNNABLE_FIXTURES } = await import('../tests/fixtures/alignmentFixtures.js')
  const { generateAnchorsFromLayout } = await import(
    '../src/features/score-follow/generateAnchorsFromLayout.js'
  )
  const {
    compareAnchorSets,
    assessPromotionReadiness,
    formatAnchorComparisonText,
    PROMOTION_STATUS,
  } = await import('../src/features/score-follow/anchorComparison.js')
  const { buildPromotionDecision } = await import(
    '../src/features/score-follow/anchorPromotion.js'
  )

  const comparableStatuses = []

  for (const fixture of RUNNABLE_FIXTURES) {
    const reconciliation = reconcilePdfLayoutWithScore(fixture.makeInputs())
    const generated = generateAnchorsFromLayout(reconciliation, fixture.makePageLayout())
    const reference = fixture.makeReferenceAnchors ? fixture.makeReferenceAnchors() : null
    const comparison = compareAnchorSets(generated.anchors, reference)
    const readiness = comparison.comparable ? assessPromotionReadiness(comparison) : null

    // Phase 5b: how the promotion gate would decide for a (non-demo) session.
    const promotion = buildPromotionDecision({
      enabled: true,
      isDemoSession: false,
      comparison,
      readiness,
      anchorCounts: { auto: generated.anchors.length },
      generatedAnchors: generated.anchors,
    })

    console.log('='.repeat(60))
    console.log(`${fixture.title}  [${fixture.license}]`)
    console.log(formatAnchorComparisonText(comparison, readiness))
    console.log(
      `  Promotion gate: ${promotion.useGenerated ? 'USE GENERATED' : 'fall back'} ` +
        `(${promotion.reason})`,
    )
    console.log('')

    if (readiness) {
      comparableStatuses.push({ id: fixture.id, status: readiness.status })
    }
  }

  console.log('='.repeat(60))
  console.log('Promotion readiness (fixtures with trusted reference anchors):')
  if (comparableStatuses.length === 0) {
    console.log('  (none)')
  }
  for (const entry of comparableStatuses) {
    console.log(`  ${entry.id}: ${entry.status}`)
  }

  const allReady =
    comparableStatuses.length > 0 &&
    comparableStatuses.every((entry) => entry.status === PROMOTION_STATUS.READY)
  console.log(
    `\nOverall: ${allReady ? 'READY for promotion' : 'NOT yet — review the per-fixture status above.'}`,
  )

  if (comparableStatuses.some((entry) => entry.status === PROMOTION_STATUS.NOT_SAFE)) {
    console.error('\ndiagnose-alignment --compare: a comparable fixture is NOT_SAFE.')
    process.exit(1)
  }
}

/**
 * PDF geometry detection proof: run the REAL pixel pipeline on synthetic pages
 * whose printed geometry is known, and score the detected measure boundaries
 * against ground truth. Reports detected systems/barlines/measures, weak systems,
 * false-positive/negative barline hints, per-system geometry, and readiness.
 *
 * Geometry-only fields (measureStartX / playableEndX / systemEndX) isolate PDF
 * GEOMETRY DETECTION quality from the beat-1 onset heuristic (playableStartX).
 */
async function runDetect() {
  const synthetic = await import('../tests/helpers/syntheticScore.js')
  const { analyzeSemiAutoScoreSetup } = await import(
    '../src/features/score-follow/semiAutoScoreAlignment.js'
  )
  const { compareAnchorSets, assessPromotionReadiness, GEOMETRY_COMPARISON_FIELDS, PROMOTION_STATUS } =
    await import('../src/features/score-follow/anchorComparison.js')
  const F = await import('../tests/helpers/buildXml.js')

  // Piano grand staff: declare 2 staves so detected treble+bass pair into one
  // system (matches the synthetic pages, which are all grand staves).
  const pianoAttributes =
    '<attributes><divisions>1</divisions><staves>2</staves>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
  const timingMap = (measureCount, breakEvery) => {
    let xml = ''
    for (let m = 1; m <= measureCount; m += 1) {
      xml += `<measure number="${m}">`
      if (m === 1) xml += pianoAttributes + F.soundTempo(120)
      if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) xml += '<print new-system="yes"/>'
      xml += F.fourQuarters() + '</measure>'
    }
    return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
  }

  const cases = [
    {
      id: 'clean-1page',
      pages: [synthetic.cleanPianoPage({ systems: 3, measuresPerSystem: 4 })],
      measures: 12,
      breakEvery: 4,
      expectReady: true,
    },
    {
      id: 'clean-multipage',
      pages: synthetic.multiPageScore({ pages: 2, systemsPerPage: 3, measuresPerSystem: 4 }),
      measures: 24,
      breakEvery: 4,
      expectReady: true,
    },
    {
      id: 'light-classical',
      pages: [synthetic.lightClassicalPage({ systems: 4, measuresPerSystem: 4 })],
      measures: 16,
      breakEvery: 4,
      expectReady: true,
    },
    {
      id: 'uneven-measures',
      pages: [synthetic.unevenMeasurePage()],
      measures: 8,
      breakEvery: 4,
      expectReady: true,
    },
    {
      id: 'dense-notation',
      pages: [synthetic.densePianoPage({ systems: 5, measuresPerSystem: 6 })],
      measures: 30,
      breakEvery: 6,
      expectReady: true, // geometry stays READY; barline COUNT is gated (see per-system lines)
    },
  ]

  let failures = 0
  for (const testCase of cases) {
    const res = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: testCase.pages.length,
      timingMap: timingMap(testCase.measures, testCase.breakEvery),
      renderPage: synthetic.renderPagesFromArray(testCase.pages),
    })
    const truth = synthetic.groundTruthAnchors(testCase.pages)
    const expectedSystems = testCase.pages.reduce(
      (sum, page) => sum + (page.systemBarlineFracs?.length ?? 0),
      0,
    )
    const det = res.preview?.supplementalMeasureAnchors ?? []
    const cmp = compareAnchorSets(det, truth, { fields: GEOMETRY_COMPARISON_FIELDS })
    const readiness = assessPromotionReadiness(cmp)
    const entries = res.preview?.systemEntries ?? []
    const unreliableBarlineCount = entries.filter(
      (entry) => entry.system?.barlineConfident === false,
    )

    console.log('='.repeat(60))
    console.log(`${testCase.id}  (stage=${res.preview?.stage}, alloc=${res.preview?.allocationMode})`)
    console.log(
      `  systems: detected ${entries.length} / expected ${expectedSystems}  |  ` +
        `confidence ${res.preview?.confidence}`,
    )
    entries.forEach((entry, i) => {
      const s = entry.system
      console.log(
        `    sys${i} p${entry.page}: barlines=${s?.barlineCount ?? '—'} ` +
          `measEst=${s?.measureEstimate ?? 'null'} ` +
          `barlineConfident=${s?.barlineConfident ?? '—'}` +
          (s?.barlineReliabilityReason && s.barlineReliabilityReason !== 'ok'
            ? ` (${s.barlineReliabilityReason})`
            : ''),
      )
    })
    const expectedMeasures = truth.length
    console.log(
      `  measures: detected anchors ${det.length} / expected ${expectedMeasures}  |  ` +
        `unreliable barline count ${unreliableBarlineCount.length}`,
    )
    if (cmp.comparable) {
      console.log(
        `  GEOMETRY (boundary + system-end): max err ${cmp.maxError.toFixed(4)} | ` +
          `avg err ${cmp.avgError.toFixed(4)} → ${readiness.status.toUpperCase()}`,
      )
    } else {
      console.log('  GEOMETRY: not comparable.')
    }

    if (testCase.expectReady && readiness.status !== PROMOTION_STATUS.READY) {
      console.error(`  ✗ expected READY geometry but got ${readiness.status}`)
      failures += 1
    }
    console.log('')
  }

  console.log('='.repeat(60))
  if (failures > 0) {
    console.error(`diagnose-alignment --detect: ${failures} case(s) regressed below READY geometry.`)
    process.exit(1)
  }
  console.log('PDF geometry detection: all expected-READY cases pass against ground truth.')
}

const args = process.argv.slice(2)
if (args.includes('--detect')) {
  await runDetect()
} else if (args.includes('--compare')) {
  await runCompare()
} else if (args.includes('--anchors')) {
  await runAnchors()
} else if (args.includes('--fixtures')) {
  await runFixtures()
} else if (args.length === 0 || args.includes('--check')) {
  runCheck()
} else {
  runFile(args)
}
