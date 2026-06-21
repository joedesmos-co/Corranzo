function smoothFloatArray(values, radius) {
  const output = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = values[index + offset]
      if (sample != null) {
        sum += sample
        count += 1
      }
    }
    output[index] = count > 0 ? sum / count : 0
  }
  return output
}

function pixelLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  // Composite over white: PDFs that don't paint a white background render onto
  // a transparent canvas (RGB 0, alpha 0). Without this, every pixel — ink and
  // blank alike — would read as black and defeat staff detection on real scores.
  return lum * alpha + 255 * (1 - alpha)
}

function isDark(data, index, threshold = 185) {
  return pixelLuminance(data, index) < threshold
}

/**
 * Horizontal content region — ignores wide blank margins.
 */
export function detectContentBounds(imageData, columnThreshold = 0.012) {
  const { width, height, data } = imageData
  let left = width
  let right = -1

  const edgeSkip = Math.max(2, Math.floor(width * 0.04))

  for (let x = edgeSkip; x < width - edgeSkip; x += 1) {
    let darkRows = 0
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4
      if (isDark(data, index, 200)) {
        darkRows += 1
      }
    }
    if (darkRows / height > columnThreshold) {
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }

  if (right < left) {
    return { left: 0, right: width - 1, x0: 0, x1: 1, width }
  }

  const contentWidth = right - left + 1
  const pad = Math.max(2, Math.floor(contentWidth * 0.015))
  const boundedLeft = Math.max(0, left - pad)
  const boundedRight = Math.min(width - 1, right + pad)

  return {
    left: boundedLeft,
    right: boundedRight,
    x0: boundedLeft / width,
    x1: (boundedRight + 1) / width,
    width: boundedRight - boundedLeft + 1,
  }
}

export function computeRowDensityInContent(imageData, contentBounds) {
  const { width, height, data } = imageData
  const { left, right } = contentBounds
  const contentWidth = Math.max(1, right - left + 1)
  const rowDensity = new Float32Array(height)

  for (let y = 0; y < height; y += 1) {
    let dark = 0
    for (let x = left; x <= right; x += 1) {
      const index = (y * width + x) * 4
      if (isDark(data, index)) {
        dark += 1
      }
    }
    rowDensity[y] = dark / contentWidth
  }

  return rowDensity
}

function mergeNearbyBands(bands, minGap) {
  if (bands.length === 0) {
    return []
  }
  const merged = [{ ...bands[0] }]
  for (let index = 1; index < bands.length; index += 1) {
    const band = bands[index]
    const last = merged[merged.length - 1]
    if (band.y0 - last.y1 < minGap) {
      last.y1 = band.y1
      last.center = (last.y0 + last.y1) / 2
    } else {
      merged.push({ ...band })
    }
  }
  return merged
}

function splitBandByRowValleys(rowDensity, band, height, options = {}) {
  const { minSplitHeightRatio = 0.45, valleyThreshold = 0.01, minSubBandNorm = 0.055 } = options
  const bandHeightPx = Math.floor((band.y1 - band.y0) * height)
  if (bandHeightPx < height * minSplitHeightRatio) {
    return [band]
  }

  const yStart = Math.floor(band.y0 * height)
  const yEnd = Math.ceil(band.y1 * height)
  const minGapPx = Math.max(6, Math.floor(height * 0.02))
  const splitPoints = [yStart]
  let gapRun = 0
  let gapStart = yStart

  for (let y = yStart; y < yEnd; y += 1) {
    if (rowDensity[y] < valleyThreshold) {
      if (gapRun === 0) {
        gapStart = y
      }
      gapRun += 1
    } else if (gapRun >= minGapPx) {
      const mid = Math.floor((gapStart + y) / 2)
      if (mid - yStart > minGapPx && yEnd - mid > minGapPx) {
        splitPoints.push(mid)
      }
      gapRun = 0
    } else {
      gapRun = 0
    }
  }
  splitPoints.push(yEnd)

  if (splitPoints.length <= 2) {
    return [band]
  }

  const subBands = []
  for (let index = 0; index < splitPoints.length - 1; index += 1) {
    const y0 = splitPoints[index] / height
    const y1 = splitPoints[index + 1] / height
    if (y1 - y0 >= minSubBandNorm) {
      subBands.push({ y0, y1, center: (y0 + y1) / 2 })
    }
  }

  return subBands.length > 0 ? subBands : [band]
}

