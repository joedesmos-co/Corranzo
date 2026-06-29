import { isInk } from './omrInk.js'
import {
  FLAT_ORDER_SEMITONES,
  OMR_MUSICAL_CONFIDENCE,
  SHARP_ORDER_SEMITONES,
} from './omrMusicalConstants.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function isSharpGlyph(imageData, cx, cy, threshold) {
  let vertical = 0
  for (let y = cy - 6; y <= cy + 6; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      vertical += 1
    }
  }
  let crosses = 0
  for (const dx of [-3, -2, 2, 3]) {
    for (let y = cy - 3; y <= cy + 3; y += 2) {
      if (inkAt(imageData, cx + dx, y, threshold)) {
        crosses += 1
      }
    }
  }
  return vertical >= 4 && crosses >= 2
}

function isFlatGlyph(imageData, cx, cy, threshold) {
  let vertical = 0
  for (let y = cy - 5; y <= cy + 5; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      vertical += 1
    }
  }
  let loop = 0
  for (let x = cx - 1; x <= cx + 3; x += 1) {
    for (let y = cy; y <= cy + 4; y += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        loop += 1
      }
    }
  }
  return vertical >= 5 && loop >= 4 && loop <= 14
}

/**
 * Detect key signature sharps/flats in the left margin of the first measure.
 */
export function detectKeySignature(imageData, measureBox, staffLines, inkThreshold) {
  const { width, height } = imageData
  const xStart = Math.floor(measureBox.x0 * width) + 4
  const xEnd = xStart + Math.floor((measureBox.x1 - measureBox.x0) * width * 0.22)
  const keyRegionEnd = xStart + Math.floor((xEnd - xStart) * 0.7)
  const lineYs = staffLines.treble
  const candidates = []

  for (const yNorm of lineYs) {
    const cy = Math.round(yNorm * height)
    for (let cx = xStart; cx <= keyRegionEnd; cx += 3) {
      if (isSharpGlyph(imageData, cx, cy, inkThreshold)) {
        candidates.push({ type: 'sharp', yNorm, cx })
      } else if (isFlatGlyph(imageData, cx, cy, inkThreshold)) {
        candidates.push({ type: 'flat', yNorm, cx })
      }
    }
  }

  const unique = []
  for (const item of candidates.sort((a, b) => a.cx - b.cx || a.yNorm - b.yNorm)) {
    if (!unique.some((existing) => Math.abs(existing.cx - item.cx) <= 6)) {
      unique.push(item)
    }
  }

  if (!unique.length) {
    return { fifths: 0, mode: 'major', confidence: 0 }
  }

  const sharps = unique.filter((item) => item.type === 'sharp').length
  const flats = unique.filter((item) => item.type === 'flat').length
  if (sharps && flats) {
    return { fifths: 0, mode: 'major', confidence: 0 }
  }

  const count = sharps || flats
  if (count > 7) {
    return { fifths: 0, mode: 'major', confidence: 0 }
  }

  const fifths = sharps ? count : -count
  const confidence = Math.min(0.95, 0.62 + count * 0.05)
  return { fifths, mode: 'major', confidence, count, order: sharps ? SHARP_ORDER_SEMITONES : FLAT_ORDER_SEMITONES }
}

export function shouldEmitKeySignature(keySignature) {
  return (keySignature?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.KEY && keySignature.fifths !== 0
}
