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
  INTERIOR_NARROW: 'interior-narrow',
  NOTE_COLUMN: 'note-column',
  INSUFFICIENT_GRAND_STAFF: 'insufficient-grand-staff',
}

/** Interior measure slivers below this content fraction are likely stem columns. */
const NARROW_MEASURE_FRAC = 0.08
/** Adjacent span below this is not a full measure when paired with a narrow sliver. */
const PARTIAL_MEASURE_FRAC = 0.2

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

/** Best full-height run across neighboring columns — reconnects barlines thinned by beams. */
function columnBandStatsSmoothed(imageData, x, band, darkThreshold, radius = 1) {
  let best = null
  for (let dx = -radius; dx <= radius; dx += 1) {
    const stats = columnBandStats(imageData, x + dx, band, darkThreshold)
    if (!best || stats.maxRunFrac > best.maxRunFrac) {
      best = stats
    }
  }
  return best
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
      [BARLINE_REJECT_REASON.INTERIOR_NARROW]: 0,
      [BARLINE_REJECT_REASON.NOTE_COLUMN]: 0,
      [BARLINE_REJECT_REASON.INSUFFICIENT_GRAND_STAFF]: 0,
    },
    acceptedBeforeRefine: 0,
    refinementRemoved: 0,
  }
}

/**
 * Measure span widths (fraction of content width) implied by barline positions.
 */
export function measureSpansFromBarlines(positions, contentBounds) {
  const x0 = contentBounds.x0 ?? 0
  const x1 = contentBounds.x1 ?? 1
  const contentWidth = Math.max(1e-6, x1 - x0)
  const clipped = positions
    .filter((pos) => pos > x0 + 0.01 && pos < x1 - 0.01)
    .sort((left, right) => left - right)
  const boundaries = [x0, ...clipped, x1]
  const spans = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    spans.push((boundaries[index + 1] - boundaries[index]) / contentWidth)
  }
  return { spans, boundaries, clipped, contentWidth }
}

export function hasInteriorNarrowMeasureSpan(
  positions,
  contentBounds,
  narrowFrac = NARROW_MEASURE_FRAC,
) {
  const { spans } = measureSpansFromBarlines(positions, contentBounds)
  if (spans.length < 3) {
    return false
  }
  return spans.slice(1, -1).some((span) => span < narrowFrac)
}

/**
 * Drop interior barlines that split one measure into a narrow sliver plus a partial.
 */
export function pruneInteriorNarrowBarlines(positions, contentBounds, diagnostics = null) {
  let removed = 0
  let current = [...positions].sort((left, right) => left - right)
  let changed = true
  while (changed) {
    changed = false
    const { spans, clipped } = measureSpansFromBarlines(current, contentBounds)
    if (!clipped.length) {
      break
    }
    for (let index = 0; index < clipped.length; index += 1) {
      const leftSpan = spans[index]
      const rightSpan = spans[index + 1]
      const narrowPair =
        leftSpan < NARROW_MEASURE_FRAC && rightSpan < NARROW_MEASURE_FRAC
      const narrowLeftPartial =
        index < clipped.length - 1 &&
        rightSpan < NARROW_MEASURE_FRAC &&
        leftSpan < PARTIAL_MEASURE_FRAC
      const narrowRightPartial =
        index > 0 &&
        leftSpan < NARROW_MEASURE_FRAC &&
        rightSpan < PARTIAL_MEASURE_FRAC
      if (narrowPair || narrowLeftPartial || narrowRightPartial) {
        const x = clipped[index]
        current = current.filter((pos) => Math.abs(pos - x) > 1e-6)
        removed += 1
        changed = true
        break
      }
    }
  }
  if (diagnostics && removed > 0) {
    diagnostics.rejected[BARLINE_REJECT_REASON.INTERIOR_NARROW] += removed
  }
  return { positions: current, removed }
}

