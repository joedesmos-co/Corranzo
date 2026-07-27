import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startToneFromUserGesture } from '../audio/toneAudioUnlock.js'
import { formatMidiImportError } from '../import/formatImportError.js'
import { quantizePracticeTime } from '../../context/PracticeTickContext.jsx'
import { displayTempoAtTime } from './scorePlaybackSchedule.js'
import { METRONOME_COUNT_IN, METRONOME_SUBDIVISION } from './metronomeConstants.js'
import { ScorePlaybackEngine } from './scorePlaybackEngine.js'
import {
  describePlaybackEvents,
  pushScoreSourceContentTrace,
} from '../library/scoreSourceContentIdentity.js'
import {
  assertDerivedBelongsToActiveScore,
  logPlaybackSourceCheck,
} from '../score/activeScore.js'

/** React display rate for transport time — wall-clock playback stays accurate via getScoreTime(). */
const TIME_UPDATE_INTERVAL_MS = 100

/**
 * Playback hook driven by the performed score timeline (MusicXML required).
 */
export default function useScorePlayback({
  timingMap,
  midiSource,
  timingLoading = false,
  alignmentDiagnostics = null,
  instrumentId = null,
}) {
  const engineRef = useRef(null)
  const loadGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const [tracks, setTracks] = useState([])
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [metronomeEnabled, setMetronomeEnabledState] = useState(false)
  const [metronomeLevel, setMetronomeLevelState] = useState(0.6)
  const [metronomeSubdivision, setMetronomeSubdivisionState] = useState(
    METRONOME_SUBDIVISION.QUARTER,
  )
  const [metronomeCountIn, setMetronomeCountInState] = useState(METRONOME_COUNT_IN.OFF)
  const [metronomeDisplay, setMetronomeDisplay] = useState(null)
  const [mappingWarning, setMappingWarning] = useState(null)
  const [audioSource, setAudioSource] = useState('musicxml')
  const [instrumentStatus, setInstrumentStatus] = useState(null)

  useEffect(() => {
    // Re-arm on setup — StrictMode dev re-runs effects on the same fiber, and a
    // cleanup-only ref would stay false, dropping every engine time update.
    mountedRef.current = true
    const engine = new ScorePlaybackEngine()
    let lastTimeEmit = 0
    let pendingTime = null
    let pendingDuration = null
    let pendingIsPlaying = null
    let timeFlushId = null

    const flushTimeUpdate = () => {
      timeFlushId = null
      if (!mountedRef.current || pendingTime == null) {
        return
      }
      const nextTime = pendingTime
      pendingTime = null
      setCurrentTime((previous) => (Object.is(previous, nextTime) ? previous : nextTime))
      if (pendingDuration != null) {
        const nextDuration = pendingDuration
        pendingDuration = null
        setDuration((previous) => (Object.is(previous, nextDuration) ? previous : nextDuration))
      }
      if (pendingIsPlaying != null) {
        const nextPlaying = pendingIsPlaying
        pendingIsPlaying = null
        setIsPlaying((previous) => (previous === nextPlaying ? previous : nextPlaying))
      }
    }

    engine.onTimeUpdate = (time, total) => {
      if (!mountedRef.current) {
        return
      }
      pendingTime = time
      pendingDuration = total
      pendingIsPlaying = engine.isPlaying()
      const now = performance.now()
      if (now - lastTimeEmit >= TIME_UPDATE_INTERVAL_MS) {
        lastTimeEmit = now
        flushTimeUpdate()
        return
      }
      if (timeFlushId == null) {
        timeFlushId = requestAnimationFrame(() => {
          lastTimeEmit = performance.now()
          flushTimeUpdate()
        })
      }
    }
    engine.onInstrumentStatus = (status) => {
      if (!mountedRef.current) {
        return
      }
      setInstrumentStatus(status)
    }
    engine.onMetronomeDisplay = (state) => {
      if (!mountedRef.current) {
        return
      }
      setMetronomeDisplay((previous) => {
        if (
          previous?.phase === state.phase &&
          previous?.beat === state.beat &&
          previous?.measureNumber === state.measureNumber &&
          previous?.accent === state.accent &&
          previous?.countInActive === state.countInActive &&
          previous?.countInProgress === state.countInProgress
        ) {
          return previous
        }
        return state
      })
    }
    engineRef.current = engine

    return () => {
      mountedRef.current = false
      if (timeFlushId != null) {
        cancelAnimationFrame(timeFlushId)
      }
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const midiData = midiSource?.data
  const midiFileName = midiSource?.fileName
  // Key playback rebuilds by MusicXML *content*, not filename/duration alone.
  const timingRevision =
    timingMap?.sourceContentKey ??
    timingMap?.contentHash ??
    `${timingMap?.fileName ?? ''}:${timingMap?.durationSeconds ?? ''}:${timingMap?.noteCount ?? ''}`

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) {
      return undefined
    }

    if (!timingMap || timingLoading) {
      engine.stop()
      setIsPlaying((previous) => (previous ? false : previous))
      if (!timingMap) {
        setTracks((previous) => (previous.length === 0 ? previous : []))
        setDuration((previous) => (previous === 0 ? previous : 0))
        setCurrentTime((previous) => (previous === 0 ? previous : 0))
        setError((previous) => (previous == null ? previous : null))
        setMappingWarning((previous) => (previous == null ? previous : null))
        setAudioSource((previous) => (previous === 'musicxml' ? previous : 'musicxml'))
        pushScoreSourceContentTrace('playback-engine-cleared', {
          timingRevision: null,
        })
      }
      setIsLoading((previous) => {
        const next = Boolean(timingLoading)
        return previous === next ? previous : next
      })
      return undefined
    }

    const loadGeneration = loadGenerationRef.current + 1
    loadGenerationRef.current = loadGeneration
    const expectedContentHash = timingMap.contentHash ?? null

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
        pushScoreSourceContentTrace('playback-engine-load-start', {
          timingRevision,
          timingContentHash: expectedContentHash,
          measureCount: timingMap.measures?.length ?? null,
          durationSeconds: timingMap.durationSeconds ?? null,
          noteCount: timingMap.noteCount ?? timingMap.notes?.length ?? null,
          instrumentId,
        })
        const result = await engine.load({
          timingMap,
          midiArrayBuffer: midiData ?? null,
          alignmentDiagnostics,
          instrumentId,
        })
        if (loadGenerationRef.current !== loadGeneration) {
          pushScoreSourceContentTrace('playback-engine-load-stale', {
            expectedContentHash,
            loadGeneration,
            currentGeneration: loadGenerationRef.current,
            instrumentId,
          })
          return
        }
        if (!result) {
          setTracks([])
          setDuration(0)
          setCurrentTime(0)
          setIsPlaying(false)
          return
        }
        const eventSummary = describePlaybackEvents(engine.noteEvents)
        const ownerScoreId =
          timingMap.ownerScoreId ??
          (typeof window !== 'undefined'
            ? window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId ?? null
            : null)
        const activeScoreSnapshot =
          typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ : null
        if (ownerScoreId && activeScoreSnapshot?.scoreId) {
          assertDerivedBelongsToActiveScore(
            { ownerScoreId },
            { scoreId: activeScoreSnapshot.scoreId },
            'playback-timeline',
          )
        }
        logPlaybackSourceCheck({
          activeScore: {
            scoreId: activeScoreSnapshot?.scoreId ?? ownerScoreId,
            musicXml: { hash: expectedContentHash },
          },
          playbackOwnerScoreId: ownerScoreId,
          musicXmlHash: expectedContentHash,
        })
        pushScoreSourceContentTrace('playback-engine-events', {
          timingRevision,
          timingContentHash: expectedContentHash,
          ownerScoreId,
          duration: result.duration,
          events: eventSummary,
          instrumentId,
        })
        pushScoreSourceContentTrace('playback-timeline-rebuild', {
          timingRevision,
          timingContentHash: expectedContentHash,
          ownerScoreId,
          duration: result.duration,
          playbackInputIdentity: expectedContentHash,
          events: eventSummary,
          instrumentId,
          playableEventCount: eventSummary.count,
        })
        // Expose for browser automation assertions.
        if (typeof window !== 'undefined') {
          window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ = {
            timingContentHash: expectedContentHash,
            timingRevision,
            ownerScoreId,
            duration: result.duration,
            events: eventSummary,
            playbackInputIdentity: expectedContentHash,
            instrumentId,
            playableEventCount: eventSummary.count,
            firstMidi: eventSummary.first?.[0]?.midi ?? null,
            measureCount: timingMap.measures?.length ?? null,
            at: Date.now(),
          }
          window.__SCOREFLOW_GUITAR_PLAYBACK_TRACE__ = {
            instrumentId,
            timingContentHash: expectedContentHash,
            ownerScoreId,
            playableEventCount: eventSummary.count,
            firstEvents: eventSummary.first,
            duration: result.duration,
            mappingMethod: result.mappingMethod ?? null,
            audioSource: result.mappingMethod && result.mappingMethod !== 'none' ? 'midi' : 'musicxml',
            at: Date.now(),
          }
        }
        setTracks(result.tracks)
        setDuration(result.duration)
        setMappingWarning(result.mappingWarning ?? null)
        setAudioSource(
          result.mappingMethod && result.mappingMethod !== 'none' ? 'midi' : 'musicxml',
        )
        setCurrentTime(0)
        setIsPlaying(false)
        await engine.preload?.()
        try {
          await engine.ensureVoices?.()
        } catch {
          // Voice graph may not be ready before the first user gesture — non-fatal.
        }
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
    instrumentId,
  ])

  const quantizedTimeForTempo = quantizePracticeTime(currentTime)
  const effectiveTempo = useMemo(() => {
    if (!timingMap) {
      return null
    }
    return Math.round(displayTempoAtTime(timingMap, quantizedTimeForTempo, playbackRate))
  }, [timingMap, quantizedTimeForTempo, playbackRate])

  const play = useCallback(() => {
    const engine = engineRef.current
    if (!engine || engine.isPlaying()) {
      return
    }

    setIsPlaying(true)
    const audioStart = startToneFromUserGesture()

    engine.playFromUserGesture(audioStart).catch((playError) => {
      if (!mountedRef.current) {
        return
      }
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
    const engine = engineRef.current
    if (!engine) {
      return
    }
    engine.seek(seconds)
    setCurrentTime(engine.getCurrentScoreTime())
    setIsPlaying(engine.isPlaying())
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

  const setMetronomeSubdivision = useCallback((subdivision) => {
    engineRef.current?.setMetronomeSubdivision(subdivision)
    setMetronomeSubdivisionState(subdivision)
  }, [])

  const setMetronomeCountIn = useCallback((measureCount) => {
    engineRef.current?.setMetronomeCountIn(measureCount)
    setMetronomeCountInState(measureCount)
  }, [])

  const testSound = useCallback(() => {
    const engine = engineRef.current
    if (!engine) {
      return
    }

    const audioStart = startToneFromUserGesture()
    engine.playTestTone(audioStart).catch((playError) => {
      if (!mountedRef.current) {
        return
      }
      setError(formatMidiImportError(playError))
    })
  }, [])

  const setTrackMuted = useCallback((trackId, muted) => {
    engineRef.current?.setTrackMuted(trackId, muted)
    setTracks((previous) =>
      previous.map((track) => (track.id === trackId ? { ...track, muted } : track)),
    )
  }, [])

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
    metronomeSubdivision,
    metronomeCountIn,
    metronomeDisplay,
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
    setMetronomeSubdivision,
    setMetronomeCountIn,
    testSound,
    setTrackMuted,
    getScoreTime,
  }
}
