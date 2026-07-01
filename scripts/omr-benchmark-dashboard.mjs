#!/usr/bin/env node
/**
 * OMR benchmark dashboard — one command health summary across clean/dense fixtures.
 *
 * Usage:
 *   node scripts/omr-benchmark-dashboard.mjs
 *   node scripts/omr-benchmark-dashboard.mjs --manifest benchmarks/omr-benchmark.manifest.json
 *   node scripts/omr-benchmark-dashboard.mjs --from-reports tmp/omr-benchmark-iter/rhythm-voice2
 *   node scripts/omr-benchmark-dashboard.mjs --promote-scoregraph-clips
 *   node scripts/omr-benchmark-dashboard.mjs --json tmp/omr-benchmark-dashboard/report.json --md tmp/omr-benchmark-dashboard/report.md
 *
 * Requires local PDF + MXL assets (see manifest). Does not change OMR runtime logic.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { evaluateOmrAccuracy } from '../src/features/omr/omrAccuracyEvaluator.js'
import {
  buildFixtureDashboardRecord,
  expandHomePath,
  formatOmrBenchmarkMarkdown,
  OMR_BENCHMARK_STATUS,
  serializeOmrBenchmarkReport,
  summarizeOmrBenchmarkDashboard,
  validateOmrBenchmarkManifest,
} from '../src/features/omr/omrBenchmarkDashboard.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = join(ROOT, 'benchmarks/omr-benchmark.manifest.json')
const DEFAULT_OUT_DIR = join(ROOT, 'tmp/omr-benchmark-dashboard')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'OMR benchmark dashboard',
    '',
    'Runs OMR + accuracy evaluation for each manifest fixture and writes a summary report.',
    '',
    'Options:',
    '  --manifest <path>         Fixture manifest (default: benchmarks/omr-benchmark.manifest.json)',
    '  --json <path>             JSON report path (default: tmp/omr-benchmark-dashboard/report.json)',
    '  --md <path>               Markdown report path (default: tmp/omr-benchmark-dashboard/report.md)',
    '  --from-reports <dir>      Build dashboard from existing evaluate-omr-accuracy JSON files',
    '                            (expects clean.json + dense.json or <id>.json per fixture)',
    '  --max-pages <n>           Override per-fixture max pages',
    '  --no-preprocess           Disable OMR preprocessing',
    '  --promote-scoregraph-clips',
    '                            Dev-only: enable default-off ScoreGraph hard-constraint clip promotion',
    '  --allow-missing           Skip fixtures with missing PDF/truth instead of erroring',
    '  --help                    Show this help',
  ].join('\n')
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function writeText(filePath, content) {
  ensureParent(filePath)
  writeFileSync(filePath, content)
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }

  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`MXL archive has no MusicXML root: ${scorePath}`)
  }
  return zip.file(rootPath).async('string')
}

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    return (content.items ?? [])
      .map((item) => ({
        text: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        fontName: item.fontName ?? '',
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

async function generateOmrFromPdf(pdfPath, { maxPages, preprocessPages, promoteScoreGraphClips = false }) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  return runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    preprocessPages,
    promoteScoreGraphClips,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })
}

function resolveFixturePaths(fixture, homeDir = process.env.HOME ?? '') {
  return {
    ...fixture,
    pdfPath: expandHomePath(fixture.pdf, homeDir),
    truthPath: expandHomePath(fixture.truth, homeDir),
  }
}

function loadManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const validation = validateOmrBenchmarkManifest(manifest)
  if (!validation.ok) {
    throw new Error(`Invalid OMR benchmark manifest:\n${validation.errors.join('\n')}`)
  }
  return manifest
}

function reportPathForFixture(fromReportsDir, fixture) {
  const aliases = new Set([fixture.id, fixture.tier].filter(Boolean))
  if (fixture.id === 'clean') {
    aliases.add('medium')
  }
  const candidates = []
  for (const alias of aliases) {
    candidates.push(
      join(fromReportsDir, `${alias}.json`),
      join(fromReportsDir, `after-${alias}.json`),
      join(fromReportsDir, `before-${alias}.json`),
    )
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function evaluateFixture(fixture, options) {
  const resolved = resolveFixturePaths(fixture)
  const pdfExists = existsSync(resolved.pdfPath)
  const truthExists = existsSync(resolved.truthPath)

  if (!pdfExists || !truthExists) {
    if (options.allowMissing) {
      return buildFixtureDashboardRecord({
        fixture: resolved,
        error: new Error(
          `Missing assets: ${!pdfExists ? `pdf ${resolved.pdfPath}` : ''}${!pdfExists && !truthExists ? '; ' : ''}${!truthExists ? `truth ${resolved.truthPath}` : ''}`,
        ),
      })
    }
    throw new Error(
      `Fixture "${resolved.id}" is missing assets. PDF exists=${pdfExists}, truth exists=${truthExists}.`,
    )
  }

  const maxPages = Math.max(1, Number(options.maxPages ?? resolved.maxPages ?? 24))
  const preprocessPages = options.preprocessPages !== false
  const promoteScoreGraphClips = options.promoteScoreGraphClips === true

  try {
    console.error(`Running OMR: ${resolved.label ?? resolved.id}`)
    const omrResult = await generateOmrFromPdf(resolved.pdfPath, {
      maxPages,
      preprocessPages,
      promoteScoreGraphClips,
    })
    const groundTruthMusicXml = await readScoreXml(resolved.truthPath)
    const report = evaluateOmrAccuracy({
      generatedMusicXml: omrResult.musicXml,
      groundTruthMusicXml,
      generatedFileName: `${basename(resolved.pdfPath)}.omr.musicxml`,
      groundTruthFileName: basename(resolved.truthPath),
      generatedOmrDiagnostics: omrResult.diagnostics,
      options: { exampleLimit: 99999 },
    })

    if (options.saveFixtureReports) {
      const fixtureReportPath = join(options.outDir, 'fixtures', `${resolved.id}.json`)
      writeText(
        fixtureReportPath,
        `${JSON.stringify(
          {
            ...report,
            run: {
              pdfPath: resolved.pdfPath,
              truthPath: resolved.truthPath,
              maxPages,
              preprocessPages,
              promoteScoreGraphClips,
              omrNoteCount: omrResult.noteCount ?? null,
              omrMeasureCount: omrResult.measureCount ?? null,
            },
          },
          null,
          2,
        )}\n`,
      )
    }

    return buildFixtureDashboardRecord({
      fixture: resolved,
      report,
      run: {
        pdfPath: resolved.pdfPath,
        truthPath: resolved.truthPath,
        maxPages,
        preprocessPages,
        promoteScoreGraphClips,
        omrNoteCount: omrResult.noteCount ?? null,
        omrMeasureCount: omrResult.measureCount ?? null,
      },
    })
  } catch (error) {
    const rejected = error?.difficulty?.tooDifficult
    if (rejected) {
      error.code = 'rejected'
      error.reasons = error.difficulty?.reasons ?? []
    }
    return buildFixtureDashboardRecord({
      fixture: resolved,
      error,
      run: {
        pdfPath: resolved.pdfPath,
        truthPath: resolved.truthPath,
        maxPages,
        preprocessPages,
        promoteScoreGraphClips,
        omrConfidence: error?.difficulty?.confidence ?? null,
        failureReasons: error?.difficulty?.reasons ?? [],
      },
    })
  }
}

function loadFixtureFromReport(fixture, reportPath) {
  const resolved = resolveFixturePaths(fixture)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  return buildFixtureDashboardRecord({
    fixture: resolved,
    report,
    run: report.run ?? {
      pdfPath: report.run?.pdfPath ?? resolved.pdfPath,
      truthPath: report.run?.truthPath ?? resolved.truthPath,
      sourceReport: reportPath,
    },
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(usage())
    return
  }

  const manifestPath = argValue(args, '--manifest') ?? DEFAULT_MANIFEST
  const outDir = dirname(argValue(args, '--json') ?? join(DEFAULT_OUT_DIR, 'report.json'))
  const jsonPath = argValue(args, '--json') ?? join(DEFAULT_OUT_DIR, 'report.json')
  const mdPath = argValue(args, '--md') ?? join(DEFAULT_OUT_DIR, 'report.md')
  const fromReportsDir = argValue(args, '--from-reports')
  const maxPagesOverride = argValue(args, '--max-pages')
  const allowMissing = hasFlag(args, '--allow-missing')
  const preprocessPages = !hasFlag(args, '--no-preprocess')
  const promoteScoreGraphClips = hasFlag(args, '--promote-scoregraph-clips')

  const manifest = loadManifest(manifestPath)
  const records = []

  for (const fixture of manifest.fixtures) {
    if (fromReportsDir) {
      const reportPath = reportPathForFixture(fromReportsDir, fixture)
      if (!reportPath) {
        const resolved = resolveFixturePaths(fixture)
        records.push(
          buildFixtureDashboardRecord({
            fixture: resolved,
            error: new Error(`No cached report found in ${fromReportsDir} for fixture ${fixture.id}`),
          }),
        )
        continue
      }
      console.error(`Loading report: ${reportPath}`)
      records.push(loadFixtureFromReport(fixture, reportPath))
      continue
    }

    records.push(
      await evaluateFixture(fixture, {
        allowMissing,
        maxPages: maxPagesOverride ? Number(maxPagesOverride) : undefined,
        preprocessPages,
        promoteScoreGraphClips,
        outDir,
        saveFixtureReports: true,
      }),
    )
  }

  const summary = summarizeOmrBenchmarkDashboard(records)
  summary.manifestPath = manifestPath
  summary.mode = fromReportsDir ? 'from-reports' : 'live'
  summary.pipelineOptions = {
    preprocessPages,
    promoteScoreGraphClips,
  }

  writeText(jsonPath, `${serializeOmrBenchmarkReport(summary)}\n`)
  writeText(mdPath, formatOmrBenchmarkMarkdown(summary))

  console.log(formatOmrBenchmarkMarkdown(summary))
  console.error(`\nWrote ${jsonPath}`)
  console.error(`Wrote ${mdPath}`)

  const hasBlockingStatus = records.some(
    (record) =>
      record.status === OMR_BENCHMARK_STATUS.FAIL ||
      record.status === OMR_BENCHMARK_STATUS.REJECTED ||
      record.status === OMR_BENCHMARK_STATUS.ERROR,
  )
  if (hasBlockingStatus) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error('')
  console.error(usage())
  process.exitCode = 1
})
