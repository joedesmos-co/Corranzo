import { compositeLuminance } from './omrInk.js'
import { copyOmrPixels, copyPixelView } from './omrPixelBuffer.js'
import { omrDebugStep } from './omrDebug.js'

function cloneImageData(imageData) {
  return copyOmrPixels(imageData, 'preprocess:clone')
}

function setRgb(data, index, value) {
  const bounded = Math.max(0, Math.min(255, Math.round(value)))
  data[index] = bounded
  data[index + 1] = bounded
  data[index + 2] = bounded
  data[index + 3] = 255
}

function percentileFromHistogram(histogram, total, percentile, maxValue = 255) {
  const target = Math.max(1, total * percentile)
  let seen = 0
  for (let value = 0; value <= maxValue; value += 1) {
    seen += histogram[value]
    if (seen >= target) return value
  }
  return maxValue
}

function sampledPageStatistics(imageData, stride = 4) {
  const { data, width, height } = imageData
  const histogram = new Uint32Array(256)
  let edgeVariance = 0
  let midtoneCount = 0
  let samples = 0
  let inkSamples = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 1; y < height - stride; y += stride) {
    for (let x = 1; x < width - stride; x += stride) {
      const index = (y * width + x) * 4
      const lum = Math.max(0, Math.min(255, Math.round(compositeLuminance(data, index))))
      histogram[lum] += 1
      if (lum >= 32 && lum < 247) midtoneCount += 1
      if (lum < 235) {
        inkSamples += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      const right = compositeLuminance(data, index + stride * 4)
      const down = compositeLuminance(data, index + width * stride * 4)
      edgeVariance += Math.abs(lum - right) + Math.abs(lum - down)
      samples += 1
    }
  }

  const foregroundSampleCount = histogram.slice(0, 245).reduce((sum, count) => sum + count, 0)
  const foregroundLuminance = foregroundSampleCount
    ? percentileFromHistogram(histogram, foregroundSampleCount, 0.2, 244)
    : 255
  const backgroundLuminance = percentileFromHistogram(histogram, samples, 0.5)
  const robustContrastSpread = Math.max(0, backgroundLuminance - foregroundLuminance)
  const hasContent = maxX >= minX && maxY >= minY
  return {
    histogram,
    samples,
    foregroundLuminance,
    backgroundLuminance,
    robustContrastSpread,
    midtoneRatio: samples ? midtoneCount / samples : 0,
    inkRatio: samples ? inkSamples / samples : 0,
    noiseLevel: samples ? edgeVariance / samples : 0,
    contentBounds: hasContent
      ? {
          x: minX / width,
          y: minY / height,
          width: (maxX - minX + stride) / width,
          height: (maxY - minY + stride) / height,
          space: 'normalized',
        }
      : null,
  }
}

/**
 * Estimate whether a page looks scanned (noisy, low contrast) vs clean digital.
 *
 * Dense digital engraving produces high edge-variance ("noiseLevel") from
 * legitimate staff/note antialiasing. That signal alone must not classify a
 * sharp white-background page as a scan — despeckle on those pages erases
 * thin staff peaks and silently breaks TAB line ownership.
 */
export function estimatePageScanQuality(imageData) {
  const { histogram, ...statistics } = sampledPageStatistics(imageData)
  const minLum = histogram.findIndex((count) => count > 0)
  let maxLum = 255
  while (maxLum > 0 && histogram[maxLum] === 0) maxLum -= 1
  const contrastSpread = Math.max(0, maxLum - Math.max(0, minLum))
  const backgroundTexture =
    statistics.backgroundLuminance < 255 && statistics.midtoneRatio > 0.035
  const hasMusicalContent = statistics.inkRatio >= 0.001 && statistics.contentBounds !== null
  const looksLikeCleanDigital =
    contrastSpread >= 220 &&
    statistics.backgroundLuminance >= 250 &&
    statistics.robustContrastSpread >= 180 &&
    !backgroundTexture
  const isLikelyScanned =
    hasMusicalContent &&
    !looksLikeCleanDigital &&
    (contrastSpread < 175 || statistics.noiseLevel > 22 || backgroundTexture)

  return {
    isLikelyScanned,
    backgroundTexture,
    contrastSpread,
    looksLikeCleanDigital,
    ...statistics,
    confidence: isLikelyScanned ? (backgroundTexture ? 0.8 : 0.72) : 0.7,
  }
}

