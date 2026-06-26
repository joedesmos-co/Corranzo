/** Page mean confidence below this is flagged as a weak page. */
export const CALIBRATION_WEAK_PAGE_THRESHOLD = 0.85

/** System confidence below this (but above low) is flagged as weak. */
export const CALIBRATION_WEAK_SYSTEM_THRESHOLD = 0.75

/** Systems below this score are critically low-confidence. */
export const CALIBRATION_LOW_CONFIDENCE_THRESHOLD = 0.55

function isLowConfidenceSystem(confidence) {
  return Number.isFinite(confidence) && confidence < CALIBRATION_LOW_CONFIDENCE_THRESHOLD
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function round3(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
}

export function isWeakConfidencePage(confidence) {
  return Number.isFinite(confidence) && confidence < CALIBRATION_WEAK_PAGE_THRESHOLD
}

export function isWeakConfidenceSystem(confidence) {
  return (
    Number.isFinite(confidence) &&
    confidence < CALIBRATION_WEAK_SYSTEM_THRESHOLD &&
    !isLowConfidenceSystem(confidence)
  )
}

/** Mean of the lowest fraction of values (e.g. bottom quartile). */
export function bottomFractionMean(values, fraction = 0.25) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) {
    return null
  }
  const sorted = [...finite].sort((a, b) => a - b)
  const count = Math.max(1, Math.ceil(sorted.length * fraction))
  const slice = sorted.slice(0, count)
  return slice.reduce((sum, value) => sum + value, 0) / slice.length
}

/**
 * Overall confidence cannot stay near 100% when a page/system tail is weak or
 * pages are missing from calibration maps. Uses a geometric blend of the raw
 * measure-weighted score, weakest page, and bottom-quartile system mean, then
 * applies a missing-page penalty.
 */
export function computeAdjustedOverallConfidence({
  rawOverall,
  perPageConfidence = [],
  perSystemConfidence = [],
  missingPages = [],
  expectedPageCount = 0,
}) {
  if (!Number.isFinite(rawOverall)) {
    return null
  }

  const pageConfs = perPageConfidence.map((entry) => entry.confidence).filter(Number.isFinite)
  const systemConfs = perSystemConfidence.map((entry) => entry.confidence).filter(Number.isFinite)

  const minPage = pageConfs.length ? Math.min(...pageConfs) : rawOverall
  const tailSystems = bottomFractionMean(systemConfs, 0.25) ?? rawOverall

  const components = [rawOverall, minPage, tailSystems].filter(Number.isFinite)
  let adjusted =
    components.length > 0
      ? components.reduce((product, value) => product * value, 1) ** (1 / components.length)
      : rawOverall

  const missingCount = missingPages.length
  if (missingCount > 0 && expectedPageCount > 0) {
    const missingRatio = missingCount / expectedPageCount
    adjusted *= 1 - Math.min(0.4, missingRatio * 0.55)
  }

  return clamp01(adjusted)
}

function collectCalibratedPageNumbers({ perPageConfidence, perSystemConfidence, pageLayout }) {
  const pages = new Set()
  for (const entry of perPageConfidence ?? []) {
    if (entry?.page != null) {
      pages.add(entry.page)
    }
  }
  for (const entry of perSystemConfidence ?? []) {
    if (entry?.page != null) {
      pages.add(entry.page)
    }
  }
  for (const entry of pageLayout ?? []) {
    if (entry?.page != null) {
      pages.add(entry.page)
    }
  }
  return pages
}

function expectedPageNumbers({ pdfPageCount, orientation }) {
  if (orientation?.pages?.length) {
    return orientation.pages.map((entry) => entry.page).sort((a, b) => a - b)
  }
  if (pdfPageCount > 0) {
    return Array.from({ length: pdfPageCount }, (_, index) => index + 1)
  }
  return []
}

