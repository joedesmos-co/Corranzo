import { describeOmrImageBuffer } from './omrPixelBuffer.js'

export function isOmrDebugEnabled() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
      return false
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('scoreflow:omr-debug') === '0') {
      return false
    }
  } catch {
    // ignore storage errors
  }
  return typeof import.meta === 'undefined' || import.meta.env?.DEV !== false
}

export function omrDebugStep(label, imageData = null, extra = null) {
  if (!isOmrDebugEnabled()) {
    return
  }
  if (imageData) {
    console.debug(`[omr] ${label}`, describeOmrImageBuffer(imageData, label), extra ?? '')
    return
  }
  if (extra != null) {
    console.debug(`[omr] ${label}`, extra)
    return
  }
  console.debug(`[omr] ${label}`)
}
