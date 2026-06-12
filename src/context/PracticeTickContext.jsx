import { createContext, useContext } from 'react'

export const PracticeTickContext = createContext(null)
export const ScoreFollowCursorContext = createContext(null)

export function usePracticeTick() {
  const value = useContext(PracticeTickContext)
  if (!value) {
    throw new Error('usePracticeTick must be used within PracticeSessionProvider')
  }
  return value
}

export function useScoreFollowCursor() {
  const value = useContext(ScoreFollowCursorContext)
  if (!value) {
    throw new Error('useScoreFollowCursor must be used within PracticeSessionProvider')
  }
  return value
}

export function useScoreFollowCursorOptional() {
  return useContext(ScoreFollowCursorContext)
}

/** Quantize seconds for display-only memo comparisons (~4 updates/sec). */
export function quantizePracticeTime(seconds) {
  return Math.round((seconds ?? 0) * 4) / 4
}
