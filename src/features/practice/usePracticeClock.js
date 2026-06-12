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
  midiCurrentTime,
  sourcesRevision = '',
}) {
  const [manualTime, setManualTime] = useState(0)
  const wasPlayingRef = useRef(false)

  const syncStatus = useMemo(
    () => getPracticeSyncStatus({ hasMidi, hasMusicXml, isPlaying }),
    [hasMidi, hasMusicXml, isPlaying],
  )

  const isFollowingMidi = syncStatus === 'following-midi'
  const canManualScrub = canManualScrubMusicXml({ hasMidi, isPlaying })

  const practiceTime = resolvePracticeTime({
    hasMidi,
    hasMusicXml,
    isPlaying,
    midiCurrentTime,
    manualTime,
  })

  useEffect(() => {
    if (!hasMidi) {
      setManualTime(0)
    }
  }, [hasMidi])

  useEffect(() => {
    setManualTime(0)
  }, [sourcesRevision])

  useEffect(() => {
    const wasPlaying = wasPlayingRef.current
    if (wasPlaying && !isPlaying && hasMidi && hasMusicXml) {
      setManualTime(midiCurrentTime)
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, midiCurrentTime, hasMidi, hasMusicXml])

  function syncManualTimeToMidi(seconds) {
    setManualTime(seconds)
  }

  return {
    practiceTime,
    manualTime,
    setManualTime,
    syncManualTimeToMidi,
    syncStatus,
    isFollowingMidi,
    canManualScrub,
  }
}
