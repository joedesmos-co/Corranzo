import { useEffect, useRef } from 'react'
import {
  publishScoreFollowCursor,
  resetScoreFollowCursorRuntime,
} from './scoreFollowCursorRuntime.js'

const PAGE_CHANGE_ALPHA = 0.55
const SNAP_THRESHOLD = 0.0005

/**
 * Audio-clock cursor driver. During playback the RAF loop reads
 * `getScoreTime()` (Tone-synchronized) and publishes to the imperative runtime
 * store so the overlay can paint at 60 fps without React re-rendering the
 * practice tree every frame.
 */
export default function useScoreFollowCursorDriver({
  targetCursor,
  active,
  resetSnapKey = '',
  lockExact = false,
  getScoreTime = null,
  resolveRealtimeCursor = null,
}) {
  const targetRef = useRef(targetCursor)
  targetRef.current = targetCursor

  const getScoreTimeRef = useRef(getScoreTime)
  getScoreTimeRef.current = getScoreTime
  const resolveRealtimeCursorRef = useRef(resolveRealtimeCursor)
  resolveRealtimeCursorRef.current = resolveRealtimeCursor

  const stateRef = useRef({
    x: 0,
    y: 0,
    page: 1,
    measureNumber: null,
    initialized: false,
  })

  useEffect(() => {
    stateRef.current.initialized = false
    if (targetCursor?.visible) {
      publishScoreFollowCursor({ ...targetCursor, smoothed: false })
    } else {
      resetScoreFollowCursorRuntime({ visible: false, page: 1, x: 0, y: 0 })
    }
  }, [resetSnapKey])

  useEffect(() => {
    if (lockExact || !active) {
      const next = targetCursor ?? { visible: false }
      publishScoreFollowCursor({ ...next, smoothed: false })
      if (next.visible) {
        stateRef.current.x = next.x
        stateRef.current.y = next.y
        stateRef.current.page = next.page
        stateRef.current.measureNumber = next.measureNumber ?? null
        stateRef.current.initialized = true
      } else {
        stateRef.current.initialized = false
      }
    }
  }, [lockExact, active, targetCursor])

  useEffect(() => {
    if (!active || lockExact) {
      return undefined
    }

    let frameId = 0

    const tick = () => {
      const rtResolve = resolveRealtimeCursorRef.current
      const rtGetTime = getScoreTimeRef.current
      const target =
        rtResolve && rtGetTime ? rtResolve(rtGetTime()) : targetRef.current

      if (!target?.visible) {
        publishScoreFollowCursor(target ?? { visible: false })
        frameId = requestAnimationFrame(tick)
        return
      }

      const state = stateRef.current
      if (!state.initialized || state.page !== target.page) {
        state.x = target.x
        state.y = target.y
        state.page = target.page
        state.measureNumber = target.measureNumber ?? null
        state.initialized = true
        publishScoreFollowCursor({ ...target, smoothed: false })
        frameId = requestAnimationFrame(tick)
        return
      }

      if (rtResolve && rtGetTime) {
        state.x = target.x
        state.y = target.y
        state.page = target.page
        state.measureNumber = target.measureNumber ?? null
        publishScoreFollowCursor({ ...target, smoothed: false })
        frameId = requestAnimationFrame(tick)
        return
      }

      const dx = target.x - state.x
      const dy = target.y - state.y
      const alphaX = Math.abs(dx) > 0.2 ? PAGE_CHANGE_ALPHA : 0.42

      if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
        state.x = target.x
        state.y = target.y
      } else {
        state.x += dx * alphaX
        state.y = target.y
      }
      state.page = target.page
      state.measureNumber = target.measureNumber ?? null

      publishScoreFollowCursor({
        ...target,
        x: state.x,
        y: state.y,
        page: state.page,
        smoothed: true,
      })

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [active, lockExact])
}