/**
 * Lift only the paper-tone range on a high-contrast scan. Dark notation stays
 * untouched; the transition avoids a hard threshold around antialiased ink.
 */
export function normalizeScanBackground(imageData) {
  const { data } = imageData
  for (let index = 0; index < data.length; index += 4) {
    const lum = compositeLuminance(data, index)
    if (lum < 220) continue
    const strength = Math.min(1, Math.max(0, (lum - 220) / 30))
    setRgb(data, index, lum + (255 - lum) * strength)
  }
}

export function normalizeImageContrast(imageData, quality = estimatePageScanQuality(imageData)) {
  const { data } = imageData
  const sourceMin = Math.max(0, Math.min(220, quality.foregroundLuminance ?? 0))
  const sourceMax = Math.max(sourceMin + 1, quality.backgroundLuminance ?? 255)
  const span = sourceMax - sourceMin
  const targetMin = 0
  const targetMax = 252

  for (let i = 0; i < data.length; i += 4) {
    const lum = compositeLuminance(data, i)
    const stretched = targetMin + ((lum - sourceMin) / span) * (targetMax - targetMin)
    setRgb(data, i, stretched)
  }
}

/** Remove only isolated dark specks; connected notation and staff ink is untouched. */
export function denoiseImageData(imageData) {
  const { width, height, data } = imageData
  const copy = copyPixelView(data, 'preprocess:denoise-copy')
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const center = compositeLuminance(copy, index)
      if (center >= 165) continue
      let connected = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const neighborIndex = ((y + dy) * width + (x + dx)) * 4
          if (compositeLuminance(copy, neighborIndex) < 205) connected += 1
        }
      }
      if (connected <= 1) {
        const surrounding = [
          compositeLuminance(copy, ((y - 1) * width + x) * 4),
          compositeLuminance(copy, ((y + 1) * width + x) * 4),
          compositeLuminance(copy, (y * width + x - 1) * 4),
          compositeLuminance(copy, (y * width + x + 1) * 4),
        ]
        setRgb(data, index, Math.max(235, surrounding.reduce((sum, value) => sum + value, 0) / 4))
      }
    }
  }
}

/**
 * Boost thin horizontal ink runs — helps faint staff lines on scans.
 */
export function recoverStaffLineInk(imageData) {
  const { width, height, data } = imageData
  const copy = copyPixelView(data, 'preprocess:staff-recovery-copy')
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      let run = 0
      for (let dx = -2; dx <= 2; dx += 1) {
        const index = (y * width + (x + dx)) * 4
        if (compositeLuminance(copy, index) < 185) {
          run += 1
        }
      }
      const verticalNeighbors =
        compositeLuminance(copy, ((y - 1) * width + x) * 4) +
        compositeLuminance(copy, ((y + 1) * width + x) * 4)
      if (run >= 4 && verticalNeighbors > 300) {
        const index = (y * width + x) * 4
        const lum = compositeLuminance(copy, index)
        if (lum > 150 && lum < 230) {
          setRgb(data, index, Math.max(0, lum - 35))
        }
      }
    }
  }
}

