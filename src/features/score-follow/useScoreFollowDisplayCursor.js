import { useEffect, useRef } from 'react'
import {
  publishScoreFollowCursor,
  resetScoreFollowCursorRuntime,
} from './scoreFollowCursorRuntime.js'
import { systemKeyForCursor } from './cursorVisualMotion.js'

const PAGE_CHANGE_ALPHA = 0.55
const SNAP_THRESHOLD = 0.0005

/**
 * Wait-For-You checkpoint glide.
 *
 * The checkpoint positions themselves are exact — the bar must end precisely
 * on the required notehead. What is wrong is the TRANSITION: hopping from one
 * checkpoint column to the next reads as a teleport, because the eye expects
 * the cursor to travel. So the bar glides: a bounded, eased move that covers
 * the gap and then holds on the note while the musician plays.
 *
 * The glide is deliberately small and additive — it never changes where the
 * cursor lands, only how it gets there.
 */
const CHECKPOINT_GLIDE_MIN_DISTANCE = 0.0008
const CHECKPOINT_GLIDE_BASE_MS = 180
const CHECKPOINT_GLIDE_MAX_MS = 420
/** Page-normalised distance → extra milliseconds (a long gap takes longer). */
const CHECKPOINT_GLIDE_MS_PER_UNIT = 2400

/**
 * Audio-clock cursor driver. During playback the RAF loop reads
 * `getScoreTime()` (Tone-synchronized) and publishes to the imperative runtime
 * store so the overlay can paint at 60 fps without React re-rendering the
 * practice tree every frame.
 */
export default function useScoreFollowCursorDriver({
  targetCursor,
  active,
  smoothCheckpoints = false,
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
    systemKey: '',
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
    if (active && !lockExact) return undefined
    const next = targetCursor ?? { visible: false }
    const state = stateRef.current
    const fromX = state.x
    const fromY = state.y
    const toX = Number.isFinite(next.x) ? next.x : fromX
    const toY = Number.isFinite(next.y) ? next.y : fromY
    const distance = Math.abs(toX - fromX)
    // A page change is a different surface, not a gap to travel across: the
    // bar appears on the new page instead of sliding over the page break.
    const glide =
      smoothCheckpoints &&
      next.visible &&
      state.initialized &&
      Number.isFinite(fromX) &&
      distance > CHECKPOINT_GLIDE_MIN_DISTANCE &&
      next.page === state.page
    const duration = Math.min(
      CHECKPOINT_GLIDE_MAX_MS,
      CHECKPOINT_GLIDE_BASE_MS + distance * CHECKPOINT_GLIDE_MS_PER_UNIT,
    )
    let frame = 0
    const start = performance.now()
    const paint = (now) => {
      const progress = glide ? Math.min(1, (now - start) / duration) : 1
      const ease = progress * progress * (3 - 2 * progress)
      const x = glide ? fromX + (toX - fromX) * ease : toX
      const y = glide ? fromY + (toY - fromY) * ease : toY
      Object.assign(state, { x, y, page: next.page,
        measureNumber: next.measureNumber, systemKey: systemKeyForCursor(next),
        initialized: Boolean(next.visible) })
      publishScoreFollowCursor({ ...next, x, y, smoothed: glide && progress < 1 })
      if (progress < 1) frame = requestAnimationFrame(paint)
    }
    paint(start)
    return () => cancelAnimationFrame(frame)
  }, [lockExact, active, targetCursor, smoothCheckpoints])

  useEffect(() => {
    if (!active || lockExact) {
      return undefined
    }

    const publishNow = () => {
      const rtResolve = resolveRealtimeCursorRef.current
      const rtGetTime = getScoreTimeRef.current
      const target =
        rtResolve && rtGetTime ? rtResolve(rtGetTime()) : targetRef.current
      if (target?.visible) {
        stateRef.current.x = target.x
        stateRef.current.y = target.y
        stateRef.current.page = target.page
        stateRef.current.measureNumber = target.measureNumber ?? null
        stateRef.current.initialized = true
        publishScoreFollowCursor({ ...target, smoothed: false })
      }
    }

    publishNow()

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
      const targetSystemKey = systemKeyForCursor(target)
      if (
        !state.initialized ||
        state.page !== target.page ||
        state.systemKey !== targetSystemKey
      ) {
        state.x = target.x
        state.y = target.y
        state.page = target.page
        state.measureNumber = target.measureNumber ?? null
        state.systemKey = targetSystemKey
        state.initialized = true
        publishScoreFollowCursor({ ...target, smoothed: false })
        frameId = requestAnimationFrame(tick)
        return
      }

      if (rtResolve && rtGetTime) {
        // Motion Engine v2: `target` is already a smooth, onset-locked curve
        // sampled at the audio clock (the motion timeline). Publish it directly —
        // no predictive follower / ad-hoc smoothing layer. The timeline itself
        // produces the smoothness and the exact onset alignment.
        state.x = target.x
        state.y = target.y
        state.page = target.page
        state.systemKey = targetSystemKey
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