function filterPlausibleSystems(bands, options = {}) {
  const {
    minBandHeightNorm = 0.055,
    maxBandHeightNorm = 0.28,
    centerMin = 0.12,
    centerMax = 0.96,
  } = options
  return bands.filter((band) => {
    const bandHeight = band.y1 - band.y0
    if (bandHeight < minBandHeightNorm || bandHeight > maxBandHeightNorm) {
      return false
    }
    if (band.center < centerMin || band.center > centerMax) {
      return false
    }
    return true
  })
}

/** Default band-quality scoring parameters (conservative / high-precision). */
export const STAFF_BAND_QUALITY_DEFAULTS = {
  minBandHeightNorm: 0.055,
  maxBandHeightNorm: 0.28,
  peakDensityThreshold: 0.035,
  minPeaks: 3,
  maxPeaks: 10,
  minMeanDensity: 0.025,
  maxMeanDensity: 0.32,
  baseScore: 0.55,
}

/**
 * Looser scoring for dense piano music, anime/game arrangements, lyrics and
 * uneven scans: a denser, taller band with many ink peaks is still a staff.
 */
export const STAFF_BAND_QUALITY_TOLERANT = {
  minBandHeightNorm: 0.045,
  maxBandHeightNorm: 0.46,
  peakDensityThreshold: 0.03,
  minPeaks: 2,
  maxPeaks: 80,
  minMeanDensity: 0.015,
  maxMeanDensity: 0.62,
  baseScore: 0.46,
}

/**
 * Staff lines show several horizontal ink peaks; title blocks are denser or too shallow.
 * Accepts an options object so tolerant detection can relax thresholds for dense notation.
 */
export function scoreStaffBandQuality(imageData, band, rowDensity, options = {}) {
  const params = { ...STAFF_BAND_QUALITY_DEFAULTS, ...options }
  const { height } = imageData
  const y0 = Math.floor(band.y0 * height)
  const y1 = Math.ceil(band.y1 * height)
  const bandHeightPx = Math.max(1, y1 - y0)
  const bandHeightNorm = bandHeightPx / height

  if (bandHeightNorm < params.minBandHeightNorm || bandHeightNorm > params.maxBandHeightNorm) {
    return 0
  }

  let peaks = 0
  for (let y = y0 + 1; y < y1 - 1; y += 1) {
    if (
      rowDensity[y] > params.peakDensityThreshold &&
      rowDensity[y] >= rowDensity[y - 1] &&
      rowDensity[y] >= rowDensity[y + 1]
    ) {
      peaks += 1
    }
  }

  if (peaks < params.minPeaks || peaks > params.maxPeaks) {
    return 0
  }

  let densitySum = 0
  for (let y = y0; y < y1; y += 1) {
    densitySum += rowDensity[y]
  }
  const meanDensity = densitySum / bandHeightPx

  if (meanDensity > params.maxMeanDensity) {
    return 0
  }
  if (meanDensity < params.minMeanDensity) {
    return 0
  }

  return params.baseScore + Math.min(0.35, peaks * 0.04)
}

/**
 * Find horizontal staff/system bands from row ink density (content area only).
 * Options let tolerant detection widen the accepted band geometry.
 */
