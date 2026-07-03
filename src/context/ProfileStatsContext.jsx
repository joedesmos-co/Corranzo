import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  clearStats,
  loadStats,
} from '../features/profile/profileStorage.js'
import {
  beginSession,
  endSession,
} from '../features/profile/practiceStats.js'
import { saveManualSession } from '../features/profile/manualPracticeLog.js'
import { recordWfyPracticeEvent } from '../features/profile/autoPracticeTracker.js'
import { useInstrument } from './instrumentContext.js'

const ProfileStatsContext = createContext(null)

export function ProfileStatsProvider({ children }) {
  const { instrumentId } = useInstrument()
  const [stats, setStats] = useState(() => loadStats())

  const beginPracticeSession = useCallback((piece) => beginSession(piece), [])

  const endPracticeSession = useCallback((durationSeconds) => {
    const nextStats = endSession(durationSeconds)
    setStats(nextStats)
    return nextStats
  }, [])

  const resetAllStats = useCallback(() => {
    clearStats()
    const emptyStats = loadStats()
    setStats(emptyStats)
    return emptyStats
  }, [])

  const saveManualPracticeSession = useCallback(
    (sessionDetails) => {
      // Manual log entries record the app-wide selected instrument unless the
      // caller explicitly names one.
      const nextStats = saveManualSession({ instrumentId, ...sessionDetails })
      setStats(nextStats)
      return nextStats
    },
    [instrumentId],
  )

  const refreshStats = useCallback(() => {
    const nextStats = loadStats()
    setStats(nextStats)
    return nextStats
  }, [])

  const recordWfyEvent = useCallback((type) => {
    recordWfyPracticeEvent(type)
  }, [])

  const value = useMemo(
    () => ({
      stats,
      beginPracticeSession,
      endPracticeSession,
      saveManualPracticeSession,
      resetAllStats,
      refreshStats,
      recordWfyEvent,
    }),
    [
      stats,
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
