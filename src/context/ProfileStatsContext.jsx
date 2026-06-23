/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  clearStats,
  loadStats,
} from '../features/profile/profileStorage.js'
import {
  beginSession,
  endSession,
} from '../features/profile/practiceStats.js'

const ProfileStatsContext = createContext(null)

export function ProfileStatsProvider({ children }) {
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

  const recordWfyManualContinue = useCallback(() => {}, [])

  const value = useMemo(
    () => ({
      stats,
      beginPracticeSession,
      endPracticeSession,
      resetAllStats,
      recordWfyManualContinue,
    }),
    [
      stats,
      beginPracticeSession,
      endPracticeSession,
      resetAllStats,
      recordWfyManualContinue,
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
