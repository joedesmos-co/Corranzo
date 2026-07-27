import { summarizeDurationErrors } from './omrDurationErrorAnalysis.js'
import { summarizePitchErrors } from './omrPitchErrorAnalysis.js'
import {
  buildHotspotDiagnostics,
  formatHotspotDiagnosticsMarkdown,
} from './omrHotspotDiagnostics.js'
import {
  buildWrittenSoundingDurationDiagnostics,
  formatWrittenSoundingDurationMarkdown,
} from './omrWrittenSoundingDurationDiagnostics.js'
import {
  buildTieSustainConstraintDiagnostics,
  formatTieSustainConstraintMarkdown,
} from './omrTieSustainConstraintDiagnostics.js'
import {
  buildRolloutGateReport,
  formatRolloutGateMarkdown,
} from './omrRolloutGate.js'
import {
  formatVoiceSerializationShadowMarkdown,
} from './omrVoiceSerializationShadowReport.js'
import {
  buildCorpusVoiceSerializationQualification,
  buildVoiceSerializationQualification,
  formatVoiceSerializationQualificationMarkdown,
} from './omrVoiceSerializationQualification.js'
import {
  buildRhythmShadowBenchmarkComparison,
  formatRhythmShadowMarkdown,
} from './omrRhythmShadowReport.js'
import {
  buildRhythmErrorAttribution,
  formatRhythmErrorAttributionMarkdown,
} from './omrRhythmErrorAttribution.js'
import {
  buildOmrPipelineStageDiagnostics,
  formatOmrPipelineStageDiagnosticsMarkdown,
} from './omrPipelineStageDiagnostics.js'
import {
  clusterFixtureFailures,
  formatErrorGroupingMarkdown,
  groupAccuracyReportErrors,
  mergeHistograms,
  summarizeTierBreakdown,
  topHistogramEntries,
} from './omrDiagnosticGrouping.js'
import { summarizeSemanticDefectClasses } from './omrSemanticDefectClass.js'

export const OMR_BENCHMARK_MANIFEST_VERSION = 2

export const OMR_BENCHMARK_STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
  ERROR: 'error',
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function pct(value) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  return `${Math.round(value * 100)}%`
}

function topHistogramEntry(histogram = {}) {
  return topHistogramEntries(histogram, 1)[0] ?? null
}

export function expandHomePath(path, homeDir = '') {
  if (!path || typeof path !== 'string') {
    return path
  }
  if (path.startsWith('~/')) {
    return `${homeDir}${path.slice(1)}`
  }
  return path
}

export const DEFAULT_FIXTURE_SEARCH_PATHS = ['benchmarks/omr-fixtures', '~/Downloads', 'tmp/sprint1']

function isAbsoluteLike(path) {
  return typeof path === 'string' && (path.startsWith('/') || path.startsWith('~/'))
}

/** Browser-safe POSIX-style path join (this module is also bundled for the app). */
function joinPath(...segments) {
  return segments
    .filter((segment) => segment != null && segment !== '')
    .join('/')
    .replace(/\/{2,}/g, '/')
}

/**
 * Resolve a fixture asset (pdf/truth) across the manifest search paths.
 * Absolute/`~` paths and legacy fields are honored as-is. Pure: takes an
 * `exists` predicate so it can be unit-tested without a filesystem.
 *
 * Returns { candidates: string[], resolvedPath: string|null }.
 */
export function resolveFixtureAssetPath({
  fileName,
  legacyPath = null,
  searchPaths = DEFAULT_FIXTURE_SEARCH_PATHS,
  rootDir = '',
  homeDir = '',
  exists = () => false,
} = {}) {
  const candidates = []
  const pushCandidate = (candidate) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate)
    }
  }

  if (isAbsoluteLike(fileName)) {
    pushCandidate(expandHomePath(fileName, homeDir))
  } else if (fileName) {
    for (const searchPath of searchPaths) {
      const base = expandHomePath(searchPath, homeDir)
      const prefix = isAbsoluteLike(base) ? base : joinPath(rootDir, base)
      pushCandidate(joinPath(prefix, fileName))
    }
  }

  if (legacyPath) {
    pushCandidate(expandHomePath(legacyPath, homeDir))
  }

  const resolvedPath = candidates.find((candidate) => exists(candidate)) ?? null
  return { candidates, resolvedPath }
}

