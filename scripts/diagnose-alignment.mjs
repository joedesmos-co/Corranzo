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

const args = process.argv.slice(2)
if (args.includes('--fixtures')) {
  await runFixtures()
} else if (args.length === 0 || args.includes('--check')) {
  runCheck()
} else {
  runFile(args)
}
