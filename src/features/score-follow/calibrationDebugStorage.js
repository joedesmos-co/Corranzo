const SNAPSHOT_SUFFIX = '::calibration-snapshot'
const ROTATIONS_SUFFIX = '::page-view-rotations'
// Manual rotations are the ONLY persisted rotation layer. Auto rotations are
// always re-derived from a fresh analysis, so a new key here means any legacy
// merged auto+manual maps from earlier builds are ignored (no stale auto turns).
const MANUAL_ROTATIONS_SUFFIX = '::manual-page-rotations'

function snapshotKey(setupKey) {
  return setupKey ? `${setupKey}${SNAPSHOT_SUFFIX}` : null
}

function rotationsKey(setupKey) {
  return setupKey ? `${setupKey}${ROTATIONS_SUFFIX}` : null
}

function manualRotationsKey(setupKey) {
  return setupKey ? `${setupKey}${MANUAL_ROTATIONS_SUFFIX}` : null
}

export function loadCalibrationDebugSnapshot(setupKey) {
  const key = snapshotKey(setupKey)
  if (!key) {
    return null
  }
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) {
      return null
    }
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveCalibrationDebugSnapshot(setupKey, snapshot) {
  const key = snapshotKey(setupKey)
  if (!key) {
    return
  }
  try {
    if (!snapshot) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // ignore quota
  }
}

export function loadPageViewRotations(setupKey) {
  const key = rotationsKey(setupKey)
  if (!key) {
    return {}
  }
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function savePageViewRotations(setupKey, rotations) {
  const key = rotationsKey(setupKey)
  if (!key) {
    return
  }
  try {
    if (!rotations || Object.keys(rotations).length === 0) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, JSON.stringify(rotations))
  } catch {
    // ignore quota
  }
}

/** Load ONLY the user's manual page-rotation overrides (auto turns are never persisted). */
export function loadManualPageRotations(setupKey) {
  const key = manualRotationsKey(setupKey)
  if (!key) {
    return {}
  }
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveManualPageRotations(setupKey, rotations) {
  const key = manualRotationsKey(setupKey)
  if (!key) {
    return
  }
  try {
    if (!rotations || Object.keys(rotations).length === 0) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, JSON.stringify(rotations))
  } catch {
    // ignore quota
  }
}

export function clearCalibrationDebugStorage(setupKey) {
  saveCalibrationDebugSnapshot(setupKey, null)
  savePageViewRotations(setupKey, null)
  saveManualPageRotations(setupKey, null)
}
