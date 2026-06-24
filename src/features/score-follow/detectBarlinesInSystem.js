import { computeRowDensityInContent } from './detectStaffSystems.js'

/** Rejection reasons surfaced in diagnostics / reliability scoring. */
export const BARLINE_REJECT_REASON = {
  STEM_LIKE: 'stem-like',
  SINGLE_STAFF: 'single-staff',
  WEAK_GAP: 'weak-gap-span',
  WEAK_RUN: 'weak-run',
  TOO_DENSE: 'too-dense',
  INCONSISTENT: 'inconsistent-spacing',
  MARGIN: 'margin',
}

/** Minimum normalized gap between barlines for a sparse/simple layout (no thinning). */
const SPARSE_LAYOUT_MAX_CANDIDATES = 8
/** Below this implied measure width (fraction of content), spacing is ambiguous. */
const AMBIGUOUS_MEASURE_WIDTH_FRAC = 0.048

function pixelLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

function isDark(data, index, threshold = 185) {
  return pixelLuminance(data, index) < threshold
}

function contentColumns(imageData, contentBounds) {
  const { width } = imageData
  const left = Math.max(0, Math.floor((contentBounds.left ?? contentBounds.x0 * width)))
  const right = Math.min(width - 1, Math.ceil((contentBounds.right ?? contentBounds.x1 * width)))
  return { left, right }
}

/**
 * Split a grand-staff system band into treble, inter-staff gap, and bass rows.
 * Uses the lowest horizontal-ink row in the middle third (the treble↔bass gap).
 */
export function splitGrandStaffVerticalBands(imageData, contentBounds, system) {
  const { width, height } = imageData
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const bandHeight = Math.max(1, y1 - y0 + 1)
  const { left, right } = contentColumns(imageData, contentBounds)

  const rowDensity = computeRowDensityInContent(imageData, contentBounds)
  const searchStart = y0 + Math.floor(bandHeight * 0.32)
  const searchEnd = y0 + Math.floor(bandHeight * 0.68)
  let splitY = Math.floor((y0 + y1) / 2)
  let minDensity = Infinity
  for (let y = searchStart; y <= searchEnd; y += 1) {
    const d = rowDensity[y] ?? 0
    if (d < minDensity) {
      minDensity = d
      splitY = y
    }
  }

  const gapHalf = Math.max(2, Math.floor(bandHeight * 0.06))
  const treble = { y0, y1: Math.max(y0, splitY - gapHalf) }
  const gap = {
    y0: Math.max(y0, splitY - gapHalf),
    y1: Math.min(y1, splitY + gapHalf),
  }
  const bass = { y0: Math.min(y1, splitY + gapHalf), y1 }

  return { treble, gap, bass, splitY, left, right }
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

function emptyBarlineDiagnostics() {
  return {
    candidatesRaw: 0,
    accepted: 0,
    retainedLowConfidence: 0,
    thinningRemoved: 0,
    densityAmbiguous: false,
    rejected: {
      [BARLINE_REJECT_REASON.STEM_LIKE]: 0,
      [BARLINE_REJECT_REASON.SINGLE_STAFF]: 0,
      [BARLINE_REJECT_REASON.WEAK_GAP]: 0,
      [BARLINE_REJECT_REASON.WEAK_RUN]: 0,
      [BARLINE_REJECT_REASON.MARGIN]: 0,
      [BARLINE_REJECT_REASON.TOO_DENSE]: 0,
      [BARLINE_REJECT_REASON.INCONSISTENT]: 0,
    },
  }
}

/**
 * Count independent stem-like signals for a column. Reject only when multiple
 * agree — a single weak signal keeps the candidate (downgraded later).
 */
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

  // Full grand-staff continuity through the inter-staff gap is a strong barline signal.
  if (gapStrong && trebleStrong && bassStrong) {
    signals = Math.max(0, signals - 1)
  }

  return signals
}

