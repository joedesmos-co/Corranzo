const STORAGE_PREFIX = 'scoreflow-auto-setup-v1-'

export function buildAutoSetupKey(pdfFingerprint, timingSourceId) {
  if (!pdfFingerprint) {
    return null
  }
  return `${STORAGE_PREFIX}${pdfFingerprint}::${timingSourceId ?? 'timing'}`
}

export function hasAutoSetupBeenAttempted(setupKey) {
  if (!setupKey) {
    return false
  }
  try {
    return sessionStorage.getItem(setupKey) === 'attempted'
  } catch {
    return false
  }
}

/** Session flag: auto setup succeeded and anchors were applied for this PDF+timing. */
export function markAutoSetupAttempted(setupKey) {
  if (!setupKey) {
    return
  }
  try {
    sessionStorage.setItem(setupKey, 'attempted')
  } catch {
    // ignore quota
  }
}

export function clearAutoSetupAttempted(setupKey) {
  if (!setupKey) {
    return
  }
  try {
    sessionStorage.removeItem(setupKey)
  } catch {
    // ignore
  }
}

/** Clear a success flag left by older builds that marked every run, not only successes. */
export function shouldClearStaleAutoSetupFlag({ attempted, autoAnchorCount }) {
  return Boolean(attempted) && (autoAnchorCount ?? 0) < 2
}
