import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  canManualScrubMusicXml,
  getPracticeSyncStatus,
  resolvePracticeTime,
} from './practiceClock.js'

export default function usePracticeClock({
  hasMidi,
  hasMusicXml,
  isPlaying,
  playbackCurrentTime,
  sourcesRevision = '',
}) {
  const [manualTime, setManualTime] = useState(0)
  const wasPlayingRef = useRef(false)

  const syncStatus = useMemo(
    () => getPracticeSyncStatus({ hasMidi, hasMusicXml, isPlaying }),
    [hasMidi, hasMusicXml, isPlaying],
  )

  const isFollowingPlayback = hasMusicXml && isPlaying
  const canManualScrub = canManualScrubMusicXml({ isPlaying })

  const practiceTime = resolvePracticeTime({
    hasMusicXml,
    isPlaying,
    playbackCurrentTime,
    manualTime,
  })

  useEffect(() => {
    setManualTime(0)
  }, [sourcesRevision])

  useEffect(() => {
    const wasPlaying = wasPlayingRef.current
    if (wasPlaying && !isPlaying && hasMusicXml) {
      setManualTime(playbackCurrentTime)
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, playbackCurrentTime, hasMusicXml])

  const setManualTimeStable = useCallback((seconds) => {
    setManualTime(seconds)
  }, [])

  const syncManualTimeToPlayback = useCallback((seconds) => {
    setManualTime(seconds)
  }, [])

  // Stabilize the return identity. The clock is re-rendered on every audio
  // progress tick, so a fresh object literal here rebuilds the practice session
  // memo, the provider value and therefore every practice subscriber at the
  // tick rate — the same churn that produced the intermittent
  // "Maximum update depth exceeded" warning. Memoize on the real inputs so the
  // identity only moves when a value actually changes.
  return useMemo(
    () => ({
      practiceTime,
      manualTime,
      setManualTime: setManualTimeStable,
      syncManualTimeToMidi: syncManualTimeToPlayback,
      syncManualTimeToPlayback,
      syncStatus,
      isFollowingMidi: syncStatus === 'following-midi' || isFollowingPlayback,
      isFollowingPlayback,
      canManualScrub,
    }),
    [
      practiceTime,
      manualTime,
      setManualTimeStable,
      syncManualTimeToPlayback,
      syncStatus,
      isFollowingPlayback,
      canManualScrub,
    ],
  )
}
