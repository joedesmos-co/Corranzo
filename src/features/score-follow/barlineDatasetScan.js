/**
 * Scan every barline-relevant column in a staff system for dataset export.
 * Tooling only — mirrors detectBarlinesInSystem heuristics without changing runtime.
 */
import {
  BARLINE_REJECT_REASON,
  splitGrandStaffVerticalBands,
} from './detectBarlinesInSystem.js'
import { DETECTOR_DECISION } from './barlineDataset.js'

function pixelLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

function isDark(data, index, threshold = 185) {
  return pixelLuminance(data, index) < threshold
}

function columnBandStats(imageData, x, band, darkThreshold) {
  const { width, data } = imageData
  const y0 = band.y0
  const y1 = band.y1
  const bandHeight = Math.max(1, y1 - y0 + 1)
  let run = 0
  let bestRun = 0
  let dark = 0
  let transitions = 0
  let prevDark = null
  for (let y = y0; y <= y1; y += 1) {
    const index = (y * width + x) * 4
    const isDarkPx = isDark(data, index, darkThreshold)
    if (prevDark !== null && isDarkPx !== prevDark) {
      transitions += 1
    }
    prevDark = isDarkPx
    if (isDarkPx) {
      run += 1
      dark += 1
      if (run > bestRun) bestRun = run
    } else {
      run = 0
    }
  }
  return {
    maxRunFrac: bestRun / bandHeight,
    inkFrac: dark / bandHeight,
    transitions,
  }
}

function countStemLikeSignals({
  trebleStats,
  bassStats,
  fullStats,
  trebleStrong,
  bassStrong,
  gapStrong,
  fullStrong,
  trebleRunMin,
  bassRunMin,
  stemLikeMax,
}) {
  let signals = 0

  if (fullStats.transitions > 10 && !fullStrong) {
    signals += 1
  } else if (fullStats.transitions > 8 && !fullStrong && !gapStrong) {
    signals += 1
  }

  if (
    (trebleStrong && bassStats.maxRunFrac < stemLikeMax) ||
    (bassStrong && trebleStats.maxRunFrac < stemLikeMax)
  ) {
    signals += 1
  }

  if (
    !fullStrong &&
    trebleStats.maxRunFrac < trebleRunMin * 0.85 &&
    bassStats.maxRunFrac < bassRunMin * 0.85
  ) {
    signals += 1
  }

  if (!fullStrong && !gapStrong && !(trebleStrong && bassStrong)) {
    signals += 1
  }

  if (
    !fullStrong &&
    !(trebleStrong && bassStrong) &&
    Math.abs(trebleStats.maxRunFrac - bassStats.maxRunFrac) > 0.28
  ) {
    signals += 1
  }

  if (gapStrong && trebleStrong && bassStrong) {
    signals = Math.max(0, signals - 1)
  }

  return signals
}

function candidateScore({ trebleStats, bassStats, gapStats, fullStats, gapStrong, trebleStrong, bassStrong }) {
  return (
    trebleStats.maxRunFrac +
    bassStats.maxRunFrac +
    gapStats.maxRunFrac +
    fullStats.maxRunFrac * 0.5 -
    fullStats.transitions * 0.015 +
    (gapStrong ? 0.22 : 0) +
    (trebleStrong && bassStrong ? 0.12 : 0)
  )
}

function classifyColumnOutcome({
  stemSignals,
  hasBarlineShape,
  trebleStrong,
  bassStrong,
  fullStrong,
  gapStrong,
  trebleStats,
  bassStats,
  trebleRunMin,
  bassRunMin,
  stemLikeMax,
  marginSkip,
}) {
  if (marginSkip) {
    return {
      decision: DETECTOR_DECISION.IGNORED_MARGIN,
      confidence: null,
      rejectReason: BARLINE_REJECT_REASON.MARGIN,
    }
  }

  if (hasBarlineShape && stemSignals === 0) {
    return {
      decision: DETECTOR_DECISION.ACCEPTED_HIGH,
      confidence: 'high',
      rejectReason: null,
    }
  }

  if (stemSignals >= 2 || (!hasBarlineShape && stemSignals >= 1)) {
    let rejectReason = BARLINE_REJECT_REASON.STEM_LIKE
    if (
      (trebleStrong && bassStats.maxRunFrac < stemLikeMax) ||
      (bassStrong && trebleStats.maxRunFrac < stemLikeMax)
    ) {
      rejectReason = BARLINE_REJECT_REASON.SINGLE_STAFF
    } else if (
      !fullStrong &&
      trebleStats.maxRunFrac < trebleRunMin * 0.85 &&
      bassStats.maxRunFrac < bassRunMin * 0.85
    ) {
      rejectReason = BARLINE_REJECT_REASON.WEAK_RUN
    } else if (!fullStrong && !gapStrong && !(trebleStrong && bassStrong)) {
      rejectReason = BARLINE_REJECT_REASON.WEAK_GAP
    }
    return {
      decision: DETECTOR_DECISION.REJECTED,
      confidence: null,
      rejectReason,
    }
  }

  if (hasBarlineShape && stemSignals === 1) {
    return {
      decision: DETECTOR_DECISION.ACCEPTED_LOW,
      confidence: 'low',
      rejectReason: null,
    }
  }

  return {
    decision: DETECTOR_DECISION.REJECTED,
    confidence: null,
    rejectReason: BARLINE_REJECT_REASON.STEM_LIKE,
  }
}

