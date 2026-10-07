import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  clearStats,
  loadStats,
  loadStatsWithStatus,
} from '../features/profile/profileStorage.js'
import {
  beginSession,
  endSession,
} from '../features/profile/practiceStats.js'
import { trySaveManualSession } from '../features/profile/manualPracticeLog.js'
import { recordWfyPracticeEvent } from '../features/profile/autoPracticeTracker.js'
import { useInstrument } from './instrumentContext.js'

const ProfileStatsContext = createContext(null)

export function ProfileStatsProvider({ children }) {
  const { instrumentId } = useInstrument()
  const [statsState, setStatsState] = useState(() => loadStatsWithStatus())

  const stats = statsState.stats
  const statsStatus = statsState.status
  const statsCorrupted = Boolean(statsState.corrupted)
  const statsRecovered = Boolean(statsState.recoveredFromBackup)

  const beginPracticeSession = useCallback((piece) => beginSession(piece), [])

  const endPracticeSession = useCallback((durationSeconds) => {
    const nextStats = endSession(durationSeconds)
    setStatsState(loadStatsWithStatus())
    return nextStats
  }, [])

  const resetAllStats = useCallback(() => {
    clearStats()
    const next = loadStatsWithStatus()
    setStatsState(next)
    return next.stats
  }, [])

  const saveManualPracticeSession = useCallback(
    (sessionDetails) => {
      // Manual log entries record the app-wide selected instrument unless the
      // caller explicitly names one. Truthful: no success confirmation before
      // a durable commit; failures preserve pending work for retry.
      const result = trySaveManualSession({ instrumentId, ...sessionDetails })
      setStatsState(loadStatsWithStatus())
      return result
    },
    [instrumentId],
  )

  const refreshStats = useCallback(() => {
    const next = loadStatsWithStatus()
    setStatsState(next)
    return next.stats
  }, [])

  const recordWfyEvent = useCallback((type) => {
    recordWfyPracticeEvent(type)
  }, [])

  const value = useMemo(
    () => ({
      stats,
      statsStatus,
      statsCorrupted,
      statsRecovered,
      beginPracticeSession,
      endPracticeSession,
      saveManualPracticeSession,
      resetAllStats,
      refreshStats,
      recordWfyEvent,
    }),
    [
      stats,
      statsStatus,
      statsCorrupted,
      statsRecovered,
      beginPracticeSession,
      endPracticeSession,
      saveManualPracticeSession,
      resetAllStats,
      refreshStats,
      recordWfyEvent,
    ],
  )

  return (
    <ProfileStatsContext.Provider value={value}>
      {children}
    </ProfileStatsContext.Provider>
  )
}

export function useProfileStats() {
  const value = useContext(ProfileStatsContext)
  if (!value) {
    throw new Error('useProfileStats must be used within ProfileStatsProvider')
  }
  return value
}

// Kept for tests that import loadStats directly.
export { loadStats }
