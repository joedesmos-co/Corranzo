import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useWebMidiInput from '../midi-input/useWebMidiInput.js'
import { isWebMidiSupported } from '../midi-input/parseMidiMessage.js'
import { WEB_MIDI_PERMISSION, WEB_MIDI_SUPPORT } from '../midi-input/webMidiConstants.js'
import useMicrophoneCapture from '../microphone-input/useMicrophoneCapture.js'
import { isMicrophoneSupported } from '../microphone-input/micEnvironment.js'
import { WFY_INPUT_SOURCE } from '../microphone-input/micInputConstants.js'
import { idleFeedbackForCheckpoint } from './waitForYouInputFeedback.js'
import useWaitForYouMicInput from './useWaitForYouMicInput.js'
import useScorePlayback from '../playback/useScorePlayback.js'
import useMusicXmlTiming from '../musicxml/useMusicXmlTiming.js'
import usePracticeClock from './usePracticeClock.js'
import useAlignmentDiagnostics from './useAlignmentDiagnostics.js'
import useMeasureNavigation from './useMeasureNavigation.js'
import useBeatNavigation from './useBeatNavigation.js'
import usePracticeLoop from './usePracticeLoop.js'
import useLoopPlayback from './useLoopPlayback.js'
import useWaitForYou from './useWaitForYou.js'
import useWaitForYouMidiInput from './useWaitForYouMidiInput.js'
import { getBeatAtTime, getMeasureAtTime } from '../musicxml/timingQuery.js'
import { PRACTICE_MODE } from './practiceMode.js'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import useWaitForYouMatchSettings from './useWaitForYouMatchSettings.js'
import useWaitForYouReferencePlayback from './useWaitForYouReferencePlayback.js'
import useImportReadiness from '../import/useImportReadiness.js'
import { savePracticePrefs, loadPracticePrefs } from '../session/practicePrefsStorage.js'

/**
 * Wires playback, timing, navigation, loop, and Wait For You hooks for the Practice view.
 */
