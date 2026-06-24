/**
 * Alignment corpus benchmark — pure report building and summarization.
 * Tooling only; does not change runtime score-follow behaviour.
 */
import { PROMOTION_STATUS } from './anchorComparison.js'

export const BENCHMARK_MANIFEST_VERSION = 1

export const BLOCKER_CATEGORIES = {
  SOURCE_MISMATCH: 'source-mismatch',
  MEASURE_COUNT_MISMATCH: 'measure-count-mismatch',
  DENSE_FALSE_BARLINES: 'dense-false-barlines',
  MISSING_BARLINES: 'missing-barlines',
  WRONG_SYSTEM_GROUPING: 'wrong-system-grouping',
  PAGE_MISMATCH: 'page-mismatch',
  WEAK_SYSTEMS: 'weak-systems',
  CALIBRATION_INCOMPLETE: 'calibration-incomplete',
  SETUP_FAILED: 'setup-failed',
  MISSING_ASSETS: 'missing-assets',
}

/** Validate manifest shape; returns { ok, errors }. */
export function validateManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing or not an object'] }
  }
  if (!Array.isArray(manifest.entries)) {
    return { ok: false, errors: ['manifest.entries must be an array'] }
  }
  manifest.entries.forEach((entry, index) => {
    if (!entry?.id) {
      errors.push(`entries[${index}]: missing id`)
    }
    if (!entry?.runner) {
      errors.push(`entries[${index}] (${entry?.id ?? '?'}): missing runner`)
    }
    if (!entry?.license) {
      errors.push(`entries[${index}] (${entry?.id ?? '?'}): missing license`)
    }
  })
  return { ok: errors.length === 0, errors }
}

/** Filter manifest entries for a benchmark run. */
export function selectManifestEntries(manifest, { ciOnly = false } = {}) {
  const entries = manifest.entries ?? []
  if (!ciOnly) {
    return entries
  }
  return entries.filter((entry) => entry.runInCi !== false)
}

function aggregateRejectionHints(perSystem = []) {
  const totals = {}
  for (const system of perSystem) {
    const summary = system.rejectedSummary ?? system.barlineRejectedSummary ?? ''
    if (!summary) {
      continue
    }
    for (const part of summary.split(',')) {
      const trimmed = part.trim()
      const match = trimmed.match(/^([^=]+)=/)
      if (match) {
        const key = match[1].trim()
        totals[key] = (totals[key] ?? 0) + 1
      }
    }
  }
  return totals
}

/** Map diagnostics to normalized blocker category tags. */
export function categorizeBlockers({
  source = {},
  systems = {},
  calibrationOk = false,
  setupOk = true,
  alignmentWarnings = [],
} = {}) {
  const blockers = []

  if (!setupOk) {
    blockers.push(BLOCKER_CATEGORIES.SETUP_FAILED)
  }
  if (!calibrationOk) {
    blockers.push(BLOCKER_CATEGORIES.CALIBRATION_INCOMPLETE)
  }

  for (const indicator of source.indicators ?? []) {
    if (indicator === 'measure-count-mismatch') {
      blockers.push(BLOCKER_CATEGORIES.MEASURE_COUNT_MISMATCH)
    }
    if (indicator === 'system-count-mismatch') {
      blockers.push(BLOCKER_CATEGORIES.WRONG_SYSTEM_GROUPING)
    }
    if (indicator === 'page-count-mismatch') {
      blockers.push(BLOCKER_CATEGORIES.PAGE_MISMATCH)
    }
    if (indicator.includes('midi') || indicator === 'layout-start-mismatch') {
      blockers.push(BLOCKER_CATEGORIES.SOURCE_MISMATCH)
    }
  }

  if (source.editionConflictLikely) {
    blockers.push(BLOCKER_CATEGORIES.SOURCE_MISMATCH)
  }

  if ((systems.weak ?? 0) > 0) {
    blockers.push(BLOCKER_CATEGORIES.WEAK_SYSTEMS)
  }

  const rejectionHints = aggregateRejectionHints(systems.perSystem)
  const perSystem = systems.perSystem ?? []
  const hasDenseThinning = (rejectionHints['too-dense'] ?? 0) > 0
  const hasAmbiguousDensity =
    perSystem.some((s) => s.barlineDensityAmbiguous === true) ||
    perSystem.some((s) =>
      ['ambiguous-density', 'barline-grid-too-dense', 'too-many-barlines'].includes(
        s.barlineReliabilityReason,
      ),
    )
  const hasRetainedLowConfidence = perSystem.some(
    (s) =>
      (s.barlineRetainedLowConfidence ?? 0) > 0 &&
      s.barlineConfident === false &&
      (s.barlineReliabilityReason === 'low-confidence-candidates' ||
        s.barlineDensityAmbiguous === true),
  )
  const hasInconsistentSpacing = (rejectionHints['inconsistent-spacing'] ?? 0) > 0

  if (
    hasDenseThinning ||
    hasAmbiguousDensity ||
    hasRetainedLowConfidence ||
    hasInconsistentSpacing
  ) {
    blockers.push(BLOCKER_CATEGORIES.DENSE_FALSE_BARLINES)
  }
  if ((systems.missingBarlineEstimate ?? 0) > 0) {
    blockers.push(BLOCKER_CATEGORIES.MISSING_BARLINES)
  }

  for (const warning of alignmentWarnings) {
    const lower = String(warning).toLowerCase()
    if (lower.includes('barline') && lower.includes('measure')) {
      blockers.push(BLOCKER_CATEGORIES.MEASURE_COUNT_MISMATCH)
    }
    if (lower.includes('system') && lower.includes('differ')) {
      blockers.push(BLOCKER_CATEGORIES.WRONG_SYSTEM_GROUPING)
    }
    if (lower.includes('page count')) {
      blockers.push(BLOCKER_CATEGORIES.PAGE_MISMATCH)
    }
  }

  return [...new Set(blockers)]
}

