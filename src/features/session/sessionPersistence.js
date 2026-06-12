const DB_NAME = 'scoreflow-session'
const DB_VERSION = 1
const STORE_NAME = 'files'
const META_KEY = 'scoreflow-session-meta-v1'
export const SESSION_META_VERSION = 1
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const FILE_KEYS = ['pdf', 'midi', 'musicXml']

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Could not open session storage.'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

function putFile(db, key, buffer) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    transaction.objectStore(STORE_NAME).put(buffer, key)
  })
}

function getFile(db, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    transaction.onerror = () => reject(transaction.error)
    const request = transaction.objectStore(STORE_NAME).get(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result ?? null)
  })
}

function clearFiles(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    transaction.objectStore(STORE_NAME).clear()
  })
}

export function loadSessionMeta() {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    if (parsed?.version !== SESSION_META_VERSION) {
      return null
    }
    if (Date.now() - (parsed.savedAt ?? 0) > SESSION_MAX_AGE_MS) {
      return { expired: true, meta: parsed }
    }
    return { expired: false, meta: parsed }
  } catch {
    return null
  }
}

export function saveSessionMeta(meta) {
  try {
    localStorage.setItem(
      META_KEY,
      JSON.stringify({
        version: SESSION_META_VERSION,
        savedAt: Date.now(),
        ...meta,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function clearSessionMeta() {
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    // ignore
  }
}

export async function saveSessionFiles({ pdf, midi, musicXml }) {
  const db = await openDatabase()
  try {
    if (pdf?.data) {
      await putFile(db, 'pdf', pdf.data)
    }
    if (midi?.data) {
      await putFile(db, 'midi', midi.data)
    }
    if (musicXml?.data) {
      await putFile(db, 'musicXml', musicXml.data)
    }
  } finally {
    db.close()
  }
}

export async function loadSessionFiles() {
  const db = await openDatabase()
  try {
    const entries = {}
    for (const key of FILE_KEYS) {
      const buffer = await getFile(db, key)
      if (buffer instanceof ArrayBuffer) {
        entries[key] = buffer
      }
    }
    return entries
  } finally {
    db.close()
  }
}

export async function clearSessionStorage() {
  clearSessionMeta()
  try {
    const db = await openDatabase()
    try {
      await clearFiles(db)
    } finally {
      db.close()
    }
  } catch {
    // ignore
  }
}

/**
 * Verify stored blobs match saved metadata before restoring UI state.
 */
export function validateRestoredSession(meta, files) {
  const issues = []

  if (!meta?.pdfMeta?.fileName) {
    issues.push('missing-pdf-meta')
    return { ok: false, issues, pdfMeta: null, midiSource: null, musicXmlSource: null }
  }

  const pdfBuffer = files.pdf
  if (!pdfBuffer) {
    issues.push('missing-pdf-file')
    return { ok: false, issues, pdfMeta: null, midiSource: null, musicXmlSource: null }
  }

  if (meta.pdfMeta.size != null && pdfBuffer.byteLength !== meta.pdfMeta.size) {
    issues.push('pdf-size-mismatch')
  }

  const pdfMeta = { ...meta.pdfMeta }
  let midiSource = null
  let musicXmlSource = null

  if (meta.midiFileName) {
    if (!files.midi) {
      issues.push('missing-midi-file')
    } else if (meta.midiSize != null && files.midi.byteLength !== meta.midiSize) {
      issues.push('midi-size-mismatch')
    } else {
      midiSource = { fileName: meta.midiFileName, data: files.midi }
    }
  }

  if (meta.musicXmlFileName) {
    if (!files.musicXml) {
      issues.push('missing-timing-file')
    } else if (meta.musicXmlSize != null && files.musicXml.byteLength !== meta.musicXmlSize) {
      issues.push('timing-size-mismatch')
    } else {
      musicXmlSource = { fileName: meta.musicXmlFileName, data: files.musicXml }
    }
  }

  const pdfFile = new File([pdfBuffer], pdfMeta.fileName, {
    type: 'application/pdf',
    lastModified: pdfMeta.lastModified ?? Date.now(),
  })

  return {
    ok: issues.length === 0 || (pdfMeta && musicXmlSource),
    issues,
    pdfFile,
    pdfMeta,
    midiSource,
    musicXmlSource,
    partial: issues.length > 0,
  }
}

export function buildSessionMeta({
  pdfMeta,
  midiSource,
  musicXmlSource,
  activeView,
  pageNumber,
  practicePrefs,
}) {
  return {
    pdfMeta,
    midiFileName: midiSource?.fileName ?? null,
    midiSize: midiSource?.data?.byteLength ?? null,
    musicXmlFileName: musicXmlSource?.fileName ?? null,
    musicXmlSize: musicXmlSource?.data?.byteLength ?? null,
    activeView,
    pageNumber,
    practicePrefs,
  }
}
