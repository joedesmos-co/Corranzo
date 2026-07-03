import { describeOmrImageBuffer } from './omrPixelBuffer.js'
import { getOmrDiagnosticFlags } from './omrDiagnosticFlags.js'

export function isOmrDebugEnabled() {
  return getOmrDiagnosticFlags().debug
}

export function omrDebugStep(label, imageData = null, extra = null) {
  if (!isOmrDebugEnabled()) {
    return
  }
  const prefix = '[omr-debug]'
  if (imageData) {
    console.debug(`${prefix} ${label}`, describeOmrImageBuffer(imageData, label), extra ?? '')
    return
  }
  if (extra != null) {
    console.debug(`${prefix} ${label}`, extra)
    return
  }
  console.debug(`${prefix} ${label}`)
}
