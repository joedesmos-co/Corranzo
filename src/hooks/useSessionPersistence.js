import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildSessionMeta,
  clearSessionStorage,
  loadSessionFiles,
  loadSessionMeta,
  saveSessionFiles,
  saveSessionMeta,
  validateRestoredInstrumentBundles,
  validateRestoredSession,
} from '../features/session/sessionPersistence.js'
import { shouldDeferSessionRestore } from '../features/session/sessionRestoreRouting.js'
import { withTimeout } from '../utils/asyncWithTimeout.js'

const SAVE_DEBOUNCE_MS = 1200
const RESTORE_TIMEOUT_MS = 30_000

export const RESTORE_STATUS = {
  IDLE: 'idle',
  RESTORING: 'restoring',
  RESTORED: 'restored',
  PARTIAL: 'partial',
  FAILED: 'failed',
  EXPIRED: 'expired',
  NONE: 'none',
}

function hasSavedSessionMeta() {
  try {
    return Boolean(loadSessionMeta())
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
}) {
  const [restoreStatus, setRestoreStatus] = useState(() => initialRestoreStatus(restoreSuspended))
  const [restoreMessage, setRestoreMessage] = useState(null)
  const restoreAttemptedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const deferredRestoreRef = useRef(
    restoreSuspended || shouldDeferSessionRestore(window.location.pathname),
  )
  const mountedRef = useRef(true)

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

    try {
      const loaded = loadSessionMeta()
      if (!loaded) {
        if (!mountedRef.current) return
        setRestoreStatus(RESTORE_STATUS.NONE)
        return
      }

      if (!mountedRef.current) return
      setRestoreStatus(RESTORE_STATUS.RESTORING)

      if (loaded.expired) {
        if (!mountedRef.current) return
        setRestoreStatus(RESTORE_STATUS.EXPIRED)
        setRestoreMessage('Your saved session was older than a week and was not restored.')
        await clearSessionStorage()
        return
      }

      const files = await withTimeout(
        loadSessionFiles(),
        RESTORE_TIMEOUT_MS,
        'Restoring files timed out. Skip restore or clear the saved session.',
      )
      if (!mountedRef.current) return
      const result = validateRestoredSession(loaded.meta, files)
      const instrumentBundles = validateRestoredInstrumentBundles(loaded.meta, files)
      const bundleOnlyRestore = !result.ok || !result.pdfMeta
      const fallbackBundleEntry = bundleOnlyRestore
        ? Object.entries(instrumentBundles)[0] ?? null
        : null

      if (bundleOnlyRestore && !fallbackBundleEntry) {
        if (!mountedRef.current) return
        setRestoreStatus(RESTORE_STATUS.FAILED)
        setRestoreMessage(
          'Could not restore your last session — upload your files again, or clear the saved session below.',
        )
        return
      }

      const [fallbackInstrumentId, fallbackBundle] = fallbackBundleEntry ?? []
      await withTimeout(
        onRestore(
          bundleOnlyRestore
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
                activeView: loaded.meta.activeView ?? 'library',
                pageNumber: loaded.meta.pageNumber ?? 1,
                practicePrefs: loaded.meta.practicePrefs ?? null,
                instrumentId: loaded.meta.instrumentId ?? null,
                instrumentBundles,
                issues: result.issues ?? [],
              },
        ),
        RESTORE_TIMEOUT_MS,
        'Restoring files timed out. Skip restore or clear the saved session.',
      )
      if (!mountedRef.current) return

      if (result.partial) {
        setRestoreStatus(RESTORE_STATUS.PARTIAL)
        setRestoreMessage(
          result.issues?.includes('stale-omr-session')
            ? 'Restored your PDF, but experimental playback was invalid — regenerate from PDF in Library.'
            : 'Restored your score with some files missing — re-upload anything that looks wrong.',
        )
      } else {
        setRestoreStatus(RESTORE_STATUS.RESTORED)
        setRestoreMessage('Restored your last practice session.')
      }
    } catch (error) {
      if (!mountedRef.current) return
      setRestoreStatus(RESTORE_STATUS.FAILED)
      setRestoreMessage(
        error instanceof Error
          ? error.message
          : 'Could not restore your last session — you can upload fresh files anytime.',
      )
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

  const scheduleSave = useCallback(() => {
    if (!restoreGateOpen) {
      return
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(async () => {
      if (!pdfMeta?.fileName || !pdfBuffer) {
        return
      }

      const meta = buildSessionMeta({
        pdfMeta,
        midiSource,
        musicXmlSource,
        activeView,
        pageNumber,
        practicePrefs: practicePrefsRef?.current ?? null,
        instrumentId,
        instrumentBundles: getInstrumentSessionBundles?.() ?? null,
      })

      saveSessionMeta(meta)

      try {
        await saveSessionFiles({
          pdf: { data: pdfBuffer.slice(0) },
          midi: midiSource?.data ? { data: midiSource.data.slice(0) } : null,
          musicXml: musicXmlSource?.data ? { data: musicXmlSource.data.slice(0) } : null,
          instrumentFiles: Object.fromEntries(
            Object.entries(getInstrumentSessionBundles?.() ?? {}).map(([bundleInstrumentId, bundle]) => [
              bundleInstrumentId,
              {
                pdf: bundle.pdfBuffer ? { data: bundle.pdfBuffer.slice(0) } : null,
                midi: bundle.midiSource?.data ? { data: bundle.midiSource.data.slice(0) } : null,
                musicXml: bundle.musicXmlSource?.data
                  ? { data: bundle.musicXmlSource.data.slice(0) }
                  : null,
              },
            ]),
          ),
        })
      } catch {
        // Private browsing / quota — metadata still helps user know what they had
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
    await clearSessionStorage()
    restoreAttemptedRef.current = false
    setRestoreStatus(RESTORE_STATUS.NONE)
    setRestoreMessage(null)
  }, [])

  const skipRestore = useCallback(() => {
    restoreAttemptedRef.current = true
    setRestoreStatus(RESTORE_STATUS.FAILED)
    setRestoreMessage(
      'Skipped restore. Upload your files, or clear the saved session below.',
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
  }
}
