const STORAGE_PREFIX = 'scoreflow-score-follow-v1-'

export function buildPdfFingerprint(meta) {
  if (!meta?.fileName) {
    return null
  }
  if (meta.size != null && meta.lastModified != null) {
    return `${meta.fileName}::${meta.size}::${meta.lastModified}`
  }
  return meta.fileName
}

export function getScoreFollowStorageKey(fingerprint) {
  if (!fingerprint) {
    return null
  }
  return `${STORAGE_PREFIX}${fingerprint}`
}

export function getLegacyScoreFollowStorageKey(fileName) {
  if (!fileName) {
    return null
  }
  return `${STORAGE_PREFIX}${fileName}`
}

function readAnchorsFromKey(key) {
  if (!key) {
    return []
  }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return []
    }
    const data = JSON.parse(raw)
    return Array.isArray(data.anchors) ? data.anchors : []
  } catch {
    return []
  }
}

function writeAnchorsToKey(key, anchors) {
  if (!key) {
    return { ok: false, reason: 'no-key' }
  }
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        anchors,
        updatedAt: Date.now(),
      }),
    )
    return { ok: true }
  } catch {
    return { ok: false, reason: 'quota' }
  }
}

/**
 * Load anchors for a PDF, migrating from legacy fileName-only keys when needed.
 */
export function loadScoreFollowAnchors({ fingerprint, fileName }) {
  const primaryKey = getScoreFollowStorageKey(fingerprint)
  let anchors = readAnchorsFromKey(primaryKey)

  const legacyKey = getLegacyScoreFollowStorageKey(fileName)
  const canMigrateLegacy =
    anchors.length === 0 &&
    legacyKey &&
    primaryKey &&
    legacyKey !== primaryKey

  if (canMigrateLegacy) {
    const legacyAnchors = readAnchorsFromKey(legacyKey)
    if (legacyAnchors.length > 0) {
      anchors = legacyAnchors
      writeAnchorsToKey(primaryKey, anchors)
    }
  }

  return anchors
}

export function saveScoreFollowAnchors(fingerprint, anchors) {
  return writeAnchorsToKey(getScoreFollowStorageKey(fingerprint), anchors)
}

export function createAnchorId() {
  return `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
