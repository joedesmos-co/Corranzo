import {
  rebuildMusicXmlSourceFromSessionMeta,
  validateOmrSourceMeta,
} from '../import/musicXmlSource.js'
import { SUPPORTED_INSTRUMENT_IDS, normalizeInstrumentId } from '../instruments/instruments.js'
import { normalizeOmrSourceVisualMap } from '../omr/omrSourceVisualMap.js'

const DB_NAME = 'scoreflow-session'
const DB_VERSION = 1
const STORE_NAME = 'files'
const META_KEY = 'scoreflow-session-meta-v1'
export const SESSION_META_BACKUP_KEY = 'scoreflow-session-meta-v1:backup'
export const SESSION_META_CORRUPT_KEY = 'scoreflow-session-meta-v1:corrupt'
export const SESSION_META_VERSION = 2
export const SESSION_META_VERSION_V1 = 1
/** Deprecated: user-owned saves no longer expire. Kept for compatibility. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const FILE_KEYS = ['pdf', 'midi', 'musicXml']
const SOURCE_VISUAL_MAP_FILE_KEY = 'sourceVisualMap'

function instrumentFileKey(instrumentId, fileKey) {
  return `instrument:${normalizeInstrumentId(instrumentId)}:${fileKey}`
}

function generationFileKey(commitId, key) {
  return `gen:${commitId}:${key}`
}

function createCommitId() {
  return `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizePersistedSourceVisualMap(value) {
  try {
    return normalizeOmrSourceVisualMap(value)
  } catch {
    return null
  }
}

function stripSourceVisualMapFromOmrMeta(omrMeta) {
  if (!omrMeta || typeof omrMeta !== 'object') {
    return omrMeta ?? null
  }
  const { sourceVisualMap: _sourceVisualMap, ...lightweightMeta } = omrMeta
  return lightweightMeta
}

function stripSourceVisualMapsFromSessionMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return meta
  }
  const instrumentBundles =
    meta.instrumentBundles && typeof meta.instrumentBundles === 'object'
      ? Object.fromEntries(
          Object.entries(meta.instrumentBundles).map(([instrumentId, bundle]) => [
            instrumentId,
            bundle && typeof bundle === 'object'
              ? {
                  ...bundle,
                  omrMeta: stripSourceVisualMapFromOmrMeta(bundle.omrMeta),
                }
              : bundle,
          ]),
        )
      : meta.instrumentBundles
  return {
    ...meta,
    omrMeta: stripSourceVisualMapFromOmrMeta(meta.omrMeta),
    instrumentBundles,
  }
}

function attachPersistedSourceVisualMap(musicXmlSource, value) {
  if (musicXmlSource?.source !== 'omr' || !musicXmlSource.omrMeta) {
    return musicXmlSource
  }
  const sourceVisualMap = normalizePersistedSourceVisualMap(value)
  if (!sourceVisualMap) {
    return musicXmlSource
  }
  return {
    ...musicXmlSource,
    omrMeta: {
      ...musicXmlSource.omrMeta,
      sourceVisualMap,
    },
  }
}

function getLocalStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

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

/**
 * Write a full blob set in ONE IndexedDB transaction so the generation is
 * all-or-nothing. `ops` is an array of { type: 'put'|'delete', key, value }.
 */
