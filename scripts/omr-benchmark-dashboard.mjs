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
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { evaluateOmrAccuracy } from '../src/features/omr/omrAccuracyEvaluator.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildFixtureDashboardRecord,
  DEFAULT_FIXTURE_SEARCH_PATHS,
  expandHomePath,
  formatOmrBenchmarkMarkdown,
  OMR_BENCHMARK_STATUS,
  parseChecksum,
  resolveFixtureAssetPath,
  serializeOmrBenchmarkReport,
  summarizeOmrBenchmarkDashboard,
  validateOmrBenchmarkManifest,
  verifyChecksum,
} from '../src/features/omr/omrBenchmarkDashboard.js'
import { buildRhythmShadowBenchmarkComparison } from '../src/features/omr/omrRhythmShadowReport.js'
import { buildVoiceSerializationShadowBenchmarkComparison } from '../src/features/omr/omrVoiceSerializationShadowReport.js'
import { formatRolloutGateDocument } from '../src/features/omr/omrRolloutGate.js'
import {
  buildVoiceSerializationQualification,
  formatVoiceSerializationQualificationDocument,
} from '../src/features/omr/omrVoiceSerializationQualification.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'
import {
  assessOmrV3ProductionGate,
  assessOmrV3PromotionGate,
  evaluateOmrV3Shadow,
} from '../src/features/omr/v3/omrV3Evaluation.js'

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
    '  --check-fixtures          Verify fixture presence + sha256 checksums and exit (no OMR run)',
    '  --from-reports <dir>      Build dashboard from existing evaluate-omr-accuracy JSON files',
    '                            (expects clean.json + dense.json or <id>.json per fixture)',
    '  --max-pages <n>           Override per-fixture max pages',
    '  --no-preprocess           Disable OMR preprocessing',
    '  --promote-scoregraph-clips',
    '                            Dev-only: enable default-off ScoreGraph hard-constraint clip promotion',
  '  --allow-missing           Skip fixtures with missing PDF/truth instead of erroring',
  '  --only-fixtures <ids>     Comma-separated fixture ids to evaluate (live run only)',
  '  --write-qualification-docs',
  '                            Refresh tracked V2 qualification docs (full manifest only)',
  '  --help                    Show this help',
    '',
    'Diagnostic flags (browser / dev):',
    '  scoreflow:omr-trace=1|0   Structured pipeline trace logs',
    '  scoreflow:omr-debug=1|0   Per-step image buffer debug',
    '  scoreflow:omr-trace-groups=1  Collapse trace phases in console groups',
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

async function generateOmrFromPdf(pdfPath, { maxPages, preprocessPages, promoteScoreGraphClips = false, includeScoreGraph = false, instrumentId = null, stavesPerSystem = null, omrV3Shadow = true }) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  return runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    preprocessPages,
    promoteScoreGraphClips,
    includeScoreGraph,
    instrumentId,
    stavesPerSystem,
    omrV3Shadow,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function resolveFixturePaths(fixture, manifest = {}, homeDir = process.env.HOME ?? '') {
  const searchPaths = manifest.fixtureSearchPaths ?? DEFAULT_FIXTURE_SEARCH_PATHS
  const pdf = resolveFixtureAssetPath({
    fileName: fixture.pdf,
    legacyPath: fixture.pdfLegacyPath,
    searchPaths,
    rootDir: ROOT,
    homeDir,
    exists: existsSync,
  })
  const truth = resolveFixtureAssetPath({
    fileName: fixture.truth,
    legacyPath: fixture.truthLegacyPath,
    searchPaths,
    rootDir: ROOT,
    homeDir,
    exists: existsSync,
  })
  return {
    ...fixture,
    pdfPath: pdf.resolvedPath ?? pdf.candidates[0] ?? expandHomePath(fixture.pdf, homeDir),
    truthPath: truth.resolvedPath ?? truth.candidates[0] ?? expandHomePath(fixture.truth, homeDir),
    pdfCandidates: pdf.candidates,
    truthCandidates: truth.candidates,
  }
}

