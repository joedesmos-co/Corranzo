import { summarizeDurationErrors } from './omrDurationErrorAnalysis.js'

export const OMR_BENCHMARK_MANIFEST_VERSION = 1

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
  const entries = Object.entries(histogram).filter(([, count]) => count > 0)
  if (!entries.length) {
    return null
  }
  entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const [category, count] = entries[0]
  return { category, count }
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

export function validateOmrBenchmarkManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing or not an object'] }
  }
  if (!Array.isArray(manifest.fixtures)) {
    return { ok: false, errors: ['manifest.fixtures must be an array'] }
  }
  manifest.fixtures.forEach((fixture, index) => {
    if (!fixture?.id) {
      errors.push(`fixtures[${index}]: missing id`)
    }
    if (!fixture?.pdf) {
      errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): missing pdf`)
    }
    if (!fixture?.truth) {
      errors.push(`fixtures[${index}] (${fixture?.id ?? '?'}): missing truth`)
    }
  })
  return { ok: errors.length === 0, errors }
}

export function extractFixtureMetrics(report = {}) {
  const metrics = report.metrics ?? {}
  const totals = report.totals ?? {}
  const wrongDurations = report.debug?.wrongDurations ?? []
  const durationHistogram = summarizeDurationErrors(wrongDurations)
  const topDurationErrorCategory = topHistogramEntry(durationHistogram)
  const primary = report.summary?.primaryErrorSource ?? null

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
    durationErrorHistogram: durationHistogram,
    truncatedWrongDurations: report.debug?.truncated?.wrongDurations ?? 0,
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
} = {}) {
  const base = {
    id: fixture?.id ?? null,
    label: fixture?.label ?? fixture?.id ?? null,
    tier: fixture?.tier ?? null,
    pdfPath: fixture?.pdfPath ?? null,
    truthPath: fixture?.truthPath ?? null,
    status: OMR_BENCHMARK_STATUS.ERROR,
    failureReasons: [],
    thresholdFailures: [],
    metrics: null,
    run: run ?? null,
    error: null,
  }

  if (error?.code === 'rejected' || error?.difficulty?.tooDifficult) {
    return {
      ...base,
      status: OMR_BENCHMARK_STATUS.REJECTED,
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
    return {
      ...base,
      status: OMR_BENCHMARK_STATUS.ERROR,
      failureReasons: [error?.message ?? String(error)],
      error: {
        message: error?.message ?? String(error),
        code: error?.code ?? 'error',
      },
    }
  }

  if (!report) {
    return {
      ...base,
      status: OMR_BENCHMARK_STATUS.SKIPPED,
      failureReasons: ['missing-report'],
    }
  }

  const metrics = extractFixtureMetrics(report)
  const thresholdFailures = assessFixtureThresholds(metrics, fixture?.thresholds ?? {})
  const omrRejected = Boolean(report.generatedOmrDiagnostics?.difficulty?.tooDifficult)
  const status = omrRejected
    ? OMR_BENCHMARK_STATUS.REJECTED
    : thresholdFailures.length
      ? OMR_BENCHMARK_STATUS.FAIL
      : OMR_BENCHMARK_STATUS.PASS

  return {
    ...base,
    status,
    metrics,
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

  for (const record of records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1
    const source = record.metrics?.topErrorCategory?.source
    if (source) {
      errorCategoryCounts[source] = (errorCategoryCounts[source] ?? 0) + 1
    }
    const durationCategory = record.metrics?.topDurationErrorCategory?.category
    if (durationCategory) {
      durationCategoryCounts[durationCategory] =
        (durationCategoryCounts[durationCategory] ?? 0) + 1
    }
  }

  const overallPass =
    records.length > 0 &&
    records.every(
      (record) =>
        record.status === OMR_BENCHMARK_STATUS.PASS || record.status === OMR_BENCHMARK_STATUS.SKIPPED,
    )

  return {
    version: 1,
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
    }
    if (record.scoreGraph) {
      const graph = record.scoreGraph
      const bridge = graph.geometryBridge
      const coverage = bridge?.coverage != null ? pct(bridge.coverage) : 'n/a'
      lines.push(
        `  ScoreGraph IR (observation): ${graph.totalNodes} nodes, ${graph.totalEdges} edges across ${graph.measureCount} measures; geometry bridge ${coverage}`,
      )
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

  return `${lines.join('\n')}\n`
}

export function serializeOmrBenchmarkReport(summary) {
  return JSON.stringify(summary, null, 2)
}
