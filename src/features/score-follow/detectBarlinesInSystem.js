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

    // Note columns flicker dark/light; barlines are one long vertical stroke.
    if (fullStats.transitions > 8 && !fullStrong) {
      diagnostics.rejected[BARLINE_REJECT_REASON.STEM_LIKE] += 1
      continue
    }

    // Stems/note clusters: strong ink in one staff only, weak in the other.
    if (
      (trebleStrong && bassStats.maxRunFrac < stemLikeMax) ||
      (bassStrong && trebleStats.maxRunFrac < stemLikeMax)
    ) {
      diagnostics.rejected[BARLINE_REJECT_REASON.SINGLE_STAFF] += 1
      continue
    }

    // Short vertical runs confined to note regions (stem-like), not full barlines.
    if (
      !fullStrong &&
      (trebleStats.maxRunFrac < trebleRunMin * 0.85 || bassStats.maxRunFrac < bassRunMin * 0.85)
    ) {
      diagnostics.rejected[BARLINE_REJECT_REASON.WEAK_RUN] += 1
      continue
    }

    // Both staves must show a barline-like run, OR one very strong full-grand run.
    if (!fullStrong && !(trebleStrong && bassStrong)) {
      diagnostics.rejected[BARLINE_REJECT_REASON.STEM_LIKE] += 1
      continue
    }

    // Real barlines continue through the treble↔bass gap; isolated stems do not.
    if (!fullStrong && !gapStrong) {
      diagnostics.rejected[BARLINE_REJECT_REASON.WEAK_GAP] += 1
      continue
    }

    rawCandidates.push({
      x: xNorm,
      score:
        trebleStats.maxRunFrac +
        bassStats.maxRunFrac +
        gapStats.maxRunFrac +
        fullStats.maxRunFrac * 0.5 -
        fullStats.transitions * 0.015,
    })
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
      }
    } else {
      merged.push({ ...candidate })
    }
  }

  let positions = merged.map((m) => m.x)
  diagnostics.accepted = positions.length

  if (positions.length > 3) {
    const thinned = thinBarlineGrid(merged, contentBounds)
    if (thinned.length < positions.length) {
      diagnostics.rejected[BARLINE_REJECT_REASON.TOO_DENSE] += positions.length - thinned.length
    }
    positions = thinned
    diagnostics.accepted = positions.length
  }

  return { positions, diagnostics }
}

/** Keep the widest-spaced barlines when a stem grid produced too many candidates. */
function thinBarlineGrid(candidates, contentBounds) {
  if (candidates.length <= 3) {
    return candidates.map((c) => c.x).sort((a, b) => a - b)
  }
  const sorted = [...candidates].sort((a, b) => a.x - b.x)
  const sortedX = sorted.map((c) => c.x)

  // A handful of survivors are almost always real barlines — keep them all.
  if (candidates.length <= 8) {
    return sortedX
  }
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
  let minGap = estMeasureFrac * contentWidth * 0.72

  // Few candidates are usually real barlines — do not over-thin using one wide gap.
  if (candidates.length <= 10) {
    minGap = Math.max(contentWidth * 0.028, medGap * 0.82)
  } else if (candidates.length > 12) {
    minGap = Math.max(minGap, contentWidth * 0.085)
  }

  const pickWithMinGap = (gapPx) => {
    const byScore = [...candidates].sort((a, b) => b.score - a.score)
    const picked = []
    for (const candidate of byScore) {
      if (picked.every((k) => Math.abs(candidate.x - k) >= gapPx)) {
        picked.push(candidate.x)
      }
    }
    picked.sort((a, b) => a - b)
    return picked
  }

  let kept = pickWithMinGap(minGap)
  while (kept.length > 14 && minGap < contentWidth * 0.22) {
    minGap *= 1.12
    kept = pickWithMinGap(minGap)
  }
  if (kept.length === 0) {
    return sortedX
  }
  const last = sortedX[sortedX.length - 1]
  if (last - kept[kept.length - 1] >= minGap * 0.55) {
    kept.push(last)
  } else if (Math.abs(last - kept[kept.length - 1]) > minGap * 0.2) {
    kept[kept.length - 1] = last
  }
  return kept
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
