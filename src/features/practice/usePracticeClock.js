import { useEffect, useMemo, useRef, useState } from 'react'
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

  function syncManualTimeToPlayback(seconds) {
    setManualTime(seconds)
  }

  return {
    practiceTime,
    manualTime,
    setManualTime,
    syncManualTimeToMidi: syncManualTimeToPlayback,
    syncManualTimeToPlayback,
    syncStatus,
    isFollowingMidi: syncStatus === 'following-midi' || isFollowingPlayback,
    isFollowingPlayback,
    canManualScrub,
  }
}
