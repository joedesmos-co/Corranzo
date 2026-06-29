import { DEFAULT_MUSICXML_VELOCITY } from '../musicxml/dynamicsMap.js'

/** Standard playback shortening for staccato (written duration preserved elsewhere). */
export const STACCATO_PLAYBACK_RATIO = 0.5

/** Velocity boost for accented notes (on top of dynamics, capped at 1). */
export const ACCENT_VELOCITY_BOOST = 0.12

export const MIN_PLAYBACK_DURATION_SECONDS = 0.03

export function staccatoPlaybackDurationSeconds(writtenDurationSeconds) {
  const written = Math.max(writtenDurationSeconds, MIN_PLAYBACK_DURATION_SECONDS)
  return Math.max(MIN_PLAYBACK_DURATION_SECONDS, written * STACCATO_PLAYBACK_RATIO)
}

/** Sounding duration for playback; score-follow and measure math keep written duration. */
export function playbackDurationSecondsForNote(note) {
  const written = Math.max(note?.durationSeconds ?? 0, MIN_PLAYBACK_DURATION_SECONDS)
  if (note?.staccato) {
    return staccatoPlaybackDurationSeconds(written)
  }
  return written
}

/** Playback velocity with accent emphasis; onset and written duration unchanged. */
export function playbackVelocityForNote(note) {
  const base = note?.velocity ?? DEFAULT_MUSICXML_VELOCITY
  if (note?.accent) {
    return Math.min(1, base + ACCENT_VELOCITY_BOOST)
  }
  return base
}
