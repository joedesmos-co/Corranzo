import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SESSION_META_BACKUP_KEY,
  buildSessionMeta,
  clearSessionCompanionFiles,
  clearSessionStorage,
  loadSessionFiles,
  loadSessionFilesForCommit,
  loadSessionMeta,
  saveSessionFiles,
  saveSessionMeta,
  validateRestoredInstrumentBundles,
  validateRestoredSession,
} from '../features/session/sessionPersistence.js'
import { shouldDeferSessionRestore } from '../features/session/sessionRestoreRouting.js'
import { withTimeout } from '../utils/asyncWithTimeout.js'
import {
  describeScoreSourceIdentities,
  logScoreSourceIdentities,
} from '../features/library/scoreSourceReplacement.js'

import { updateSavedSessionView } from '../features/session/sessionViewPersistence.js'

const SAVE_DEBOUNCE_MS = 1200
const RESTORE_TIMEOUT_MS = 30_000

export const RESTORE_STATUS = {
  IDLE: 'idle',
  RESTORING: 'restoring',
  RESTORED: 'restored',
  PARTIAL: 'partial',
  FAILED: 'failed',
  // Deprecated: user saves never expire. Kept so older persisted UI states
  // and the banner tone mapping keep working.
  EXPIRED: 'expired',
  NONE: 'none',
}

export const SAVE_STATUS = {
  IDLE: 'idle',
  SAVING: 'saving',
  SAVED: 'saved',
  FAILED: 'failed',
}

function hasSavedSessionMeta() {
  try {
    const loaded = loadSessionMeta()
    return Boolean(loaded?.meta?.pdfMeta?.fileName || loaded?.meta)
  } catch {
    return false
  }
}

function initialRestoreStatus(restoreSuspended) {
  try {
    if (restoreSuspended || shouldDeferSessionRestore(window.location.pathname)) {
      return RESTORE_STATUS.NONE
    }
    return hasSavedSessionMeta() ? RESTORE_STATUS.RESTORING : RESTORE_STATUS.NONE
  } catch {
    return RESTORE_STATUS.NONE
  }
}

function describeSaveError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/quota/i.test(message)) {
    return 'Your device storage is full, so your score couldn’t be saved. Free up space and try again — your current score is still open.'
  }
  if (/indexeddb|not available/i.test(message)) {
    return 'Storage isn’t available in this browser, so your score couldn’t be saved. Your current score is still open.'
  }
  return 'Your score couldn’t be saved on this device. Keep this tab open and try again — your current score is still open.'
}