function columnHasInk(trebleStats, bassStats, gapStats, fullStats, minInk = 0.06) {
  return (
    trebleStats.inkFrac >= minInk ||
    bassStats.inkFrac >= minInk ||
    gapStats.inkFrac >= minInk ||
    fullStats.inkFrac >= minInk
  )
}

/**
 * Scan all ink-bearing columns in a system band and return per-column features + detector outcome.
 * @returns {{ columns: Array, bands: object, mergeGapPx: number }}
 */
export function scanBarlineColumnCandidates(imageData, contentBounds, system, options = {}) {
  const {
    darkThreshold = 150,
    trebleRunMin = 0.52,
    bassRunMin = 0.52,
    gapRunMin = 0.28,
    fullBandRunMin = 0.78,
    stemLikeMax = 0.38,
    minInkFrac = 0.06,
    includeMargin = false,
  } = options

  const { width, height } = imageData
  const { treble, gap, bass, left, right } = splitGrandStaffVerticalBands(
    imageData,
    contentBounds,
    system,
  )
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const fullBand = { y0, y1 }

  const x0Bound = contentBounds.x0 ?? 0
  const x1Bound = contentBounds.x1 ?? 1
  const margin = x0Bound + 0.025
  const maxX = x1Bound - 0.025
  const columns = []

  for (let x = left; x <= right; x += 1) {
    const xNorm = x / width
    const trebleStats = columnBandStats(imageData, x, treble, darkThreshold)
    const bassStats = columnBandStats(imageData, x, bass, darkThreshold)
    const gapStats = columnBandStats(imageData, x, gap, darkThreshold)
    const fullStats = columnBandStats(imageData, x, fullBand, darkThreshold)

    if (!columnHasInk(trebleStats, bassStats, gapStats, fullStats, minInkFrac)) {
      continue
    }

    const trebleStrong = trebleStats.maxRunFrac >= trebleRunMin
    const bassStrong = bassStats.maxRunFrac >= bassRunMin
    const gapStrong = gapStats.maxRunFrac >= gapRunMin
    const fullStrong = fullStats.maxRunFrac >= fullBandRunMin
    const edgeBarline = fullStrong && trebleStrong && bassStrong
    const marginSkip = (xNorm < margin || xNorm > maxX) && !edgeBarline

    if (marginSkip && !includeMargin) {
      continue
    }

    const stemSignals = countStemLikeSignals({
      trebleStats,
      bassStats,
      fullStats,
      trebleStrong,
      bassStrong,
      gapStrong,
      fullStrong,
      trebleRunMin,
      bassRunMin,
      stemLikeMax,
    })
    const hasBarlineShape = fullStrong || (trebleStrong && bassStrong)
    const outcome = classifyColumnOutcome({
      stemSignals,
      hasBarlineShape,
      trebleStrong,
      bassStrong,
      fullStrong,
      gapStrong,
      trebleStats,
      bassStats,
      trebleRunMin,
      bassRunMin,
      stemLikeMax,
      marginSkip,
    })

    columns.push({
      xPx: x,
      x: xNorm,
      features: {
        treble: trebleStats,
        bass: bassStats,
        gap: gapStats,
        full: fullStats,
        stemSignals,
        trebleStrong,
        bassStrong,
        gapStrong,
        fullStrong,
        hasBarlineShape,
        score: candidateScore({
          trebleStats,
          bassStats,
          gapStats,
          fullStats,
          gapStrong,
          trebleStrong,
          bassStrong,
        }),
      },
      detector: outcome,
    })
  }

  const mergeGapPx = Math.max(2, Math.floor(width * 0.012))

  return {
    columns,
    mergeGapPx,
    bands: {
      y0: system.y0,
      y1: system.y1,
      trebleY0: treble.y0 / height,
      trebleY1: treble.y1 / height,
      bassY0: bass.y0 / height,
      bassY1: bass.y1 / height,
    },
  }
}

/** Mark which scanned columns match final accepted barline positions. */
export function annotateFinalAcceptedColumns(columns, finalPositions, imageWidth, mergeGapPx) {
  for (const column of columns) {
    const nearFinal = finalPositions.some(
      (x) => Math.abs(column.x - x) * imageWidth <= mergeGapPx + 1,
    )
    const wasAccepted =
      column.detector.decision === DETECTOR_DECISION.ACCEPTED_HIGH ||
      column.detector.decision === DETECTOR_DECISION.ACCEPTED_LOW

    column.detector.finalAccepted = nearFinal
    if (wasAccepted && !nearFinal) {
      column.detector.decision = DETECTOR_DECISION.THINNED
    }
  }
  return columns
}