export default function usePracticeSession({
  midiSource,
  musicXmlSource,
  pdfSoftWarning = null,
  hasPdf = false,
  practiceActive = true,
  initialPracticePrefs = null,
  isDemoPiece = false,
  onRecordManualContinue = null,
}) {
  const prefs = initialPracticePrefs ?? loadPracticePrefs() ?? {}

  const [practiceMode, setPracticeMode] = useState(
    prefs.practiceMode ?? PRACTICE_MODE.NORMAL,
  )
  const [checkpointMode, setCheckpointMode] = useState(
    prefs.checkpointMode ?? WFY_CHECKPOINT_MODE.BEAT,
  )
  const matchSettingsState = useWaitForYouMatchSettings(prefs.matchSettings)
  const autoMidiRequestedRef = useRef(false)
  const ensurePausedRef = useRef(() => {})

  const defaultWfyInputSource = isWebMidiSupported()
    ? WFY_INPUT_SOURCE.MIDI
    : isMicrophoneSupported()
      ? WFY_INPUT_SOURCE.MICROPHONE
      : WFY_INPUT_SOURCE.MANUAL

  const [wfyInputSource, setWfyInputSource] = useState(
    prefs.wfyInputSource ?? defaultWfyInputSource,
  )

  const timing = useMusicXmlTiming(musicXmlSource, 0)

  const alignment = useAlignmentDiagnostics(midiSource, timing.timingMap)

  const playback = useScorePlayback({
    timingMap: timing.timingMap,
    midiSource,
    timingLoading: timing.isLoading,
    alignmentDiagnostics: alignment.diagnostics,
  })

  const hasMidi = Boolean(midiSource?.data)
  const hasMusicXml = Boolean(musicXmlSource?.data)
  const isWaitForYou = practiceMode === PRACTICE_MODE.WAIT_FOR_YOU

  const sourcesRevision = useMemo(
    () =>
      [
        midiSource?.fileName ?? '',
        midiSource?.data?.byteLength ?? 0,
        musicXmlSource?.fileName ?? '',
        musicXmlSource?.data?.byteLength ?? 0,
      ].join('|'),
    [midiSource, musicXmlSource],
  )

  const clock = usePracticeClock({
    hasMidi,
    hasMusicXml,
    isPlaying: playback.isPlaying,
    playbackCurrentTime: playback.currentTime,
    sourcesRevision,
  })

  const practiceTime = clock.practiceTime

  const importReadiness = useImportReadiness({
    hasPdf,
    hasMidi,
    hasMusicXml,
    timingMap: timing.timingMap,
    timingError: timing.error,
    timingLoading: timing.isLoading,
    midiTracks: playback.tracks,
    midiDuration: playback.duration,
    midiError: playback.error,
    midiLoading: playback.isLoading,
    alignmentDiagnostics: alignment.diagnostics,
    pdfSoftWarning,
    isDemoPiece,
  })

  const timingDisabled = !timing.timingMap || timing.isLoading

  const currentMeasureForLoop = timing.timingMap
    ? getMeasureAtTime(timing.timingMap, practiceTime)
    : null
  const currentBeatForLoop = timing.timingMap
    ? getBeatAtTime(timing.timingMap, practiceTime)
    : null

  const ensurePaused = useCallback(() => {
    if (playback.isPlaying) {
      playback.pause()
    }
  }, [playback])

  ensurePausedRef.current = ensurePaused

  useEffect(() => {
    if (prefs.practiceTime != null && hasMusicXml && !hasMidi) {
      clock.setManualTime(prefs.practiceTime)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- restore once on mount

  useEffect(() => {
    if (!hasMusicXml) {
      return
    }
    playback.seek(0)
    clock.syncManualTimeToMidi(0)
    clock.setManualTime(0)
  }, [sourcesRevision]) // eslint-disable-line react-hooks/exhaustive-deps -- new score files → start at 0

  const seekToPracticeTime = useCallback(
    (seconds) => {
      if (hasMusicXml) {
        playback.seek(seconds)
        if (clock.canManualScrub) {
          clock.syncManualTimeToPlayback(seconds)
        }
      }
    },
    [hasMusicXml, playback, clock.canManualScrub, clock.syncManualTimeToPlayback],
  )

  const referencePlayback = useWaitForYouReferencePlayback({
    onBeforePlay: () => ensurePausedRef.current(),
  })

  const loop = usePracticeLoop(
    timing.timingMap,
    currentMeasureForLoop,
    currentBeatForLoop,
    prefs.loop,
  )

  const waitForYou = useWaitForYou({
    practiceMode,
    checkpointMode,
    timingMap: timing.timingMap,
    loopRegion: loop.region,
    seekToPracticeTime,
    onEnsurePaused: ensurePaused,
    practiceTime: clock.practiceTime,
  })

  const micCaptureActive =
    practiceActive && wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE

  const microphone = useMicrophoneCapture({ active: micCaptureActive })

  const webMidi = useWebMidiInput({
    listen:
      isWaitForYou &&
      checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
      wfyInputSource === WFY_INPUT_SOURCE.MIDI,
  })

  const waitForYouMidi = useWaitForYouMidiInput({
    active: isWaitForYou && wfyInputSource === WFY_INPUT_SOURCE.MIDI,
    checkpointMode,
    currentCheckpoint: waitForYou.currentCheckpoint,
    matchSettings: matchSettingsState.settings,
    onPlayerInputMatched: waitForYou.onPlayerInputMatched,
    webMidi,
  })

  const waitForYouMic = useWaitForYouMicInput({
    active: practiceActive && wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE,
    checkpointMode,
    currentCheckpoint: waitForYou.currentCheckpoint,
    matchSettings: matchSettingsState.settings,
    onPlayerInputMatched: waitForYou.onPlayerInputMatched,
    microphone,
  })

  const handleWfyInputSourceChange = useCallback(
    (source) => {
      if (source !== WFY_INPUT_SOURCE.MICROPHONE) {
        microphone.disable()
      }
      setWfyInputSource(source)
    },
    [microphone],
  )

  useEffect(() => {
    const shouldAutoEnable =
      isWaitForYou &&
      checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
      wfyInputSource === WFY_INPUT_SOURCE.MIDI &&
      webMidi.support === WEB_MIDI_SUPPORT.SUPPORTED &&
      webMidi.permission === WEB_MIDI_PERMISSION.PROMPT &&
      !autoMidiRequestedRef.current

    if (!shouldAutoEnable) {
      return
    }

    autoMidiRequestedRef.current = true
    webMidi.requestAccess()
  }, [isWaitForYou, checkpointMode, wfyInputSource, webMidi])

  const waitForYouInput = useMemo(() => {
    if (wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE) {
      return {
        source: WFY_INPUT_SOURCE.MICROPHONE,
        ...waitForYouMic,
      }
    }
    if (wfyInputSource === WFY_INPUT_SOURCE.MIDI) {
      return {
        source: WFY_INPUT_SOURCE.MIDI,
        ...waitForYouMidi,
      }
    }
    return {
      source: WFY_INPUT_SOURCE.MANUAL,
      matchingEnabled: false,
      inputFeedback: idleFeedbackForCheckpoint(waitForYou.currentCheckpoint),
      feedbackOutcome: 'idle',
      isChordCheckpoint: Boolean(waitForYou.currentCheckpoint?.isChord),
    }
  }, [
    wfyInputSource,
    waitForYouMic,
    waitForYouMidi,
    waitForYou.currentCheckpoint,
  ])

  const waitForYouRef = useRef(waitForYou)
  waitForYouRef.current = waitForYou

  const seekToPracticeTimeWithWfy = useCallback(
    (seconds) => {
      seekToPracticeTime(seconds)
      if (practiceMode === PRACTICE_MODE.WAIT_FOR_YOU) {
        waitForYouRef.current.syncToNearestCheckpoint(seconds)
      }
    },
    [seekToPracticeTime, practiceMode],
  )

  const measure = useMeasureNavigation(
    timing.timingMap,
    practiceTime,
    seekToPracticeTimeWithWfy,
  )

  const beat = useBeatNavigation(
    timing.timingMap,
    practiceTime,
    seekToPracticeTimeWithWfy,
  )

  const handleLoopRestart = useCallback(
    (seconds) => {
      seekToPracticeTimeWithWfy(seconds)
    },
    [seekToPracticeTimeWithWfy],
  )

  useLoopPlayback({
    enabled: loop.enabled && !isWaitForYou,
    region: loop.region,
    isPlaying: playback.isPlaying,
    hasPlayback: hasMusicXml,
    currentTime: playback.currentTime,
    onLoopRestart: handleLoopRestart,
  })

  const handlePlay = useCallback(() => {
    if (isWaitForYou) {
      ensurePaused()
      return
    }
    playback.play()
  }, [isWaitForYou, ensurePaused, playback])

  const handleMidiStop = useCallback(() => {
    playback.stop()
    if (hasMusicXml) {
      clock.syncManualTimeToMidi(0)
      clock.setManualTime(0)
    }
    if (isWaitForYou) {
      waitForYou.restart()
    }
  }, [playback, hasMusicXml, clock, isWaitForYou, waitForYou])

  const handleMidiSeek = useCallback(
    (seconds) => {
      seekToPracticeTimeWithWfy(seconds)
    },
    [seekToPracticeTimeWithWfy],
  )

  const handleToggleMute = useCallback(
    (trackId, muted) => {
      playback.setTrackMuted(trackId, muted)
    },
    [playback],
  )

  const handlePracticeModeChange = useCallback(
    (mode) => {
      if (mode === PRACTICE_MODE.WAIT_FOR_YOU) {
        ensurePaused()
      }
      setPracticeMode(mode)
    },
    [ensurePaused],
  )

  const practicePrefsSnapshot = useMemo(
    () => ({
      practiceMode,
      checkpointMode,
      wfyInputSource,
      practiceTime: clock.practiceTime,
      loop: {
        snapMode: loop.snapMode,
        enabled: loop.enabled,
        startMeasureNumber: loop.startMeasureNumber,
        endMeasureNumber: loop.endMeasureNumber,
        startBeat: loop.startBeat,
        endBeat: loop.endBeat,
      },
      matchSettings: matchSettingsState.rawSettings,
    }),
    [
      practiceMode,
      checkpointMode,
      wfyInputSource,
      clock.practiceTime,
      loop.snapMode,
      loop.enabled,
      loop.startMeasureNumber,
      loop.endMeasureNumber,
      loop.startBeat,
      loop.endBeat,
      matchSettingsState.rawSettings,
    ],
  )

  useEffect(() => {
    savePracticePrefs(practicePrefsSnapshot)
  }, [practicePrefsSnapshot])

  const waitForYouForUi = useMemo(() => {
    const markCorrectFromUser = () => {
      onRecordManualContinue?.()
      waitForYou.markCorrectAndContinue()
    }
    return {
      ...waitForYou,
      markCorrectAndContinue: markCorrectFromUser,
    }
  }, [waitForYou, onRecordManualContinue])

  return {
    practicePrefsSnapshot,
    practiceMode,
    setPracticeMode: handlePracticeModeChange,
    isWaitForYou,
    hasMidi,
    hasMusicXml,
    sources: {
      playbackFileName: midiSource?.fileName ?? null,
      timingFileName: musicXmlSource?.fileName ?? null,
    },
    playback: {
      ...playback,
      controlsDisabled: !hasMusicXml || playback.isLoading,
      playDisabled: !hasMusicXml || playback.isLoading || isWaitForYou,
      seekDisabled: !hasMusicXml || isWaitForYou,
      transportHint: isWaitForYou
        ? 'Paused in Wait For You — press Enter or tap “I’m ready” to continue.'
        : null,
    },
    clock,
    practiceTime,
    timing,
    alignment,
    measure,
    beat,
    loop,
    waitForYou: waitForYouForUi,
    waitForYouMidi,
    waitForYouMic,
    waitForYouInput,
    wfyInputSource,
    setWfyInputSource: handleWfyInputSourceChange,
    microphone,
    matchSettings: matchSettingsState.settings,
    rawMatchSettings: matchSettingsState.rawSettings,
    updateMatchSetting: matchSettingsState.updateSetting,
    resetMatchSettings: matchSettingsState.resetSettings,
    referencePlayback,
    checkpointMode,
    setCheckpointMode,
    webMidi,
    timingDisabled,
    seekToPracticeTime: seekToPracticeTimeWithWfy,
    handlePlay,
    handleMidiStop,
    handleMidiSeek,
    handleToggleMute,
    importReadiness,
    isDemoPiece,
  }
}
