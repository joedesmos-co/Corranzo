import { compositeLuminance } from './omrInk.js'
import { copyOmrPixels, copyPixelView } from './omrPixelBuffer.js'
import { omrDebugStep } from './omrDebug.js'

function cloneImageData(imageData) {
  return copyOmrPixels(imageData, 'preprocess:clone')
}

function setRgb(data, index, value) {
  data[index] = value
  data[index + 1] = value
  data[index + 2] = value
  data[index + 3] = 255
}

/**
 * Estimate whether a page looks scanned (noisy, low contrast) vs clean digital.
 */
export function estimatePageScanQuality(imageData) {
  const { data, width, height } = imageData
  let minLum = 255
  let maxLum = 0
  let edgeVariance = 0
  let samples = 0

  for (let y = 1; y < height - 1; y += 4) {
    for (let x = 1; x < width - 1; x += 4) {
      const index = (y * width + x) * 4
      const lum = compositeLuminance(data, index)
      minLum = Math.min(minLum, lum)
      maxLum = Math.max(maxLum, lum)
      const right = compositeLuminance(data, index + 4)
      const down = compositeLuminance(data, index + width * 4)
      edgeVariance += Math.abs(lum - right) + Math.abs(lum - down)
      samples += 1
    }
  }

  const contrastSpread = maxLum - minLum
  const noiseLevel = samples > 0 ? edgeVariance / samples : 0
  const isLikelyScanned = contrastSpread < 175 || noiseLevel > 22

  return {
    isLikelyScanned,
    contrastSpread,
    noiseLevel,
    confidence: isLikelyScanned ? 0.72 : 0.65,
  }
}

export function normalizeImageContrast(imageData) {
  const { data } = imageData
  let minLum = 255
  let maxLum = 0
  for (let i = 0; i < data.length; i += 4) {
    const lum = compositeLuminance(data, i)
    minLum = Math.min(minLum, lum)
    maxLum = Math.max(maxLum, lum)
  }

  const span = Math.max(1, maxLum - minLum)
  const targetMin = 12
  const targetMax = 245

  for (let i = 0; i < data.length; i += 4) {
    const lum = compositeLuminance(data, i)
    const stretched = targetMin + ((lum - minLum) / span) * (targetMax - targetMin)
    setRgb(data, i, Math.round(stretched))
  }
}

export function denoiseImageData(imageData) {
  const { width, height, data } = imageData
  const copy = copyPixelView(data, 'preprocess:denoise-copy')
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const index = ((y + dy) * width + (x + dx)) * 4
          sum += compositeLuminance(copy, index)
          count += 1
        }
      }
      const index = (y * width + x) * 4
      const center = compositeLuminance(copy, index)
      const blurred = sum / count
      const blended = Math.abs(center - blurred) > 28 ? center : blurred * 0.65 + center * 0.35
      setRgb(data, index, Math.round(blended))
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
  let bestScore = 0
  for (let angleTenths = -15; angleTenths <= 15; angleTenths += 5) {
    const angle = angleTenths / 10
    let score = 0
    for (let y = Math.floor(height * 0.15); y < Math.floor(height * 0.85); y += 6) {
      let rowInk = 0
      for (let x = 0; x < width; x += 2) {
        const shiftedY = Math.round(y + x * Math.tan((angle * Math.PI) / 180) * 0.02)
        if (shiftedY < 0 || shiftedY >= height) {
          continue
        }
        const index = (shiftedY * width + x) * 4
        if (compositeLuminance(data, index) < 185) {
          rowInk += 1
        }
      }
      if (rowInk / Math.max(1, width / 2) > 0.2) {
        score += rowInk
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }
  return { angle: Math.abs(bestAngle) < 0.3 ? 0 : bestAngle, confidence: bestScore > 0 ? 0.6 : 0 }
}

export function deskewImageData(imageData, angleDegrees = 0) {
  if (!angleDegrees) {
    return imageData
  }
  const { width, height, data } = imageData
  const out = new Uint8ClampedArray(data.length)
  out.fill(255)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceY = Math.round(y - x * Math.tan((angleDegrees * Math.PI) / 180) * 0.02)
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
    const owned = copyOmrPixels(imageData, 'preprocess:pass-through')
    omrDebugStep('preprocess:skipped-owned-copy', owned)
    return { imageData: owned, quality, applied: [] }
  }

  const processed = cloneImageData(imageData)
  const applied = []

  normalizeImageContrast(processed)
  applied.push('contrast')
  denoiseImageData(processed)
  applied.push('denoise')

  const { angle } = estimateDeskewAngle(processed)
  if (angle) {
    deskewImageData(processed, angle)
    applied.push('deskew')
  }

  recoverStaffLineInk(processed)
  applied.push('staff-recovery')

  omrDebugStep('preprocess:output', processed, { applied })
  return { imageData: processed, quality, applied }
}
