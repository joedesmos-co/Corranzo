import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function verticalBarStrength(imageData, x, y0, y1, threshold) {
  const top = Math.floor(y0)
  const bottom = Math.ceil(y1)
  let run = 0
  for (let y = top; y <= bottom; y += 1) {
    if (inkAt(imageData, x, y, threshold)) {
      run += 1
    }
  }
  return run / Math.max(1, bottom - top + 1)
}

function dotNear(imageData, x, y, threshold) {
  let dark = 0
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (inkAt(imageData, x + dx, y + dy, threshold)) {
        dark += 1
      }
    }
  }
  return dark >= 5 && dark <= 16
}

/**
 * Detect obvious repeat barlines at measure edges (local pixels only).
 */
export function detectRepeatBarline(imageData, measureBox, inkThreshold, edge = 'right') {
  const { width, height } = imageData
  const xNorm = edge === 'right' ? measureBox.x1 : measureBox.x0
  const cx = Math.round(xNorm * width)
  const y0 = measureBox.y0 * height
  const y1 = measureBox.y1 * height
  const midY = Math.round((y0 + y1) / 2)

  for (let offset = -8; offset <= 4; offset += 1) {
    const barX = cx + offset
    const barA = verticalBarStrength(imageData, barX, y0, y1, inkThreshold)
    const barB = verticalBarStrength(imageData, barX + 3, y0, y1, inkThreshold)
    if (barA < 0.45 || barB < 0.45) {
      continue
    }
    const dotLeft = dotNear(imageData, barX - 6, midY, inkThreshold)
    const dotRight = dotNear(imageData, barX + 8, midY, inkThreshold)
    if (edge === 'right' && dotLeft) {
      return { backwardRepeat: true, confidence: 0.8 }
    }
    if (edge === 'left' && dotRight) {
      return { forwardRepeat: true, confidence: 0.8 }
    }
  }

  return null
}

export function shouldEmitRepeat(marking) {
  return (marking?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.REPEAT
}

/**
 * Detect a simple first/second ending bracket above the system.
 */
export function detectVoltaEnding(imageData, measureBox, inkThreshold) {
  const { width, height } = imageData
  const left = Math.floor(measureBox.x0 * width)
  const right = Math.ceil(measureBox.x1 * width)
  const top = Math.floor(measureBox.y0 * height) - 12
  let ink = 0
  for (let x = left; x <= right; x += 2) {
    for (let y = top; y <= top + 8; y += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        ink += 1
      }
    }
  }
  const span = Math.max(1, right - left + 1)
  if (ink / span < 0.08 || ink / span > 0.35) {
    return null
  }

  const numberInk = []
  for (let x = left + 4; x <= left + 20; x += 1) {
    if (inkAt(imageData, x, top + 2, inkThreshold)) {
      numberInk.push(x)
    }
  }
  if (numberInk.length < 3) {
    return null
  }

  const endingNumber = numberInk.length >= 8 ? 2 : 1
  return { endingStartNumbers: [endingNumber], confidence: 0.72 }
}

export function shouldEmitEnding(ending) {
  return (ending?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ENDING
}