function verifyFixtureChecksums(resolved) {
  const results = {}
  for (const [kind, pathKey, checksumKey] of [
    ['pdf', 'pdfPath', 'pdf'],
    ['truth', 'truthPath', 'truth'],
  ]) {
    const expected = resolved.checksums?.[checksumKey]
    if (!expected) {
      results[kind] = { skipped: true, reason: 'no-checksum-in-manifest' }
      continue
    }
    const filePath = resolved[pathKey]
    if (!filePath || !existsSync(filePath)) {
      results[kind] = { ok: false, reason: 'file-missing', expected: parseChecksum(expected)?.digest }
      continue
    }
    results[kind] = verifyChecksum(expected, sha256File(filePath))
  }
  return results
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
      join(fromReportsDir, 'fixtures', `${alias}.json`),
      join(fromReportsDir, `after-${alias}.json`),
      join(fromReportsDir, `before-${alias}.json`),
    )
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function reportForFixtureCache(report) {
  if (!report?.generatedOmrDiagnostics?.scoreGraphFull) {
    return report
  }
  const generatedOmrDiagnostics = { ...report.generatedOmrDiagnostics }
  delete generatedOmrDiagnostics.scoreGraphFull
  return { ...report, generatedOmrDiagnostics }
}

async function evaluateFixture(fixture, options) {
  const resolved = resolveFixturePaths(fixture, options.manifest)
  const optional = Boolean(fixture.optional) || Boolean(fixture.diagnosticOnly)
  const importOnly = fixture.expectedOutcome === 'import-only'
  const pdfExists = existsSync(resolved.pdfPath)
  const truthExists = importOnly || existsSync(resolved.truthPath)

  if (!pdfExists || !truthExists) {
    // Optional/diagnostic-only fixtures are skipped when absent (no error).
    if (optional || options.allowMissing) {
      const missingError = new Error(
        `Missing assets: ${!pdfExists ? `pdf ${resolved.pdfPath}` : ''}${!pdfExists && !truthExists ? '; ' : ''}${!truthExists ? `truth ${resolved.truthPath}` : ''}`,
      )
      missingError.code = 'missing-assets'
      if (optional) {
        console.error(`Skipping optional fixture (assets missing): ${resolved.label ?? resolved.id}`)
      }
      return buildFixtureDashboardRecord({ fixture: resolved, error: missingError })
    }
    throw new Error(
      `Fixture "${resolved.id}" is missing assets. PDF exists=${pdfExists}, truth exists=${truthExists}.`,
    )
  }

  const checksumResults = verifyFixtureChecksums(resolved)
  for (const [kind, result] of Object.entries(checksumResults)) {
    if (result && result.ok === false) {
      console.error(
        `WARNING: ${resolved.id} ${kind} checksum mismatch (expected ${result.expected ?? '?'}, got ${result.actual ?? 'missing'})`,
      )
    }
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
      includeScoreGraph: true,
      instrumentId: resolved.instrumentId ?? null,
      stavesPerSystem: resolved.stavesPerSystem ?? null,
    })
    const run = {
      pdfPath: resolved.pdfPath,
      truthPath: resolved.truthPath,
      maxPages,
      preprocessPages,
      promoteScoreGraphClips,
      omrNoteCount: omrResult.noteCount ?? null,
      omrMeasureCount: omrResult.measureCount ?? null,
      checksums: checksumResults,
    }
    if (importOnly) {
      const partialRecovery = omrResult.diagnostics?.partialRecovery ?? {}
      return buildFixtureDashboardRecord({
        fixture: resolved,
        run,
        observation: {
          outcome: 'recognized',
          pagesProcessed: partialRecovery.successfulPages ?? null,
          failedPages: partialRecovery.failedPages?.length ?? 0,
          isolatedRegions: partialRecovery.isolatedRegions?.length ?? 0,
          noteCount: omrResult.noteCount ?? 0,
          measureCount: omrResult.measureCount ?? 0,
          confidence: omrResult.overallConfidence ?? null,
          processingMs: omrResult.diagnostics?.performance?.totalMs ?? null,
          warnings: omrResult.warnings ?? [],
        },
      })
    }
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
            ...reportForFixtureCache(report),
            run,
          },
          null,
          2,
        )}\n`,
      )
    }

    const record = buildFixtureDashboardRecord({
      fixture: resolved,
      report,
      run,
      scoreGraphMeasures: omrResult.diagnostics?.scoreGraphFull?.measures ?? null,
    })
    await attachRhythmShadow(record, report, resolved, {
      runtimeMusicXml: omrResult.musicXml,
      scoreGraph: omrResult.diagnostics?.scoreGraphFull ?? null,
    })
    await attachVoiceSerializationShadow(record, report, resolved, {
      runtimeMusicXml: omrResult.musicXml,
      scoreGraph: omrResult.diagnostics?.scoreGraphFull ?? null,
    })
    attachOmrV3Shadow(record, report, resolved, {
      omrResult,
      groundTruthMusicXml,
    })
    return record
  } catch (error) {
    const rejected = error?.difficulty?.tooDifficult
    if (rejected) {
      error.code = 'rejected'
      error.reasons = error.difficulty?.reasons ?? []
    }
    const record = buildFixtureDashboardRecord({
      fixture: resolved,
      error,
      observation: importOnly
        ? {
            outcome: rejected ? 'rejected' : 'error',
            confidence: error?.difficulty?.confidence ?? null,
            failureReasons: error?.difficulty?.reasons ?? [error?.code ?? 'error'],
          }
        : null,
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
    const compactRejectionShadow = (shadow) =>
      shadow
        ? {
            status: shadow.status,
            engine: shadow.engine ?? null,
            promotedToRuntime: false,
            stages: shadow.stages ?? null,
            evidence: shadow.evidence ?? null,
            decision: shadow.decision ?? null,
            error: shadow.error ?? null,
          }
        : null
    record.omrV3Shadow = compactRejectionShadow(error?.omrV3Shadow)
    record.omrV3IndependentShadow = compactRejectionShadow(error?.omrV3IndependentShadow)
    return record
  }
}

function attachOmrV3Shadow(
  record,
  report,
  resolvedFixture,
  { omrResult, groundTruthMusicXml } = {},
) {
  const compactUnavailableShadow = (shadow) =>
    shadow
      ? {
          status: shadow.status,
          engine: shadow.engine ?? null,
          error: shadow.error ?? null,
          evidence: shadow.evidence ?? null,
          promotedToRuntime: false,
        }
      : null
  try {
    const truthTiming = parseMusicXml(groundTruthMusicXml, `${resolvedFixture.id}.truth.musicxml`)
    const inferredSystemCount = (truthTiming.measures ?? []).filter(
      (measure) => measure.systemBreakBefore,
    ).length
    const expectedSystemCount =
      resolvedFixture.expectedSystemCount ?? (inferredSystemCount > 0 ? inferredSystemCount : null)
    const categories = new Set(resolvedFixture.categories ?? [])
    let expectedGroupType = null
    if (categories.has('paired-notation-tab')) expectedGroupType = 'guitar-notation-tab'
    else if (categories.has('tab-only')) expectedGroupType = 'tab-only'
    else if (resolvedFixture.instrumentId === 'guitar') expectedGroupType = 'single-notation'
    else if (resolvedFixture.stavesPerSystem === 2 || categories.has('grand-staff')) {
      expectedGroupType = 'piano-grand-staff'
    } else if (resolvedFixture.stavesPerSystem === 1) expectedGroupType = 'single-notation'
    const expectedStaffGroupTypes =
      resolvedFixture.expectedStaffGroupTypes ??
      (expectedGroupType && Number.isInteger(expectedSystemCount)
        ? Array.from({ length: expectedSystemCount }, () => expectedGroupType)
        : undefined)
    const current = {
      metrics: report.metrics,
      structure: {
        absoluteMeasureCountError: Math.abs(report.totals?.measureCountDifference ?? 0),
        systemCountAccuracy: Number.isInteger(expectedSystemCount)
          ? omrResult.diagnostics?.systems === expectedSystemCount
            ? 1
            : 0
          : null,
      },
      fusion: {
        duplicateEventRate: 0,
      },
      validity: {
        invalidEventRate: 0,
        voiceOverlapViolations: 0,
      },
    }
    const evaluateShadow = (shadow) => {
      if (!shadow || shadow.status !== 'ready' || !shadow.document) {
        return compactUnavailableShadow(shadow)
      }
      try {
        const evaluation = evaluateOmrV3Shadow({
          document: shadow.document,
          runtimeMusicXml: omrResult.musicXml,
          truthMusicXml: groundTruthMusicXml,
          expectedStructure: {
            measureCount: report.totals?.truthMeasureCount,
            systemCount: expectedSystemCount,
            staffGroupTypes: expectedStaffGroupTypes,
          },
        })
        const { musicXml: _musicXml, ...compactEvaluation } = evaluation
        return {
          status: 'ready',
          engine: shadow.engine,
          promotedToRuntime: false,
          rollout: shadow.rollout,
          stages: shadow.stages,
          evidence: shadow.evidence ?? shadow.stages?.evidence ?? null,
          evaluation: compactEvaluation,
          current,
          v3: compactEvaluation,
        }
      } catch (error) {
        return {
          status: 'evaluation-error',
          engine: shadow.engine ?? null,
          error: error instanceof Error ? error.message : String(error),
          promotedToRuntime: false,
        }
      }
    }
    record.omrV3Shadow = evaluateShadow(omrResult?.omrV3Shadow)
    record.omrV3IndependentShadow = evaluateShadow(omrResult?.omrV3IndependentShadow)
  } catch (error) {
    const failure = {
      status: 'evaluation-error',
      error: error instanceof Error ? error.message : String(error),
      promotedToRuntime: false,
    }
    record.omrV3Shadow = failure
    record.omrV3IndependentShadow = failure
  }
}

function loadFixtureFromReport(fixture, reportPath, manifest) {
  const resolved = resolveFixturePaths(fixture, manifest)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const record = buildFixtureDashboardRecord({
    fixture: resolved,
    report,
    run: report.run ?? {
      pdfPath: report.run?.pdfPath ?? resolved.pdfPath,
      truthPath: report.run?.truthPath ?? resolved.truthPath,
      sourceReport: reportPath,
    },
  })
  return { record, report, resolved }
}

function mergeRhythmShadowCache(records, outDir) {
  const cachePath = join(outDir, 'rhythm-shadow-report.json')
  if (!existsSync(cachePath)) {
    return
  }
  let cache
  try {
    cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    return
  }
  for (const record of records) {
    if (
      record.rhythmShadow &&
      record.rhythmShadow.status !== 'shadow-only-no-scoregraph' &&
      record.rhythmShadow.solverDiagnostics
    ) {
      continue
    }
    const cached = cache.fixtures?.find((entry) => entry.fixtureId === record.id)
    if (cached) {
      record.rhythmShadow = cached
    }
  }
}

function mergeVoiceSerializationShadowCache(records, outDir) {
  const cachePath = join(outDir, 'voice-serialization-shadow-report.json')
  if (!existsSync(cachePath)) {
    return
  }
  let cache
  try {
    cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    return
  }
  for (const record of records) {
    if (
      record.voiceSerializationShadow &&
      record.voiceSerializationShadow.status !== 'shadow-only-no-scoregraph' &&
      record.voiceSerializationShadow.solverDiagnostics
    ) {
      continue
    }
    const cached = cache.fixtures?.find((entry) => entry.fixtureId === record.id)
    if (cached) {
      record.voiceSerializationShadow = cached
    }
  }
}

function mergeOmrV3ShadowCache(records, outDir) {
  const cachePath = join(outDir, 'omr-v3-shadow-report.json')
  if (!existsSync(cachePath)) return
  let cache
  try {
    cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    return
  }
  for (const record of records) {
    const cached = cache.fixtures?.find((entry) => entry.fixtureId === record.id)
    if (!cached) continue
    if (record.omrV3Shadow?.status !== 'ready') record.omrV3Shadow = cached.shadow
    if (record.omrV3IndependentShadow?.status !== 'ready') {
      record.omrV3IndependentShadow = cached.independentShadow ?? null
    }
  }
}

function formatOmrV3ShadowMarkdown(report) {
  const lines = [
    '# OMR V3 Shadow Evaluation',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Promotion gate: **${report.gate.status}** (improved fixtures ${report.gate.improvedFixtureCount}/${report.gate.requiredImprovedFixtureCount}, regressions ${report.gate.regressionCount})`,
    '',
    `Production replacement gate: **${report.productionGate.status}** (${report.productionGate.blockers.length} blocker(s))`,
    ...report.productionGate.blockers.map((blocker) => `- ${blocker.code}`),
    '',
    '| Fixture | Compatibility | Independent | Current F1 | Compatibility F1 | Independent F1 | Independent evidence |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
  ]
  for (const fixture of report.fixtures) {
    const current = fixture.shadow?.current
    const v3 = fixture.shadow?.evaluation
    const independent = fixture.independentShadow?.evaluation
    const pct = (value) => Number.isFinite(value) ? `${Math.round(value * 10000) / 100}%` : 'n/a'
    lines.push(
      `| ${fixture.fixtureId} | ${fixture.shadow?.status ?? 'unavailable'} | ${fixture.independentShadow?.status ?? 'unavailable'} | ${pct(current?.metrics?.noteDetectionF1)} | ${pct(v3?.accuracy?.v3?.noteDetectionF1)} | ${pct(independent?.accuracy?.v3?.noteDetectionF1)} | ${pct(fixture.independentShadow?.evidence?.independentPrimaryEventRate)} |`,
    )
  }
  lines.push(
    '',
    'All V3 results are shadow-only. No runtime candidate is promoted by this report.',
    '',
  )
  return lines.join('\n')
}