function noteColumnLikelihood(imageData, xNorm, bands, fullBand, darkThreshold) {
  const x = Math.round(xNorm * imageData.width)
  const trebleStats = columnBandStats(imageData, x, bands.treble, darkThreshold)
  const bassStats = columnBandStats(imageData, x, bands.bass, darkThreshold)
  const gapStats = columnBandStats(imageData, x, bands.gap, darkThreshold)
  const fullStats = columnBandStatsSmoothed(imageData, x, fullBand, darkThreshold)
  let signals = 0
  if (fullStats.transitions >= 12) {
    signals += 1
  }
  if (gapStats.maxRunFrac < 0.4) {
    signals += 1
  }
  if (Math.min(trebleStats.maxRunFrac, bassStats.maxRunFrac) < 0.55) {
    signals += 1
  }
  if (
    trebleStats.inkFrac > 0.18 &&
    bassStats.inkFrac > 0.18 &&
    fullStats.maxRunFrac < 0.86
  ) {
    signals += 1
  }
  if (Math.abs(trebleStats.maxRunFrac - bassStats.maxRunFrac) > 0.3) {
    signals += 1
  }
  return signals
}

function filterNoteColumnBarlineCandidates(
  candidates,
  imageData,
  contentBounds,
  system,
  darkThreshold,
  diagnostics,
) {
  const { height } = imageData
  const bands = splitGrandStaffVerticalBands(imageData, contentBounds, system)
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const fullBand = { y0, y1 }
  let removed = 0
  const kept = candidates.filter((candidate) => {
    const likelihood = noteColumnLikelihood(
      imageData,
      candidate.x,
      bands,
      fullBand,
      darkThreshold,
    )
    if (likelihood >= 4) {
      removed += 1
      return false
    }
    if (likelihood >= 3 && candidate.confidence === 'low') {
      removed += 1
      return false
    }
    return true
  })
  if (removed > 0) {
    diagnostics.rejected[BARLINE_REJECT_REASON.NOTE_COLUMN] += removed
  }
  return kept
}

function filterInsufficientGrandStaffSpan(
  candidates,
  imageData,
  contentBounds,
  system,
  darkThreshold,
  { trebleRunMin, bassRunMin },
  diagnostics,
) {
  const { height, width } = imageData
  const bands = splitGrandStaffVerticalBands(imageData, contentBounds, system)
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const fullBand = { y0, y1 }
  const x0Bound = contentBounds.x0 ?? 0
  const x1Bound = contentBounds.x1 ?? 1
  const margin = x0Bound + 0.025
  const maxX = x1Bound - 0.025
  let removed = 0
  const kept = candidates.filter((candidate) => {
    const x = Math.round(candidate.x * width)
    const xNorm = candidate.x
    const edgeBarline = xNorm <= margin + 0.01 || xNorm >= maxX - 0.01
    if (edgeBarline) {
      return true
    }
    const trebleStats = columnBandStats(imageData, x, bands.treble, darkThreshold)
    const bassStats = columnBandStats(imageData, x, bands.bass, darkThreshold)
    const gapStats = columnBandStats(imageData, x, bands.gap, darkThreshold)
    const fullStats = columnBandStatsSmoothed(imageData, x, fullBand, darkThreshold)
    const grandStaffSpan =
      trebleStats.maxRunFrac >= trebleRunMin &&
      bassStats.maxRunFrac >= bassRunMin &&
      gapStats.maxRunFrac >= 0.28
    if (grandStaffSpan || fullStats.maxRunFrac >= 0.78) {
      return true
    }
    removed += 1
    return false
  })
  if (removed > 0) {
    diagnostics.rejected[BARLINE_REJECT_REASON.INSUFFICIENT_GRAND_STAFF] += removed
  }
  return kept
}