export function detectStaffSystems(imageData, contentBounds = null, options = {}) {
  const {
    denseThreshold = 0.024,
    minBandHeightNorm = 0.055,
    maxBandHeightNorm = 0.28,
    centerMin = 0.12,
    centerMax = 0.96,
    valleyThreshold = 0.01,
    minSplitHeightRatio = 0.45,
  } = options
  const { height } = imageData
  const bounds = contentBounds ?? detectContentBounds(imageData)
  const rowDensity = computeRowDensityInContent(imageData, bounds)

  const smoothed = smoothFloatArray(rowDensity, 2)
  const minBandHeight = height * 0.04
  const lineGapMerge = Math.max(8, Math.floor(height * 0.028))
  const rawBands = []
  let inBand = false
  let startY = 0
  let gapRun = 0

  for (let y = 0; y < height; y += 1) {
    const dense = smoothed[y] > denseThreshold
    if (dense) {
      if (!inBand) {
        startY = y
        inBand = true
      }
      gapRun = 0
    } else if (inBand) {
      gapRun += 1
      if (gapRun >= lineGapMerge) {
        const endY = y - gapRun
        if (endY - startY >= minBandHeight) {
          const y0 = startY / height
          const y1 = endY / height
          rawBands.push({ y0, y1, center: (y0 + y1) / 2 })
        }
        inBand = false
        gapRun = 0
      }
    }
  }

  if (inBand) {
    const endY = height - gapRun
    if (endY - startY >= minBandHeight) {
      const y0 = startY / height
      const y1 = endY / height
      rawBands.push({ y0, y1: endY / height, center: (y0 + y1) / 2 })
    }
  }

  const merged = mergeNearbyBands(rawBands, Math.max(6, Math.floor(height * 0.02)))
  const split = merged.flatMap((band) =>
    splitBandByRowValleys(smoothed, band, height, {
      valleyThreshold,
      minSplitHeightRatio,
      minSubBandNorm: minBandHeightNorm,
    }),
  )
  const filtered = filterPlausibleSystems(split, {
    minBandHeightNorm,
    maxBandHeightNorm,
    centerMin,
    centerMax,
  })

  return filtered.map((band) => ({ ...band, contentBounds: bounds }))
}

const HEADER_CUTOFF_NORM = 0.16
const TOLERANT_HEADER_CUTOFF_NORM = 0.11
const MIN_STAFF_INK_WIDTH_RATIO = 0.42
const TOLERANT_MIN_STAFF_INK_WIDTH_RATIO = 0.26
const MAX_SYSTEMS_PER_PAGE = 6
const TOLERANT_MAX_SYSTEMS_PER_PAGE = 14

/**
 * Resolve a candidate band against the header zone so the FIRST staff system
 * is never silently dropped just because the title sits above it.
 *
 *  - fully below the cutoff → keep unchanged
 *  - straddling (title merged with the first staff) → trim the title off at the
 *    lowest-density gap near the header line, preserving the staff portion
 *  - entirely within the header (pure title / composer text) → drop (null)
 */
function resolveHeaderBand(band, rowDensity, height, headerCutoff) {
  if (band.y0 >= headerCutoff) {
    return band
  }
  const cutoffPx = Math.round(headerCutoff * height)
  const y0px = Math.floor(band.y0 * height)
  const y1px = Math.ceil(band.y1 * height)
  const minStaffPx = Math.round(height * 0.045)

  // Pure header band — never extends meaningfully past the header line.
  if (y1px <= cutoffPx + minStaffPx) {
    return null
  }

  // Straddles the header line: snap the new top to the lowest-density row near
  // the cutoff (the natural title↔staff gap), trimming the title away.
  const window = Math.round(height * 0.04)
  const from = Math.max(y0px, cutoffPx - window)
  const to = Math.max(from, Math.min(cutoffPx + window, y1px - minStaffPx))
  let bestY = Math.max(cutoffPx, from)
  let bestDensity = Infinity
  for (let y = from; y <= to; y += 1) {
    if (rowDensity[y] <= bestDensity) {
      bestDensity = rowDensity[y]
      bestY = y
    }
  }
  const trimmedY0 = bestY / height
  if (band.y1 - trimmedY0 < 0.05) {
    return band
  }
  return { ...band, y0: trimmedY0, center: (trimmedY0 + band.y1) / 2 }
}

/**
 * Conservative staff list: drops header/title bands and non-staff ink regions.
 */
export function systemInkWidthRatio(imageData, contentBounds, band) {
  return staffHorizontalInkRatio(imageData, contentBounds, band)
}

function staffHorizontalInkRatio(imageData, contentBounds, band) {
  const { width, height, data } = imageData
  const y0 = Math.floor(band.y0 * height)
  const y1 = Math.ceil(band.y1 * height)
  const xLeft = Math.floor(contentBounds.left ?? contentBounds.x0 * width)
  const xRight = Math.ceil(contentBounds.right ?? contentBounds.x1 * width)
  const contentWidth = Math.max(1, xRight - xLeft + 1)

  let minInkX = width
  let maxInkX = -1
  for (let y = y0; y <= y1; y += 1) {
    for (let x = xLeft; x <= xRight; x += 1) {
      const index = (y * width + x) * 4
      if (isDark(data, index, 200)) {
        minInkX = Math.min(minInkX, x)
        maxInkX = Math.max(maxInkX, x)
      }
    }
  }

  if (maxInkX < minInkX) {
    return 0
  }
  return (maxInkX - minInkX + 1) / contentWidth
}