async function attachRhythmShadow(record, report, resolvedFixture, { runtimeMusicXml = null, scoreGraph = null } = {}) {
  if (!report?.generatedOmrDiagnostics?.pages?.length && !scoreGraph?.measures?.length) {
    record.rhythmShadow = null
    return
  }
  const truthPath = resolvedFixture?.truthPath ?? report.run?.truthPath
  let groundTruthMusicXml = null
  if (truthPath && existsSync(truthPath)) {
    try {
      groundTruthMusicXml = await readScoreXml(truthPath)
    } catch {
      groundTruthMusicXml = null
    }
  }
  record.rhythmShadow = buildRhythmShadowBenchmarkComparison({
    report,
    fixtureId: resolvedFixture?.id ?? record.id ?? null,
    groundTruthMusicXml,
    runtimeMusicXml,
    scoreGraph,
    title: report.summary?.generatedTitle ?? null,
  })
}

async function attachVoiceSerializationShadow(
  record,
  report,
  resolvedFixture,
  { runtimeMusicXml = null, scoreGraph = null } = {},
) {
  if (!report?.generatedOmrDiagnostics?.pages?.length && !scoreGraph?.measures?.length) {
    record.voiceSerializationShadow = null
    return
  }
  const truthPath = resolvedFixture?.truthPath ?? report.run?.truthPath
  let groundTruthMusicXml = null
  if (truthPath && existsSync(truthPath)) {
    try {
      groundTruthMusicXml = await readScoreXml(truthPath)
    } catch {
      groundTruthMusicXml = null
    }
  }
  record.voiceSerializationShadow = buildVoiceSerializationShadowBenchmarkComparison({
    report,
    fixtureId: resolvedFixture?.id ?? record.id ?? null,
    groundTruthMusicXml,
    runtimeMusicXml,
    scoreGraph,
    title: report.summary?.generatedTitle ?? null,
  })
  record.voiceSerializationQualification = buildVoiceSerializationQualification(
    record.voiceSerializationShadow,
    {
      fixtureId: resolvedFixture?.id ?? record.id ?? null,
      fixtureMetrics: record.metrics ?? null,
    },
  )
}

