import { computeRowDensityInContent } from './detectStaffSystems.js'

function pixelLuminance(data, index) {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
}

function isDark(data, index, threshold = 185) {
  return pixelLuminance(data, index) < threshold
}

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

/**
 * Vertical ink peaks inside a staff system band (barline-like).
 * Returns normalized x in [0,1] within the page.
 */
export function detectBarlinePositionsInSystem(imageData, contentBounds, system) {
  const { width, height, data } = imageData
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const xLeft = Math.max(0, Math.floor(contentBounds.x0 * width))
  const xRight = Math.min(width - 1, Math.ceil(contentBounds.x1 * width))
  const bandHeight = Math.max(1, y1 - y0 + 1)
  const colCount = Math.max(1, xRight - xLeft + 1)
  const colDensity = new Float32Array(colCount)

  for (let x = xLeft; x <= xRight; x += 1) {
    let dark = 0
    for (let y = y0; y <= y1; y += 1) {
      const index = (y * width + x) * 4
      if (isDark(data, index, 200)) {
        dark += 1
      }
    }
    colDensity[x - xLeft] = dark / bandHeight
  }

  const smoothed = smoothFloatArray(colDensity, 2)
  const rowDensity = computeRowDensityInContent(imageData, contentBounds)
  let staffPeak = 0
  for (let y = y0; y <= y1; y += 1) {
    staffPeak = Math.max(staffPeak, rowDensity[y] ?? 0)
  }
  const threshold = Math.max(0.12, staffPeak * 0.45)
  const minGapPx = Math.max(8, Math.floor(width * 0.018))

  const peaks = []
  for (let index = 1; index < smoothed.length - 1; index += 1) {
    const value = smoothed[index]
    if (
      value >= threshold &&
      value >= smoothed[index - 1] &&
      value >= smoothed[index + 1]
    ) {
      const xNorm = (xLeft + index) / width
      const last = peaks[peaks.length - 1]
      if (!last || (xNorm - last) * width >= minGapPx) {
        peaks.push(xNorm)
      }
    }
  }

  const margin = contentBounds.x0 + 0.04
  const maxX = contentBounds.x1 - 0.04
  return peaks.filter((x) => x >= margin && x <= maxX)
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