/**
 * Build one corpus row from pipeline outputs.
 */
export function buildPieceBenchmarkRecord({
  entry,
  status = 'ok',
  skipReason = null,
  error = null,
  setup = null,
  calibration = null,
  diagnostics = null,
  alignmentReport = null,
}) {
  const base = {
    id: entry.id,
    title: entry.title ?? entry.id,
    composer: entry.composer ?? null,
    source: entry.source ?? null,
    license: entry.license ?? null,
    tags: entry.tags ?? [],
    runner: entry.runner,
    status,
    skipReason,
    error: error ? String(error) : null,
    expected: entry.expected ?? {},
  }

  if (status !== 'ok') {
    return {
      ...base,
      readiness: PROMOTION_STATUS.NOT_SAFE,
      alignmentAction: 'manual',
      failureReasons: [skipReason ?? error ?? 'benchmark-not-run'],
      blockers: [skipReason === 'missing-assets' ? BLOCKER_CATEGORIES.MISSING_ASSETS : BLOCKER_CATEGORIES.SETUP_FAILED],
    }
  }

  const perSystem = diagnostics?.systems?.perSystem ?? []
  const rejectionHints = aggregateRejectionHints(perSystem)
  const weakSystems = perSystem.filter(
    (s) => s.barlineConfident === false || s.status?.includes('weak'),
  )
  const mismatchSystems = perSystem.filter((s) => s.status?.includes('mismatch'))

  const falsePositiveHints = {
    stemLike: rejectionHints['stem-like'] ?? 0,
    tooDense: rejectionHints['too-dense'] ?? 0,
    weakGapSpan: rejectionHints['weak-gap-span'] ?? 0,
    weakRun: rejectionHints['weak-run'] ?? 0,
    margin: rejectionHints.margin ?? 0,
    retainedLowConfidence: perSystem.reduce(
      (sum, s) => sum + (s.barlineRetainedLowConfidence ?? 0),
      0,
    ),
    densityAmbiguousSystems: perSystem.filter((s) => s.barlineDensityAmbiguous === true).length,
  }

  const missingEstimateCount = perSystem.filter(
    (s) => !Number.isFinite(s.detectedCount),
  ).length

  const failureReasons = [
    ...(diagnostics?.readiness?.reasons ?? []),
    ...(diagnostics?.warnings ?? []),
    ...(alignmentReport?.warnings ?? []),
  ].filter(Boolean)

  const blockers = categorizeBlockers({
    source: diagnostics?.source ?? {},
    systems: {
      ...(diagnostics?.systems ?? {}),
      perSystem,
      missingBarlineEstimate: missingEstimateCount,
    },
    calibrationOk: diagnostics?.calibrationOk === true,
    setupOk: setup?.ok === true,
    alignmentWarnings: alignmentReport?.warnings ?? [],
  })

  return {
    ...base,
    pages: diagnostics?.source?.pdfPages ?? setup?.preview?.pageCount ?? null,
    measures: diagnostics?.expectedMeasures ?? null,
    systemsDetected: diagnostics?.systems?.total ?? setup?.preview?.systemCount ?? null,
    expectedMeasures: entry.expected?.measures ?? diagnostics?.expectedMeasures ?? null,
    detectedMeasures: diagnostics?.detectedMeasures ?? null,
    measureDelta: diagnostics?.measureDelta ?? null,
    barlineReliability: {
      confidentSystems: perSystem.filter((s) => s.barlineConfident !== false).length,
      weakSystems: weakSystems.length,
      unreliableCount: perSystem.filter((s) => s.barlineConfident === false).length,
    },
    weakSystems: weakSystems.map((s) => ({
      systemIndex: s.systemIndex,
      page: s.page,
      reason: s.barlineReliabilityReason ?? s.notes?.join('; '),
    })),
    mismatchSystems: mismatchSystems.map((s) => s.systemIndex),
    falsePositiveHints,
    falseNegativeHints: {
      missingMeasureEstimate: missingEstimateCount,
      extraBarlineEstimate: diagnostics?.systems?.extraBarlineEstimate ?? 0,
      missingBarlineEstimate: diagnostics?.systems?.missingBarlineEstimate ?? 0,
    },
    alignmentAction: alignmentReport?.decision?.action ?? 'manual',
    readiness: diagnostics?.readiness?.status ?? PROMOTION_STATUS.NOT_SAFE,
    allocationMode: diagnostics?.allocationMode ?? calibration?.allocationMode ?? null,
    sourceIndicators: diagnostics?.source?.indicators ?? [],
    failureReasons: [...new Set(failureReasons)].slice(0, 12),
    blockers,
  }
}

