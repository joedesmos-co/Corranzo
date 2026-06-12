import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { formatMidiImportError } from '../import/formatImportError.js'
import { ScorePlaybackEngine } from './scorePlaybackEngine.js'

/**
 * Playback hook driven by the performed score timeline (MusicXML required).
 * Optional MIDI is mapped onto performed time; XML-only silent playback is supported.
 */
export default function useScorePlayback({ timingMap, midiSource, timingLoading = false }) {
  const engineRef = useRef(null)
  const loadGenerationRef = useRef(0)
  const [tracks, setTracks] = useState([])
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [playbackRate, setPlaybackRateState] = useState(1)

  useEffect(() => {
    const engine = new ScorePlaybackEngine()
    engine.onTimeUpdate = (time, total) => {
      setCurrentTime(time)
      setDuration(total)
      setIsPlaying(engine.isPlaying())
    }
    engineRef.current = engine

    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const midiData = midiSource?.data
  const midiFileName = midiSource?.fileName
  const timingRevision = timingMap?.fileName ?? timingMap?.durationSeconds ?? null

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) {
      return undefined
    }

    if (!timingMap || timingLoading) {
      if (!timingLoading) {
        engine.stop()
        setTracks([])
        setDuration(0)
        setCurrentTime(0)
        setIsPlaying(false)
        setError(null)
        setIsLoading(false)
      }
      return undefined
    }

    const loadGeneration = loadGenerationRef.current + 1
    loadGenerationRef.current = loadGeneration

    async function load() {
      setIsLoading(true)
      setError(null)
      setTracks([])
      setDuration(0)
      setCurrentTime(0)
      setIsPlaying(false)
      engine.stop()

      try {
        const result = await engine.load({
          timingMap,
          midiArrayBuffer: midiData ?? null,
        })
        if (loadGenerationRef.current !== loadGeneration) {
          return
        }
        if (!result) {
          setTracks([])
          setDuration(0)
          setCurrentTime(0)
          setIsPlaying(false)
          return
        }
        setTracks(result.tracks)
        setDuration(result.duration)
        setCurrentTime(0)
        setIsPlaying(false)
      } catch (loadError) {
        if (loadGenerationRef.current === loadGeneration) {
          setError(formatMidiImportError(loadError))
          setTracks([])
          setDuration(0)
          setCurrentTime(0)
          setIsPlaying(false)
        }
      } finally {
        if (loadGenerationRef.current === loadGeneration) {
          setIsLoading(false)
        }
      }
    }

    load()

    return () => {
      loadGenerationRef.current += 1
    }
  }, [timingMap, timingRevision, timingLoading, midiData, midiFileName, midiData?.byteLength])

  const play = useCallback(() => {
    const engine = engineRef.current
    if (!engine) {
      return
    }

    setIsPlaying(true)
    const audioStart = Tone.start()

    engine.playFromUserGesture(audioStart).catch((playError) => {
      setError(formatMidiImportError(playError))
      setIsPlaying(false)
    })
  }, [])

  const pause = useCallback(() => {
    engineRef.current?.pause()
    setIsPlaying(false)
  }, [])

  const stop = useCallback(() => {
    engineRef.current?.stop()
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  const seek = useCallback((seconds) => {
    engineRef.current?.seek(seconds)
    setCurrentTime(seconds)
  }, [])

  const setPlaybackRate = useCallback((rate) => {
    engineRef.current?.setPlaybackRate(rate)
    setPlaybackRateState(rate)
  }, [])

  const testSound = useCallback(() => {
    const engine = engineRef.current
    if (!engine) {
      return
    }

    const audioStart = Tone.start()
    engine.playTestTone(audioStart).catch((playError) => {
      setError(formatMidiImportError(playError))
    })
  }, [])

  const setTrackMuted = useCallback((trackId, muted) => {
    engineRef.current?.setTrackMuted(trackId, muted)
    setTracks((previous) =>
      previous.map((track) => (track.id === trackId ? { ...track, muted } : track)),
    )
  }, [])

  return {
    tracks,
    duration,
    currentTime,
    isPlaying,
    isLoading,
    error,
    playbackRate,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
    testSound,
    setTrackMuted,
  }
}