function candidatesForPositions(candidates, positions) {
  return positions.map((x) => {
    const exact = candidates.find((candidate) => Math.abs(candidate.x - x) < 1e-6)
    if (exact) {
      return exact
    }
    return candidates.reduce((best, candidate) => {
      if (!best) {
        return candidate
      }
      return Math.abs(candidate.x - x) < Math.abs(best.x - x) ? candidate : best
    }, null)
  })
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

function recoveredCandidatesFromPositions(positions, sourceMerged) {
  const known = new Set(sourceMerged.map((entry) => entry.x))
  const extras = positions
    .filter((x) => !known.has(x))
    .map((x) => ({ x, confidence: 'low', score: 0.35 }))
  return [...sourceMerged, ...extras]
}

function shouldPruneInteriorNarrowBarlines(positions, contentBounds) {
  if (positions.length < 7) {
    return false
  }
  if (!hasInteriorNarrowMeasureSpan(positions, contentBounds)) {
    return false
  }
  const spacing = gapSpacingStats(positions, contentBounds)
  const uniformStemGrid =
    spacing.tightGrid &&
    spacing.coefficientOfVariation != null &&
    spacing.coefficientOfVariation < 0.14
  return !uniformStemGrid
}

/**
 * Post-merge barline filters, interior-narrow pruning, and optional density thinning.
 */
function refineBarlineCandidateSet({
  merged,
  imageData,
  contentBounds,
  system,
  darkThreshold,
  trebleRunMin,
  bassRunMin,
  diagnostics,
  afterRecovery = false,
}) {
  let currentMerged = merged
  if (!afterRecovery) {
    currentMerged = filterNoteColumnBarlineCandidates(
      currentMerged,
      imageData,
      contentBounds,
      system,
      darkThreshold,
      diagnostics,
    )
    const preGrandStaffPositions = currentMerged
      .map((entry) => entry.x)
      .sort((left, right) => left - right)
    const preGrandStaffSpacing = gapSpacingStats(preGrandStaffPositions, contentBounds)
    const denseStemGrid =
      currentMerged.length > SPARSE_LAYOUT_MAX_CANDIDATES && preGrandStaffSpacing.tightGrid
    if (!denseStemGrid) {
      const beforeGrandStaff = currentMerged
      const insuffBefore = diagnostics.rejected[BARLINE_REJECT_REASON.INSUFFICIENT_GRAND_STAFF]
      const filteredGrandStaff = filterInsufficientGrandStaffSpan(
        currentMerged,
        imageData,
        contentBounds,
        system,
        darkThreshold,
        { trebleRunMin, bassRunMin },
        diagnostics,
      )
      const minKept = Math.max(4, Math.ceil(beforeGrandStaff.length * 0.45))
      if (filteredGrandStaff.length >= minKept) {
        currentMerged = filteredGrandStaff
      } else {
        diagnostics.rejected[BARLINE_REJECT_REASON.INSUFFICIENT_GRAND_STAFF] = insuffBefore
      }
    }
  }

  let positions = currentMerged.map((entry) => entry.x).sort((left, right) => left - right)
  const preSpacing = gapSpacingStats(positions, contentBounds)
  const denseStemGrid =
    positions.length > SPARSE_LAYOUT_MAX_CANDIDATES && preSpacing.tightGrid
  if (!denseStemGrid && shouldPruneInteriorNarrowBarlines(positions, contentBounds)) {
    positions = pruneInteriorNarrowBarlines(positions, contentBounds, diagnostics).positions
    currentMerged = candidatesForPositions(merged, positions)
  }

  const preThinCount = positions.length
  const narrowInterior = hasInteriorNarrowMeasureSpan(positions, contentBounds)
  let thinningAmbiguous = false
  let thinningRemoved = 0

  const shouldThinDenseGrid =
    preThinCount > SPARSE_LAYOUT_MAX_CANDIDATES && preSpacing.tightGrid
  const shouldThinNarrowInterior = preThinCount >= 7 && narrowInterior
  if (shouldThinDenseGrid || shouldThinNarrowInterior) {
    const thinned = thinBarlineGrid(currentMerged, contentBounds, { conservative: true })
    const removed = preThinCount - thinned.positions.length
    if (removed > 0) {
      diagnostics.rejected[BARLINE_REJECT_REASON.TOO_DENSE] += removed
      thinningRemoved = removed
    }
    thinningAmbiguous = thinned.ambiguous
    positions = thinned.positions
    currentMerged = candidatesForPositions(merged, positions)
  }

  if (!denseStemGrid && shouldPruneInteriorNarrowBarlines(positions, contentBounds)) {
    positions = pruneInteriorNarrowBarlines(positions, contentBounds, diagnostics).positions
    currentMerged = candidatesForPositions(merged, positions)
  }

  return {
    merged: currentMerged,
    positions,
    thinningRemoved,
    thinningAmbiguous,
    preThinCount,
  }
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
    const fullStats = columnBandStatsSmoothed(imageData, x, fullBand, darkThreshold)

    const trebleStrong = trebleStats.maxRunFrac >= trebleRunMin
    const bassStrong = bassStats.maxRunFrac >= bassRunMin
    const gapStrong = gapStats.maxRunFrac >= gapRunMin
    const fullStrong = fullStats.maxRunFrac >= fullBandRunMin
    const edgeBarline = fullStrong && trebleStrong && bassStrong
    const grandStaffBarline = fullStrong && gapStrong && trebleStrong && bassStrong

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

    // Full grand-staff continuity — accept even when dense beams add transition noise.
    if (grandStaffBarline) {
      rawCandidates.push({
        x: xNorm,
        confidence: stemSignals === 0 ? 'high' : 'low',
        score:
          candidateScore({
            trebleStats,
            bassStats,
            gapStats,
            fullStats,
            gapStrong,
            trebleStrong,
            bassStrong,
          }) + 0.2,
      })
      if (stemSignals > 0) {
        diagnostics.retainedLowConfidence += 1
      }
      continue
    }

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
  rawCandidates.sort((left, right) => left.x - right.x)
  let merged = []
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

  diagnostics.acceptedBeforeRefine = merged.length
  let refined = refineBarlineCandidateSet({
    merged,
    imageData,
    contentBounds,
    system,
    darkThreshold,
    trebleRunMin,
    bassRunMin,
    diagnostics,
  })
  let positions = refined.positions
  merged = refined.merged
  let preThinCount = refined.preThinCount
  let thinningAmbiguous = refined.thinningAmbiguous
  if (refined.thinningRemoved > 0) {
    diagnostics.thinningRemoved = refined.thinningRemoved
  }

  diagnostics.accepted = positions.length
  diagnostics.retainedLowConfidence = merged.filter((entry) => entry.confidence === 'low').length
  diagnostics.refinementRemoved = Math.max(0, diagnostics.acceptedBeforeRefine - positions.length)

  diagnostics.densityAmbiguous = assessDensityAmbiguity(positions, contentBounds, {
    thinningAmbiguous,
    rejected: diagnostics.rejected,
    preThinCount,
  })

  if (positions.length < 5) {
    const recovered = detectBarlinesFromVerticalProjection(imageData, contentBounds, system, {
      darkThreshold: Math.min(darkThreshold, 135),
      trebleRunMin: trebleRunMin * 0.92,
      bassRunMin: bassRunMin * 0.92,
      gapRunMin: gapRunMin * 0.9,
      fullBandRunMin: Math.min(fullBandRunMin, 0.68),
    })
    if (recovered.positions.length > positions.length) {
      diagnostics.recoveredFromProjection = true
      diagnostics.recoveryBefore = positions.length
      positions = mergeBarlinePositions(positions, recovered.positions, contentBounds, width)
      merged = recoveredCandidatesFromPositions(positions, merged)
      refined = refineBarlineCandidateSet({
        merged,
        imageData,
        contentBounds,
        system,
        darkThreshold,
        trebleRunMin,
        bassRunMin,
        diagnostics,
        afterRecovery: true,
      })
      positions = refined.positions
      merged = refined.merged
      preThinCount = Math.max(preThinCount, recovered.positions.length)
      thinningAmbiguous = refined.thinningAmbiguous || thinningAmbiguous
      if (refined.thinningRemoved > 0) {
        diagnostics.thinningRemoved = (diagnostics.thinningRemoved ?? 0) + refined.thinningRemoved
      }
      diagnostics.accepted = positions.length
      diagnostics.retainedLowConfidence = merged.filter((entry) => entry.confidence === 'low').length
      diagnostics.refinementRemoved = Math.max(0, diagnostics.acceptedBeforeRefine - positions.length)
      diagnostics.densityAmbiguous = assessDensityAmbiguity(positions, contentBounds, {
        thinningAmbiguous,
        rejected: diagnostics.rejected,
        preThinCount,
      })
    }
  }

  if (positions.length < 3) {
    const relaxed = detectBarlinesRelaxedFullBand(imageData, contentBounds, system, {
      darkThreshold: Math.min(darkThreshold, 130),
    })
    if (relaxed.positions.length > positions.length) {
      diagnostics.recoveredRelaxedFullBand = true
      positions = mergeBarlinePositions(positions, relaxed.positions, contentBounds, width)
      merged = recoveredCandidatesFromPositions(positions, merged)
      refined = refineBarlineCandidateSet({
        merged,
        imageData,
        contentBounds,
        system,
        darkThreshold,
        trebleRunMin,
        bassRunMin,
        diagnostics,
        afterRecovery: true,
      })
      positions = refined.positions
      merged = refined.merged
      preThinCount = Math.max(preThinCount, relaxed.positions.length)
      thinningAmbiguous = refined.thinningAmbiguous || thinningAmbiguous
      if (refined.thinningRemoved > 0) {
        diagnostics.thinningRemoved = (diagnostics.thinningRemoved ?? 0) + refined.thinningRemoved
      }
      diagnostics.accepted = positions.length
      diagnostics.retainedLowConfidence = merged.filter((entry) => entry.confidence === 'low').length
      diagnostics.refinementRemoved = Math.max(0, diagnostics.acceptedBeforeRefine - positions.length)
      diagnostics.densityAmbiguous = assessDensityAmbiguity(positions, contentBounds, {
        thinningAmbiguous,
        rejected: diagnostics.rejected,
        preThinCount,
      })
    }
  }

  return { positions, diagnostics }
}

function columnBarlineProjectionScore(trebleStats, bassStats, gapStats, fullStats) {
  const bothStaves = Math.min(trebleStats.maxRunFrac, bassStats.maxRunFrac)
  if (fullStats.maxRunFrac < 0.62 || bothStaves < 0.42) {
    return -1
  }
  return (
    fullStats.maxRunFrac * 1.5 +
    bothStaves * 0.55 +
    gapStats.maxRunFrac * 0.45 +
    fullStats.inkFrac * 0.25 -
    fullStats.transitions * 0.018
  )
}

/**
 * When shape-based detection collapses to too few barlines (common under dense
 * beamed piano), recover peaks from a vertical ink projection across the band.
 */
function detectBarlinesFromVerticalProjection(imageData, contentBounds, system, options = {}) {
  const {
    darkThreshold = 140,
    trebleRunMin = 0.52,
    bassRunMin = 0.52,
    gapRunMin = 0.28,
    fullBandRunMin = 0.72,
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
  const contentWidth = Math.max(1e-6, (contentBounds.x1 ?? 1) - (contentBounds.x0 ?? 0))
  const minGap = contentWidth * 0.035

  const profile = []
  for (let x = left; x <= right; x += 1) {
    const trebleStats = columnBandStats(imageData, x, treble, darkThreshold)
    const bassStats = columnBandStats(imageData, x, bass, darkThreshold)
    const gapStats = columnBandStats(imageData, x, gap, darkThreshold)
    const fullStats = columnBandStatsSmoothed(imageData, x, fullBand, darkThreshold)
    const score = columnBarlineProjectionScore(trebleStats, bassStats, gapStats, fullStats)
    if (score < 0) {
      continue
    }
    const trebleStrong = trebleStats.maxRunFrac >= trebleRunMin
    const bassStrong = bassStats.maxRunFrac >= bassRunMin
    const gapStrong = gapStats.maxRunFrac >= gapRunMin
    const fullStrong = fullStats.maxRunFrac >= fullBandRunMin
    if (!(fullStrong || (trebleStrong && bassStrong && gapStrong))) {
      continue
    }
    profile.push({ x: x / width, score })
  }

  if (profile.length < 3) {
    return { positions: [] }
  }

  const peaks = []
  const scoreFloor = Math.max(0.95, ...profile.map((entry) => entry.score)) * 0.72
  for (let i = 1; i < profile.length - 1; i += 1) {
    const prev = profile[i - 1]
    const cur = profile[i]
    const next = profile[i + 1]
    if (cur.score >= prev.score && cur.score >= next.score && cur.score >= scoreFloor) {
      peaks.push(cur)
    }
  }

  peaks.sort((a, b) => b.score - a.score)
  const picked = []
  for (const peak of peaks) {
    if (picked.every((x) => Math.abs(peak.x - x) >= minGap)) {
      picked.push(peak.x)
    }
  }
  picked.sort((a, b) => a - b)
  return { positions: picked }
}

/**
 * Last-resort sweep for dense textures: accept tall full-band columns even when
 * treble/bass continuity is broken by beams (Spider-Dance-style layouts).
 */
function detectBarlinesRelaxedFullBand(imageData, contentBounds, system, options = {}) {
  const { darkThreshold = 130 } = options
  const { width, height } = imageData
  const { treble, bass, left, right } = splitGrandStaffVerticalBands(
    imageData,
    contentBounds,
    system,
  )
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const fullBand = { y0, y1 }
  const contentWidth = Math.max(1e-6, (contentBounds.x1 ?? 1) - (contentBounds.x0 ?? 0))
  const minGap = contentWidth * 0.03
  const x0Bound = contentBounds.x0 ?? 0
  const x1Bound = contentBounds.x1 ?? 1
  const margin = x0Bound + 0.02
  const maxX = x1Bound - 0.02

  const profile = []
  for (let x = left; x <= right; x += 1) {
    const xNorm = x / width
    if (xNorm < margin || xNorm > maxX) {
      continue
    }
    const fullStats = columnBandStatsSmoothed(imageData, x, fullBand, darkThreshold, 2)
    const trebleStats = columnBandStats(imageData, x, treble, darkThreshold)
    const bassStats = columnBandStats(imageData, x, bass, darkThreshold)
    if (fullStats.maxRunFrac < 0.8) {
      continue
    }
    if (trebleStats.maxRunFrac < 0.35 && bassStats.maxRunFrac < 0.35) {
      continue
    }
    if (fullStats.transitions > 14 && fullStats.maxRunFrac < 0.9) {
      continue
    }
    profile.push({
      x: xNorm,
      score: fullStats.maxRunFrac + Math.max(trebleStats.maxRunFrac, bassStats.maxRunFrac) * 0.25,
    })
  }

  if (profile.length < 2) {
    return { positions: [] }
  }

  const scoreFloor = Math.max(0.9, ...profile.map((entry) => entry.score)) * 0.78
  const peaks = []
  for (let i = 1; i < profile.length - 1; i += 1) {
    const cur = profile[i]
    if (
      cur.score >= profile[i - 1].score &&
      cur.score >= profile[i + 1].score &&
      cur.score >= scoreFloor
    ) {
      peaks.push(cur)
    }
  }

  peaks.sort((a, b) => b.score - a.score)
  const picked = []
  for (const peak of peaks) {
    if (picked.every((x) => Math.abs(peak.x - x) >= minGap)) {
      picked.push(peak.x)
    }
  }
  picked.sort((a, b) => a - b)
  return { positions: picked }
}

function mergeBarlinePositions(existing, recovered, contentBounds, width) {
  const contentWidth = Math.max(1e-6, (contentBounds.x1 ?? 1) - (contentBounds.x0 ?? 0))
  const mergeGapPx = Math.max(2, Math.floor(contentWidth * width * 0.01))
  const merged = []
  for (const x of [...existing, ...recovered].sort((a, b) => a - b)) {
    const last = merged[merged.length - 1]
    if (last != null && (x - last) * width <= mergeGapPx) {
      merged[merged.length - 1] = (x + last) / 2
    } else {
      merged.push(x)
    }
  }
  return merged
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