/** Summarize an array of piece records. */
export function summarizeBenchmarkResults(records = []) {
  const ran = records.filter((r) => r.status === 'ok')
  const skipped = records.filter((r) => r.status === 'skipped')
  const errored = records.filter((r) => r.status === 'error')

  const readinessCounts = {
    [PROMOTION_STATUS.READY]: 0,
    [PROMOTION_STATUS.NEEDS_REVIEW]: 0,
    [PROMOTION_STATUS.NOT_SAFE]: 0,
  }
  const actionCounts = { auto: 0, confirm: 0, manual: 0 }
  const blockerCounts = {}

  for (const record of ran) {
    readinessCounts[record.readiness] = (readinessCounts[record.readiness] ?? 0) + 1
    actionCounts[record.alignmentAction] = (actionCounts[record.alignmentAction] ?? 0) + 1
    for (const blocker of record.blockers ?? []) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1
    }
  }

  const topBlockers = Object.entries(blockerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }))

  return {
    total: records.length,
    ran: ran.length,
    skipped: skipped.length,
    errored: errored.length,
    readiness: readinessCounts,
    alignmentAction: actionCounts,
    blockerCounts,
    topBlockers,
    records,
  }
}

export function formatBenchmarkSummaryText(summary) {
  const lines = [
    '=== Alignment corpus benchmark ===',
    `Pieces: ${summary.total} total | ${summary.ran} ran | ${summary.skipped} skipped | ${summary.errored} errors`,
    '',
    'Readiness:',
    `  READY: ${summary.readiness[PROMOTION_STATUS.READY] ?? 0}`,
    `  NEEDS_REVIEW: ${summary.readiness[PROMOTION_STATUS.NEEDS_REVIEW] ?? 0}`,
    `  NOT_SAFE: ${summary.readiness[PROMOTION_STATUS.NOT_SAFE] ?? 0}`,
    '',
    'Alignment action:',
    `  auto: ${summary.alignmentAction.auto ?? 0} | confirm: ${summary.alignmentAction.confirm ?? 0} | manual: ${summary.alignmentAction.manual ?? 0}`,
  ]

  if (summary.topBlockers?.length) {
    lines.push('', 'Top blockers:')
    summary.topBlockers.slice(0, 8).forEach(({ category, count }) => {
      lines.push(`  ${count}× ${category}`)
    })
  }

  return lines.join('\n')
}

/** Flatten piece records to CSV rows. */
export function pieceRecordsToCsv(records = []) {
  const header = [
    'id',
    'title',
    'status',
    'readiness',
    'alignmentAction',
    'pages',
    'measures',
    'systemsDetected',
    'expectedMeasures',
    'detectedMeasures',
    'measureDelta',
    'weakSystems',
    'blockers',
    'tags',
  ]
  const rows = records.map((record) =>
    [
      record.id,
      csvEscape(record.title),
      record.status,
      record.readiness ?? '',
      record.alignmentAction ?? '',
      record.pages ?? '',
      record.measures ?? '',
      record.systemsDetected ?? '',
      record.expectedMeasures ?? '',
      record.detectedMeasures ?? '',
      record.measureDelta ?? '',
      record.barlineReliability?.weakSystems ?? '',
      (record.blockers ?? []).join('|'),
      (record.tags ?? []).join('|'),
    ].join(','),
  )
  return `${header.join(',')}\n${rows.join('\n')}\n`
}

function csvEscape(value) {
  const text = String(value ?? '')
  return text.includes(',') || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeBenchmarkReport(summary) {
  return JSON.stringify(
    {
      version: BENCHMARK_MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        total: summary.total,
        ran: summary.ran,
        skipped: summary.skipped,
        errored: summary.errored,
        readiness: summary.readiness,
        alignmentAction: summary.alignmentAction,
        blockerCounts: summary.blockerCounts,
        topBlockers: summary.topBlockers,
      },
      pieces: summary.records,
    },
    null,
    2,
  )
}
