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

export const MANUAL_DRAFT_KEY = 'scoreflow-manual-draft-v1'

function getDraftStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function isValidDraftTimerState(value) {
  if (!value || typeof value !== 'object') {
    return false
  }
  return (
    (value.status === MANUAL_TIMER_IDLE ||
      value.status === MANUAL_TIMER_RUNNING ||
      value.status === MANUAL_TIMER_PAUSED) &&
    Number.isFinite(Number(value.accumulatedMs)) &&
    (value.segmentStartedAt == null || Number.isFinite(Number(value.segmentStartedAt))) &&
    (value.sessionStartedAt == null || Number.isFinite(Number(value.sessionStartedAt)))
  )
}

/**
 * Durable manual-timer draft: reload restores the running/paused timer and
 * pending form instead of silently losing it. A running segment re-anchors to
 * the restore moment so the reload gap is not counted and never double-counted.
 */
export function loadManualDraft() {
  try {
    const storage = getDraftStorage()
    if (!storage) {
      return null
    }
    const raw = storage.getItem(MANUAL_DRAFT_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !isValidDraftTimerState(parsed.timerState)) {
      return null
    }
    const now = Date.now()
    let timerState = parsed.timerState
    // Re-anchor a running segment: preserve accumulated time, restart the
    // live segment at restore time (no reload-gap credit, no loss).
    if (timerState.status === MANUAL_TIMER_RUNNING) {
      const accumulated = Number(timerState.accumulatedMs) || 0
      timerState = {
        status: MANUAL_TIMER_RUNNING,
        accumulatedMs: accumulated,
        segmentStartedAt: now,
        sessionStartedAt: timerState.sessionStartedAt ?? now,
      }
    }
    return {
      timerState,
      sessionInstrumentId: parsed.sessionInstrumentId ?? null,
      pieceTitle: typeof parsed.pieceTitle === 'string' ? parsed.pieceTitle : '',
      exerciseType: typeof parsed.exerciseType === 'string' ? parsed.exerciseType : 'scales',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      pendingSave:
        parsed.pendingSave && typeof parsed.pendingSave === 'object' ? parsed.pendingSave : null,
    }
  } catch {
    return null
  }
}

export function saveManualDraft(draft) {
  try {
    const storage = getDraftStorage()
    if (!storage) {
      return false
    }
    if (!draft || draft.timerState?.status === MANUAL_TIMER_IDLE && !draft.pendingSave) {
      storage.removeItem(MANUAL_DRAFT_KEY)
      return true
    }
    storage.setItem(MANUAL_DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function clearManualDraft() {
  try {
    getDraftStorage()?.removeItem(MANUAL_DRAFT_KEY)
  } catch {
    // ignore
  }
}
