import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PRACTICE_MODE } from './practiceMode.js'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import {
  buildCheckpoints,
  findCheckpointIndexAtTime,
} from './waitForYouCheckpoints.js'
import {
  getCurrentCheckpoint,
  getNextCheckpointIndex,
  getWaitForYouStatus,
  WFY_STATUS,
} from './waitForYouEngine.js'

export default function useWaitForYou({
  practiceMode,
  checkpointMode = WFY_CHECKPOINT_MODE.BEAT,
  timingMap,
  loopRegion,
  seekToPracticeTime,
  onEnsurePaused,
  practiceTime,
}) {
  const active = practiceMode === PRACTICE_MODE.WAIT_FOR_YOU
  const wasActiveRef = useRef(false)
  const checkpointsKeyRef = useRef('')

  const checkpoints = useMemo(
    () => buildCheckpoints(timingMap, loopRegion, checkpointMode),
    [timingMap, loopRegion, checkpointMode],
  )

  const checkpointsKey = useMemo(
    () =>
      `${checkpointMode}:${checkpoints.length > 0 ? `${checkpoints[0].id}-${checkpoints[checkpoints.length - 1].id}` : 'empty'}`,
    [checkpointMode, checkpoints],
  )

  const [checkpointIndex, setCheckpointIndex] = useState(0)

  const status = getWaitForYouStatus({
    active,
    checkpointCount: checkpoints.length,
    checkpointIndex,
  })

  const currentCheckpoint = getCurrentCheckpoint(checkpoints, checkpointIndex)

  const goToCheckpoint = useCallback(
    (index) => {
      const checkpoint = getCurrentCheckpoint(checkpoints, index)
      if (!checkpoint) {
        return
      }
      setCheckpointIndex(index)
      seekToPracticeTime(checkpoint.timeSeconds)
      onEnsurePaused()
    },
    [checkpoints, seekToPracticeTime, onEnsurePaused],
  )

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false
      checkpointsKeyRef.current = ''
      return
    }

    const enteringMode = !wasActiveRef.current
    const checkpointsChanged = checkpointsKeyRef.current !== checkpointsKey

    if (enteringMode) {
      const startTime = loopRegion?.isValid
        ? loopRegion.startTimeSeconds
        : (checkpoints[0]?.timeSeconds ?? 0)
      const startIndex = checkpoints.length
        ? findCheckpointIndexAtTime(checkpoints, startTime)
        : 0
      goToCheckpoint(startIndex)
    } else if (checkpointsChanged) {
      goToCheckpoint(0)
    }

    wasActiveRef.current = true
    checkpointsKeyRef.current = checkpointsKey
  }, [active, checkpointsKey, checkpoints, loopRegion, goToCheckpoint])

  const syncToNearestCheckpoint = useCallback(
    (timeSeconds) => {
      if (!active || !checkpoints.length) {
        return
      }
      const index = findCheckpointIndexAtTime(checkpoints, timeSeconds)
      setCheckpointIndex(index)
    },
    [active, checkpoints],
  )

  const markCorrectAndContinue = useCallback(() => {
    if (!active || !checkpoints.length) {
      return
    }

    const nextIndex = getNextCheckpointIndex(checkpointIndex, checkpoints.length)
    if (nextIndex >= checkpoints.length) {
      setCheckpointIndex(checkpoints.length)
      onEnsurePaused()
      return
    }

    goToCheckpoint(nextIndex)
  }, [active, checkpoints, checkpointIndex, goToCheckpoint, onEnsurePaused])

  const onPlayerInputMatched = useCallback(() => {
    markCorrectAndContinue()
  }, [markCorrectAndContinue])

  const restart = useCallback(() => {
    if (!checkpoints.length) {
      setCheckpointIndex(0)
      onEnsurePaused()
      return
    }
    goToCheckpoint(0)
  }, [checkpoints, goToCheckpoint, onEnsurePaused])

  return {
    active,
    checkpointMode,
    status,
    checkpoints,
    checkpointIndex,
    currentCheckpoint,
    totalCheckpoints: checkpoints.length,
    isWaiting: status === WFY_STATUS.WAITING,
    isComplete: status === WFY_STATUS.COMPLETE,
    markCorrectAndContinue,
    onPlayerInputMatched,
    restart,
    syncToNearestCheckpoint,
  }
}
