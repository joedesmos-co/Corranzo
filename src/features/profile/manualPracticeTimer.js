export const MANUAL_TIMER_IDLE = 'idle'
export const MANUAL_TIMER_RUNNING = 'running'
export const MANUAL_TIMER_PAUSED = 'paused'

export function createManualTimerState() {
  return {
    status: MANUAL_TIMER_IDLE,
    accumulatedMs: 0,
    segmentStartedAt: null,
    sessionStartedAt: null,
  }
}

export function getManualTimerElapsedMs(state, now = Date.now()) {
  let total = state.accumulatedMs
  if (state.status === MANUAL_TIMER_RUNNING && state.segmentStartedAt != null) {
    total += Math.max(0, now - state.segmentStartedAt)
  }
  return total
}

export function startManualTimer(state, now = Date.now()) {
  if (state.status !== MANUAL_TIMER_IDLE) {
    return state
  }

  return {
    status: MANUAL_TIMER_RUNNING,
    accumulatedMs: 0,
    segmentStartedAt: now,
    sessionStartedAt: now,
  }
}

export function pauseManualTimer(state, now = Date.now()) {
  if (state.status !== MANUAL_TIMER_RUNNING || state.segmentStartedAt == null) {
    return state
  }

  return {
    status: MANUAL_TIMER_PAUSED,
    accumulatedMs:
      state.accumulatedMs + Math.max(0, now - state.segmentStartedAt),
    segmentStartedAt: null,
    sessionStartedAt: state.sessionStartedAt,
  }
}

export function resumeManualTimer(state, now = Date.now()) {
  if (state.status !== MANUAL_TIMER_PAUSED) {
    return state
  }

  return {
    ...state,
    status: MANUAL_TIMER_RUNNING,
    segmentStartedAt: now,
  }
}

export function stopManualTimer(state, now = Date.now()) {
  const elapsedMs = getManualTimerElapsedMs(state, now)
  return {
    nextState: createManualTimerState(),
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    startedAt: state.sessionStartedAt,
    endedAt: now,
  }
}

export function formatTimerDisplay(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
