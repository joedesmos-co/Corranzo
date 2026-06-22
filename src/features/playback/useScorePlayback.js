import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { formatMidiImportError } from '../import/formatImportError.js'
import { displayTempoAtTime } from './scorePlaybackSchedule.js'
import { ScorePlaybackEngine } from './scorePlaybackEngine.js'

/**
 * Playback hook driven by the performed score timeline (MusicXML required).
 */
export default function useScorePlayback({
  timingMap,
  midiSource,
  timingLoading = false,
  alignmentDiagnostics = null,
}) {
  const engineRef = useRef(null)
  const loadGenerationRef = useRef(0)
  const [tracks, setTracks] = useState([])
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [metronomeEnabled, setMetronomeEnabledState] = useState(false)
  const [metronomeLevel, setMetronomeLevelState] = useState(0.6)
  const [mappingWarning, setMappingWarning] = useState(null)
  const [audioSource, setAudioSource] = useState('musicxml')
  const [instrumentStatus, setInstrumentStatus] = useState(null)

  useEffect(() => {
    const engine = new ScorePlaybackEngine()
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
        setMappingWarning(null)
        setAudioSource('musicxml')
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
      setMappingWarning(null)
      setAudioSource('musicxml')
      engine.stop()

      try {
        const result = await engine.load({
          timingMap,
          midiArrayBuffer: midiData ?? null,
          alignmentDiagnostics,
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
        setMappingWarning(result.mappingWarning ?? null)
        setAudioSource(
          result.mappingMethod && result.mappingMethod !== 'none' ? 'midi' : 'musicxml',
        )
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
  }, [
    timingMap,
    timingRevision,
    timingLoading,
    midiData,
    midiFileName,
    midiData?.byteLength,
    alignmentDiagnostics,
  ])

  const effectiveTempo = useMemo(() => {
    if (!timingMap) {
      return null
    }
    return Math.round(displayTempoAtTime(timingMap, currentTime, playbackRate))
  }, [timingMap, currentTime, playbackRate])

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

  const setMetronomeEnabled = useCallback((enabled) => {
    engineRef.current?.setMetronomeEnabled(enabled)
    setMetronomeEnabledState(enabled)
  }, [])

  const setMetronomeLevel = useCallback((level) => {
    engineRef.current?.setMetronomeLevel(level)
    setMetronomeLevelState(level)
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

  // Stable callback: returns the engine's real-time score position (wall-clock
  // interpolated).  Used by the display-cursor RAF loop so the cursor position
  // updates every animation frame instead of only every SCHEDULE_TICK_MS (200 ms).
  const getScoreTime = useCallback(
    () => engineRef.current?.getCurrentScoreTime() ?? 0,
    [],
  )

  return {
    tracks,
    duration,
    currentTime,
    isPlaying,
    isLoading,
    error,
    playbackRate,
    metronomeEnabled,
    metronomeLevel,
    effectiveTempo,
    mappingWarning,
    audioSource,
    instrumentStatus,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
    setMetronomeEnabled,
    setMetronomeLevel,
    testSound,
    setTrackMuted,
    getScoreTime,
  }
}
