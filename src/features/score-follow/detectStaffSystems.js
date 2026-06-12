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
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
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

function splitBandByRowValleys(rowDensity, band, height) {
  const bandHeightPx = Math.floor((band.y1 - band.y0) * height)
  if (bandHeightPx < height * 0.45) {
    return [band]
  }

  const yStart = Math.floor(band.y0 * height)
  const yEnd = Math.ceil(band.y1 * height)
  const minGapPx = Math.max(6, Math.floor(height * 0.02))
  const splitPoints = [yStart]
  let gapRun = 0
  let gapStart = yStart

  for (let y = yStart; y < yEnd; y += 1) {
    if (rowDensity[y] < 0.01) {
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
    if (y1 - y0 >= 0.055) {
      subBands.push({ y0, y1, center: (y0 + y1) / 2 })
    }
  }

  return subBands.length > 0 ? subBands : [band]
}

function filterPlausibleSystems(bands) {
  return bands.filter((band) => {
    const bandHeight = band.y1 - band.y0
    if (bandHeight < 0.055 || bandHeight > 0.28) {
      return false
    }
    if (band.center < 0.12 || band.center > 0.96) {
      return false
    }
    return true
  })
}

/**
 * Staff lines show several horizontal ink peaks; title blocks are denser or too shallow.
 */
export function scoreStaffBandQuality(imageData, band, rowDensity) {
  const { height } = imageData
  const y0 = Math.floor(band.y0 * height)
  const y1 = Math.ceil(band.y1 * height)
  const bandHeightPx = Math.max(1, y1 - y0)
  const bandHeightNorm = bandHeightPx / height

  if (bandHeightNorm < 0.055 || bandHeightNorm > 0.28) {
    return 0
  }

  let peaks = 0
  for (let y = y0 + 1; y < y1 - 1; y += 1) {
    if (
      rowDensity[y] > 0.035 &&
      rowDensity[y] >= rowDensity[y - 1] &&
      rowDensity[y] >= rowDensity[y + 1]
    ) {
      peaks += 1
    }
  }

  if (peaks < 3 || peaks > 10) {
    return 0
  }

  let densitySum = 0
  for (let y = y0; y < y1; y += 1) {
    densitySum += rowDensity[y]
  }
  const meanDensity = densitySum / bandHeightPx

  if (meanDensity > 0.32) {
    return 0
  }
  if (meanDensity < 0.025) {
    return 0
  }

  return 0.55 + Math.min(0.35, peaks * 0.04)
}

/**
 * Find horizontal staff/system bands from row ink density (content area only).
 */
export function detectStaffSystems(imageData, contentBounds = null) {
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
    const dense = smoothed[y] > 0.024
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
  const split = merged.flatMap((band) => splitBandByRowValleys(smoothed, band, height))
  const filtered = filterPlausibleSystems(split)

  return filtered.map((band) => ({ ...band, contentBounds: bounds }))
}

const HEADER_CUTOFF_NORM = 0.16
const MIN_STAFF_INK_WIDTH_RATIO = 0.42
const MAX_SYSTEMS_PER_PAGE = 6

/**
 * Conservative staff list: drops header/title bands and non-staff ink regions.
 */
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
  const candidates = detectStaffSystems(imageData, bounds)

  return candidates
    .map((system) => ({
      system,
      score: scoreStaffBandQuality(imageData, system, rowDensity),
      inkWidth: staffHorizontalInkRatio(imageData, bounds, system),
    }))
    .filter(
      (entry) =>
        entry.score >= 0.62 &&
        entry.system.y0 >= HEADER_CUTOFF_NORM &&
        entry.inkWidth >= MIN_STAFF_INK_WIDTH_RATIO,
    )
    .sort((a, b) => a.system.y0 - b.system.y0)
    .map((entry) => entry.system)
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

export { HEADER_CUTOFF_NORM, MAX_SYSTEMS_PER_PAGE }
