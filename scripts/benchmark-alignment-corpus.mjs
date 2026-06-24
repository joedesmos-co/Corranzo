/**
 * Batch alignment benchmark for public-domain corpus pieces.
 *
 * Usage:
 *   node scripts/benchmark-alignment-corpus.mjs
 *   node scripts/benchmark-alignment-corpus.mjs --ci-only --json /tmp/report.json
 *   node scripts/benchmark-alignment-corpus.mjs --all --download --json report.json --csv report.csv
 *
 * See docs/alignment-benchmark.md
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import { buildAlignmentReport } from '../src/features/score-follow/alignmentReport.js'
import {
  buildCalibrationDiagnostics,
  calibrateAnchorsHybrid,
  buildHybridBundledPayload,
} from '../src/features/score-follow/calibrationWorkflow.js'
import {
  validateManifest,
  selectManifestEntries,
  buildPieceBenchmarkRecord,
  summarizeBenchmarkResults,
  formatBenchmarkSummaryText,
  pieceRecordsToCsv,
  serializeBenchmarkReport,
} from '../src/features/score-follow/alignmentBenchmark.js'
import { resolveEntryAssets } from './lib/benchmarkCorpusRunners.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultManifest = join(root, 'benchmarks/alignment-corpus.manifest.json')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

async function benchmarkPiece(entry, options) {
  try {
    const assets = await resolveEntryAssets(entry, root, {
      download: options.download,
    })

    if (!assets.ok) {
      return buildPieceBenchmarkRecord({
        entry,
        status: 'skipped',
        skipReason: assets.skipReason ?? 'missing-assets',
        error: assets.detail,
      })
    }

    const setup = await analyzeSemiAutoScoreSetup({
      pdfSource: assets.pdfPath ?? entry.id,
      numPages: assets.numPages,
      timingMap: assets.timingMap,
      renderPage: assets.renderPage,
    })

    if (!setup.ok) {
      return buildPieceBenchmarkRecord({
        entry,
        status: 'error',
        error: setup.message ?? 'auto-setup failed',
        setup,
      })
    }

    const calibration = calibrateAnchorsHybrid({
      systemEntries: setup.preview.systemEntries,
      timingMap: assets.timingMap,
      pdfPageCount: assets.numPages,
      timingSource: assets.musicxmlPath,
      timingSourceKind: assets.timingSourceKind,
      layoutHints: assets.layoutHints,
      allowReconcile: true,
      refuseOnSourceMismatch: false,
    })

    const payload = buildHybridBundledPayload(calibration, {
      pieceId: entry.id,
      pdfFile: assets.pdfPath ?? `${entry.id}.pdf`,
      timingFile: assets.musicxmlPath ?? `${entry.id}.musicxml`,
    })

    const diagnostics = buildCalibrationDiagnostics({
      calibrationResult: calibration,
      setup,
      payload,
      timingSourceKind: assets.timingSourceKind,
      layoutHints: assets.layoutHints,
      timingMeta: assets.timingMeta,
    })

    const perSystemCounts = setup.preview.systemEntries.map(
      (e) => e.system?.measureEstimate ?? null,
    )
    const counts = perSystemCounts.every((c) => Number.isFinite(c))
      ? perSystemCounts
      : calibration.countAnalysis?.suggestedCounts ?? []

    const reconciliation = reconcilePdfLayoutWithScore({
      timingMap: assets.timingMap,
      perSystemBarlineCounts: counts,
      systemEntries: setup.preview.systemEntries,
      pdfPageCount: assets.numPages,
    })

    const alignmentReport = buildAlignmentReport({
      reconciliation,
      timingMap: assets.timingMap,
      layoutConfidence: setup.preview.layoutConfidence ?? null,
      pieceId: entry.id,
    })

    return buildPieceBenchmarkRecord({
      entry,
      status: 'ok',
      setup,
      calibration,
      diagnostics,
      alignmentReport,
      timingSourceKind: assets.timingSourceKind,
      layoutHints: assets.layoutHints,
      timingMeta: assets.timingMeta,
    })
  } catch (error) {
    return buildPieceBenchmarkRecord({
      entry,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const manifestPath = argValue(args, '--manifest') ?? defaultManifest
  const jsonOut = argValue(args, '--json')
  const csvOut = argValue(args, '--csv')
  const ciOnly = hasFlag(args, '--ci-only') || !hasFlag(args, '--all')
  const download = hasFlag(args, '--download')

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const validation = validateManifest(manifest)
  if (!validation.ok) {
    console.error('Invalid manifest:\n  - ' + validation.errors.join('\n  - '))
    process.exit(1)
  }

  const entries = selectManifestEntries(manifest, { ciOnly })
  console.log(`Running alignment benchmark on ${entries.length} piece(s)${ciOnly ? ' (CI subset)' : ''}…\n`)

  const records = []
  for (const entry of entries) {
    process.stderr.write(`  · ${entry.id}…`)
    const record = await benchmarkPiece(entry, { download })
    records.push(record)
    process.stderr.write(` ${record.status} (${record.readiness ?? '—'})\n`)
  }

  const summary = summarizeBenchmarkResults(records)
  console.log('')
  console.log(formatBenchmarkSummaryText(summary))

  if (jsonOut) {
    writeFileSync(jsonOut, `${serializeBenchmarkReport(summary)}\n`)
    console.log(`\nWrote JSON → ${jsonOut}`)
  }
  if (csvOut) {
    writeFileSync(csvOut, pieceRecordsToCsv(records))
    console.log(`Wrote CSV → ${csvOut}`)
  }

  if (summary.errored > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