function gapSpacingStats(positions, contentBounds) {
  if (positions.length < 2) {
    return { medGap: 0, measureWidthFrac: null, coefficientOfVariation: null, tightGrid: false }
  }
  const contentWidth = Math.max(1e-6, (contentBounds.x1 ?? 1) - (contentBounds.x0 ?? 0))
  const gaps = []
  for (let i = 1; i < positions.length; i += 1) {
    gaps.push(positions[i] - positions[i - 1])
  }
  const medGap = median(gaps)
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const variance =
    gaps.reduce((sum, g) => sum + (g - meanGap) ** 2, 0) / Math.max(1, gaps.length)
  const coefficientOfVariation = meanGap > 0 ? Math.sqrt(variance) / meanGap : null
  const measureWidthFrac = medGap / contentWidth
  const tightGrid =
    positions.length > SPARSE_LAYOUT_MAX_CANDIDATES &&
    measureWidthFrac < AMBIGUOUS_MEASURE_WIDTH_FRAC
  return { medGap, measureWidthFrac, coefficientOfVariation, tightGrid }
}

/** Post-thin density ambiguity: require multiple independent stem-grid signals. */
function assessDensityAmbiguity(positions, contentBounds, context = {}) {
  const { thinningAmbiguous = false, rejected = {}, preThinCount = 0 } = context
  if (thinningAmbiguous) {
    return true
  }

  const spacing = gapSpacingStats(positions, contentBounds)
  if (positions.length <= SPARSE_LAYOUT_MAX_CANDIDATES && !spacing.tightGrid) {
    return false
  }

  if (!spacing.tightGrid) {
    return false
  }

  const rejectedDense = rejected[BARLINE_REJECT_REASON.TOO_DENSE] ?? 0
  const rejectedInconsistent = rejected[BARLINE_REJECT_REASON.INCONSISTENT] ?? 0
  if (rejectedInconsistent > 0) {
    return true
  }

  const cv = spacing.coefficientOfVariation
  // Regular tight spacing is the stem-grid signature; irregular tight spacing may be real music.
  if (cv != null && cv < 0.14) {
    return true
  }

  if (rejectedDense >= 3 && spacing.measureWidthFrac < AMBIGUOUS_MEASURE_WIDTH_FRAC) {
    return true
  }

  if (preThinCount > SPARSE_LAYOUT_MAX_CANDIDATES + 2 && positions.length > SPARSE_LAYOUT_MAX_CANDIDATES) {
    return true
  }

  return false
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

/**
 * Classify vertical column runs as barlines vs stems/note clusters inside a
 * grand-staff system. Requires continuity in BOTH treble and bass staves and
 * reasonable span across the inter-staff gap (real barlines; stems are short).
 */
export function detectBarlineCandidates(imageData, contentBounds, system, options = {}) {
  const {
    darkThreshold = 150,
    trebleRunMin = 0.52,
    bassRunMin = 0.52,
    gapRunMin = 0.28,
    fullBandRunMin = 0.78,
    stemLikeMax = 0.38,
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

  const diagnostics = emptyBarlineDiagnostics()
  const x0Bound = contentBounds.x0 ?? 0
  const x1Bound = contentBounds.x1 ?? 1
  const margin = x0Bound + 0.025
  const maxX = x1Bound - 0.025
  const rawCandidates = []

  for (let x = left; x <= right; x += 1) {
    diagnostics.candidatesRaw += 1
    const xNorm = x / width

    const trebleStats = columnBandStats(imageData, x, treble, darkThreshold)
    const bassStats = columnBandStats(imageData, x, bass, darkThreshold)
    const gapStats = columnBandStats(imageData, x, gap, darkThreshold)
    const fullStats = columnBandStats(imageData, x, fullBand, darkThreshold)

    const trebleStrong = trebleStats.maxRunFrac >= trebleRunMin
    const bassStrong = bassStats.maxRunFrac >= bassRunMin
    const gapStrong = gapStats.maxRunFrac >= gapRunMin
    const fullStrong = fullStats.maxRunFrac >= fullBandRunMin
    const edgeBarline = fullStrong && trebleStrong && bassStrong

    if ((xNorm < margin || xNorm > maxX) && !edgeBarline) {
      diagnostics.rejected[BARLINE_REJECT_REASON.MARGIN] += 1
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

    // Clear barline with no stem signals — accept at full confidence.
    if (hasBarlineShape && stemSignals === 0) {
      rawCandidates.push({
        x: xNorm,
        confidence: 'high',
        score: candidateScore({
          trebleStats,
          bassStats,
          gapStats,
          fullStats,
          gapStrong,
          trebleStrong,
          bassStrong,
        }),
      })
      continue
    }

    // Multiple stem signals — hard reject (note column / stem grid).
    if (stemSignals >= 2 || (!hasBarlineShape && stemSignals >= 1)) {
      if (
        (trebleStrong && bassStats.maxRunFrac < stemLikeMax) ||
        (bassStrong && trebleStats.maxRunFrac < stemLikeMax)
      ) {
        diagnostics.rejected[BARLINE_REJECT_REASON.SINGLE_STAFF] += 1
      } else if (
        !fullStrong &&
        trebleStats.maxRunFrac < trebleRunMin * 0.85 &&
        bassStats.maxRunFrac < bassRunMin * 0.85
      ) {
        diagnostics.rejected[BARLINE_REJECT_REASON.WEAK_RUN] += 1
      } else if (!fullStrong && !gapStrong && !(trebleStrong && bassStrong)) {
        diagnostics.rejected[BARLINE_REJECT_REASON.WEAK_GAP] += 1
      } else {
        diagnostics.rejected[BARLINE_REJECT_REASON.STEM_LIKE] += 1
      }
      continue
    }

    // Single borderline signal but barline-shaped — retain, downgrade confidence.
    if (hasBarlineShape && stemSignals === 1) {
      rawCandidates.push({
        x: xNorm,
        confidence: 'low',
        score:
          candidateScore({
            trebleStats,
            bassStats,
            gapStats,
            fullStats,
            gapStrong,
            trebleStrong,
            bassStrong,
          }) - 0.15,
      })
      diagnostics.retainedLowConfidence += 1
      continue
    }

    diagnostics.rejected[BARLINE_REJECT_REASON.STEM_LIKE] += 1
  }

  const mergeGapPx = Math.max(2, Math.floor(width * 0.012))
  rawCandidates.sort((a, b) => a.x - b.x)
  const merged = []
  for (const candidate of rawCandidates) {
    const last = merged[merged.length - 1]
    if (last && (candidate.x - last.x) * width <= mergeGapPx) {
      if (candidate.score > last.score) {
        last.x = candidate.x
        last.score = candidate.score
        last.confidence =
          last.confidence === 'low' || candidate.confidence === 'low' ? 'low' : 'high'
      }
    } else {
      merged.push({ ...candidate })
    }
  }

  let positions = merged.map((m) => m.x)
  diagnostics.accepted = positions.length
  diagnostics.retainedLowConfidence = merged.filter((c) => c.confidence === 'low').length

  const preThinCount = positions.length
  const preSpacing = gapSpacingStats(positions, contentBounds)
  let thinningAmbiguous = false

  // Sparse/simple layouts: never thin — real barlines are preserved as-is.
  if (preThinCount > SPARSE_LAYOUT_MAX_CANDIDATES && preSpacing.tightGrid) {
    const thinned = thinBarlineGrid(merged, contentBounds, { conservative: true })
    const removed = preThinCount - thinned.positions.length
    if (removed > 0) {
      diagnostics.rejected[BARLINE_REJECT_REASON.TOO_DENSE] += removed
      diagnostics.thinningRemoved = removed
    }
    thinningAmbiguous = thinned.ambiguous
    positions = thinned.positions
    diagnostics.accepted = positions.length
    diagnostics.retainedLowConfidence = thinned.retainedLowConfidence
  }

  diagnostics.densityAmbiguous = assessDensityAmbiguity(positions, contentBounds, {
    thinningAmbiguous,
    rejected: diagnostics.rejected,
    preThinCount,
  })

  return { positions, diagnostics }
}

/**
 * When a stem grid produced too many candidates, prefer spacing-based thinning
 * only on clearly dense grids. Returns positions plus ambiguity flags.
 */
function thinBarlineGrid(candidates, contentBounds, { conservative = false } = {}) {
  if (candidates.length <= SPARSE_LAYOUT_MAX_CANDIDATES) {
    return {
      positions: candidates.map((c) => c.x).sort((a, b) => a - b),
      retainedLowConfidence: candidates.filter((c) => c.confidence === 'low').length,
      ambiguous: false,
    }
  }
  const sorted = [...candidates].sort((a, b) => a.x - b.x)
  const sortedX = sorted.map((c) => c.x)
  const contentWidth = Math.max(1e-6, (contentBounds.x1 ?? 1) - (contentBounds.x0 ?? 0))
  const gaps = []
  for (let i = 1; i < sortedX.length; i += 1) {
    gaps.push(sortedX[i] - sortedX[i - 1])
  }
  const gapsDesc = [...gaps].sort((a, b) => b - a)
  const medGap = median(gaps)
  const wideGaps = gaps.filter((g) => g >= medGap * 1.75)
  const wideSample =
    wideGaps.length >= 2
      ? wideGaps
      : gapsDesc.slice(0, Math.max(1, Math.ceil(gapsDesc.length * 0.12)))
  let estMeasureFrac = Math.max(0.045, median(wideSample) / contentWidth)
  let minGap = estMeasureFrac * contentWidth * (conservative ? 0.82 : 0.72)

  if (candidates.length <= 10) {
    minGap = Math.max(contentWidth * 0.028, medGap * 0.82)
  } else if (candidates.length > 12) {
    minGap = Math.max(minGap, contentWidth * (conservative ? 0.095 : 0.085))
  }

  const pickWithMinGap = (gapPx) => {
    const byScore = [...candidates].sort((a, b) => b.score - a.score)
    const picked = []
    const pickedMeta = []
    for (const candidate of byScore) {
      if (picked.every((k) => Math.abs(candidate.x - k) >= gapPx)) {
        picked.push(candidate.x)
        pickedMeta.push(candidate)
      }
    }
    picked.sort((a, b) => a - b)
    return { picked, pickedMeta }
  }

  let { picked: kept, pickedMeta } = pickWithMinGap(minGap)
  const maxKept = conservative ? 12 : 14
  while (kept.length > maxKept && minGap < contentWidth * 0.22) {
    minGap *= 1.12
    ;({ picked: kept, pickedMeta } = pickWithMinGap(minGap))
  }
  if (kept.length === 0) {
    return {
      positions: sortedX,
      retainedLowConfidence: sorted.filter((c) => c.confidence === 'low').length,
      ambiguous: true,
    }
  }
  const last = sortedX[sortedX.length - 1]
  if (last - kept[kept.length - 1] >= minGap * 0.55) {
    kept.push(last)
    const lastMeta = sorted[sorted.length - 1]
    pickedMeta.push(lastMeta)
  } else if (Math.abs(last - kept[kept.length - 1]) > minGap * 0.2) {
    kept[kept.length - 1] = last
    pickedMeta[pickedMeta.length - 1] = sorted[sorted.length - 1]
  }

  const ambiguous =
    kept.length >= 8 &&
    median(
      kept.slice(1).map((x, i) => x - kept[i]),
    ) /
      contentWidth <
      AMBIGUOUS_MEASURE_WIDTH_FRAC

  return {
    positions: kept,
    retainedLowConfidence: pickedMeta.filter((c) => c.confidence === 'low').length,
    ambiguous,
  }
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Vertical barline x positions inside a staff system band (normalized page x).
 */
export function detectBarlinePositionsInSystem(imageData, contentBounds, system, options = {}) {
  return detectBarlineCandidates(imageData, contentBounds, system, options).positions
}

/**
 * Pick barline-based x for measure index within a system span, or fall back to even spacing.
 */
export function estimateMeasureXInSystem({
  measureIndex,
  measuresInSpan,
  barlines,
  contentBounds,
  fallbackStartX,
  fallbackEndX,
}) {
  if (measuresInSpan <= 1) {
    return fallbackStartX
  }

  const usableBarlines =
    barlines.length >= measuresInSpan - 1 &&
    barlines.length <= (measuresInSpan - 1) * 2
      ? barlines
      : []

  if (usableBarlines.length >= measuresInSpan - 1) {
    if (measureIndex === 0) {
      return fallbackStartX
    }
    if (measureIndex >= measuresInSpan - 1) {
      return fallbackEndX
    }
    return usableBarlines[measureIndex - 1] ?? fallbackStartX
  }

  const t = measureIndex / Math.max(1, measuresInSpan - 1)
  return fallbackStartX + (fallbackEndX - fallbackStartX) * t
}