export default function useSessionPersistence({
  pdfBuffer,
  pdfMeta,
  midiSource,
  musicXmlSource,
  activeView,
  pageNumber,
  practicePrefsRef = null,
  instrumentId = null,
  getInstrumentSessionBundles = null,
  onRestore,
  restoreSuspended = false,
  sessionSaveGeneration = 0,
  sessionSaveGenerationRef = null,
}) {
  const [restoreStatus, setRestoreStatus] = useState(() => initialRestoreStatus(restoreSuspended))
  const [restoreMessage, setRestoreMessage] = useState(null)
  const [saveStatus, setSaveStatus] = useState(SAVE_STATUS.IDLE)
  const [saveMessage, setSaveMessage] = useState(null)
  const restoreAttemptedRef = useRef(false)
  const restoreControllerRef = useRef(null)
  const saveTimerRef = useRef(null)
  const saveGenerationRef = useRef(sessionSaveGeneration)
  const deferredRestoreRef = useRef(
    restoreSuspended || shouldDeferSessionRestore(window.location.pathname),
  )
  const mountedRef = useRef(true)

  const readSaveGeneration = useCallback(() => {
    if (sessionSaveGenerationRef) {
      return sessionSaveGenerationRef.current
    }
    return saveGenerationRef.current
  }, [sessionSaveGenerationRef])

  useEffect(() => {
    saveGenerationRef.current = sessionSaveGeneration
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [sessionSaveGeneration])

  useEffect(() => {
    // Must re-arm on every effect setup: StrictMode dev runs setup→cleanup→setup
    // on the SAME fiber (refs persist), so a cleanup-only ref stays false and the
    // in-flight restore silently bails after its await — overlay stuck forever.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const isRestoring = restoreStatus === RESTORE_STATUS.RESTORING
  const restoreGateOpen = !isRestoring

  const attemptRestore = useCallback(async () => {
    if (restoreAttemptedRef.current) {
      return
    }
    restoreAttemptedRef.current = true
    const controller = new AbortController()
    restoreControllerRef.current = controller

    try {
      const loaded = loadSessionMeta()
      if (!loaded?.meta?.pdfMeta?.fileName && !loaded?.meta) {
        if (loaded?.corrupted) {
          if (!mountedRef.current || controller.signal.aborted) return
          setRestoreStatus(RESTORE_STATUS.FAILED)
          setRestoreMessage(
            'Your saved data looks damaged, so nothing was opened. Import your PDF again — nothing was deleted.',
          )
          return
        }
        if (!mountedRef.current || controller.signal.aborted) return
        setRestoreStatus(RESTORE_STATUS.NONE)
        return
      }

      if (!mountedRef.current || controller.signal.aborted) return
      setRestoreStatus(RESTORE_STATUS.RESTORING)

      // Never auto-delete on age or corruption. Corrupt-but-recoverable data
      // is never overwritten merely by opening the app.
      const wasRecovered = Boolean(loaded.recoveredFromBackup || loaded.corrupted)

      let files
      try {
        files = await withTimeout(
          loadSessionFiles(),
          RESTORE_TIMEOUT_MS,
          'Opening your saved score took too long. Try reloading or importing your PDF again.',
        )
      } catch (loadError) {
        if (!mountedRef.current || controller.signal.aborted) return
        setRestoreStatus(RESTORE_STATUS.FAILED)
        setRestoreMessage(describeSaveError(loadError))
        return
      }
      if (!mountedRef.current || controller.signal.aborted) return
      let result = validateRestoredSession(loaded.meta, files)
      let instrumentBundles = validateRestoredInstrumentBundles(loaded.meta, files)
      let restoredMeta = loaded.meta
      let usedBackup = false

      const bundleOnlyRestore = !result.ok || !result.pdfMeta
      // Last-known-good fallback: when the current generation fails
      // validation, retry the backup manifest + its generation blobs.
      if (bundleOnlyRestore && Object.keys(instrumentBundles).length === 0) {
        try {
          const backupRaw =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem(SESSION_META_BACKUP_KEY)
              : null
          if (backupRaw) {
            const backupMeta = JSON.parse(backupRaw)
            if (backupMeta?.commitId && backupMeta.commitId !== loaded.meta?.commitId) {
              const backupFiles = await withTimeout(
                loadSessionFilesForCommit(backupMeta.commitId),
                RESTORE_TIMEOUT_MS,
                'Opening your saved score took too long. Try reloading or importing your PDF again.',
              )
              const backupResult = validateRestoredSession(backupMeta, backupFiles)
              const backupBundles = validateRestoredInstrumentBundles(backupMeta, backupFiles)
              if (backupResult.ok && backupResult.pdfMeta) {
                result = backupResult
                instrumentBundles = backupBundles
                restoredMeta = backupMeta
                usedBackup = true
              }
            }
          }
        } catch {
          // ignore backup fallback failures; fall through to FAILED below
        }
      }
      if (!mountedRef.current || controller.signal.aborted) return
      const stillBundleOnly = !result.ok || !result.pdfMeta
      const fallbackBundleEntry = stillBundleOnly
        ? Object.entries(instrumentBundles)[0] ?? null
        : null

      if (stillBundleOnly && !fallbackBundleEntry) {
        if (!mountedRef.current || controller.signal.aborted) return
        setRestoreStatus(RESTORE_STATUS.FAILED)
        setRestoreMessage(
          loaded.corrupted || wasRecovered
            ? 'Your saved data looks damaged, so nothing was opened. Import your PDF again — your previous save was kept where possible.'
            : 'Your saved score couldn’t be opened. Import the PDF again, or clear the saved score below.',
        )
        return
      }

      const [fallbackInstrumentId, fallbackBundle] = fallbackBundleEntry ?? []
      await withTimeout(
        onRestore(
          stillBundleOnly
            ? {
                pdfFile: fallbackBundle.pdfFile,
                pdfMeta: fallbackBundle.pdfMeta,
                midiSource: fallbackBundle.midiSource,
                musicXmlSource: fallbackBundle.musicXmlSource,
                activeView: 'library',
                pageNumber: fallbackBundle.pageNumber ?? 1,
                practicePrefs: fallbackBundle.practicePrefs ?? null,
                instrumentId: fallbackInstrumentId,
                instrumentBundles,
                issues: fallbackBundle.issues ?? [],
              }
            : {
                pdfFile: result.pdfFile,
                pdfMeta: result.pdfMeta,
                midiSource: result.midiSource,
                musicXmlSource: result.musicXmlSource,
                activeView: restoredMeta.activeView ?? 'library',
                pageNumber: restoredMeta.pageNumber ?? 1,
                practicePrefs: restoredMeta.practicePrefs ?? null,
                instrumentId: restoredMeta.instrumentId ?? null,
                instrumentBundles,
                scoreId: restoredMeta.scoreId ?? null,
                issues: result.issues ?? [],
              },
          () => mountedRef.current && !controller.signal.aborted,
        ),
        RESTORE_TIMEOUT_MS,
        'Opening your saved score took too long. Try reloading or importing your PDF again.',
      )
      if (!mountedRef.current || controller.signal.aborted) return

      if (result.partial) {
        setRestoreStatus(RESTORE_STATUS.PARTIAL)
        setRestoreMessage(
          result.issues?.includes('stale-omr-session')
            ? 'Your PDF is saved, but playback needs preparation. Continue from Import.'
            : usedBackup || wasRecovered
              ? 'Your last save needed recovery, but your score is open. Check Import before practicing.'
              : 'Your PDF is saved, but some companion files are missing. Check Import before practicing.',
        )
      } else {
        setRestoreStatus(RESTORE_STATUS.RESTORED)
        setRestoreMessage(
          usedBackup || wasRecovered
            ? 'Your previous save was recovered and is ready.'
            : 'Your score and practice settings are ready.',
        )
      }
    } catch {
      if (!mountedRef.current || controller.signal.aborted) return
      controller.abort()
      setRestoreStatus(RESTORE_STATUS.FAILED)
      setRestoreMessage('Your saved score couldn’t be opened. Try reloading, or import your PDF again.')
    }
  }, [onRestore])

  useEffect(() => {
    if (restoreSuspended) {
      if (hasSavedSessionMeta()) {
        deferredRestoreRef.current = true
      }
      return
    }

    if (deferredRestoreRef.current && hasSavedSessionMeta() && !restoreAttemptedRef.current) {
      deferredRestoreRef.current = false
      setRestoreStatus(RESTORE_STATUS.RESTORING)
    }
  }, [restoreSuspended])

  useEffect(() => {
    if (restoreSuspended) {
      return
    }
    if (restoreStatus === RESTORE_STATUS.RESTORING) {
      attemptRestore()
    }
  }, [attemptRestore, restoreStatus, restoreSuspended])

  useEffect(() => {
    if (restoreGateOpen && !restoreSuspended) updateSavedSessionView(activeView, pdfMeta, instrumentId)
  }, [activeView, pdfMeta, instrumentId, restoreGateOpen, restoreSuspended])

  const scheduleSave = useCallback(() => {
    if (!restoreGateOpen) {
      return
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    const generationAtSchedule = readSaveGeneration()
    saveTimerRef.current = window.setTimeout(async () => {
      if (readSaveGeneration() !== generationAtSchedule) {
        return
      }
      if (!pdfMeta?.fileName || !pdfBuffer) {
        return
      }

      const instrumentBundles = getInstrumentSessionBundles?.() ?? null
      const meta = buildSessionMeta({
        pdfMeta,
        midiSource,
        musicXmlSource,
        activeView,
        pageNumber,
        practicePrefs: practicePrefsRef?.current ?? null,
        instrumentId,
        instrumentBundles,
        scoreId:
          musicXmlSource?.ownerScoreId ??
          (typeof window !== 'undefined'
            ? window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId ?? null
            : null),
      })

      if (readSaveGeneration() !== generationAtSchedule) {
        return
      }
      logScoreSourceIdentities(
        'persistence-save',
        describeScoreSourceIdentities({
          pdfMeta,
          musicXmlSource,
          midiSource,
          practiceSessionEpoch: null,
          bundle: {
            pdfMeta,
            musicXmlSource,
            midiSource,
          },
        }),
      )
      if (mountedRef.current) {
        setSaveStatus(SAVE_STATUS.SAVING)
        setSaveMessage(null)
      }
      if (!saveSessionMeta(meta)) {
        // Do not overwrite fixed IndexedDB file keys when their matching
        // manifest could not be committed; that would corrupt the prior save.
        // Preserve last-good and surface failure truthfully.
        if (mountedRef.current) {
          setSaveStatus(SAVE_STATUS.FAILED)
          setSaveMessage(
            'Your device storage is full, so your score couldn’t be saved. Free up space — your current score is still open and nothing was deleted.',
          )
        }
        return
      }

      try {
        await saveSessionFiles({
          pdf: { data: pdfBuffer.slice(0) },
          midi: midiSource?.data ? { data: midiSource.data.slice(0) } : null,
          musicXml: musicXmlSource?.data ? { data: musicXmlSource.data.slice(0) } : null,
          sourceVisualMap: musicXmlSource?.omrMeta?.sourceVisualMap ?? null,
          instrumentFiles: Object.fromEntries(
            Object.entries(instrumentBundles ?? {}).map(([bundleInstrumentId, bundle]) => [
              bundleInstrumentId,
              {
                pdf: bundle.pdfBuffer ? { data: bundle.pdfBuffer.slice(0) } : null,
                midi: bundle.midiSource?.data ? { data: bundle.midiSource.data.slice(0) } : null,
                musicXml: bundle.musicXmlSource?.data
                  ? { data: bundle.musicXmlSource.data.slice(0) }
                  : null,
                sourceVisualMap: bundle.musicXmlSource?.omrMeta?.sourceVisualMap ?? null,
              },
            ]),
          ),
          commitId: meta.commitId,
        })
        // A superseded save may have finished after a newer PDF replacement and
        // re-put Piece A's MusicXML. Wipe companions when this writer is stale.
        if (readSaveGeneration() !== generationAtSchedule) {
          await clearSessionCompanionFiles()
        }
        if (mountedRef.current) {
          setSaveStatus(SAVE_STATUS.SAVED)
          setSaveMessage(null)
        }
      } catch (error) {
        // Truthful failure: manifest for this generation exists, but its
        // blobs did not commit. Last-good generation + backup manifest remain
        // for recovery; never present silent success.
        if (mountedRef.current) {
          setSaveStatus(SAVE_STATUS.FAILED)
          setSaveMessage(describeSaveError(error))
        }
      }
    }, SAVE_DEBOUNCE_MS)
  }, [
    pdfBuffer,
    pdfMeta,
    midiSource,
    musicXmlSource,
    activeView,
    pageNumber,
    practicePrefsRef,
    instrumentId,
    getInstrumentSessionBundles,
    restoreGateOpen,
    readSaveGeneration,
  ])

  useEffect(() => {
    if (!pdfMeta?.fileName || !restoreGateOpen) {
      return undefined
    }
    scheduleSave()
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [pdfMeta, scheduleSave, restoreGateOpen])

  const clearSavedSession = useCallback(async () => {
    restoreControllerRef.current?.abort()
    await clearSessionStorage()
    restoreAttemptedRef.current = false
    setRestoreStatus(RESTORE_STATUS.NONE)
    setRestoreMessage(null)
    setSaveStatus(SAVE_STATUS.IDLE)
    setSaveMessage(null)
  }, [])

  const skipRestore = useCallback(() => {
    restoreControllerRef.current?.abort()
    restoreAttemptedRef.current = true
    setRestoreStatus(RESTORE_STATUS.FAILED)
    setRestoreMessage(
      'Opening paused. Reload to try your saved score again, or import another PDF.',
    )
  }, [])

  return {
    restoreStatus,
    restoreMessage,
    isRestoring,
    restoreGateOpen,
    clearSavedSession,
    skipRestore,
    dismissRestoreMessage: () => setRestoreMessage(null),
    saveStatus,
    saveMessage,
    dismissSaveMessage: () => {
      setSaveMessage(null)
      setSaveStatus(SAVE_STATUS.IDLE)
    },
  }
}