export function parseChecksum(value) {
  if (!value || typeof value !== 'string') {
    return null
  }
  const [algorithm, digest] = value.includes(':') ? value.split(':', 2) : ['sha256', value]
  return { algorithm: algorithm.toLowerCase(), digest: digest.toLowerCase() }
}

/**
 * Compare an expected manifest checksum against an actual digest.
 * Returns { ok, expected, actual, algorithm } or null when no checksum given.
 */
export function verifyChecksum(expected, actualDigest) {
  const parsed = parseChecksum(expected)
  if (!parsed) {
    return null
  }
  const actual = (actualDigest ?? '').toLowerCase()
  return {
    ok: actual === parsed.digest,
    algorithm: parsed.algorithm,
    expected: parsed.digest,
    actual: actual || null,
  }
}

export function validateOmrBenchmarkManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing or not an object'] }
  }
  if (!Array.isArray(manifest.fixtures)) {
    return { ok: false, errors: ['manifest.fixtures must be an array'] }
  }
  manifest.fixtures.forEach((fixture, index) => {
    const optional = Boolean(fixture?.optional) || Boolean(fixture?.diagnosticOnly)
    const importOnly = fixture?.expectedOutcome === 'import-only'
    if (!fixture?.id) {
      errors.push(`fixtures[${index}]: missing id`)
    }
    if (!fixture?.pdf) {
      errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): missing pdf`)
    }
    if (!fixture?.truth && !importOnly) {
      errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): missing truth`)
    }
    if (fixture?.checksums && typeof fixture.checksums !== 'object') {
      errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): checksums must be an object`)
    }
    if (importOnly && !optional) {
      errors.push(
        `fixtures[${index}] (${fixture?.id ?? '?'}): import-only fixtures must be optional diagnostics`,
      )
    }
    if (!optional) {
      if (!fixture?.checksums?.pdf || !fixture?.checksums?.truth) {
        errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): enforced fixtures require PDF and truth checksums`)
      }
      if (!fixture?.license) {
        errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): enforced fixtures require a license`)
      }
      if (!fixture?.provenanceRecord) {
        errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): enforced fixtures require a provenance record`)
      }
      if (!Array.isArray(fixture?.categories) || fixture.categories.length === 0) {
        errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): enforced fixtures require category coverage`)
      }
      if ((fixture?.expectedOutcome ?? 'transcribe') === 'transcribe' && !fixture?.thresholds) {
        errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): transcribed enforced fixtures require frozen regression floors`)
      }
    }
    if (
      fixture?.expectedOutcome != null &&
      !['transcribe', 'reject-honestly', 'import-only'].includes(fixture.expectedOutcome)
    ) {
      errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): invalid expectedOutcome`)
    }
  })
  if (manifest.fixtureSearchPaths && !Array.isArray(manifest.fixtureSearchPaths)) {
    errors.push('manifest.fixtureSearchPaths must be an array when present')
  }
  return { ok: errors.length === 0, errors }
}

export function extractFixtureMetrics(report = {}) {
  const metrics = report.metrics ?? {}
  const totals = report.totals ?? {}
  const wrongDurations = report.debug?.wrongDurations ?? []
  const wrongPitches = report.debug?.wrongPitches ?? []
  const durationHistogram = summarizeDurationErrors(wrongDurations)
  const pitchSummary = summarizePitchErrors(wrongPitches)
  const topDurationErrorCategory = topHistogramEntry(durationHistogram)
  const topPitchErrorCategory = topHistogramEntry(pitchSummary.histogram)
  const primary = report.summary?.primaryErrorSource ?? null
  const errorGrouping = groupAccuracyReportErrors(report)
  const rhythmErrorAttribution = buildRhythmErrorAttribution(report)

  return {
    pitchAccuracy: round(metrics.pitchAccuracy),
    durationAccuracy: round(metrics.durationAccuracy),
    onsetAccuracy: round(metrics.onsetAccuracy),
    chordGroupingAccuracy: round(metrics.chordGroupingAccuracy),
    noteDetectionF1: round(metrics.noteDetectionF1),
    measureCountDiff: totals.measureCountDifference ?? null,
    noteCountDiff: totals.noteCountDifference ?? null,
    wrongPitch: totals.wrongPitchCount ?? 0,
    wrongDuration: totals.wrongDurationCount ?? 0,
    wrongOnset: totals.wrongOnsetCount ?? 0,
    chordMismatch: totals.chordMismatchCount ?? 0,
    topErrorCategory: primary
      ? {
          source: primary.source ?? null,
          label: primary.label ?? null,
          confidence: round(primary.confidence),
        }
      : null,
    topDurationErrorCategory,
    topPitchErrorCategory,
    durationErrorHistogram: durationHistogram,
    pitchErrorHistogram: pitchSummary.histogram,
    errorGrouping,
    rhythmErrorAttribution,
    namedErrorBuckets: errorGrouping?.namedBuckets ?? null,
    semanticDefectClasses: errorGrouping?.semanticDefectClasses ?? null,
    truncatedWrongDurations: report.debug?.truncated?.wrongDurations ?? 0,
    truncatedWrongPitches: report.debug?.truncated?.wrongPitches ?? 0,
  }
}

export function assessFixtureThresholds(metrics, thresholds = {}) {
  const failures = []
  const checks = [
    ['pitchAccuracy', metrics.pitchAccuracy, thresholds.pitchAccuracy, 'gte'],
    ['durationAccuracy', metrics.durationAccuracy, thresholds.durationAccuracy, 'gte'],
    ['onsetAccuracy', metrics.onsetAccuracy, thresholds.onsetAccuracy, 'gte'],
    ['chordGroupingAccuracy', metrics.chordGroupingAccuracy, thresholds.chordGroupingAccuracy, 'gte'],
    ['noteDetectionF1', metrics.noteDetectionF1, thresholds.noteDetectionF1, 'gte'],
  ]

  for (const [name, actual, expected, mode] of checks) {
    if (!Number.isFinite(expected)) {
      continue
    }
    if (!Number.isFinite(actual) || (mode === 'gte' && actual < expected)) {
      failures.push({
        metric: name,
        actual,
        expected,
        mode,
      })
    }
  }

  if (Number.isFinite(thresholds.maxMeasureCountDiff)) {
    const actual = Math.abs(Number(metrics.measureCountDiff) || 0)
    if (actual > thresholds.maxMeasureCountDiff) {
      failures.push({
        metric: 'measureCountDiff',
        actual: metrics.measureCountDiff,
        expected: thresholds.maxMeasureCountDiff,
        mode: 'abs-lte',
      })
    }
  }

  if (Number.isFinite(thresholds.maxNoteCountDiff)) {
    const actual = Math.abs(Number(metrics.noteCountDiff) || 0)
    if (actual > thresholds.maxNoteCountDiff) {
      failures.push({
        metric: 'noteCountDiff',
        actual: metrics.noteCountDiff,
        expected: thresholds.maxNoteCountDiff,
        mode: 'abs-lte',
      })
    }
  }

  return failures
}

export function buildFixtureDashboardRecord({
  fixture,
  report = null,
  error = null,
  run = null,
  observation = null,
  scoreGraphMeasures = null,
} = {}) {
  const diagnosticOnly = Boolean(fixture?.diagnosticOnly)
  const optional = Boolean(fixture?.optional) || diagnosticOnly
  const expectedOutcome = fixture?.expectedOutcome ?? 'transcribe'
  const expectedRejectionCodes = fixture?.expectedRejectionCodes ?? ['rejected']
  const base = {
    id: fixture?.id ?? null,
    label: fixture?.label ?? fixture?.id ?? null,
    tier: fixture?.tier ?? null,
    optional,
    diagnosticOnly,
    license: fixture?.license ?? null,
    provenanceRecord: fixture?.provenanceRecord ?? null,
    categories: fixture?.categories ?? [],
    expectedOutcome,
    expectedRejectionCodes,
    pdfPath: fixture?.pdfPath ?? null,
    truthPath: fixture?.truthPath ?? null,
    status: OMR_BENCHMARK_STATUS.ERROR,
    failureReasons: [],
    thresholdFailures: [],
    metrics: null,
    run: run ?? null,
    stressObservation: observation,
    error: null,
  }

  if (error && expectedOutcome === 'reject-honestly') {
    const rejectionCode = error?.code ?? (error?.difficulty?.tooDifficult ? 'rejected' : 'error')
    if (expectedRejectionCodes.includes(rejectionCode)) {
      return {
        ...base,
        status: OMR_BENCHMARK_STATUS.PASS,
        expectedRejection: true,
        failureReasons: error?.difficulty?.reasons ?? error?.reasons ?? [rejectionCode],
        error: {
          message: error?.message ?? 'OMR rejected unsupported input',
          code: rejectionCode,
        },
      }
    }
  }

  if (error?.code === 'rejected' || error?.difficulty?.tooDifficult) {
    return {
      ...base,
      // Diagnostic-only fixtures observe rejection without blocking the dashboard.
      status: diagnosticOnly ? OMR_BENCHMARK_STATUS.SKIPPED : OMR_BENCHMARK_STATUS.REJECTED,
      failureReasons: error?.difficulty?.reasons ?? error?.reasons ?? [error?.message ?? 'rejected'],
      error: {
        message: error?.message ?? 'OMR rejected PDF as too difficult',
        code: error?.code ?? 'rejected',
      },
      run: run ?? {
        omrConfidence: error?.difficulty?.confidence ?? null,
        failureReasons: error?.difficulty?.reasons ?? [],
      },
    }
  }

  if (error) {
    // Optional fixtures with missing assets are skipped, not errored.
    if (optional && error?.code === 'missing-assets') {
      return {
        ...base,
        status: OMR_BENCHMARK_STATUS.SKIPPED,
        failureReasons: [error?.message ?? 'missing optional fixture assets'],
      }
    }
    return {
      ...base,
      status: diagnosticOnly ? OMR_BENCHMARK_STATUS.SKIPPED : OMR_BENCHMARK_STATUS.ERROR,
      failureReasons: [error?.message ?? String(error)],
      error: {
        message: error?.message ?? String(error),
        code: error?.code ?? 'error',
      },
    }
  }

  if (!report) {
    if (expectedOutcome === 'import-only') {
      return {
        ...base,
        status: OMR_BENCHMARK_STATUS.SKIPPED,
        failureReasons: observation ? [] : ['missing-import-observation'],
      }
    }
    return {
      ...base,
      status: OMR_BENCHMARK_STATUS.SKIPPED,
      failureReasons: ['missing-report'],
    }
  }

  if (expectedOutcome === 'reject-honestly') {
    return {
      ...base,
      status: OMR_BENCHMARK_STATUS.FAIL,
      metrics: extractFixtureMetrics(report),
      failureReasons: ['expected an honest rejection, but runtime emitted a transcription'],
    }
  }

  const metrics = extractFixtureMetrics(report)
  const thresholdFailures = diagnosticOnly
    ? []
    : assessFixtureThresholds(metrics, fixture?.thresholds ?? {})
  const hotspotDiagnostics = buildHotspotDiagnostics(report, {
    fixtureId: fixture?.id,
    scoreGraphMeasures,
  })
  const writtenSoundingDuration = buildWrittenSoundingDurationDiagnostics(report, {
    fixtureId: fixture?.id,
    scoreGraphMeasures,
  })
  const tieSustainConstraints = buildTieSustainConstraintDiagnostics(report, {
    fixtureId: fixture?.id,
    scoreGraphMeasures,
  })
  const pipelineStageDiagnostics = buildOmrPipelineStageDiagnostics(report, { fixture })
  const omrRejected = Boolean(report.generatedOmrDiagnostics?.difficulty?.tooDifficult)
  const status = diagnosticOnly
    ? OMR_BENCHMARK_STATUS.SKIPPED
    : omrRejected
      ? OMR_BENCHMARK_STATUS.REJECTED
      : thresholdFailures.length
        ? OMR_BENCHMARK_STATUS.FAIL
        : OMR_BENCHMARK_STATUS.PASS

  return {
    ...base,
    status,
    metrics,
    hotspotDiagnostics,
    writtenSoundingDuration,
    tieSustainConstraints,
    pipelineStageDiagnostics,
    rhythmShadow: null,
    voiceSerializationShadow: null,
    thresholdFailures,
    failureReasons: omrRejected
      ? report.generatedOmrDiagnostics?.failureReasons ?? ['too-difficult']
      : thresholdFailures.map(
          (entry) =>
            `${entry.metric}: ${entry.actual ?? 'n/a'} (need ${entry.mode === 'abs-lte' ? `|diff|≤${entry.expected}` : `≥${entry.expected}`})`,
        ),
    generatedTitle: report.summary?.generatedTitle ?? null,
    groundTruthTitle: report.summary?.groundTruthTitle ?? null,
    scoreGraph: report.generatedOmrDiagnostics?.scoreGraph ?? null,
    runtimeVsScoreGraph: report.generatedOmrDiagnostics?.runtimeVsScoreGraph ?? null,
    ...(report.generatedOmrDiagnostics?.scoreGraphClipPromotion
      ? { scoreGraphClipPromotion: report.generatedOmrDiagnostics.scoreGraphClipPromotion }
      : {}),
    omrConfidence: report.generatedOmrDiagnostics?.difficulty?.confidence ?? null,
    omrFailureReasons: report.generatedOmrDiagnostics?.failureReasons ?? [],
    rejectedOrphanCount: Object.values(
      report.generatedOmrDiagnostics?.orphans?.rejectedOrphanReasons ?? {},
    ).reduce((sum, count) => sum + count, 0),
  }
}

export function summarizeOmrBenchmarkDashboard(records = []) {
  const statusCounts = Object.fromEntries(
    Object.values(OMR_BENCHMARK_STATUS).map((status) => [status, 0]),
  )
  const errorCategoryCounts = {}
  const durationCategoryCounts = {}
  const pitchCategoryCounts = {}
  const durationHistograms = []
  const pitchHistograms = []
  const namedBucketHistograms = []

  for (const record of records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1
    if (record.metrics?.namedErrorBuckets?.buckets) {
      namedBucketHistograms.push(record.metrics.namedErrorBuckets.buckets)
    }
    const source = record.metrics?.topErrorCategory?.source
    if (source) {
      errorCategoryCounts[source] = (errorCategoryCounts[source] ?? 0) + 1
    }
    const durationCategory = record.metrics?.topDurationErrorCategory?.category
    if (durationCategory) {
      durationCategoryCounts[durationCategory] =
        (durationCategoryCounts[durationCategory] ?? 0) + 1
    }
    const pitchCategory = record.metrics?.topPitchErrorCategory?.category
    if (pitchCategory) {
      pitchCategoryCounts[pitchCategory] = (pitchCategoryCounts[pitchCategory] ?? 0) + 1
    }
    if (record.metrics?.durationErrorHistogram) {
      durationHistograms.push(record.metrics.durationErrorHistogram)
    }
    if (record.metrics?.pitchErrorHistogram) {
      pitchHistograms.push(record.metrics.pitchErrorHistogram)
    }
  }

  const overallPass =
    records.length > 0 &&
    records.every(
      (record) =>
        record.status === OMR_BENCHMARK_STATUS.PASS || record.status === OMR_BENCHMARK_STATUS.SKIPPED,
    )

  const aggregatedDurationHistogram = mergeHistograms(durationHistograms)
  const aggregatedPitchHistogram = mergeHistograms(pitchHistograms)
  const aggregatedNamedBuckets = mergeHistograms(namedBucketHistograms)
  const aggregatedNamedBucketTotal = Object.values(aggregatedNamedBuckets).reduce(
    (sum, count) => sum + (Number(count) || 0),
    0,
  )
  const rankedNamedBuckets = topHistogramEntries(aggregatedNamedBuckets, 20)
  const largestNamedBucket = rankedNamedBuckets[0]
    ? {
        bucket: rankedNamedBuckets[0].category,
        count: rankedNamedBuckets[0].count,
        share:
          aggregatedNamedBucketTotal > 0
            ? round(rankedNamedBuckets[0].count / aggregatedNamedBucketTotal)
            : null,
      }
    : null
  const semanticDefectClasses = summarizeSemanticDefectClasses({
    namedBuckets: { buckets: aggregatedNamedBuckets },
    durationErrorHistogram: aggregatedDurationHistogram,
  })

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    fixtureCount: records.length,
    statusCounts,
    overallPass,
    topErrorCategories: Object.entries(errorCategoryCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([category, count]) => ({ category, count })),
    topDurationErrorCategories: Object.entries(durationCategoryCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([category, count]) => ({ category, count })),
    topPitchErrorCategories: Object.entries(pitchCategoryCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([category, count]) => ({ category, count })),
    aggregatedDurationHistogram,
    aggregatedPitchHistogram,
    aggregatedDurationTop: topHistogramEntries(aggregatedDurationHistogram),
    aggregatedPitchTop: topHistogramEntries(aggregatedPitchHistogram),
    aggregatedNamedBuckets,
    rankedNamedBuckets,
    largestNamedBucket,
    semanticDefectClasses,
    tierBreakdown: summarizeTierBreakdown(records),
    failureClusters: clusterFixtureFailures(records),
    rolloutGate: buildRolloutGateReport(records),
    voiceSerializationQualification: buildCorpusVoiceSerializationQualification(records),
    fixtures: records,
  }
}

function fixtureMetricLine(record) {
  const metrics = record.metrics
  if (!metrics) {
    return '  metrics: n/a'
  }
  return [
    `  pitch ${pct(metrics.pitchAccuracy)} | duration ${pct(metrics.durationAccuracy)} | onset ${pct(metrics.onsetAccuracy)} | chord ${pct(metrics.chordGroupingAccuracy)} | F1 ${pct(metrics.noteDetectionF1)}`,
    `  measureΔ ${metrics.measureCountDiff ?? 'n/a'} | noteΔ ${metrics.noteCountDiff ?? 'n/a'} | wrongPitch ${metrics.wrongPitch} | wrongDuration ${metrics.wrongDuration} | wrongOnset ${metrics.wrongOnset} | chordMismatch ${metrics.chordMismatch}`,
  ].join('\n')
}

function promotedMeasuresLine(promotion) {
  const measures = promotion.promotedMeasureNumbers ?? []
  const preview = measures.slice(0, 24).join(', ')
  const suffix = measures.length > 24 ? `, ... (+${measures.length - 24} more)` : ''
  return [
    `  ScoreGraph clip promotion: ${promotion.promotedMeasureCount ?? 0} measures, ${promotion.promotedDecisions ?? 0} decisions, skipped ${promotion.skippedCount ?? 0}`,
    measures.length ? `  promoted measures: ${preview}${suffix}` : null,
  ].filter(Boolean).join('\n')
}

export function formatOmrBenchmarkMarkdown(summary) {
  const lines = [
    '# OMR benchmark dashboard',
    '',
    `Generated: ${summary.generatedAt}`,
    `Fixtures: ${summary.fixtureCount}`,
    `Overall: ${summary.overallPass ? 'PASS' : 'FAIL'}`,
    summary.largestNamedBucket
      ? `Largest remaining error bucket: ${summary.largestNamedBucket.bucket} = ${summary.largestNamedBucket.count}${
          summary.largestNamedBucket.share != null
            ? ` (${Math.round(summary.largestNamedBucket.share * 100)}%)`
            : ''
        }`
      : 'Largest remaining error bucket: none',
    '',
    '## Status',
    `- pass: ${summary.statusCounts.pass ?? 0}`,
    `- fail: ${summary.statusCounts.fail ?? 0}`,
    `- rejected: ${summary.statusCounts.rejected ?? 0}`,
    `- skipped: ${summary.statusCounts.skipped ?? 0}`,
    `- error: ${summary.statusCounts.error ?? 0}`,
    '',
    '## Fixtures',
  ]

  for (const record of summary.fixtures ?? []) {
    lines.push('')
    lines.push(`### ${record.label ?? record.id} (\`${record.status}\`)`)
    if (record.pdfPath) {
      lines.push(`- PDF: \`${record.pdfPath}\``)
    }
    if (record.truthPath) {
      lines.push(`- Truth: \`${record.truthPath}\``)
    }
    if (record.license) {
      lines.push(`- License: ${record.license} (${record.provenanceRecord})`)
    }
    if (record.categories?.length) {
      lines.push(`- Categories: ${record.categories.join(', ')}`)
    }
    if (record.expectedRejection) {
      lines.push(`- Expected honest rejection: ${record.error?.code ?? 'rejected'}`)
    }
    if (record.stressObservation) {
      const observation = record.stressObservation
      lines.push(`- Import observation: ${observation.outcome ?? 'unknown'}`)
      if (Number.isFinite(observation.pagesProcessed)) {
        lines.push(
          `- Regions: ${observation.pagesProcessed} page(s) processed, ${observation.failedPages ?? 0} failed, ${observation.isolatedRegions ?? 0} isolated`,
        )
      }
      if (Number.isFinite(observation.noteCount) || Number.isFinite(observation.measureCount)) {
        lines.push(
          `- Recognition: ${observation.noteCount ?? 0} note(s), ${observation.measureCount ?? 0} measure(s), confidence ${pct(observation.confidence)}`,
        )
      }
      if (Number.isFinite(observation.processingMs)) {
        lines.push(`- Pipeline timing: ${Math.round(observation.processingMs)} ms`)
      }
    }
    if (record.metrics) {
      lines.push(fixtureMetricLine(record))
      const top = record.metrics.topErrorCategory
      if (top?.label) {
        lines.push(`  top error category: ${top.label} (${top.source})`)
      }
      const durationTop = record.metrics.topDurationErrorCategory
      if (durationTop) {
        const partial =
          record.metrics.truncatedWrongDurations > 0
            ? ' (partial sample from truncated report)'
            : ''
        lines.push(
          `  top duration error category: ${durationTop.category} (${durationTop.count} sampled)${partial}`,
        )
      }
      const pitchTop = record.metrics.topPitchErrorCategory
      if (pitchTop) {
        const partial =
          record.metrics.truncatedWrongPitches > 0
            ? ' (partial sample from truncated report)'
            : ''
        lines.push(
          `  top pitch error category: ${pitchTop.category} (${pitchTop.count} sampled)${partial}`,
        )
      }
      if (record.metrics.errorGrouping) {
        const groupingLines = formatErrorGroupingMarkdown(record.metrics.errorGrouping, {
          includeHeading: false,
        })
          .trim()
          .split('\n')
          .map((line) => `  ${line}`)
        lines.push(...groupingLines)
      }
      if (record.metrics.rhythmErrorAttribution) {
        lines.push(
          formatRhythmErrorAttributionMarkdown(record.metrics.rhythmErrorAttribution, {
            indent: '  ',
          }).trimEnd(),
        )
      }
      if (record.writtenSoundingDuration) {
        lines.push(
          formatWrittenSoundingDurationMarkdown(record.writtenSoundingDuration, {
            indent: '  ',
          }).trimEnd(),
        )
      }
      if (record.tieSustainConstraints) {
        lines.push(
          formatTieSustainConstraintMarkdown(record.tieSustainConstraints, {
            indent: '  ',
          }).trimEnd(),
        )
      }
      if (record.hotspotDiagnostics) {
        lines.push(
          formatHotspotDiagnosticsMarkdown(record.hotspotDiagnostics, { indent: '  ' }).trimEnd(),
        )
      }
      if (record.pipelineStageDiagnostics) {
        lines.push(
          formatOmrPipelineStageDiagnosticsMarkdown(record.pipelineStageDiagnostics)
            .trimEnd()
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        )
      }
      if (record.rhythmShadow) {
        lines.push(formatRhythmShadowMarkdown(record.rhythmShadow).trimEnd())
      }
      if (record.voiceSerializationShadow) {
        lines.push(formatVoiceSerializationShadowMarkdown(record.voiceSerializationShadow).trimEnd())
      }
    }
    if (record.scoreGraph) {
      const graph = record.scoreGraph
      const bridge = graph.geometryBridge
      const coverage = bridge?.coverage != null ? pct(bridge.coverage) : 'n/a'
      lines.push(
        `  ScoreGraph IR (observation): ${graph.totalNodes} nodes, ${graph.totalEdges} edges across ${graph.measureCount} measures; geometry bridge ${coverage}`,
      )
      const budget = graph.voiceBudgetDiagnostics
      if (budget) {
        lines.push(
          `  IR voice budget: ${budget.measuresWithOverflow} overflow measure(s), ${budget.totalOverflowEvents} overflow event(s), ${budget.measuresWithUnderflow} underfill measure(s)`,
        )
      }
      const durationObservation = graph.durationObservation
      if (durationObservation) {
        lines.push(
          `  IR duration split: ${durationObservation.nodesWithWrittenSoundingSplit} node(s) sounding≠written; ${durationObservation.tieNodes} tie; ${durationObservation.gapToNextNodes} gap-to-next`,
        )
      }
      const parity = record.runtimeVsScoreGraph?.parity
      if (parity) {
        lines.push(
          `  IR ↔ runtime parity: noteheads ${parity.noteheads ? 'ok' : 'MISMATCH'}, rests ${parity.rests ? 'ok' : 'MISMATCH'}`,
        )
      }
    }
    if (record.scoreGraphClipPromotion) {
      lines.push(promotedMeasuresLine(record.scoreGraphClipPromotion))
    }
    if (record.failureReasons?.length) {
      lines.push(`- reasons: ${record.failureReasons.join('; ')}`)
    }
    if (record.error?.message) {
      lines.push(`- error: ${record.error.message}`)
    }
  }

  if (summary.topErrorCategories?.length) {
    lines.push('')
    lines.push('## Top error categories (across fixtures)')
    for (const entry of summary.topErrorCategories) {
      lines.push(`- ${entry.category}: ${entry.count}`)
    }
  }

  if (summary.aggregatedDurationTop?.length) {
    lines.push('')
    lines.push('## Aggregated duration error histogram')
    for (const entry of summary.aggregatedDurationTop) {
      lines.push(`- ${entry.category}: ${entry.count}`)
    }
  }

  if (summary.aggregatedPitchTop?.length) {
    lines.push('')
    lines.push('## Aggregated pitch error histogram')
    for (const entry of summary.aggregatedPitchTop) {
      lines.push(`- ${entry.category}: ${entry.count}`)
    }
  }

  if (summary.rankedNamedBuckets?.length) {
    lines.push('')
    lines.push('## Error buckets (across fixtures)')
    lines.push('Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes')
    for (const entry of summary.rankedNamedBuckets) {
      lines.push(`- ${entry.category}: ${entry.count}`)
    }
    if (summary.largestNamedBucket) {
      const share =
        summary.largestNamedBucket.share != null
          ? ` (${Math.round(summary.largestNamedBucket.share * 100)}% of counted errors)`
          : ''
      lines.push(
        `- **Largest remaining error bucket: ${summary.largestNamedBucket.bucket} = ${summary.largestNamedBucket.count}${share}**`,
      )
    }
  }

  if (summary.semanticDefectClasses?.ranked?.length) {
    lines.push('')
    lines.push('## Semantic defect classes (across fixtures)')
    lines.push(summary.semanticDefectClasses.priorityGuidance)
    lines.push('Classes: Rhythm, Sustain (ties), Articulation, Measure structure, Playback, Pitch')
    for (const entry of summary.semanticDefectClasses.ranked) {
      const share = entry.share != null ? ` (${Math.round(entry.share * 100)}%)` : ''
      lines.push(`- ${entry.label}: ${entry.count}${share} (priority ${entry.priority})`)
    }
    if (summary.semanticDefectClasses.largestClass) {
      const largest = summary.semanticDefectClasses.largestClass
      lines.push(
        `- **Largest semantic class: ${largest.label} = ${largest.count}**`,
      )
    }
  }

  if (summary.tierBreakdown?.length) {
    lines.push('')
    lines.push('## Tier breakdown')
    for (const tier of summary.tierBreakdown) {
      const statusLine = Object.entries(tier.statusCounts)
        .map(([status, count]) => `${status}=${count}`)
        .join(', ')
      lines.push(`- ${tier.tier}: ${tier.fixtureCount} fixture(s) (${statusLine})`)
      if (tier.failing.length) {
        lines.push(`  failing: ${tier.failing.join(', ')}`)
      }
    }
  }

  if (summary.failureClusters?.length) {
    lines.push('')
    lines.push('## Failure clusters')
    for (const cluster of summary.failureClusters) {
      lines.push(
        `- ${cluster.status} | source=${cluster.errorSource} | duration=${cluster.durationCategory} | pitch=${cluster.pitchCategory}: ${cluster.fixtures.join(', ')}`,
      )
      if (cluster.reasons.length) {
        lines.push(`  reasons: ${cluster.reasons.join('; ')}`)
      }
    }
  }

  if (summary.rolloutGate) {
    lines.push('')
    lines.push('## V2 rollout gate')
    lines.push(formatRolloutGateMarkdown(summary.rolloutGate).trimEnd())
  }

  if (summary.voiceSerializationQualification) {
    lines.push('')
    lines.push('## Voice serialization qualification (Phase 6B)')
    lines.push(`**${summary.voiceSerializationQualification.verdict}**`)
    for (const fixture of summary.voiceSerializationQualification.fixtures ?? []) {
      lines.push(formatVoiceSerializationQualificationMarkdown(fixture, { indent: '' }).trimEnd())
    }
  }

  return `${lines.join('\n')}\n`
}

export function serializeOmrBenchmarkReport(summary) {
  return JSON.stringify(summary, null, 2)
}