function checkFixtures(manifest) {
  let anyMismatch = false
  let anyMissingRequired = false

  for (const fixture of manifest.fixtures) {
    const resolved = resolveFixturePaths(fixture, manifest)
    const optional = Boolean(fixture.optional) || Boolean(fixture.diagnosticOnly)
    const importOnly = fixture.expectedOutcome === 'import-only'
    const tag = optional ? ' (optional)' : ''
    console.log(`\n${fixture.id}${tag}: ${fixture.label ?? ''}`)

    for (const [kind, pathKey] of [
      ['pdf', 'pdfPath'],
      ...(importOnly ? [] : [['truth', 'truthPath']]),
    ]) {
      const filePath = resolved[pathKey]
      const exists = filePath && existsSync(filePath)
      if (!exists) {
        console.log(`  ${kind}: MISSING (looked in: ${resolved[`${kind}Candidates`]?.join(', ')})`)
        if (!optional) {
          anyMissingRequired = true
        }
        continue
      }
      const expected = resolved.checksums?.[kind]
      if (!expected) {
        console.log(`  ${kind}: present, no checksum in manifest → ${filePath}`)
        continue
      }
      const result = verifyChecksum(expected, sha256File(filePath))
      if (result.ok) {
        console.log(`  ${kind}: OK (${result.algorithm}) → ${filePath}`)
      } else {
        anyMismatch = true
        console.log(
          `  ${kind}: CHECKSUM MISMATCH → ${filePath}\n    expected ${result.expected}\n    actual   ${result.actual}`,
        )
      }
    }
  }

  console.log('')
  if (anyMismatch) {
    console.log('Result: checksum mismatch detected.')
    process.exitCode = 1
  } else if (anyMissingRequired) {
    console.log('Result: required fixture assets missing.')
    process.exitCode = 1
  } else {
    console.log('Result: all present fixtures match their manifest checksums.')
  }
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
  const onlyFixturesRaw = argValue(args, '--only-fixtures')
  const onlyFixtureIds = onlyFixturesRaw
    ? onlyFixturesRaw.split(',').map((entry) => entry.trim()).filter(Boolean)
    : null
  const preprocessPages = !hasFlag(args, '--no-preprocess')
  const promoteScoreGraphClips = hasFlag(args, '--promote-scoregraph-clips')
  const checkFixturesOnly = hasFlag(args, '--check-fixtures')
  const writeQualificationDocs = hasFlag(args, '--write-qualification-docs')

  const manifest = loadManifest(manifestPath)

  if (checkFixturesOnly) {
    checkFixtures(manifest)
    return
  }

  const records = []

  for (const fixture of manifest.fixtures) {
    if (onlyFixtureIds && !onlyFixtureIds.includes(fixture.id)) {
      continue
    }
    if (fromReportsDir) {
      const reportPath = reportPathForFixture(fromReportsDir, fixture)
      if (!reportPath) {
        const resolved = resolveFixturePaths(fixture, manifest)
        records.push(
          buildFixtureDashboardRecord({
            fixture: resolved,
            error: new Error(`No cached report found in ${fromReportsDir} for fixture ${fixture.id}`),
          }),
        )
        continue
      }
      console.error(`Loading report: ${reportPath}`)
      const { record, report, resolved } = loadFixtureFromReport(fixture, reportPath, manifest)
      await attachRhythmShadow(record, report, resolved)
      await attachVoiceSerializationShadow(record, report, resolved)
      records.push(record)
      continue
    }

    records.push(
      await evaluateFixture(fixture, {
        manifest,
        allowMissing,
        maxPages: maxPagesOverride ? Number(maxPagesOverride) : undefined,
        preprocessPages,
        promoteScoreGraphClips,
        outDir,
        saveFixtureReports: true,
      }),
    )
  }

  if (fromReportsDir) {
    mergeRhythmShadowCache(records, outDir)
    mergeVoiceSerializationShadowCache(records, outDir)
    mergeOmrV3ShadowCache(records, outDir)
  }

  const summary = summarizeOmrBenchmarkDashboard(records)
  const completeManifestCoverage =
    !onlyFixtureIds &&
    records.length === manifest.fixtures.length &&
    manifest.fixtures.every((fixture) => records.some((record) => record.id === fixture.id))
  summary.manifestPath = manifestPath
  summary.mode = fromReportsDir ? 'from-reports' : 'live'
  summary.pipelineOptions = {
    preprocessPages,
    promoteScoreGraphClips,
    omrV3Shadow: true,
  }

  const omrV3Fixtures = records
    .map((record) => ({
      fixtureId: record.id,
      label: record.label,
      enforced: !record.diagnosticOnly && !record.optional,
      expectedOutcome: manifest.fixtures.find((fixture) => fixture.id === record.id)?.expectedOutcome,
      shadow: record.omrV3Shadow,
      independentShadow: record.omrV3IndependentShadow,
    }))
  const omrV3Gate = assessOmrV3PromotionGate(
    omrV3Fixtures
      .filter((fixture) => fixture.shadow?.status === 'ready')
      .map((fixture) => ({
        id: fixture.fixtureId,
        enforced: fixture.enforced,
        current: fixture.shadow.current,
        v3: fixture.shadow.v3,
      })),
  )
  const hasExpectedV3Coverage = (fixture) =>
    fixture.shadow?.status === 'ready' ||
    (fixture.expectedOutcome === 'reject-honestly' &&
      fixture.shadow?.status === 'structure-ready')
  const unavailableEnforcedFixtures = omrV3Fixtures
    .filter((fixture) => fixture.enforced && !hasExpectedV3Coverage(fixture))
    .map((fixture) => ({
      fixtureId: fixture.fixtureId,
      status: fixture.shadow?.status ?? 'unavailable',
      error: fixture.shadow?.error ?? null,
    }))
  omrV3Gate.unavailableEnforcedFixtures = unavailableEnforcedFixtures
  omrV3Gate.unavailableEnforcedFixtureCount = unavailableEnforcedFixtures.length
  if (unavailableEnforcedFixtures.length > 0) {
    omrV3Gate.pass = false
    omrV3Gate.status = 'shadow-only'
    for (const candidate of Object.keys(omrV3Gate.candidates)) {
      omrV3Gate.candidates[candidate] = 'not-promoted'
    }
  }
  const omrV3ProductionGate = assessOmrV3ProductionGate(
    omrV3Fixtures.map((fixture) => ({
      id: fixture.fixtureId,
      enforced: fixture.enforced,
      expectedOutcome: fixture.expectedOutcome,
      shadow: fixture.independentShadow,
    })),
    {
      // Metrics cannot activate a runtime that has not been independently
      // qualified and had its rollback path exercised.
      runtimeCandidateImplemented: false,
      rollbackVerified: false,
    },
  )
  const omrV3Report = {
    generatedAt: summary.generatedAt,
    manifestPath,
    engine: 'omr-v3-shadow',
    promoted: false,
    gate: omrV3Gate,
    productionGate: omrV3ProductionGate,
    fixtures: omrV3Fixtures,
  }
  summary.omrV3Shadow = {
    fixtureCount: omrV3Fixtures.length,
    readyFixtureCount: omrV3Fixtures.filter((fixture) => fixture.shadow?.status === 'ready').length,
    independentReadyFixtureCount: omrV3Fixtures.filter(
      (fixture) => fixture.independentShadow?.status === 'ready',
    ).length,
    gate: omrV3Gate,
    productionGate: omrV3ProductionGate,
    promoted: false,
  }

  writeText(jsonPath, `${serializeOmrBenchmarkReport(summary)}\n`)
  writeText(mdPath, formatOmrBenchmarkMarkdown(summary))
  const omrV3JsonPath = join(outDir, 'omr-v3-shadow-report.json')
  const omrV3MarkdownPath = join(outDir, 'omr-v3-shadow-report.md')
  writeText(omrV3JsonPath, `${JSON.stringify(omrV3Report, null, 2)}\n`)
  writeText(omrV3MarkdownPath, formatOmrV3ShadowMarkdown(omrV3Report))
  console.error(`Wrote ${omrV3JsonPath}`)
  console.error(`Wrote ${omrV3MarkdownPath}`)

  const hotspotRecords = records
    .filter((record) => record.hotspotDiagnostics)
    .map((record) => ({
      fixtureId: record.id,
      label: record.label,
      ...record.hotspotDiagnostics,
    }))
  if (hotspotRecords.length) {
    const hotspotPath = join(outDir, 'onset-voice-phase-trace.json')
    writeText(
      hotspotPath,
      `${JSON.stringify(
        {
          generatedAt: summary.generatedAt,
          manifestPath,
          hotspots: hotspotRecords,
        },
        null,
        2,
      )}\n`,
    )
    console.error(`Wrote ${hotspotPath}`)
  }

  const durationSplitRecords = records
    .filter((record) => record.writtenSoundingDuration)
    .map((record) => ({
      fixtureId: record.id,
      label: record.label,
      ...record.writtenSoundingDuration,
    }))
  if (durationSplitRecords.length) {
    const durationSplitPath = join(outDir, 'duration-split-trace.json')
    writeText(
      durationSplitPath,
      `${JSON.stringify(
        {
          generatedAt: summary.generatedAt,
          manifestPath,
          phase: 3,
          fixtures: durationSplitRecords,
        },
        null,
        2,
      )}\n`,
    )
    console.error(`Wrote ${durationSplitPath}`)
  }

  const tieSustainRecords = records
    .filter((record) => record.tieSustainConstraints)
    .map((record) => ({
      fixtureId: record.id,
      label: record.label,
      ...record.tieSustainConstraints,
    }))
  if (tieSustainRecords.length) {
    const tieSustainPath = join(outDir, 'tie-sustain-constraint-trace.json')
    writeText(
      tieSustainPath,
      `${JSON.stringify(
        {
          generatedAt: summary.generatedAt,
          manifestPath,
          phase: 4,
          fixtures: tieSustainRecords,
        },
        null,
        2,
      )}\n`,
    )
    console.error(`Wrote ${tieSustainPath}`)
  }

  const rhythmShadowRecords = records
    .filter((record) => record.rhythmShadow && record.rhythmShadow.status !== 'unavailable')
    .map((record) => ({
      fixtureId: record.id,
      label: record.label,
      ...record.rhythmShadow,
    }))
  if (rhythmShadowRecords.length) {
    const rhythmShadowPath = join(outDir, 'rhythm-shadow-report.json')
    writeText(
      rhythmShadowPath,
      `${JSON.stringify(
        {
          generatedAt: summary.generatedAt,
          manifestPath,
          promoted: false,
          engine: 'v2-rhythm-shadow-prototype',
          fixtures: rhythmShadowRecords,
        },
        null,
        2,
      )}\n`,
    )
    console.error(`Wrote ${rhythmShadowPath}`)
  }

  const voiceSerializationRecords = records
    .filter((record) => record.voiceSerializationShadow && record.voiceSerializationShadow.status !== 'unavailable')
    .map((record) => ({
      fixtureId: record.id,
      label: record.label,
      ...record.voiceSerializationShadow,
    }))
  if (voiceSerializationRecords.length) {
    const voiceSerializationPath = join(outDir, 'voice-serialization-shadow-report.json')
    writeText(
      voiceSerializationPath,
      `${JSON.stringify(
        {
          generatedAt: summary.generatedAt,
          manifestPath,
          promoted: false,
          engine: 'v2-voice-serialization-shadow',
          phase: 6,
          fixtures: voiceSerializationRecords,
        },
        null,
        2,
      )}\n`,
    )
    console.error(`Wrote ${voiceSerializationPath}`)
  }

  if (summary.voiceSerializationQualification) {
    const qualificationPath = join(outDir, 'voice-serialization-qualification.json')
    writeText(
      qualificationPath,
      `${JSON.stringify(summary.voiceSerializationQualification, null, 2)}\n`,
    )
    console.error(`Wrote ${qualificationPath}`)

    if (completeManifestCoverage && writeQualificationDocs) {
      const qualificationDocPath = join(ROOT, 'docs', 'OMR_V2_PHASE_7_QUALIFICATION.md')
      writeText(
        qualificationDocPath,
        formatVoiceSerializationQualificationDocument(summary.voiceSerializationQualification),
      )
      console.error(`Wrote ${qualificationDocPath}`)
    }
  }

  if (summary.rolloutGate) {
    const rolloutGatePath = join(outDir, 'omr-v2-rollout-gate.json')
    writeText(
      rolloutGatePath,
      `${JSON.stringify(summary.rolloutGate, null, 2)}\n`,
    )
    console.error(`Wrote ${rolloutGatePath}`)

    if (completeManifestCoverage && writeQualificationDocs) {
      const rolloutDocPath = join(ROOT, 'docs', 'OMR_V2_ROLLOUT_GATE.md')
      writeText(rolloutDocPath, formatRolloutGateDocument(summary.rolloutGate))
      console.error(`Wrote ${rolloutDocPath}`)
    }
  }

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
