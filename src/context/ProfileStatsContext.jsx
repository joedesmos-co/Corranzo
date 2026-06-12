import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { computeProfileMetrics } from '../features/profile/computeProfileMetrics.js'
import {
  createSessionDraft,
  normalizeProfile,
  normalizeStatsStore,
} from '../features/profile/profileStatsSchema.js'
import {
  clearAllProfileData,
  finalizeSession,
  loadProfile,
  loadStatsStore,
  saveProfile,
  saveStatsStore,
} from '../features/profile/profileStorage.js'
import { applyDemoProfileSeed } from '../features/profile/seedDemoProfileStats.js'

const ProfileStatsContext = createContext(null)

export function ProfileStatsProvider({ children }) {
  const [profile, setProfile] = useState(() => loadProfile())
  const [store, setStore] = useState(() => loadStatsStore())
  const draftRef = useRef(null)
  const storeRef = useRef(store)

  useEffect(() => {
    storeRef.current = store
  }, [store])

  const metrics = useMemo(() => computeProfileMetrics(store, profile), [store, profile])

  const updateDisplayName = useCallback((name) => {
    const trimmed = String(name ?? '').trim().slice(0, 40)
    setProfile((previous) => {
      const next = normalizeProfile({
        ...previous,
        displayName: trimmed || 'Musician',
        updatedAt: Date.now(),
      })
      saveProfile(next)
      return next
    })
  }, [])

  const endPracticeSession = useCallback(() => {
    const draft = draftRef.current
    if (!draft) {
      return
    }
    draftRef.current = null
    const hasActivity =
      (draft.practiceSecondsActive ?? 0) > 0 ||
      (draft.waitForYouSeconds ?? 0) > 0 ||
      (draft.wfyNotesMatched ?? 0) > 0

    if (!hasActivity) {
      return
    }

    const nextStore = finalizeSession(storeRef.current, draft)
    storeRef.current = nextStore
    setStore(nextStore)
    saveStatsStore(nextStore)
  }, [])

  const beginPracticeSession = useCallback((piece) => {
    if (!piece?.id) {
      return
    }
    if (draftRef.current?.pieceId === piece.id) {
      return
    }
    if (draftRef.current) {
      endPracticeSession()
    }
    draftRef.current = createSessionDraft({
      pieceId: piece.id,
      pieceTitle: piece.title,
      isDemoPiece: piece.isDemoPiece,
    })
  }, [endPracticeSession])

  const patchPracticeDraft = useCallback((patcher) => {
    const draft = draftRef.current
    if (!draft || typeof patcher !== 'function') {
      return
    }
    patcher(draft)
  }, [])

  const recordWfyManualContinue = useCallback(() => {
    patchPracticeDraft((draft) => {
      draft.manualContinues = (draft.manualContinues ?? 0) + 1
    })
  }, [patchPracticeDraft])

  const seedDemoStats = useCallback(() => {
    draftRef.current = null
    const { profile: seededProfile, store: seededStore } = applyDemoProfileSeed()
    setProfile(seededProfile)
    setStore(seededStore)
    storeRef.current = seededStore
  }, [])

  const resetAllStats = useCallback(() => {
    draftRef.current = null
    clearAllProfileData()
    const freshProfile = loadProfile()
    const freshStore = loadStatsStore()
    setProfile(freshProfile)
    setStore(freshStore)
    storeRef.current = freshStore
  }, [])

  useEffect(() => {
    function flushOnPageHide() {
      if (draftRef.current) {
        endPracticeSession()
      }
    }
    window.addEventListener('pagehide', flushOnPageHide)
    return () => window.removeEventListener('pagehide', flushOnPageHide)
  }, [endPracticeSession])

  const value = useMemo(
    () => ({
      profile,
      store,
      metrics,
      updateDisplayName,
      beginPracticeSession,
      endPracticeSession,
      patchPracticeDraft,
      recordWfyManualContinue,
      seedDemoStats,
      resetAllStats,
      hasActiveDraft: () => Boolean(draftRef.current),
    }),
    [
      profile,
      store,
      metrics,
      updateDisplayName,
      beginPracticeSession,
      endPracticeSession,
      patchPracticeDraft,
      recordWfyManualContinue,
      seedDemoStats,
      resetAllStats,
    ],
  )

  return (
    <ProfileStatsContext.Provider value={value}>{children}</ProfileStatsContext.Provider>
  )
}

export function useProfileStats() {
  const value = useContext(ProfileStatsContext)
  if (!value) {
    throw new Error('useProfileStats must be used within ProfileStatsProvider')
  }
  return value
}

export function useProfileStatsOptional() {
  return useContext(ProfileStatsContext)
}