export function detectConservativeStaffSystems(imageData, contentBounds = null) {
  const bounds = contentBounds ?? detectContentBounds(imageData)
  const rowDensity = computeRowDensityInContent(imageData, bounds)
  const { height } = imageData
  const candidates = detectStaffSystems(imageData, bounds)

  return candidates
    .map((system) => resolveHeaderBand(system, rowDensity, height, HEADER_CUTOFF_NORM))
    .filter(Boolean)
    .map((system) => ({
      system: { ...system, contentBounds: bounds },
      score: scoreStaffBandQuality(imageData, system, rowDensity),
      inkWidth: staffHorizontalInkRatio(imageData, bounds, system),
    }))
    .filter(
      (entry) => entry.score >= 0.62 && entry.inkWidth >= MIN_STAFF_INK_WIDTH_RATIO,
    )
    .sort((a, b) => a.system.y0 - b.system.y0)
    .map((entry) => entry.system)
}

/**
 * Tolerant staff list — STAGE 2 of auto setup.
 *
 * Trades precision for recall so dense piano scores, anime/game arrangements,
 * lyric-heavy charts and uneven scans still produce usable system bands. Uses
 * the looser quality scorer, a wider accepted band geometry and a more
 * aggressive valley split so merged systems get separated. Header/title ink is
 * still dropped. Returns at most `maxSystems` bands (kept by descending score).
 */
export function detectTolerantStaffSystems(imageData, contentBounds = null, options = {}) {
  const { maxSystems = TOLERANT_MAX_SYSTEMS_PER_PAGE } = options
  const bounds = contentBounds ?? detectContentBounds(imageData)
  const rowDensity = computeRowDensityInContent(imageData, bounds)
  const smoothed = smoothFloatArray(rowDensity, 2)
  const { height } = imageData
  const candidates = detectStaffSystems(imageData, bounds, {
    denseThreshold: 0.02,
    minBandHeightNorm: STAFF_BAND_QUALITY_TOLERANT.minBandHeightNorm,
    maxBandHeightNorm: STAFF_BAND_QUALITY_TOLERANT.maxBandHeightNorm,
    centerMin: 0.1,
    centerMax: 0.97,
    valleyThreshold: 0.018,
    minSplitHeightRatio: 0.3,
  })

  const scored = candidates
    .map((system) => resolveHeaderBand(system, smoothed, height, TOLERANT_HEADER_CUTOFF_NORM))
    .filter(Boolean)
    .map((system) => ({
      system: { ...system, contentBounds: bounds },
      score: scoreStaffBandQuality(imageData, system, smoothed, STAFF_BAND_QUALITY_TOLERANT),
      inkWidth: staffHorizontalInkRatio(imageData, bounds, system),
    }))
    .filter(
      (entry) =>
        entry.score > 0 && entry.inkWidth >= TOLERANT_MIN_STAFF_INK_WIDTH_RATIO,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSystems)

  return scored.sort((a, b) => a.system.y0 - b.system.y0).map((entry) => entry.system)
}

/**
 * Geometric fallback — STAGE 4 last-resort band estimate.
 *
 * When pixel-based detection can't isolate staff systems, split the inked
 * content region (below the header) into bands. When a `systemCount` hint is
 * available (e.g. from MusicXML system breaks) we target that many bands and
 * snap cut points to the nearest row-density valley; otherwise we estimate the
 * count from strong valleys. Always returns ≥1 band when the page has ink, so
 * an approximate cursor can still be shown.
 */
