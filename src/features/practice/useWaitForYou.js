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
  canMarkWaitForYouCheckpoint,
  shouldBlockWaitForYouAdvance,
  WFY_STATUS,
} from './waitForYouEngine.js'
import {
  resolveWfyDisplayStatus,
  labelForWfyDisplayStatus,
} from './waitForYouDisplayStatus.js'

const CORRECT_FLASH_MS = 380
const CONTINUING_FLASH_MS = 420

export default function useWaitForYou({
  practiceMode,
  checkpointMode = WFY_CHECKPOINT_MODE.BEAT,
  timingMap,
  loopRegion,
  seekToPracticeTime,
  onEnsurePaused,
  practiceTime,
  onCheckpointCompleted = null,
  practiceScope = null,
}) {
  const active = practiceMode === PRACTICE_MODE.WAIT_FOR_YOU
  const wasActiveRef = useRef(false)
  const checkpointsKeyRef = useRef('')

  const checkpoints = useMemo(
    () => buildCheckpoints(timingMap, loopRegion, checkpointMode, { practiceScope }),
    [timingMap, loopRegion, checkpointMode, practiceScope],
  )

  const checkpointsKey = useMemo(
    () =>
      `${checkpointMode}:${practiceScope ?? 'all'}:${checkpoints.length > 0 ? `${checkpoints[0].id}-${checkpoints[checkpoints.length - 1].id}` : 'empty'}`,
    [checkpointMode, practiceScope, checkpoints],
  )

  const [checkpointIndex, setCheckpointIndex] = useState(0)
  const [displayPhase, setDisplayPhase] = useState(null)
  const advanceTimerRef = useRef(null)
  const consumedCheckpointIdRef = useRef(null)

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current != null) {
      clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearAdvanceTimer(), [clearAdvanceTimer])

  const status = getWaitForYouStatus({
    active,
    checkpointCount: checkpoints.length,
    checkpointIndex,
  })

  const currentCheckpoint = getCurrentCheckpoint(checkpoints, checkpointIndex)

  const goToCheckpoint = useCallback(
    (index, seekOptions = {}) => {
      const checkpoint = getCurrentCheckpoint(checkpoints, index)
      if (!checkpoint) {
        return
      }
      setCheckpointIndex(index)
      seekToPracticeTime(checkpoint.timeSeconds, seekOptions)
      onEnsurePaused()
    },
    [checkpoints, seekToPracticeTime, onEnsurePaused],
  )

  useEffect(() => {
    consumedCheckpointIdRef.current = null
  }, [currentCheckpoint?.id])

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false
      checkpointsKeyRef.current = ''
      clearAdvanceTimer()
      setDisplayPhase(null)
      consumedCheckpointIdRef.current = null
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
      goToCheckpoint(startIndex, { sync: false })
    } else if (checkpointsChanged) {
      goToCheckpoint(0, { sync: false })
    }

    wasActiveRef.current = true
    checkpointsKeyRef.current = checkpointsKey
  }, [active, checkpointsKey, checkpoints, loopRegion, goToCheckpoint, clearAdvanceTimer])

  const markCorrectAndContinue = useCallback(
    ({ immediate = false } = {}) => {
      if (
        !canMarkWaitForYouCheckpoint({
          active,
          checkpointCount: checkpoints.length,
          checkpointIndex,
        })
      ) {
        return
      }

      const checkpoint = getCurrentCheckpoint(checkpoints, checkpointIndex)
      if (
        shouldBlockWaitForYouAdvance(consumedCheckpointIdRef.current, checkpoint?.id ?? null)
      ) {
        return
      }
      consumedCheckpointIdRef.current = checkpoint?.id ?? null

      const runAdvance = () => {
        try {
          clearAdvanceTimer()
          setDisplayPhase(null)
          const nextIndex = getNextCheckpointIndex(checkpointIndex, checkpoints.length)
          if (nextIndex >= checkpoints.length) {
            setCheckpointIndex(checkpoints.length)
            onEnsurePaused()
            onCheckpointCompleted?.({ completed: true, loopCompleted: true })
            return
          }
          onCheckpointCompleted?.({ completed: false, loopCompleted: false })
          goToCheckpoint(nextIndex)
        } catch (error) {
          if (import.meta.env?.DEV) {
            console.error('[Practice] WFY checkpoint advance failed:', error)
          }
        }
      }

      if (immediate) {
        // Defer out of mic/audio callback stacks so flushSync + lane rebuild
        // cannot re-enter the detector or blow the React render budget.
        queueMicrotask(runAdvance)
        return
      }

      clearAdvanceTimer()
      setDisplayPhase('correct')
      advanceTimerRef.current = setTimeout(() => {
        setDisplayPhase('continuing')
        advanceTimerRef.current = setTimeout(() => {
          advanceTimerRef.current = null
          runAdvance()
        }, CONTINUING_FLASH_MS)
      }, CORRECT_FLASH_MS)
    },
    [
      active,
      checkpoints,
      checkpointIndex,
      goToCheckpoint,
      onEnsurePaused,
      onCheckpointCompleted,
      clearAdvanceTimer,
    ],
  )

  const onPlayerInputMatched = useCallback(() => {
    markCorrectAndContinue({ immediate: true })
  }, [markCorrectAndContinue])

  const restart = useCallback(() => {
    clearAdvanceTimer()
    setDisplayPhase(null)
    consumedCheckpointIdRef.current = null
    if (!checkpoints.length) {
      setCheckpointIndex(0)
      onEnsurePaused()
      return
    }
    goToCheckpoint(0)
  }, [checkpoints, goToCheckpoint, onEnsurePaused, clearAdvanceTimer])

  const syncToNearestCheckpoint = useCallback(
    (timeSeconds) => {
      if (!active || !checkpoints.length) {
        return
      }
      clearAdvanceTimer()
      setDisplayPhase(null)
      consumedCheckpointIdRef.current = null
      const index = findCheckpointIndexAtTime(checkpoints, timeSeconds)
      setCheckpointIndex(index)
    },
    [active, checkpoints, clearAdvanceTimer],
  )

  const displayStatus = resolveWfyDisplayStatus({
    active,
    engineStatus: status,
    displayPhase,
  })

  const displayLabel = labelForWfyDisplayStatus(displayStatus)

  return {
    active,
    checkpointMode,
    status,
    displayStatus,
    displayLabel,
    displayPhase,
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
