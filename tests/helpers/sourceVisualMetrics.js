function finitePoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
}

function normalizedIds(ids) {
  return [...new Set((ids ?? []).filter(Boolean).map(String))].sort()
}

function percentile(sorted, percentileValue) {
  if (!sorted.length) return null
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1),
  )
  return sorted[index]
}

/**
 * Measure source-page center error in local staff-gap units.
 *
 * Source coordinates normalize X by page width and Y by page height. Convert
 * X into page-height units before applying the Y-normalized staff gap so the
 * result remains comparable across page sizes and aspect ratios.
 */
export function centerErrorInStaffGapUnits({
  expectedCenter,
  actualCenter,
  staffGap,
  pageWidth,
  pageHeight,
}) {
  const gap = Number(staffGap)
  const width = Number(pageWidth)
  const height = Number(pageHeight)
  if (
    !finitePoint(expectedCenter) ||
    !finitePoint(actualCenter) ||
    !(gap > 0) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return null
  }

  const dxInPageHeightUnits =
    (Number(actualCenter.x) - Number(expectedCenter.x)) * (width / height)
  const dyInPageHeightUnits = Number(actualCenter.y) - Number(expectedCenter.y)
  const error = Math.hypot(dxInPageHeightUnits, dyInPageHeightUnits) / gap
  // Stable JSON reports should not move a boundary sample across the 1-gap
  // gate because binary floating point produced 1.0000000000000009.
  return Math.round(error * 1_000_000_000) / 1_000_000_000
}

/** Build one deterministic row suitable for a before/after JSON report. */
export function evaluateSourceVisualSample({
  expectedCenter,
  actualCenter,
  staffGap,
  pageWidth,
  pageHeight,
  expectedSourceNoteheadIds = [],
  actualSourceNoteheadIds = [],
  precise = false,
  fallback = false,
}) {
  const expectedIds = normalizedIds(expectedSourceNoteheadIds)
  const actualIds = normalizedIds(actualSourceNoteheadIds)
  return {
    hasTarget: finitePoint(actualCenter),
    precise: Boolean(precise),
    fallback: Boolean(fallback),
    sourceIdsMatch:
      expectedIds.length === actualIds.length &&
      expectedIds.every((id, index) => id === actualIds[index]),
    centerErrorStaffGaps: centerErrorInStaffGapUnits({
      expectedCenter,
      actualCenter,
      staffGap,
      pageWidth,
      pageHeight,
    }),
  }
}

/** Aggregate only source-backed correctness facts; no pixel snapshots needed. */
export function summarizeSourceVisualMetrics(samples = []) {
  const rows = samples.filter(Boolean)
  const errors = rows
    .map((sample) => sample.centerErrorStaffGaps)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const countWithin = (threshold) => errors.filter((value) => value <= threshold).length
  const total = rows.length

  return {
    sampleCount: total,
    preciseCount: rows.filter((sample) => sample.precise).length,
    fallbackCount: rows.filter((sample) => sample.fallback).length,
    missingTargetCount: rows.filter((sample) => !sample.hasTarget).length,
    sourceIdMatchCount: rows.filter((sample) => sample.sourceIdsMatch).length,
    wrongPreciseCount: rows.filter(
      (sample) => sample.precise && !sample.sourceIdsMatch,
    ).length,
    preciseCoverage: total
      ? rows.filter((sample) => sample.precise).length / total
      : 0,
    centerErrorStaffGaps: {
      measuredCount: errors.length,
      median: percentile(errors, 0.5),
      p95: percentile(errors, 0.95),
      max: errors.length ? errors[errors.length - 1] : null,
      withinHalfGap: countWithin(0.5),
      withinOneGap: countWithin(1),
      withinTwoGaps: countWithin(2),
    },
  }
}