export function estimateSystemBandsFromContent(imageData, contentBounds = null, options = {}) {
  const { systemCount = null, maxSystems = TOLERANT_MAX_SYSTEMS_PER_PAGE, headerCutoff = TOLERANT_HEADER_CUTOFF_NORM } =
    options
  const { height } = imageData
  const bounds = contentBounds ?? detectContentBounds(imageData)
  const rowDensity = computeRowDensityInContent(imageData, bounds)
  const smoothed = smoothFloatArray(rowDensity, 2)

  // Inked vertical extent below the header band.
  const inkThreshold = 0.012
  const headerPx = Math.floor(headerCutoff * height)
  let top = -1
  let bottom = -1
  for (let y = headerPx; y < height; y += 1) {
    if (smoothed[y] > inkThreshold) {
      if (top === -1) {
        top = y
      }
      bottom = y
    }
  }

  if (top === -1 || bottom <= top) {
    return []
  }

  const regionHeight = bottom - top
  if (regionHeight < height * 0.04) {
    // A single thin band of ink — treat the whole inked region as one system.
    const y0 = top / height
    const y1 = bottom / height
    return [{ y0, y1, center: (y0 + y1) / 2, contentBounds: bounds, estimated: true }]
  }

  // Collect candidate valleys (low-density gaps) inside the inked region.
  const valleys = []
  let runStart = -1
  for (let y = top; y <= bottom; y += 1) {
    if (smoothed[y] < inkThreshold) {
      if (runStart === -1) {
        runStart = y
      }
    } else if (runStart !== -1) {
      valleys.push((runStart + y) / 2)
      runStart = -1
    }
  }

  let targetBands
  if (Number.isFinite(systemCount) && systemCount >= 1) {
    targetBands = Math.min(maxSystems, Math.max(1, Math.round(systemCount)))
  } else {
    targetBands = Math.min(maxSystems, Math.max(1, valleys.length + 1))
  }

  if (targetBands <= 1) {
    const y0 = top / height
    const y1 = bottom / height
    return [{ y0, y1, center: (y0 + y1) / 2, contentBounds: bounds, estimated: true }]
  }

  // Even partition points, snapped to the nearest valley when one is close.
  const cutsPx = []
  for (let index = 1; index < targetBands; index += 1) {
    const evenCut = top + (regionHeight * index) / targetBands
    let snapped = evenCut
    let bestDist = regionHeight / targetBands / 2
    for (const valley of valleys) {
      const dist = Math.abs(valley - evenCut)
      if (dist < bestDist) {
        bestDist = dist
        snapped = valley
      }
    }
    cutsPx.push(snapped)
  }

  const boundariesPx = [top, ...cutsPx.sort((a, b) => a - b), bottom]
  const bands = []
  for (let index = 0; index < boundariesPx.length - 1; index += 1) {
    const y0 = boundariesPx[index] / height
    const y1 = boundariesPx[index + 1] / height
    if (y1 - y0 > 0.012) {
      bands.push({ y0, y1, center: (y0 + y1) / 2, contentBounds: bounds, estimated: true })
    }
  }

  return bands.length > 0
    ? bands
    : [
        {
          y0: top / height,
          y1: bottom / height,
          center: (top + bottom) / (2 * height),
          contentBounds: bounds,
          estimated: true,
        },
      ]
}

export function systemStartAnchorPosition(system, contentBounds) {
  const inset = 0.05
  const x =
    contentBounds.x0 + inset * Math.max(0.01, contentBounds.x1 - contentBounds.x0)
  const y = Math.min(system.y1 - 0.01, Math.max(system.y0 + 0.01, system.center))
  return {
    x: Math.min(contentBounds.x1 - 0.03, Math.max(contentBounds.x0 + 0.03, x)),
    y,
  }
}

/** Right edge of the system band — pairs with system-start for horizontal cursor sweep. */
export function systemEndAnchorPosition(system, contentBounds) {
  const inset = 0.05
  const span = Math.max(0.01, contentBounds.x1 - contentBounds.x0)
  const x = contentBounds.x1 - inset * span
  const y = Math.min(system.y1 - 0.01, Math.max(system.y0 + 0.01, system.center))
  return {
    x: Math.min(contentBounds.x1 - 0.02, Math.max(contentBounds.x0 + 0.08, x)),
    y,
  }
}

export {
  HEADER_CUTOFF_NORM,
  TOLERANT_HEADER_CUTOFF_NORM,
  MAX_SYSTEMS_PER_PAGE,
  TOLERANT_MAX_SYSTEMS_PER_PAGE,
}
