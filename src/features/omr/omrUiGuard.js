/**
 * Tracks experimental OMR UI blocking state and guarantees release on success/failure/cancel.
 * Never sets pointer-events on document.body — only a debug-friendly root marker.
 */

let activeGenerations = 0

export function beginOmrUiBlock(label = 'omr') {
  activeGenerations += 1
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.dataset.omrGenerating = label
  document.documentElement.classList.add('omr-generating')
}

export function endOmrUiBlock() {
  activeGenerations = Math.max(0, activeGenerations - 1)
  if (typeof document === 'undefined' || activeGenerations > 0) {
    return
  }
  releaseOmrUiLocks()
}

export function releaseOmrUiLocks() {
  activeGenerations = 0
  if (typeof document === 'undefined') {
    return
  }
  delete document.documentElement.dataset.omrGenerating
  document.documentElement.classList.remove('omr-generating')
  document.body.style.removeProperty('pointer-events')
  document.body.style.removeProperty('overflow')
  document.body.classList.remove('omr-generating')
}

export function isOmrUiBlocked() {
  return activeGenerations > 0
}
