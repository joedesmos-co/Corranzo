/**
 * Classify missing/extra note evaluator rows by proven root cause.
 * Diagnostic only — no detection or matcher logic.
 */

export const NOTE_COUNT_ROOT_CAUSE = {
  DETECTION_LOSS: 'detection-loss',
  DEDUPE_MISTAKE: 'dedupe-mistake',
  GROUPING_MISTAKE: 'grouping-mistake',
  SERIALIZATION_MISTAKE: 'serialization-mistake',
  MATCHER_ARTIFACT: 'matcher-artifact',
}

const NOTE_COUNT_ROOT_CAUSE_ORDER = [
  NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE,
  NOTE_COUNT_ROOT_CAUSE.MATCHER_ARTIFACT,
  NOTE_COUNT_ROOT_CAUSE.GROUPING_MISTAKE,
  NOTE_COUNT_ROOT_CAUSE.DEDUPE_MISTAKE,
  NOTE_COUNT_ROOT_CAUSE.DETECTION_LOSS,
]

function measureDedupeMap(report = {}) {
  const perMeasure = report.generatedOmrDiagnostics?.noteMatching?.perMeasure ?? []
  const map = new Map()
  for (const entry of perMeasure) {
    if (entry?.measureNumber == null) {
      continue
    }
    map.set(entry.measureNumber, {
      dedupedDuringGrouping: Number(entry.dedupedDuringGrouping) || 0,
      detectedNoteheads: Number(entry.detectedNoteheads) || 0,
      emittedNoteheads: Number(entry.emittedNoteheads) || 0,
      page: entry.page ?? null,
    })
  }
  return map
}

function findOppositeCounterpart(entry, oppositeList = [], options = {}) {
  const {
    measureWindow = 2,
    sameMidi = false,
    minOnsetDiff = 0,
    maxOnsetDiff = Infinity,
    sameMeasureOnly = false,
  } = options
  const onset = Number(entry.onsetQuarters) || 0
  const measureNumber = Number(entry.measureNumber) || 0
  const midi = entry.midi

  return oppositeList.find((candidate) => {
    const candidateMeasure = Number(candidate.measureNumber) || 0
    if (sameMeasureOnly && candidateMeasure !== measureNumber) {
      return false
    }
    if (Math.abs(candidateMeasure - measureNumber) > measureWindow) {
      return false
    }
    if (sameMidi && candidate.midi !== midi) {
      return false
    }
    const onsetDiff = Math.abs((Number(candidate.onsetQuarters) || 0) - onset)
    if (onsetDiff < minOnsetDiff || onsetDiff > maxOnsetDiff) {
      return false
    }
    return true
  }) ?? null
}

/**
 * Classify one missing or extra note row using opposite-list pairing heuristics.
 */
export function classifyMissingExtraRootCause(
  entry,
  oppositeList = [],
  { measureDiagnostics = null } = {},
) {
  const measureNumber = Number(entry.measureNumber) || 0
  const diagnostics = measureDiagnostics?.get(measureNumber)

  if (diagnostics?.dedupedDuringGrouping > 0) {
    if (diagnostics.detectedNoteheads > diagnostics.emittedNoteheads) {
      return NOTE_COUNT_ROOT_CAUSE.GROUPING_MISTAKE
    }
    return NOTE_COUNT_ROOT_CAUSE.DEDUPE_MISTAKE
  }

  const sameMidiShift = findOppositeCounterpart(entry, oppositeList, {
    measureWindow: 1,
    sameMidi: true,
    minOnsetDiff: 0.25,
  })
  if (sameMidiShift) {
    return NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE
  }

  const largeOnsetShift = findOppositeCounterpart(entry, oppositeList, {
    measureWindow: 2,
    minOnsetDiff: 1,
  })
  if (largeOnsetShift) {
    return NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE
  }

  const sameMeasureNear = findOppositeCounterpart(entry, oppositeList, {
    measureWindow: 0,
    sameMeasureOnly: true,
    maxOnsetDiff: 0.5,
  })
  if (sameMeasureNear && sameMeasureNear.midi !== entry.midi) {
    return NOTE_COUNT_ROOT_CAUSE.MATCHER_ARTIFACT
  }

  const adjacentShift = findOppositeCounterpart(entry, oppositeList, {
    measureWindow: 1,
    minOnsetDiff: 0.5,
  })
  if (adjacentShift) {
    return NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE
  }

  return NOTE_COUNT_ROOT_CAUSE.DETECTION_LOSS
}

