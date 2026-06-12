import { useCallback, useState } from 'react'
import { getExpectedMidis } from './waitForYouNoteMatch.js'
import { playReferenceMidis } from './referenceNotePlayer.js'

export default function useWaitForYouReferencePlayback({ onBeforePlay } = {}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState(null)

  const playCheckpointReference = useCallback(async (checkpoint) => {
    const midis = getExpectedMidis(checkpoint)
    if (!midis.length) {
      return
    }

    onBeforePlay?.()
    setError(null)
    setIsPlaying(true)

    try {
      const duration = midis.length > 1 ? 0.7 : 0.55
      await playReferenceMidis(midis, duration)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not play reference'
      setError(message)
    } finally {
      setIsPlaying(false)
    }
  }, [onBeforePlay])

  return {
    isPlaying,
    error,
    playCheckpointReference,
  }
}