export function estimateDeskewAngle(imageData) {
  const { width, height, data } = imageData
  let bestAngle = 0
  let bestScore = -Infinity
  let zeroScore = 0
  const centerX = (width - 1) / 2
  const inkPoints = []
  for (let y = Math.floor(height * 0.1); y < Math.floor(height * 0.9); y += 1) {
    for (let x = 1; x < width - 1; x += 3) {
      const index = (y * width + x) * 4
      if (compositeLuminance(data, index) < 190) inkPoints.push([x, y])
    }
  }
  for (let angleQuarters = -6; angleQuarters <= 6; angleQuarters += 1) {
    const angle = angleQuarters / 4
    const slope = Math.tan((angle * Math.PI) / 180)
    const rows = new Uint32Array(height)
    for (const [x, y] of inkPoints) {
      const projectedY = Math.round(y - (x - centerX) * slope)
      if (projectedY >= 0 && projectedY < height) rows[projectedY] += 1
    }
    let score = 0
    for (const rowInk of rows) {
      if (rowInk >= width / 45) score += rowInk * rowInk
    }
    if (angle === 0) zeroScore = score
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }
  const improvement = zeroScore > 0 ? (bestScore - zeroScore) / zeroScore : 0
  // The search grid resolves quarter-degree steps. Rejecting every estimate
  // below 0.5 degrees discarded a strongly supported 0.25-degree correction,
  // even though that amount moves staff geometry by several pixels across a
  // full-width page and is enough to change written pitch. The improvement
  // gate still prevents deskewing clean pages on weak/noisy evidence.
  const accepted = Math.abs(bestAngle) >= 0.25 && improvement >= 0.025
  return {
    angle: accepted ? bestAngle : 0,
    confidence: accepted ? Math.min(0.95, 0.6 + improvement) : 0,
    improvement,
  }
}

export function deskewImageData(imageData, angleDegrees = 0) {
  if (!angleDegrees) {
    return imageData
  }
  const { width, height, data } = imageData
  const out = new Uint8ClampedArray(data.length)
  out.fill(255)
  const centerX = (width - 1) / 2
  const slope = Math.tan((angleDegrees * Math.PI) / 180)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceY = Math.round(y + (x - centerX) * slope)
      if (sourceY < 0 || sourceY >= height) {
        continue
      }
      const sourceIndex = (sourceY * width + x) * 4
      const targetIndex = (y * width + x) * 4
      out[targetIndex] = data[sourceIndex]
      out[targetIndex + 1] = data[sourceIndex + 1]
      out[targetIndex + 2] = data[sourceIndex + 2]
      out[targetIndex + 3] = 255
    }
  }
  imageData.data.set(out)
  return imageData
}

/**
 * Local-only page cleanup before OMR (contrast, denoise, staff recovery, mild deskew).
 */
export function preprocessOmrPageImage(imageData, options = {}) {
  const { force = false } = options
  omrDebugStep('preprocess:input', imageData)
  const quality = estimatePageScanQuality(imageData)
  const shouldPreprocess = force || quality.isLikelyScanned
  if (!shouldPreprocess) {
    omrDebugStep('preprocess:skipped-zero-copy', imageData)
    return { imageData, quality, applied: [] }
  }

  const processed = cloneImageData(imageData)
  const applied = []

  const needsContrast =
    quality.contrastSpread < 175 || quality.backgroundLuminance < 235 || quality.backgroundTexture
  if (needsContrast) {
    normalizeImageContrast(processed, quality)
    applied.push('contrast')
  }
  if (
    quality.backgroundTexture &&
    quality.robustContrastSpread >= 150 &&
    quality.foregroundLuminance < 100
  ) {
    normalizeScanBackground(processed)
    applied.push('background-cleanup')
  }
  // Edge variance on clean digital pages tracks dense ink, not speck noise.
  // Only despeckle when contrast/paper cues also look scan-degraded; otherwise
  // isolated-pixel removal collapses near-duplicate TAB staff peaks.
  const scanLikeDegradation =
    quality.contrastSpread < 175 ||
    quality.backgroundTexture ||
    (quality.robustContrastSpread ?? 0) < 150
  if (quality.noiseLevel > 14 && scanLikeDegradation) {
    denoiseImageData(processed)
    applied.push('despeckle')
  }

  const deskew = estimateDeskewAngle(processed)
  const { angle } = deskew
  if (angle) {
    deskewImageData(processed, angle)
    applied.push('deskew')
  }

  if (
    quality.contrastSpread < 175 ||
    quality.backgroundLuminance < 235 ||
    quality.foregroundLuminance > 90
  ) {
    recoverStaffLineInk(processed)
    applied.push('staff-recovery')
  }

  omrDebugStep('preprocess:output', processed, { applied, deskew })
  return { imageData: processed, quality, applied, deskew }
}
