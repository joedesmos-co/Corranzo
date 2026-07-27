import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import {
  detectDynamicNearMeasure,
  detectDynamicsFromTextItems,
  shouldEmitDynamic,
  shouldEmitWedge,
} from './detectOmrDynamics.js'

export {
  detectDynamicNearMeasure,
  detectDynamicsFromTextItems,
  shouldEmitDynamic,
  shouldEmitWedge,
}

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
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

export function shouldEmitArticulation(articulation) {
  return articulation && (articulation.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ARTICULATION
}

export function shouldEmitPedal(pedal) {
  return pedal && (pedal.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.PEDAL
}
