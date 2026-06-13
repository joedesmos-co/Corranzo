import { useEffect, useRef, useState } from 'react'

const ALPHA_Y = 1
const PAGE_CHANGE_ALPHA = 0.55
const SNAP_THRESHOLD = 0.004

/**
 * RAF-smoothed cursor for stable on-screen motion during playback.
 *
 * When `getScoreTime` and `resolveRealtimeCursor` are provided (during active
 * playback), the RAF tick reads the engine's real-time score position every
 * frame and resolves the cursor there.  This makes the cursor update at 60 fps
 * instead of the React-state update rate (≈5 Hz / 200 ms), eliminating the
 * visible "jumping between positions" during playback.
 *
 * Skips smoothing when lockExact is set (startup / page-change snap).
 */
export default function useScoreFollowDisplayCursor({
  targetCursor,
  active,
  resetSnapKey = '',
  lockExact = false,
  getScoreTime = null,
  resolveRealtimeCursor = null,
}) {
  const [displayCursor, setDisplayCursor] = useState(targetCursor ?? { visible: false })
  const stateRef = useRef({
    x: 0,
    y: 0,
    page: 1,
    initialized: false,
  })
  const targetRef = useRef(targetCursor)
  targetRef.current = targetCursor

  // Stable refs so the RAF closure always has the latest callbacks.
  // Writing .current during render is intentional here (standard React pattern
  // for keeping stale-closure-free callbacks in a RAF loop).
  const getScoreTimeRef = useRef(getScoreTime)
  // eslint-disable-next-line react-hooks/refs
  getScoreTimeRef.current = getScoreTime
  const resolveRealtimeCursorRef = useRef(resolveRealtimeCursor)
  // eslint-disable-next-line react-hooks/refs
  resolveRealtimeCursorRef.current = resolveRealtimeCursor

  useEffect(() => {
    stateRef.current.initialized = false
  }, [resetSnapKey])

  useEffect(() => {
    if (lockExact || !active) {
      setDisplayCursor(targetCursor ?? { visible: false })
      if (targetCursor?.visible) {
        stateRef.current.x = targetCursor.x
        stateRef.current.y = targetCursor.y
        stateRef.current.page = targetCursor.page
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
      // If real-time resolution is available, compute cursor at the actual
      // engine position every frame (smooth 60 fps).  Otherwise fall back to
      // the React-state target (5 Hz with alpha-blend smoothing).
      const rtResolve = resolveRealtimeCursorRef.current
      const rtGetTime = getScoreTimeRef.current
      const target =
        rtResolve && rtGetTime ? rtResolve(rtGetTime()) : targetRef.current

      if (!target?.visible) {
        setDisplayCursor(target ?? { visible: false })
        frameId = requestAnimationFrame(tick)
        return
      }

      const state = stateRef.current
      if (!state.initialized || state.page !== target.page) {
        state.x = target.x
        state.y = target.y
        state.page = target.page
        state.initialized = true
        setDisplayCursor({ ...target })
        frameId = requestAnimationFrame(tick)
        return
      }

      // When resolving in real-time the target already advances smoothly —
      // set the display cursor directly without additional alpha-blend lag.
      if (rtResolve && rtGetTime) {
        if (
          Math.abs(target.x - state.x) > SNAP_THRESHOLD ||
          Math.abs(target.y - state.y) > SNAP_THRESHOLD ||
          target.measureNumber !== state.measureNumber
        ) {
          state.x = target.x
          state.y = target.y
          state.page = target.page
          state.measureNumber = target.measureNumber
          setDisplayCursor({ ...target, smoothed: true })
        }
        frameId = requestAnimationFrame(tick)
        return
      }

      // Fallback: alpha-blend toward the (stale) React-state target.
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

      if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
        frameId = requestAnimationFrame(tick)
        return
      }

      setDisplayCursor({
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

  return displayCursor
}
