import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolvePlayAlongVisualCheckpoint } from './playAlongVisualTarget.js'

/**
 * Keep the semantic Play Along target on the same authoritative audio clock as
 * the score-follow cursor. The resolver itself is cached and binary-searches
 * the visual schedule; React only hears about actual target transitions.
 */
export default function usePlayAlongVisualCheckpoint({
  active,
  timingMap,
  practiceScope,
  practiceTime,
  isPlaying,
  getScoreTime,
}) {
  const [resolvedState, setResolvedState] = useState({
    timingMap: null,
    practiceScope: null,
    checkpoint: null,
  })
  const fallbackTimeRef = useRef(practiceTime)
  const committedRef = useRef({
    timingMap: null,
    practiceScope: null,
    checkpoint: null,
  })

  useEffect(() => {
    fallbackTimeRef.current = practiceTime
  }, [practiceTime])

  const commitCheckpoint = useCallback((nextCheckpoint, nextTimingMap, nextScope) => {
    const previous = committedRef.current
    const previousId = previous.checkpoint?.id ?? null
    const nextId = nextCheckpoint?.id ?? null
    const sameSchedule =
      previous.timingMap === nextTimingMap &&
      previous.practiceScope === nextScope

    committedRef.current = {
      timingMap: nextTimingMap,
      practiceScope: nextScope,
      checkpoint: nextCheckpoint,
    }

    // A schedule/scope change can alter the notes behind an otherwise equal
    // ID. Null-to-null never changes anything visible and should not render.
    if (previousId === nextId && (sameSchedule || nextId == null)) {
      return
    }
    setResolvedState({
      timingMap: nextTimingMap,
      practiceScope: nextScope,
      checkpoint: nextCheckpoint,
    })
  }, [])

  const pausedCheckpoint = useMemo(
    () =>
      active && timingMap && !isPlaying
        ? resolvePlayAlongVisualCheckpoint(
            timingMap,
            practiceTime,
            practiceScope,
          )
        : null,
    [active, timingMap, practiceTime, practiceScope, isPlaying],
  )

  // Paused scrubs and seeks use the React practice clock immediately.
  useEffect(() => {
    if (!active || !timingMap) {
      commitCheckpoint(null, null, null)
      return
    }
    if (isPlaying) {
      return
    }
    commitCheckpoint(
      pausedCheckpoint,
      timingMap,
      practiceScope,
    )
  }, [
    active,
    timingMap,
    practiceScope,
    isPlaying,
    pausedCheckpoint,
    commitCheckpoint,
  ])

  // During playback, sample the engine's interpolated score time every frame.
  // No full-document work happens here: the visual event schedule is cached.
  useEffect(() => {
    if (!active || !timingMap || !isPlaying) {
      return undefined
    }

    let frameId = 0
    let cancelled = false
    const sample = () => {
      const scoreTime = getScoreTime?.()
      const authoritativeTime = Number.isFinite(scoreTime)
        ? scoreTime
        : fallbackTimeRef.current
      commitCheckpoint(
        resolvePlayAlongVisualCheckpoint(
          timingMap,
          authoritativeTime,
          practiceScope,
        ),
        timingMap,
        practiceScope,
      )
      if (!cancelled) {
        frameId = requestAnimationFrame(sample)
      }
    }

    sample()
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [
    active,
    timingMap,
    practiceScope,
    isPlaying,
    getScoreTime,
    commitCheckpoint,
  ])

  // Paused seeks can resolve synchronously from practiceTime. During playback,
  // effects run after render, so refuse to expose a checkpoint resolved from a
  // previous score or hand scope during the intervening render.
  if (!active) {
    return null
  }
  if (!isPlaying) {
    return pausedCheckpoint
  }
  if (
    resolvedState.timingMap !== timingMap ||
    resolvedState.practiceScope !== practiceScope
  ) {
    return null
  }
  return resolvedState.checkpoint
}
