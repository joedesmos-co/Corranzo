import { isInk, contentPixelBounds } from './omrInk.js'

const REST_WINDOW = 7
const MIN_REST_DARK = 8
const MAX_REST_DARK = 32

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function maxVerticalInkRun(imageData, cx, threshold, top, bottom) {
  const { data, width } = imageData
  let maxRun = 0
  let run = 0
  for (let y = top; y <= bottom; y += 1) {
    const index = (y * width + cx) * 4
    if (isInk(data, index, threshold)) {
      run += 1
      maxRun = Math.max(maxRun, run)
    } else {
      run = 0
    }
  }
  return maxRun
}

function isLikelyStaffLine(imageData, cx, cy, threshold, bounds) {
  const { data, width } = imageData
  let run = 0
  for (let x = bounds.left; x <= bounds.right; x += 1) {
    const index = (cy * width + x) * 4
    if (isInk(data, index, threshold)) {
      run += 1
    }
  }
  return run / Math.max(1, bounds.right - bounds.left + 1) > 0.55
}

/**
 * Detect quarter-rest-like blobs (experimental): compact ink not on a full staff line.
 */
export function detectRestsInMeasure(imageData, measureBox, inkThreshold, noteheadPoints = []) {
  const bounds = contentPixelBounds(imageData, {
    x0: measureBox.x0,
    x1: measureBox.x1,
    y0: measureBox.y0,
    y1: measureBox.y1,
  })
  const { width, height } = imageData
  const measureWidth = bounds.right - bounds.left + 1
  const rests = []
  const step = 4

  for (let cy = bounds.top; cy <= bounds.bottom; cy += step) {
    for (let cx = bounds.left; cx <= bounds.right; cx += step) {
      if (isLikelyStaffLine(imageData, cx, cy, inkThreshold, bounds)) {
        continue
      }
      const nearNote = noteheadPoints.some(
        (point) => Math.abs(point.cx - cx) <= 8 && Math.abs(point.cy - cy) <= 8,
      )
      if (nearNote) {
        continue
      }

      let dark = 0
      const half = Math.floor(REST_WINDOW / 2)
      for (let y = cy - half; y <= cy + half; y += 1) {
        for (let x = cx - half; x <= cx + half; x += 1) {
          if (inkAt(imageData, x, y, inkThreshold)) {
            dark += 1
          }
        }
      }
      if (dark < MIN_REST_DARK || dark > MAX_REST_DARK) {
        continue
      }
      const verticalRun = maxVerticalInkRun(imageData, cx, inkThreshold, bounds.top, bounds.bottom)
      if (verticalRun > 10) {
        continue
      }

      const existing = rests.find(
        (item) => Math.abs(item.cx - cx) <= 8 && Math.abs(item.cy - cy) <= 8,
      )
      if (existing) {
        existing.cx = Math.round((existing.cx + cx) / 2)
        existing.cy = Math.round((existing.cy + cy) / 2)
      } else {
        rests.push({ cx, cy })
      }
    }
  }

  return rests.map((rest) => ({
    type: 'rest',
    durationType: 'quarter',
    durationDivisions: 4,
    confidence: 0.62,
    positionInMeasure: (rest.cx - bounds.left) / Math.max(1, measureWidth),
    cx: rest.cx,
    cy: rest.cy,
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
  }))
}
