const STORAGE_PREFIX = 'scoreflow-annotations-'
const WORKSPACE_KEY = 'scoreflow-workspace'

export function getFileFingerprint(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

export function getAnnotationStorageKey(fingerprint) {
  return `${STORAGE_PREFIX}${fingerprint}`
}

export function loadWorkspacePreferences() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveWorkspacePreferences(preferences) {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(preferences))
  } catch {
    // Ignore quota errors
  }
}

export function loadAnnotations(fingerprint) {
  try {
    const raw = localStorage.getItem(getAnnotationStorageKey(fingerprint))
    if (!raw) {
      return null
    }
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveAnnotations(fingerprint, payload) {
  try {
    localStorage.setItem(
      getAnnotationStorageKey(fingerprint),
      JSON.stringify({ ...payload, updatedAt: Date.now() }),
    )
  } catch {
    // Ignore quota errors
  }
}

export function serializeAnnotationsExport(fileName, strokesByPage, toolSettings) {
  return {
    version: 1,
    fileName,
    strokesByPage,
    toolSettings,
    exportedAt: new Date().toISOString(),
  }
}

export function parseAnnotationsImport(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json
  if (!data || typeof data !== 'object' || !data.strokesByPage) {
    throw new Error('Invalid annotation file format.')
  }
  return {
    strokesByPage: data.strokesByPage,
    toolSettings: data.toolSettings ?? null,
  }
}
