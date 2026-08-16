/**
 * Pause first so getScoreTime reads the engine's frozen offset, then hand that
 * exact score time to the manual practice clock in the same event batch.
 */
export function pausePlaybackAtAuthoritativeTime(playback, setManualTime) {
  const pausedTime = playback?.pause?.()
  const scoreTime = Number.isFinite(pausedTime)
    ? pausedTime
    : playback?.getScoreTime?.()
  if (!Number.isFinite(scoreTime)) {
    return null
  }
  setManualTime?.(scoreTime)
  return scoreTime
}
