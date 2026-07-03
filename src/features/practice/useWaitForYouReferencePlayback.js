import { useCallback, useEffect, useRef, useState } from 'react'
import { getExpectedMidis } from './waitForYouNoteMatch.js'
import { playReferenceMidis } from './referenceNotePlayer.js'
import { getInstrument } from '../instruments/instruments.js'

export const REFERENCE_PLAYBACK_UI_TIMEOUT_MS = 2000

export async function waitForReferencePlaybackToSettle(
  playbackPromise,
  timeoutMs = REFERENCE_PLAYBACK_UI_TIMEOUT_MS,
) {
  let playbackError = null
  const guardedPlayback = Promise.resolve(playbackPromise).catch((err) => {
    playbackError = err
  })
  let timeoutId = null

  try {
    await Promise.race([
      guardedPlayback,
      new Promise((resolve) => {
        timeoutId = globalThis.setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId != null) {
      globalThis.clearTimeout(timeoutId)
    }
  }

  if (playbackError) {
    throw playbackError
  }
}

export default function useWaitForYouReferencePlayback({ onBeforePlay, instrumentId = null } = {}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const playbackGenerationRef = useRef(0)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      playbackGenerationRef.current += 1
    }
  }, [])

  const playCheckpointReference = useCallback(async (checkpoint) => {
    const playbackGeneration = playbackGenerationRef.current + 1
    playbackGenerationRef.current = playbackGeneration
    const midis = getExpectedMidis(checkpoint)
    if (!midis.length) {
      return
    }

    onBeforePlay?.()
    setError(null)
    setIsPlaying(true)

    try {
      const duration = midis.length > 1 ? 0.7 : 0.55
      await waitForReferencePlaybackToSettle(
        playReferenceMidis(midis, duration, { instrumentId }),
        Math.max(REFERENCE_PLAYBACK_UI_TIMEOUT_MS, duration * 1000 + 900),
      )
    } catch (err) {
      if (!mountedRef.current || playbackGenerationRef.current !== playbackGeneration) {
        return
      }
      const detail = err instanceof Error ? err.message : 'Could not play reference'
      // Same phrasing as always ("Piano reference sound unavailable. …") with
      // the instrument name resolved from the registry.
      const message = `${getInstrument(instrumentId).label} reference sound unavailable. ${detail}`
      setError(message)
    } finally {
      if (mountedRef.current && playbackGenerationRef.current === playbackGeneration) {
        setIsPlaying(false)
      }
    }
  }, [onBeforePlay, instrumentId])

  return {
    isPlaying,
    error,
    playCheckpointReference,
  }
}
