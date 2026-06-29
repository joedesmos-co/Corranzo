export const AUTO_SETUP_SCAN_TIMEOUT_MS = 120_000
export const OMR_AUTO_SETUP_TIMEOUT_MS = 12_000

/**
 * True when restored or applied anchors are enough to follow without scanning.
 */
export function hasUsableScoreFollowAnchors({
  anchorCounts = {},
  anchorTrust = {},
  autoSetupAttempted = false,
} = {}) {
  if ((anchorCounts.manual ?? 0) > 0) {
    return true
  }
  if ((anchorCounts.demo ?? 0) > 0) {
    return true
  }
  if (anchorTrust.showCursor) {
    return true
  }
  if (autoSetupAttempted && (anchorCounts.auto ?? 0) >= 2) {
    return true
  }
  return false
}

/**
 * Skip automatic PDF analysis when anchors are already usable (unless forced).
 */
export function shouldSkipAutoSetupScan({
  force = false,
  anchorCounts = {},
  anchorTrust = {},
  autoSetupAttempted = false,
} = {}) {
  if (force) {
    return false
  }
  return hasUsableScoreFollowAnchors({
    anchorCounts,
    anchorTrust,
    autoSetupAttempted,
  })
}

/**
 * Scanning UI should not cover a score that already has trusted anchors.
 */
export function shouldClearStaleScanningUi({
  setupPhase,
  semiAutoStatus,
  hasUsableAnchors,
} = {}) {
  if (!hasUsableAnchors) {
    return false
  }
  return setupPhase === 'running' || semiAutoStatus === 'analyzing'
}

export function idleSemiAutoSetupState() {
  return {
    status: 'idle',
    progress: 0,
    message: '',
    error: null,
    preview: null,
  }
}
