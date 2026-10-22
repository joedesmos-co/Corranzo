import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createPlayAlongFeedbackState,
  evaluatePlayAlongNoteInput,
  playAlongOutcomesMap,
  prunePlayAlongOutcomesAfterSeek,
  resetPlayAlongFeedbackState,
  resetPlayAlongForLoopIteration,
  updatePlayAlongMisses,
} from './playAlongLaneFeedback.js'

/**
 * Tracks per-note green/red outcomes during Play Along without pausing playback.
 *
 * Attempt lifecycle (B03):
 * - Pause/resume/completion PRESERVE outcomes (same attempt). The old
 *   `!active → reset` behavior wiped earned outcomes on every pause — removed.
 * - New score / loop-bounds / scope / explicit attempt id resets outcomes.
 * - Seek prunes stale future outcomes via `pruneAfterSeek`.
 * - Loop wrap resets the current iteration via `resetForLoopIteration`.
 */
export default function usePlayAlongLaneFeedback({
  active = false,
  groups = [],
  practiceTime = 0,
  matchSettings = {},
  isPlaying = false,
  attemptId = null,
  getAuthoritativeTime = null,
}) {
  const stateRef = useRef(createPlayAlongFeedbackState())
  const timelineRef = useRef({ groups, practiceTime })
  timelineRef.current = { groups, practiceTime }
  const getTimeRef = useRef(getAuthoritativeTime)
  getTimeRef.current = getAuthoritativeTime
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

  const attemptIdRef = useRef(attemptId)
  useEffect(() => {
    if (attemptIdRef.current !== attemptId) {
      attemptIdRef.current = attemptId
      // New attempt (mode change / score restart): fresh outcomes. The very
      // first attempt id mount is already empty, so only bump when non-empty.
      if (stateRef.current.outcomes.size > 0 || stateRef.current.activeGroupId != null) {
        resetPlayAlongFeedbackState(stateRef.current)
        bump()
      }
    }
  }, [attemptId, bump])

  useEffect(() => {
    if (!active || !isPlaying) {
      return undefined
    }
    const updateMisses = () => {
      const timeline = timelineRef.current
      if (updatePlayAlongMisses(stateRef.current, timeline.groups, timeline.practiceTime)) {
        bump()
      }
    }
    updateMisses()
    const intervalId = window.setInterval(() => {
      updateMisses()
    }, 80)
    return () => window.clearInterval(intervalId)
  }, [active, isPlaying, bump])

  const resolveInputTime = useCallback(
    (explicitTime = null) => {
      if (Number.isFinite(Number(explicitTime))) return Number(explicitTime)
      try {
        const authoritative = getTimeRef.current?.()
        if (Number.isFinite(Number(authoritative))) return Number(authoritative)
      } catch {
        // fall through to React clock
      }
      return timelineRef.current.practiceTime
    },
    [],
  )

  const handlePlayedMidi = useCallback(
    (midi, explicitTime = null) => {
      if (!active || !isPlaying) {
        return null
      }
      const inputTime = resolveInputTime(explicitTime)
      const outcome = evaluatePlayAlongNoteInput(
        stateRef.current,
        groups,
        inputTime,
        midi,
        matchSettings,
      )
      if (outcome) {
        bump()
      }
      return outcome
    },
    [active, isPlaying, groups, matchSettings, bump, resolveInputTime],
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

  const pruneAfterSeek = useCallback(
    (seekTimeSeconds) => {
      const timeline = timelineRef.current
      if (prunePlayAlongOutcomesAfterSeek(stateRef.current, timeline.groups, seekTimeSeconds)) {
        bump()
      }
    },
    [bump],
  )

  const resetForLoopIteration = useCallback(() => {
    resetPlayAlongForLoopIteration(stateRef.current)
    bump()
  }, [bump])

  const resetForAttempt = useCallback(() => {
    resetPlayAlongFeedbackState(stateRef.current)
    bump()
  }, [bump])

  const outcomes = useMemo(() => {
    void version
    return new Map(playAlongOutcomesMap(stateRef.current))
  }, [version])

  // Stabilize the return identity: without this, every session render
  // hands downstream memos a fresh feedback object, churning session +
  // provider identity at the Tone progress rate on top of real updates.
  return useMemo(
    () => ({
      outcomes,
      handlePlayedMidi,
      setGroupOutcome,
      pruneAfterSeek,
      resetForLoopIteration,
      resetForAttempt,
    }),
    [
      outcomes,
      handlePlayedMidi,
      setGroupOutcome,
      pruneAfterSeek,
      resetForLoopIteration,
      resetForAttempt,
    ],
  )
}
