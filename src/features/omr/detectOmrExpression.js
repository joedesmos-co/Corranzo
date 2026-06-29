import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'

const DYNAMIC_MARKS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function matchDynamicFromText(text) {
  const normalized = String(text ?? '').trim().toLowerCase()
  if (!normalized) {
    return null
  }
  for (const mark of DYNAMIC_MARKS) {
    if (normalized === mark) {
      return { mark, confidence: 0.82 }
    }
  }
  if (/^p+$/.test(normalized) && normalized.length <= 3) {
    return { mark: normalized, confidence: 0.74 }
  }
  if (/^f+$/.test(normalized) && normalized.length <= 3) {
    return { mark: normalized, confidence: 0.74 }
  }
  return null
}

export function detectDynamicsFromTextItems(textItems = []) {
  for (const item of textItems) {
    const dynamic = matchDynamicFromText(item.text)
    if (dynamic) {
      return dynamic
    }
  }
  return null
}

/**
 * Very conservative pixel dynamic detection (single-letter glyphs near staff).
 */
export function detectDynamicNearMeasure(imageData, measureBox, inkThreshold) {
  const { width, height } = imageData
  const cx = Math.floor((measureBox.x0 + measureBox.x1) * 0.5 * width)
  const cy = Math.floor(measureBox.y1 * height + 10)
  let dark = 0
  for (let y = cy; y <= cy + 10; y += 1) {
    for (let x = cx - 6; x <= cx + 6; x += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        dark += 1
      }
    }
  }
  if (dark < 8 || dark > 40) {
    return null
  }
  if (dark < 16) {
    return { mark: 'p', confidence: 0.7 }
  }
  if (dark > 28) {
    return { mark: 'f', confidence: 0.7 }
  }
  return { mark: 'mf', confidence: 0.65 }
}

export function detectStaccatoOnNote(imageData, notehead, inkThreshold) {
  const { cx, cy } = notehead
  const above = cy - 8
  const below = cy + 8
  let aboveDark = 0
  let belowDark = 0
  for (let x = cx - 2; x <= cx + 2; x += 1) {
    for (let y = above - 2; y <= above + 2; y += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        aboveDark += 1
      }
    }
    for (let y = below - 2; y <= below + 2; y += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        belowDark += 1
      }
    }
  }
  if (aboveDark >= 3 && aboveDark <= 10) {
    return { type: 'staccato', confidence: 0.7 }
  }
  if (belowDark >= 3 && belowDark <= 10) {
    return { type: 'staccato', confidence: 0.7 }
  }
  return null
}

export function detectPedalFromText(textItems = []) {
  const joined = textItems.map((item) => item.text ?? '').join(' ').toLowerCase()
  if (/\b(ped\.?|pedal)\b/.test(joined)) {
    return { type: 'pedal', confidence: 0.78 }
  }
  return null
}

export function shouldEmitDynamic(dynamic) {
  return dynamic && (dynamic.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.DYNAMIC
}

export function shouldEmitArticulation(articulation) {
  return articulation && (articulation.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ARTICULATION
}

export function shouldEmitPedal(pedal) {
  return pedal && (pedal.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.PEDAL
}
