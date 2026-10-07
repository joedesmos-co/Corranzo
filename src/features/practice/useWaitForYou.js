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

/**
 * WFY STATE MACHINE (B04/B06 audit, E10).
 *
 * Engine states (waitForYouEngine.WFY_STATUS): INACTIVE → WAITING → COMPLETE,
 * plus NO_CHECKPOINTS when the canonical timing yields no playable targets.
 * Display phases (correct → continuing) are cosmetic only and never gate
 * advancement. Duplicate-advance guard: consumedCheckpointId (one-shot per
 * checkpoint id; cleared on checkpoint-id change AND on checkpoint-list
 * rebuild so a restored list cannot inherit a stale consumed marker).
 *
 * Progression derives SOLELY from the canonical timing/event model
 * (buildCheckpoints from the performed timeline). Neither UI state, audio
 * state, nor input-source shortcuts decide advancement: MIDI, mic, and
 * manual-continue all funnel through markCorrectAndContinue, which reads
 * the LATEST checkpoint list via latestRef (no stale-closure advance).
 * Timing load is async — entering with saved WFY mode before parse resolves
 * to the NEAREST checkpoint of the loaded list, and the first correct attack
 * advances exactly once (count corresponds to a committed advancement).
 */

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
  // Latest-state refs so queued microtask advances (WFY MIDI/mic callbacks)
  // never act on a stale checkpoints/index closure after async timing load.
  // This is the restored-first-match hardening: the first correct attack
  // after restore must evaluate against the CURRENT checkpoint list.
  const latestRef = useRef({ checkpoints: [], checkpointIndex: 0, active: false })
  latestRef.current = { checkpoints, checkpointIndex, active }
  const seekToPracticeTimeRef = useRef(seekToPracticeTime)
  seekToPracticeTimeRef.current = seekToPracticeTime

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

  // A rebuilt checkpoint list (async timing load, loop/scope change) is a new
  // traversal: any in-flight "consumed" marker from the previous list must
  // not block the first correct attack of the new list (B04).
  useEffect(() => {
    consumedCheckpointIdRef.current = null
  }, [checkpointsKey])

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
      const startTime = Math.max(loopRegion?.isValid ? loopRegion.startTimeSeconds : 0, practiceTime)
      const startIndex = checkpoints.length
        ? findCheckpointIndexAtTime(checkpoints, startTime)
        : 0
      goToCheckpoint(startIndex, { sync: false })
    } else if (checkpointsChanged) {
      // Async timing load after restore (R4): the saved practiceTime is the
      // restore position — sync to the NEAREST checkpoint rather than
      // unconditionally rewinding to 0, and clear any stale consumed marker
      // so the first valid attack advances exactly once.
      consumedCheckpointIdRef.current = null
      clearAdvanceTimer()
      setDisplayPhase(null)
      if (checkpoints.length) {
        const anchorTime = Number.isFinite(Number(practiceTime)) ? Number(practiceTime) : 0
        const startIndex = findCheckpointIndexAtTime(checkpoints, Math.max(0, anchorTime))
        goToCheckpoint(startIndex, { sync: false })
      }
    }

    wasActiveRef.current = true
    checkpointsKeyRef.current = checkpointsKey
  }, [active, checkpointsKey, checkpoints, loopRegion, goToCheckpoint, clearAdvanceTimer, practiceTime])

  const markCorrectAndContinue = useCallback(
    ({ immediate = false } = {}) => {
      // Read the CURRENT traversal (not the render closure) so a correct
      // attack queued before an async timing-load commit still advances the
      // restored checkpoint exactly once (B04 restored-first-match).
      const latest = latestRef.current ?? { checkpoints: [], checkpointIndex: 0, active: false }
      const liveCheckpoints = latest.checkpoints?.length ? latest.checkpoints : checkpoints
      const liveIndex = latest.checkpoints?.length ? latest.checkpointIndex : checkpointIndex
      const liveActive = latest.active ?? active
      if (
        !canMarkWaitForYouCheckpoint({
          active: liveActive,
          checkpointCount: liveCheckpoints.length,
          checkpointIndex: liveIndex,
        })
      ) {
        return false
      }

      const checkpoint = getCurrentCheckpoint(liveCheckpoints, liveIndex)
      if (
        shouldBlockWaitForYouAdvance(consumedCheckpointIdRef.current, checkpoint?.id ?? null)
      ) {
        return false
      }
      consumedCheckpointIdRef.current = checkpoint?.id ?? null

      const runAdvance = () => {
        try {
          // Re-read latest at commit time: the checkpoint list may have
          // resolved between the attack and this microtask.
          const commit = latestRef.current ?? { checkpoints: liveCheckpoints, checkpointIndex: liveIndex }
          const commitCheckpoints = commit.checkpoints?.length ? commit.checkpoints : liveCheckpoints
          const commitIndex = commit.checkpoints?.length ? commit.checkpointIndex : liveIndex
          clearAdvanceTimer()
          setDisplayPhase(null)
          const nextIndex = getNextCheckpointIndex(commitIndex, commitCheckpoints.length)
          if (nextIndex >= commitCheckpoints.length) {
            setCheckpointIndex(commitCheckpoints.length)
            onEnsurePaused()
            onCheckpointCompleted?.({ completed: true, loopCompleted: true })
            return true
          }
          onCheckpointCompleted?.({ completed: false, loopCompleted: false })
          // goToCheckpoint closes over the render checkpoints; when the
          // committed list is newer, seek directly to avoid a stale no-op.
          const nextCheckpoint = getCurrentCheckpoint(commitCheckpoints, nextIndex)
          if (nextCheckpoint && commitCheckpoints !== checkpoints) {
            setCheckpointIndex(nextIndex)
            try {
              seekToPracticeTimeRef.current?.(nextCheckpoint.timeSeconds)
            } catch {
              // ignore seek failures; index still advances
            }
            onEnsurePaused()
            return true
          }
          goToCheckpoint(nextIndex)
          return true
        } catch (error) {
          if (import.meta.env?.DEV) {
            console.error('[Practice] WFY checkpoint advance failed:', error)
          }
          return false
        }
      }

      if (immediate) {
        // Defer out of mic/audio callback stacks so flushSync + lane rebuild
        // cannot re-enter the detector or blow the React render budget.
        // Return true: the attack was accepted and advancement is committed
        // (exactly once — consumed guards duplicates). Callers must count a
        // correct ONLY when this returns true (B04).
        queueMicrotask(runAdvance)
        return true
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
      return true
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
    return markCorrectAndContinue({ immediate: true })
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
