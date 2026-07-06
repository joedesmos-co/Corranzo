import { isFiniteMidi as isPlayableMidi } from '../playback/sanitizePlaybackNote.js'

export { isPlayableMidi as isFiniteMidi }

export function sanitizeVisualDurationSeconds(durationSeconds, fallback = 0) {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : fallback
}