function countByMeasure(entries = []) {
  const histogram = {}
  for (const entry of entries) {
    const key = String(entry.measureNumber ?? 'unknown')
    histogram[key] = (histogram[key] ?? 0) + 1
  }
  return Object.entries(histogram)
    .map(([measureNumber, count]) => ({ measureNumber: Number(measureNumber), count }))
    .sort((left, right) => right.count - left.count || left.measureNumber - right.measureNumber)
}

function countByPage(entries = [], measureDiagnostics) {
  const histogram = {}
  for (const entry of entries) {
    const page = measureDiagnostics?.get(entry.measureNumber)?.page ?? 'unknown'
    const key = String(page)
    histogram[key] = (histogram[key] ?? 0) + 1
  }
  return Object.entries(histogram)
    .map(([page, count]) => ({ page: page === 'unknown' ? null : Number(page), count }))
    .sort((left, right) => right.count - left.count)
}

export function summarizeMissingExtraRootCauses(report = {}) {
  const missing = report.debug?.missingNotes ?? []
  const extra = report.debug?.extraNotes ?? []
  const totals = report.totals ?? {}
  const measureDiagnostics = measureDedupeMap(report)

  const histogram = Object.fromEntries(
    NOTE_COUNT_ROOT_CAUSE_ORDER.map((bucket) => [bucket, 0]),
  )
  const missingByBucket = Object.fromEntries(
    NOTE_COUNT_ROOT_CAUSE_ORDER.map((bucket) => [bucket, 0]),
  )
  const extraByBucket = Object.fromEntries(
    NOTE_COUNT_ROOT_CAUSE_ORDER.map((bucket) => [bucket, 0]),
  )

  const classifiedMissing = []
  for (const entry of missing) {
    const bucket = classifyMissingExtraRootCause(entry, extra, { measureDiagnostics })
    histogram[bucket] += 1
    missingByBucket[bucket] += 1
    classifiedMissing.push({ entry, bucket })
  }

  const classifiedExtra = []
  for (const entry of extra) {
    const bucket = classifyMissingExtraRootCause(entry, missing, { measureDiagnostics })
    histogram[bucket] += 1
    extraByBucket[bucket] += 1
    classifiedExtra.push({ entry, bucket })
  }

  const ranked = NOTE_COUNT_ROOT_CAUSE_ORDER.map((bucket) => ({
    bucket,
    count: histogram[bucket],
    missing: missingByBucket[bucket],
    extra: extraByBucket[bucket],
  }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count)

  const groupingLoss =
    (measureDiagnostics ? [...measureDiagnostics.values()] : []).reduce(
      (sum, entry) => sum + (entry.dedupedDuringGrouping ?? 0),
      0,
    )

  return {
    missingCount: missing.length,
    extraCount: extra.length,
    noteCountDifference: Number(totals.noteCountDifference) || 0,
    balancedMismatch: missing.length === extra.length && (totals.noteCountDifference ?? 0) === 0,
    groupingLossDuringEmission: groupingLoss,
    histogram,
    missingByBucket,
    extraByBucket,
    ranked,
    primaryRootCause: ranked[0] ?? null,
    missingHotspots: countByMeasure(missing).slice(0, 12),
    extraHotspots: countByMeasure(extra).slice(0, 12),
    missingByPage: countByPage(missing, measureDiagnostics),
    extraByPage: countByPage(extra, measureDiagnostics),
    classifiedMissing,
    classifiedExtra,
  }
}