function writeBlobOpsAtomic(db, ops) {
  return new Promise((resolve, reject) => {
    let store
    let transaction
    try {
      transaction = db.transaction(STORE_NAME, 'readwrite')
    } catch (error) {
      reject(error)
      return
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save score files.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save score files.'))
    transaction.oncomplete = () => resolve()
    try {
      store = transaction.objectStore(STORE_NAME)
    } catch (error) {
      reject(error)
      return
    }
    try {
      for (const op of ops) {
        if (op.type === 'put') {
          const request = store.put(op.value, op.key)
          request.onerror = () => {
            try {
              transaction.abort()
            } catch {
              // ignore abort errors; onerror will reject
            }
          }
        } else {
          const request = store.delete(op.key)
          request.onerror = () => {
            try {
              transaction.abort()
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // ignore
      }
      reject(error)
    }
  })
}

function isValidSessionMetaStructure(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false
  }
  if (parsed.version !== SESSION_META_VERSION && parsed.version !== SESSION_META_VERSION_V1) {
    return false
  }
  // A manifest with no pdfMeta is a valid "no saved score" marker, not corruption.
  // Only flag structural corruption when pdfMeta exists but is malformed.
  if (parsed.pdfMeta != null && (typeof parsed.pdfMeta !== 'object' || Array.isArray(parsed.pdfMeta))) {
    return false
  }
  if (parsed.pdfMeta && parsed.pdfMeta.fileName != null && typeof parsed.pdfMeta.fileName !== 'string') {
    return false
  }
  return true
}

function tryParseSessionMeta(raw) {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (!isValidSessionMetaStructure(parsed)) {
      return { corrupt: true, parsed: null, raw }
    }
    return { corrupt: false, parsed, raw }
  } catch {
    return { corrupt: true, parsed: null, raw }
  }
}

function quarantineCorruptSessionMeta(raw) {
  const storage = getLocalStorage()
  if (!storage || raw == null) {
    return
  }
  try {
    // Never overwrite a previous quarantine that might hold recoverable bytes
    // unless this is a different payload.
    const existing = storage.getItem(SESSION_META_CORRUPT_KEY)
    if (existing !== raw) {
      storage.setItem(SESSION_META_CORRUPT_KEY, raw)
    }
  } catch {
    // ignore quarantine failures
  }
}

export function loadSessionMeta() {
  const storage = getLocalStorage()
  if (!storage) {
    return null
  }
  try {
    const raw = storage.getItem(META_KEY)
    if (!raw) {
      // Current slot empty: fall back to last-good backup instead of
      // reporting "no scores" when a valid backup exists.
      try {
        const backupRaw = storage.getItem(SESSION_META_BACKUP_KEY)
        const backup = tryParseSessionMeta(backupRaw)
        if (backup && !backup.corrupt && backup.parsed) {
          return { expired: false, meta: backup.parsed, recoveredFromBackup: true, corrupted: false }
        }
      } catch {
        // ignore backup read failures
      }
      return null
    }
    const current = tryParseSessionMeta(raw)
    if (!current.corrupt) {
      // User data never expires: ignore savedAt age entirely.
      return { expired: false, meta: current.parsed, corrupted: false }
    }
    quarantineCorruptSessionMeta(raw)
    try {
      const backupRaw = storage.getItem(SESSION_META_BACKUP_KEY)
      const backup = tryParseSessionMeta(backupRaw)
      if (backup && !backup.corrupt && backup.parsed) {
        return {
          expired: false,
          meta: backup.parsed,
          corrupted: true,
          recoveredFromBackup: true,
        }
      }
    } catch {
      // ignore
    }
    return { expired: false, meta: null, corrupted: true, recoveredFromBackup: false }
  } catch {
    return null
  }
}

/** Detailed loader for explicit corruption/recovery UI. */
export function loadSessionMetaWithStatus() {
  const loaded = loadSessionMeta()
  if (!loaded) {
    return { status: 'none', meta: null, corrupted: false, recoveredFromBackup: false }
  }
  if (loaded.corrupted && !loaded.meta) {
    return {
      status: 'corrupted',
      meta: null,
      corrupted: true,
      recoveredFromBackup: false,
    }
  }
  if (loaded.corrupted || loaded.recoveredFromBackup) {
    return {
      status: 'recovered',
      meta: loaded.meta,
      corrupted: true,
      recoveredFromBackup: Boolean(loaded.recoveredFromBackup),
    }
  }
  if (!loaded.meta?.pdfMeta?.fileName) {
    return { status: 'none', meta: loaded.meta, corrupted: false, recoveredFromBackup: false }
  }
  return { status: 'ok', meta: loaded.meta, corrupted: false, recoveredFromBackup: false }
}

export function saveSessionMeta(meta) {
  const storage = getLocalStorage()
  if (!storage) {
    return false
  }
  try {
    // Preserve last-good before overwriting. Best-effort: quota failure here
    // must not prevent attempting the new commit, and must not destroy backup.
    try {
      const currentRaw = storage.getItem(META_KEY)
      if (currentRaw) {
        const current = tryParseSessionMeta(currentRaw)
        if (!current.corrupt && current.parsed) {
          try {
            storage.setItem(SESSION_META_BACKUP_KEY, currentRaw)
          } catch {
            // ignore backup failures; the atomic setItem below still
            // preserves the current value on throw.
          }
        }
      }
    } catch {
      // ignore backup read failures
    }
    const previousCommitId = (() => {
      try {
        const currentRaw = storage.getItem(META_KEY)
        const current = tryParseSessionMeta(currentRaw)
        return current && !current.corrupt ? current.parsed?.commitId ?? null : null
      } catch {
        return null
      }
    })()
    const commitId =
      meta && typeof meta.commitId === 'string' && meta.commitId ? meta.commitId : createCommitId()
    const lightweight = stripSourceVisualMapsFromSessionMeta(meta)
    storage.setItem(
      META_KEY,
      JSON.stringify({
        version: SESSION_META_VERSION,
        savedAt: Date.now(),
        ...lightweight,
        commitId,
        previousCommitId: previousCommitId ?? lightweight.previousCommitId ?? null,
      }),
    )
    return true
  } catch {
    return false
  }
}

/** Update only preferences for the already-saved score; never rewrite its files. */
export function updateSessionPracticePrefs(practicePrefs, pdfMeta, instrumentId) {
  const saved = loadSessionMeta()
  if (!saved || !saved.meta || !pdfMeta?.fileName || !Number.isFinite(pdfMeta.size)) return false
  const identity = meta => meta ? `${meta.fileName}::${meta.size}::${meta.lastModified ?? ''}` : null
  const meta = saved.meta
  const instrument = normalizeInstrumentId(instrumentId)
  if (normalizeInstrumentId(meta.instrumentId) !== instrument || identity(meta.pdfMeta) !== identity(pdfMeta)) return false
  const bundle = meta.instrumentBundles?.[instrument]
  const instrumentBundles = bundle && identity(bundle.pdfMeta) === identity(pdfMeta)
    ? { ...meta.instrumentBundles, [instrument]: { ...bundle, practicePrefs } }
    : meta.instrumentBundles
  return saveSessionMeta({ ...meta, savedAt: Date.now(), practicePrefs, instrumentBundles })
}

export function clearSessionMeta() {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(META_KEY)
  } catch {
    // ignore
  }
  try {
    storage.removeItem(SESSION_META_BACKUP_KEY)
  } catch {
    // ignore
  }
  try {
    storage.removeItem(SESSION_META_CORRUPT_KEY)
  } catch {
    // ignore
  }
}

function collectBlobOps({ pdf, midi, musicXml, sourceVisualMap = null, instrumentFiles = null }, keyFor) {
  const ops = []
  const normalizedSourceVisualMap = normalizePersistedSourceVisualMap(sourceVisualMap)
  const putOrDelete = (key, data) => {
    if (data) {
      ops.push({ type: 'put', key, value: data })
    } else {
      ops.push({ type: 'delete', key })
    }
  }
  putOrDelete(keyFor('pdf'), pdf?.data ?? null)
  putOrDelete(keyFor('midi'), midi?.data ?? null)
  putOrDelete(keyFor('musicXml'), musicXml?.data ?? null)
  putOrDelete(keyFor(SOURCE_VISUAL_MAP_FILE_KEY), normalizedSourceVisualMap)
  for (const instrumentId of SUPPORTED_INSTRUMENT_IDS) {
    const files = instrumentFiles?.[instrumentId] ?? null
    for (const fileKey of FILE_KEYS) {
      putOrDelete(keyFor(instrumentFileKey(instrumentId, fileKey)), files?.[fileKey]?.data ?? null)
    }
    const instrumentSourceVisualMap = normalizePersistedSourceVisualMap(files?.sourceVisualMap)
    putOrDelete(
      keyFor(instrumentFileKey(instrumentId, SOURCE_VISUAL_MAP_FILE_KEY)),
      instrumentSourceVisualMap,
    )
  }
  return ops
}

function readCurrentCommitIds() {
  try {
    const loaded = loadSessionMeta()
    const meta = loaded?.meta ?? null
    return {
      commitId: typeof meta?.commitId === 'string' ? meta.commitId : null,
      previousCommitId: typeof meta?.previousCommitId === 'string' ? meta.previousCommitId : null,
    }
  } catch {
    return { commitId: null, previousCommitId: null }
  }
}

export async function clearSessionCompanionFiles() {
  const db = await openDatabase()
  try {
    await clearFiles(db)
  } finally {
    db.close()
  }
}

export async function saveSessionFiles({
  pdf,
  midi,
  musicXml,
  sourceVisualMap = null,
  instrumentFiles = null,
  commitId = null,
}) {
  const resolvedCommitId =
    commitId ?? readCurrentCommitIds().commitId ?? null
  const db = await openDatabase()
  try {
    if (resolvedCommitId) {
      const genOps = collectBlobOps(
        { pdf, midi, musicXml, sourceVisualMap, instrumentFiles },
        key => generationFileKey(resolvedCommitId, key),
      )
      // Generation blobs are the durable set: single atomic transaction.
      await writeBlobOpsAtomic(db, genOps)
      // Keep legacy fixed keys in sync for v1 readers/migration until GC.
      // A legacy-sync failure is reported so callers stay truthful; the
      // generation commit itself already succeeded atomically above.
      const legacyOps = collectBlobOps(
        { pdf, midi, musicXml, sourceVisualMap, instrumentFiles },
        key => key,
      )
      await writeBlobOpsAtomic(db, legacyOps)
      // Best-effort GC of the previous generation (never fails the save).
      const previousCommitId = readCurrentCommitIds().previousCommitId
      if (previousCommitId && previousCommitId !== resolvedCommitId) {
        try {
          const gcOps = collectBlobOps(
            { pdf: null, midi: null, musicXml: null, sourceVisualMap: null, instrumentFiles: null },
            key => generationFileKey(previousCommitId, key),
          )
          // collectBlobOps with nulls produces deletes for every key.
          await writeBlobOpsAtomic(db, gcOps)
        } catch {
          // ignore GC failures
        }
      }
    } else {
      // No commit (legacy path / no manifest): single atomic transaction over
      // fixed keys so the blob set is still all-or-nothing.
      const legacyOps = collectBlobOps(
        { pdf, midi, musicXml, sourceVisualMap, instrumentFiles },
        key => key,
      )
      await writeBlobOpsAtomic(db, legacyOps)
    }
  } finally {
    db.close()
  }
}

async function getGenerationOrLegacyFile(db, commitId, key) {
  if (commitId) {
    try {
      const genValue = await getFile(db, generationFileKey(commitId, key))
      if (genValue != null) {
        return genValue
      }
    } catch {
      // fall through to legacy
    }
  }
  return getFile(db, key)
}

export async function loadSessionFiles(options = {}) {
  const commitId = options?.commitId ?? readCurrentCommitIds().commitId ?? null
  const db = await openDatabase()
  try {
    const entries = {}
    for (const key of FILE_KEYS) {
      const buffer = await getGenerationOrLegacyFile(db, commitId, key)
      if (buffer instanceof ArrayBuffer) {
        entries[key] = buffer
      }
    }
    const sourceVisualMap = normalizePersistedSourceVisualMap(
      await getGenerationOrLegacyFile(db, commitId, SOURCE_VISUAL_MAP_FILE_KEY),
    )
    if (sourceVisualMap) {
      entries.sourceVisualMap = sourceVisualMap
    }
    const instrumentFiles = {}
    for (const instrumentId of SUPPORTED_INSTRUMENT_IDS) {
      const files = {}
      for (const key of FILE_KEYS) {
        const buffer = await getGenerationOrLegacyFile(
          db,
          commitId,
          instrumentFileKey(instrumentId, key),
        )
        if (buffer instanceof ArrayBuffer) {
          files[key] = buffer
        }
      }
      const instrumentVisualMap = normalizePersistedSourceVisualMap(
        await getGenerationOrLegacyFile(
          db,
          commitId,
          instrumentFileKey(instrumentId, SOURCE_VISUAL_MAP_FILE_KEY),
        ),
      )
      if (instrumentVisualMap) {
        files.sourceVisualMap = instrumentVisualMap
      }
      if (Object.keys(files).length > 0) {
        instrumentFiles[instrumentId] = files
      }
    }
    if (Object.keys(instrumentFiles).length > 0) {
      entries.instrumentFiles = instrumentFiles
    }
    return entries
  } finally {
    db.close()
  }
}

/** Load blobs for an explicit manifest (used for last-good fallback). */
export async function loadSessionFilesForCommit(commitId) {
  return loadSessionFiles({ commitId })
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
      midiSource = {
        fileName: meta.midiFileName,
        data: files.midi,
        ...(meta.midiOwnerPdfIdentity ? { ownerPdfIdentity: meta.midiOwnerPdfIdentity } : {}),
      }
    }
  }

  if (meta.musicXmlFileName) {
    if (!files.musicXml) {
      issues.push('missing-timing-file')
    } else if (meta.musicXmlSize != null && files.musicXml.byteLength !== meta.musicXmlSize) {
      issues.push('timing-size-mismatch')
    } else {
      musicXmlSource = rebuildMusicXmlSourceFromSessionMeta(
        meta.musicXmlFileName,
        files.musicXml.slice(0),
        meta,
      )
      musicXmlSource = attachPersistedSourceVisualMap(
        musicXmlSource,
        files.sourceVisualMap,
      )
      const omrMetaValidation = validateOmrSourceMeta(musicXmlSource)
      if (!omrMetaValidation.ok) {
        issues.push('stale-omr-session')
        musicXmlSource = null
      }
    }
  }

  // Drop companions that do not belong to the restored PDF identity.
  const pdfIdentity =
    meta.pdfIdentity ??
    (pdfMeta?.fileName
      ? `${pdfMeta.fileName}::${pdfMeta.size ?? ''}::${pdfMeta.lastModified ?? ''}`
      : null)
  if (pdfIdentity) {
    if (musicXmlSource?.data && musicXmlSource.ownerPdfIdentity && musicXmlSource.ownerPdfIdentity !== pdfIdentity) {
      issues.push('musicxml-owner-mismatch')
      musicXmlSource = null
    }
    if (midiSource?.data && midiSource.ownerPdfIdentity && midiSource.ownerPdfIdentity !== pdfIdentity) {
      issues.push('midi-owner-mismatch')
      midiSource = null
    }
    // Legacy sessions without owner stamps: attach ownership to the restored PDF.
    if (musicXmlSource?.data && !musicXmlSource.ownerPdfIdentity) {
      musicXmlSource = { ...musicXmlSource, ownerPdfIdentity: pdfIdentity }
    }
    if (midiSource?.data && !midiSource.ownerPdfIdentity) {
      midiSource = { ...midiSource, ownerPdfIdentity: pdfIdentity }
    }
  }

  const pdfFile = new File([pdfBuffer], pdfMeta.fileName, {
    type: 'application/pdf',
    lastModified: pdfMeta.lastModified ?? Date.now(),
  })

  return {
    ok:
      issues.length === 0 ||
      Boolean(pdfMeta && musicXmlSource) ||
      Boolean(pdfMeta && issues.includes('stale-omr-session')),
    issues,
    pdfFile,
    pdfMeta,
    midiSource,
    musicXmlSource,
    partial: issues.length > 0,
  }
}

