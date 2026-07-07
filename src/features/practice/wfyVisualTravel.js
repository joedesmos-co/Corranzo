import { resolveWfyDisplayFrameTime } from './visualPracticeLane.js'
import { VISUAL_EARLY_INPUT_SECONDS } from './visualLaneFeedback.js'

/** Minimum visual glide so adjacent checkpoints still animate visibly. */
export const WFY_VISUAL_TRAVEL_MIN_MS = 80

/**
 * Display-only travel duration between checkpoints at musical tempo.
 * Does not affect playback or matching clocks.
 */
export function resolveWfyTravelDurationMs(fromTime = 0, toTime = 0) {
  const from = Number(fromTime)
  const to = Number(toTime)
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return WFY_VISUAL_TRAVEL_MIN_MS
  }
  const deltaSeconds = Math.max(0, to - from)
  return Math.max(WFY_VISUAL_TRAVEL_MIN_MS, deltaSeconds * 1000)
}

export function createWfyVisualTravelState() {
  return {
    fromTime: 0,
    toTime: 0,
    startedAt: 0,
    checkpointId: null,
    arrived: true,
  }
}

export function startWfyVisualTravel(
  state,
  { fromTime = 0, toTime = 0, checkpointId = null, now = 0 } = {},
) {
  const from = Number(fromTime)
  const to = Number(toTime)
  state.fromTime = Number.isFinite(from) ? from : 0
  state.toTime = Number.isFinite(to) ? to : state.fromTime
  state.startedAt = now
  state.checkpointId = checkpointId
  state.arrived = Math.abs(state.toTime - state.fromTime) < 0.001
}

export function resolveWfyVisualTravelFrameTime(state, now = 0) {
  if (!state || state.arrived) {
    return Number.isFinite(state?.toTime) ? state.toTime : 0
  }
  const durationMs = resolveWfyTravelDurationMs(state.fromTime, state.toTime)
  const elapsedMs = Math.max(0, now - state.startedAt)
  if (elapsedMs >= durationMs) {
    state.arrived = true
    return state.toTime
  }
  return resolveWfyDisplayFrameTime({
    fromTime: state.fromTime,
    toTime: state.toTime,
    elapsedMs,
    durationMs,
  })
}

export function isWfyVisualTravelComplete(state) {
  return Boolean(state?.arrived)
}

/** True when the visual playhead is close enough to accept early WFY input. */
export function isWfyEarlyInputWindow(frameTime = 0, targetTime = 0) {
  const frame = Number(frameTime)
  const target = Number(targetTime)
  if (!Number.isFinite(frame) || !Number.isFinite(target)) {
    return false
  }
  return frame >= target - VISUAL_EARLY_INPUT_SECONDS
}

export { VISUAL_EARLY_INPUT_SECONDS as WFY_EARLY_INPUT_SECONDS }
