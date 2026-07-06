export const MIN_PLAYABLE_NOTE_DURATION_SECONDS = 0.03

export function isFiniteMidi(midi) {
  return Number.isFinite(midi) && midi >= 0 && midi <= 127
}

export function isPlayableTimingNote(note) {
  if (!note || note.isRest || note.suppressPlaybackAttack || note.isTabMirror) {
    return false
  }
  if (!isFiniteMidi(note.midi)) {
    return false
  }
  const time = note.performedSeconds ?? note.timeSeconds
  return Number.isFinite(time) && time >= 0
}

export function sanitizePlaybackDurationSeconds(durationSeconds, {
  min = MIN_PLAYABLE_NOTE_DURATION_SECONDS,
} = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return min
  }
  return Math.max(durationSeconds, min)
}

export function sanitizePlaybackVelocity(velocity) {
  if (!Number.isFinite(velocity)) {
    return 0.75
  }
  return Math.min(1, Math.max(0, velocity))
}