/** Coverage gaps + weak pages/systems + adjusted overall confidence. */
export function analyzeCalibrationCoverage({
  smartCalibration = null,
  orientation = null,
  pdfPageCount = null,
} = {}) {
  const perPageConfidence = smartCalibration?.perPageConfidence ?? []
  const perSystemConfidence = smartCalibration?.perSystemConfidence ?? []
  const pageLayout = smartCalibration?.pageLayout ?? []
  const rawOverallConfidence = smartCalibration?.overallConfidence ?? null

  const expectedPages = expectedPageNumbers({
    pdfPageCount: pdfPageCount ?? orientation?.pages?.length ?? 0,
    orientation,
  })
  const calibratedPages = collectCalibratedPageNumbers({
    perPageConfidence,
    perSystemConfidence,
    pageLayout,
  })

  const missingPages = expectedPages.filter((page) => !calibratedPages.has(page))
  const weakPages = perPageConfidence.filter((entry) => isWeakConfidencePage(entry.confidence))
  const weakSystems = perSystemConfidence.filter((entry) =>
    isWeakConfidenceSystem(entry.confidence),
  )
  const lowSystems = perSystemConfidence.filter((entry) =>
    isLowConfidenceSystem(entry.confidence),
  )

  const expectedPageCount = expectedPages.length
  const calibratedPageCount = calibratedPages.size
  const pageCountMismatch =
    expectedPageCount > 0 && calibratedPageCount > 0 && calibratedPageCount < expectedPageCount

  const adjustedOverallConfidence = computeAdjustedOverallConfidence({
    rawOverall: rawOverallConfidence,
    perPageConfidence,
    perSystemConfidence,
    missingPages,
    expectedPageCount,
  })

  return {
    pdfPageCount: expectedPageCount || null,
    calibratedPageCount,
    missingPages,
    pageCountMismatch,
    weakPages,
    weakSystems,
    lowSystems,
    rawOverallConfidence: rawOverallConfidence != null ? round3(rawOverallConfidence) : null,
    adjustedOverallConfidence:
      adjustedOverallConfidence != null ? round3(adjustedOverallConfidence) : null,
  }
}

export function buildCalibrationCoverageWarnings(coverage) {
  if (!coverage) {
    return []
  }

  const warnings = []

  if (coverage.pageCountMismatch) {
    warnings.push({
      code: 'page-count-mismatch',
      message: `Calibration covers ${coverage.calibratedPageCount} of ${coverage.pdfPageCount} PDF pages.`,
      details: { missingPages: coverage.missingPages },
    })
  }

  for (const page of coverage.missingPages ?? []) {
    warnings.push({
      code: 'missing-page-calibration',
      message: `Page ${page} has no calibration data (no detected systems or layout).`,
    })
  }

  for (const page of coverage.weakPages ?? []) {
    warnings.push({
      code: 'weak-page-confidence',
      message: `Page ${page.page} confidence ${round3(page.confidence)} is below target.`,
    })
  }

  for (const system of coverage.weakSystems ?? []) {
    warnings.push({
      code: 'weak-system-confidence',
      message: `System ${system.index + 1} (page ${system.page}) confidence ${round3(system.confidence)}.`,
    })
  }

  for (const system of coverage.lowSystems ?? []) {
    warnings.push({
      code: 'low-system-confidence',
      message: `System ${system.index + 1} (page ${system.page}) confidence ${round3(system.confidence)}.`,
    })
  }

  return warnings
}

/** Merge coverage analysis into a smart-calibration report object. */
export function enrichSmartCalibrationReport(report, { orientation = null, pdfPageCount = null } = {}) {
  if (!report?.active) {
    return report
  }
  if (report.coverage && report.adjustedOverallConfidence != null) {
    return report
  }

  const coverage = analyzeCalibrationCoverage({
    smartCalibration: report,
    orientation,
    pdfPageCount,
  })

  return {
    ...report,
    coverage,
    adjustedOverallConfidence: coverage.adjustedOverallConfidence,
    rawOverallConfidence: coverage.rawOverallConfidence ?? report.overallConfidence,
  }
}
