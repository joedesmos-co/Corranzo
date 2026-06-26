const SNAPSHOT_SUFFIX = '::calibration-snapshot'
const ROTATIONS_SUFFIX = '::page-view-rotations'

function snapshotKey(setupKey) {
  return setupKey ? `${setupKey}${SNAPSHOT_SUFFIX}` : null
}

function rotationsKey(setupKey) {
  return setupKey ? `${setupKey}${ROTATIONS_SUFFIX}` : null
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

export function clearCalibrationDebugStorage(setupKey) {
  saveCalibrationDebugSnapshot(setupKey, null)
  savePageViewRotations(setupKey, null)
}