export function buildSessionBundleMeta(bundle = {}) {
  return {
    instrumentId: bundle.instrumentId ? normalizeInstrumentId(bundle.instrumentId) : null,
    pdfMeta: bundle.pdfMeta ?? null,
    midiFileName: bundle.midiSource?.fileName ?? null,
    midiSize: bundle.midiSource?.data?.byteLength ?? null,
    midiOwnerPdfIdentity: bundle.midiSource?.ownerPdfIdentity ?? null,
    musicXmlFileName: bundle.musicXmlSource?.fileName ?? null,
    musicXmlSize: bundle.musicXmlSource?.data?.byteLength ?? null,
    musicXmlSourceKind: bundle.musicXmlSource?.source ?? null,
    musicXmlOwnerPdfIdentity: bundle.musicXmlSource?.ownerPdfIdentity ?? null,
    omrMeta: stripSourceVisualMapFromOmrMeta(bundle.musicXmlSource?.omrMeta),
    pageNumber: bundle.pageNumber ?? 1,
    practicePrefs: bundle.practicePrefs ?? null,
    pdfSoftWarning: bundle.pdfSoftWarning ?? null,
    demoPieceActive: Boolean(bundle.demoPieceActive),
  }
}

function buildInstrumentBundlesMeta(instrumentBundles) {
  if (!instrumentBundles || typeof instrumentBundles !== 'object') {
    return null
  }
  const entries = Object.entries(instrumentBundles)
    .map(([instrumentId, bundle]) => [
      normalizeInstrumentId(instrumentId),
      buildSessionBundleMeta(bundle),
    ])
    .filter(([, bundleMeta]) => Boolean(bundleMeta.pdfMeta?.fileName))
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function validateRestoredInstrumentBundles(meta, files) {
  const bundleMetaByInstrument = meta?.instrumentBundles
  if (!bundleMetaByInstrument || typeof bundleMetaByInstrument !== 'object') {
    return {}
  }

  const restored = {}
  for (const instrumentId of SUPPORTED_INSTRUMENT_IDS) {
    const bundleMeta = bundleMetaByInstrument[instrumentId]
    if (!bundleMeta?.pdfMeta?.fileName) {
      continue
    }
    const result = validateRestoredSession(
      {
        ...bundleMeta,
        activeView: meta.activeView ?? 'library',
        instrumentId,
      },
      files.instrumentFiles?.[instrumentId] ?? {},
    )
    if (!result.ok || !result.pdfMeta) {
      continue
    }
    restored[instrumentId] = {
      instrumentId,
      pdfFile: result.pdfFile,
      pdfMeta: result.pdfMeta,
      midiSource: result.midiSource,
      musicXmlSource: result.musicXmlSource,
      pageNumber: bundleMeta.pageNumber ?? 1,
      practicePrefs: bundleMeta.practicePrefs ?? null,
      pdfSoftWarning: bundleMeta.pdfSoftWarning ?? null,
      demoPieceActive: Boolean(bundleMeta.demoPieceActive),
      issues: result.issues ?? [],
    }
  }
  return restored
}

export function buildSessionMeta({
  pdfMeta,
  midiSource,
  musicXmlSource,
  activeView,
  pageNumber,
  practicePrefs,
  instrumentId = null,
  instrumentBundles = null,
  scoreId = null,
  commitId = null,
  previousCommitId = null,
}) {
  return {
    scoreId: scoreId ?? musicXmlSource?.ownerScoreId ?? null,
    pdfMeta,
    pdfIdentity: pdfMeta
      ? `${pdfMeta.fileName ?? ''}::${pdfMeta.size ?? ''}::${pdfMeta.lastModified ?? ''}`
      : null,
    midiFileName: midiSource?.fileName ?? null,
    midiSize: midiSource?.data?.byteLength ?? null,
    midiOwnerPdfIdentity: midiSource?.ownerPdfIdentity ?? null,
    midiOwnerScoreId: midiSource?.ownerScoreId ?? null,
    musicXmlFileName: musicXmlSource?.fileName ?? null,
    musicXmlSize: musicXmlSource?.data?.byteLength ?? null,
    musicXmlSourceKind: musicXmlSource?.source ?? null,
    musicXmlOwnerPdfIdentity: musicXmlSource?.ownerPdfIdentity ?? null,
    musicXmlOwnerScoreId: musicXmlSource?.ownerScoreId ?? null,
    omrMeta: stripSourceVisualMapFromOmrMeta(musicXmlSource?.omrMeta),
    activeView,
    pageNumber,
    practicePrefs,
    // Which instrument the session was practiced with (piano when absent —
    // every pre-instrument session was piano).
    instrumentId,
    instrumentBundles: buildInstrumentBundlesMeta(instrumentBundles),
    commitId: commitId ?? createCommitId(),
    previousCommitId: previousCommitId ?? null,
  }
}
