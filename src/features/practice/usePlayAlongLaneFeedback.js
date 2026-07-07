import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createPlayAlongFeedbackState,
  evaluatePlayAlongNoteInput,
  playAlongOutcomesMap,
  resetPlayAlongFeedbackState,
  updatePlayAlongMisses,
} from './playAlongLaneFeedback.js'

/**
 * Tracks per-note green/red outcomes during Play Along without pausing playback.
 */
export default function usePlayAlongLaneFeedback({
  active = false,
  groups = [],
  practiceTime = 0,
  matchSettings = {},
  isPlaying = false,
}) {
  const stateRef = useRef(createPlayAlongFeedbackState())
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((value) => value + 1), [])

  const groupsKey = useMemo(
    () => (groups.length ? `${groups[0].id}-${groups[groups.length - 1].id}-${groups.length}` : 'empty'),
    [groups],
  )

  useEffect(() => {
    resetPlayAlongFeedbackState(stateRef.current)
    bump()
  }, [groupsKey, bump])

  useEffect(() => {
    if (!active) {
      resetPlayAlongFeedbackState(stateRef.current)
      bump()
    }
  }, [active, bump])

  useEffect(() => {
    if (!active || !isPlaying) {
      return undefined
    }
    updatePlayAlongMisses(stateRef.current, groups, practiceTime)
    bump()
    const intervalId = window.setInterval(() => {
      updatePlayAlongMisses(stateRef.current, groups, practiceTime)
      bump()
    }, 80)
    return () => window.clearInterval(intervalId)
  }, [active, isPlaying, groups, practiceTime, bump])

  const handlePlayedMidi = useCallback(
    (midi) => {
      if (!active || !isPlaying) {
        return
      }
      const outcome = evaluatePlayAlongNoteInput(
        stateRef.current,
        groups,
        practiceTime,
        midi,
        matchSettings,
      )
      if (outcome) {
        bump()
      }
    },
    [active, isPlaying, groups, practiceTime, matchSettings, bump],
  )

  const setGroupOutcome = useCallback(
    (groupId, outcome) => {
      if (!groupId || !outcome) {
        return
      }
      stateRef.current.outcomes.set(groupId, outcome)
      bump()
    },
    [bump],
  )

  const outcomes = useMemo(() => {
    void version
    return new Map(playAlongOutcomesMap(stateRef.current))
  }, [version])

  return {
    outcomes,
    handlePlayedMidi,
    setGroupOutcome,
  }
}
