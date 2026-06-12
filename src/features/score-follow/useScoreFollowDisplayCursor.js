import { useEffect, useRef, useState } from 'react'

const ALPHA_X = 0.42
const ALPHA_Y = 1
const PAGE_CHANGE_ALPHA = 0.55
const SNAP_THRESHOLD = 0.004

/**
 * RAF-smoothed cursor for stable on-screen motion during playback.
 * Skips smoothing when lockExact is set (startup / per-measure snap).
 */
export default function useScoreFollowDisplayCursor({
  targetCursor,
  active,
  resetSnapKey = '',
  lockExact = false,
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
      const target = targetRef.current
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

      const dx = target.x - state.x
      const dy = target.y - state.y
      const alphaX = Math.abs(dx) > 0.2 ? PAGE_CHANGE_ALPHA : ALPHA_X

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
