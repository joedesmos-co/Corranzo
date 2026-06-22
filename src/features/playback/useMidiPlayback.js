import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { formatMidiImportError } from '../import/formatImportError.js'
import { MidiPlaybackEngine } from './midiPlaybackEngine.js'

export default function useMidiPlayback(midiSource) {
  const engineRef = useRef(null)
  const loadGenerationRef = useRef(0)
  const [tracks, setTracks] = useState([])
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [instrumentStatus, setInstrumentStatus] = useState(null)

  useEffect(() => {
    const engine = new MidiPlaybackEngine()
    engine.onTimeUpdate = (time, total) => {
      setCurrentTime(time)
      setDuration(total)
      setIsPlaying(engine.isPlaying())
    }
    engine.onInstrumentStatus = (status) => {
      setInstrumentStatus(status)
    }
    engineRef.current = engine

    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const midiData = midiSource?.data
  const midiFileName = midiSource?.fileName

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) {
      return undefined
    }

    if (!midiData) {
      engine.stop()
      setTracks([])
      setDuration(0)
      setCurrentTime(0)
      setIsPlaying(false)
      setError(null)
      setIsLoading(false)
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
        const result = await engine.load(midiData)
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
  }, [midiData, midiFileName, midiData?.byteLength])

  const play = useCallback(() => {
    const engine = engineRef.current
    if (!engine) {
      return
    }

    setIsPlaying(true)
    const audioStart = Tone.start()

    engine
      .playFromUserGesture(audioStart)
      .catch((playError) => {
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
      previous.map((track) =>
        track.id === trackId ? { ...track, muted } : track,
      ),
    )
  }, [])

  return {
    tracks,
    duration,
    currentTime,
    isPlaying,
    isLoading,
    error,
    instrumentStatus,
    play,
    pause,
    stop,
    seek,
    testSound,
    setTrackMuted,
  }
}
