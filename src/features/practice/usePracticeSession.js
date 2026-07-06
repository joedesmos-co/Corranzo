import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import useWebMidiInput from '../midi-input/useWebMidiInput.js'
import { isWebMidiSupported } from '../midi-input/parseMidiMessage.js'
import { WEB_MIDI_PERMISSION, WEB_MIDI_SUPPORT } from '../midi-input/webMidiConstants.js'
import useMicrophoneCapture from '../microphone-input/useMicrophoneCapture.js'
import { isMicrophoneSupported } from '../microphone-input/micEnvironment.js'
import { MIC_PERMISSION, MIC_SUPPORT, WFY_INPUT_SOURCE } from '../microphone-input/micInputConstants.js'
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
import useWaitForYouGuidance from './useWaitForYouGuidance.js'
import {
  shouldShowWaitForYouInputSourceModal,
  waitForYouInputSourceIsReady,
} from './waitForYouInputSourceSession.js'
import {
  resolveWfyDisplayStatus,
  labelForWfyDisplayStatus,
} from './waitForYouDisplayStatus.js'
import useImportReadiness from '../import/useImportReadiness.js'
import { savePracticePrefs, loadPracticePrefs } from '../session/practicePrefsStorage.js'
import { quantizePracticeTime } from '../../context/PracticeTickContext.jsx'
import { getInstrument } from '../instruments/instruments.js'
import {
  PRACTICE_SCOPE,
  normalizePracticeScope,
  practiceScopeAppliesToTimingMap,
} from './practiceScope.js'
import {
  getTabPositionsForTimingMap,
  resolveStringsForTimingMap,
} from '../instruments/timingMapTabPositions.js'
import { enrichGuitarChordCheckpoint } from './guitarChordShapeCheckpoint.js'

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
  onRecordWfyEvent = null,
  onWfyCheckpointCompleted = null,
  instrumentId = null,
}) {
  const prefs = initialPracticePrefs ?? loadPracticePrefs() ?? {}
  const selectedInstrument = useMemo(() => getInstrument(instrumentId), [instrumentId])

  const [practiceMode, setPracticeMode] = useState(
    prefs.practiceMode ?? PRACTICE_MODE.NORMAL,
  )
  const [practiceScope, setPracticeScopeState] = useState(
    normalizePracticeScope(prefs.practiceScope),
  )
  const [checkpointMode, setCheckpointMode] = useState(
    prefs.checkpointMode === WFY_CHECKPOINT_MODE.BEAT
      ? WFY_CHECKPOINT_MODE.BEAT
      : WFY_CHECKPOINT_MODE.NOTE,
  )
  const matchSettingsState = useWaitForYouMatchSettings(prefs.matchSettings)
  const autoMidiRequestedRef = useRef(false)
  const autoMicRequestedRef = useRef(false)
  const ensurePausedRef = useRef(() => {})

  const defaultWfyInputSource = isWebMidiSupported()
    ? WFY_INPUT_SOURCE.MIDI
    : isMicrophoneSupported()
      ? WFY_INPUT_SOURCE.MICROPHONE
      : WFY_INPUT_SOURCE.MANUAL

  const [wfyInputSource, setWfyInputSource] = useState(
    prefs.wfyInputSource ?? defaultWfyInputSource,
  )
  const [wfyInputSourceSelectedThisSession, setWfyInputSourceSelectedThisSession] =
    useState(false)

  const timing = useMusicXmlTiming(musicXmlSource, 0)
  const practiceScopeAvailable = practiceScopeAppliesToTimingMap(
    timing.timingMap,
    selectedInstrument.id,
  )
  const effectivePracticeScope = practiceScopeAvailable
    ? practiceScope
    : PRACTICE_SCOPE.BOTH_HANDS

  const alignment = useAlignmentDiagnostics(midiSource, timing.timingMap)

  const playback = useScorePlayback({
    timingMap: timing.timingMap,
    midiSource,
    timingLoading: timing.isLoading,
    alignmentDiagnostics: alignment.diagnostics,
    instrumentId,
  })

  const hasMidi = Boolean(midiSource?.data)
  const hasMusicXml = Boolean(musicXmlSource?.data)
  const isWaitForYou = practiceMode === PRACTICE_MODE.WAIT_FOR_YOU
  const wfyInputSourceReady = waitForYouInputSourceIsReady({
    checkpointMode,
    sourceSelectedThisSession: wfyInputSourceSelectedThisSession,
  })
  const showWfyInputSourceModal = shouldShowWaitForYouInputSourceModal({
    isWaitForYou,
    checkpointMode,
    sourceSelectedThisSession: wfyInputSourceSelectedThisSession,
  })

  const sourcesRevision = useMemo(
    () => ({
      midiFileName: midiSource?.fileName ?? '',
      midiData: midiSource?.data ?? null,
      musicXmlFileName: musicXmlSource?.fileName ?? '',
      musicXmlData: musicXmlSource?.data ?? null,
    }),
    [midiSource?.fileName, midiSource?.data, musicXmlSource?.fileName, musicXmlSource?.data],
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
    musicXmlSource,
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
    setPracticeScopeState(PRACTICE_SCOPE.BOTH_HANDS)
  }, [sourcesRevision]) // eslint-disable-line react-hooks/exhaustive-deps -- new score files → start at 0

  const setPracticeScope = useCallback((scope) => {
    setPracticeScopeState(normalizePracticeScope(scope))
  }, [])

  const seekToPracticeTime = useCallback(
    (seconds, options = {}) => {
      if (!hasMusicXml) {
        return
      }
      // Paused scrub uses manualTime for practiceTime; flush so the score-follow
      // cursor and page follow see the new position in the same frame as the bar.
      const setPracticeTime = () => {
        clock.setManualTime(seconds)
      }
      if (options.sync === false) {
        setPracticeTime()
      } else {
        flushSync(setPracticeTime)
      }
      playback.seek(seconds)
    },
    [hasMusicXml, playback, clock.setManualTime],
  )

  const referencePlayback = useWaitForYouReferencePlayback({
    onBeforePlay: () => ensurePausedRef.current(),
    instrumentId,
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
    onCheckpointCompleted: onWfyCheckpointCompleted,
    practiceScope: effectivePracticeScope,
  })

  const wfyAdvanceRef = useRef(waitForYou.onPlayerInputMatched)
  const onRecordWfyEventRef = useRef(onRecordWfyEvent)
  useEffect(() => {
    wfyAdvanceRef.current = waitForYou.onPlayerInputMatched
  }, [waitForYou.onPlayerInputMatched])
  useEffect(() => {
    onRecordWfyEventRef.current = onRecordWfyEvent
  }, [onRecordWfyEvent])

  const handleWfyPlayerInputMatched = useCallback(() => {
    onRecordWfyEventRef.current?.('correct')
    wfyAdvanceRef.current()
  }, [])

  const handleWfyWrongNote = useCallback(() => {
    onRecordWfyEventRef.current?.('missed')
  }, [])

  const guidanceInstrument = selectedInstrument
  const guidanceStrings = useMemo(
    () => resolveStringsForTimingMap(timing.timingMap, guidanceInstrument),
    [timing.timingMap, guidanceInstrument],
  )
  const guidanceTabPositions = useMemo(
    () =>
      guidanceStrings && timing.timingMap
        ? getTabPositionsForTimingMap(timing.timingMap, guidanceInstrument)
        : null,
    [guidanceStrings, timing.timingMap, guidanceInstrument],
  )
  const enrichedWfyCheckpoint = useMemo(
    () =>
      waitForYou.currentCheckpoint
        ? enrichGuitarChordCheckpoint(waitForYou.currentCheckpoint, {
            instrumentId,
            tabPositions: guidanceTabPositions,
          })
        : null,
    [waitForYou.currentCheckpoint, instrumentId, guidanceTabPositions],
  )

  const micCaptureActive =
    practiceActive &&
    isWaitForYou &&
    wfyInputSourceReady &&
    wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE

  const microphone = useMicrophoneCapture({ active: micCaptureActive })

  const webMidi = useWebMidiInput({
    listen:
      practiceActive &&
      isWaitForYou &&
      wfyInputSourceReady &&
      checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
      wfyInputSource === WFY_INPUT_SOURCE.MIDI,
  })

  const waitForYouMidi = useWaitForYouMidiInput({
    active:
      isWaitForYou &&
      wfyInputSourceReady &&
      wfyInputSource === WFY_INPUT_SOURCE.MIDI &&
      !waitForYou.displayPhase,
    checkpointMode,
    currentCheckpoint: enrichedWfyCheckpoint ?? waitForYou.currentCheckpoint,
    matchSettings: matchSettingsState.settings,
    onPlayerInputMatched: handleWfyPlayerInputMatched,
    onWrongNote: handleWfyWrongNote,
    webMidi,
  })

  const waitForYouMic = useWaitForYouMicInput({
    active:
      isWaitForYou &&
      practiceActive &&
      wfyInputSourceReady &&
      wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE &&
      !waitForYou.displayPhase,
    checkpointMode,
    currentCheckpoint: enrichedWfyCheckpoint ?? waitForYou.currentCheckpoint,
    matchSettings: matchSettingsState.settings,
    onPlayerInputMatched: handleWfyPlayerInputMatched,
    onWrongNote: handleWfyWrongNote,
    microphone,
    instrumentId,
  })

  const handleWfyInputSourceChange = useCallback(
    (source) => {
      if (source !== WFY_INPUT_SOURCE.MICROPHONE) {
        microphone.disable()
      }
      setWfyInputSource(source)
      setWfyInputSourceSelectedThisSession(true)
    },
    [microphone],
  )

  useEffect(() => {
    if (!isWaitForYou) {
      setWfyInputSourceSelectedThisSession(false)
    }
  }, [isWaitForYou])

  useEffect(() => {
    if (!(isWaitForYou && wfyInputSourceReady && wfyInputSource === WFY_INPUT_SOURCE.MIDI)) {
      autoMidiRequestedRef.current = false
    }
  }, [isWaitForYou, wfyInputSourceReady, wfyInputSource])

  useEffect(() => {
    const shouldAutoEnable =
      isWaitForYou &&
      wfyInputSourceReady &&
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
  }, [isWaitForYou, wfyInputSourceReady, checkpointMode, wfyInputSource, webMidi])

  // Choosing Microphone is the whole setup: request permission automatically so
  // calibration starts on its own (no separate "enable mic" click in the main
  // path). Re-armed whenever the user leaves mic mode so re-entry re-requests.
  useEffect(() => {
    if (!(isWaitForYou && wfyInputSourceReady && wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE)) {
      autoMicRequestedRef.current = false
    }
  }, [isWaitForYou, wfyInputSourceReady, wfyInputSource])

  useEffect(() => {
    const shouldAutoRequest =
      isWaitForYou &&
      practiceActive &&
      wfyInputSourceReady &&
      checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
      wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE &&
      microphone.support === MIC_SUPPORT.SUPPORTED &&
      (microphone.permission === MIC_PERMISSION.PROMPT ||
        microphone.permission === MIC_PERMISSION.GRANTED) &&
      !microphone.isListening &&
      !autoMicRequestedRef.current

    if (!shouldAutoRequest) {
      return
    }

    autoMicRequestedRef.current = true
    microphone.requestAccess()
  }, [
    isWaitForYou,
    practiceActive,
    wfyInputSourceReady,
    checkpointMode,
    wfyInputSource,
    microphone,
  ])

  const idleWfyInputFeedback = useMemo(
    () =>
      idleFeedbackForCheckpoint(enrichedWfyCheckpoint ?? waitForYou.currentCheckpoint, {
        chordAsSequence:
          wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE &&
          Boolean(waitForYou.currentCheckpoint?.isChord) &&
          !Boolean(enrichedWfyCheckpoint?.isGuitarChordShape),
      }),
    [
      wfyInputSource,
      waitForYou.currentCheckpoint?.id,
      waitForYou.currentCheckpoint?.expectedMidi,
      waitForYou.currentCheckpoint?.expectedMidis,
      waitForYou.currentCheckpoint?.isChord,
      enrichedWfyCheckpoint?.isGuitarChordShape,
      enrichedWfyCheckpoint?.displayLabel,
    ],
  )

  const waitForYouInput = useMemo(() => {
    if (!wfyInputSourceReady) {
      return {
        source: WFY_INPUT_SOURCE.MANUAL,
        matchingEnabled: false,
        inputFeedback: idleWfyInputFeedback,
        feedbackOutcome: 'idle',
        isChordCheckpoint: Boolean(waitForYou.currentCheckpoint?.isChord),
      }
    }
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
      inputFeedback: idleWfyInputFeedback,
      feedbackOutcome: 'idle',
      isChordCheckpoint: Boolean(waitForYou.currentCheckpoint?.isChord),
    }
  }, [
    wfyInputSource,
    wfyInputSourceReady,
    idleWfyInputFeedback,
    waitForYouMic.inputFeedback,
    waitForYouMic.matchingEnabled,
    waitForYouMic.feedbackOutcome,
    waitForYouMic.lastHeardMidi,
    waitForYouMic.liveFrame,
    waitForYouMic.calibration,
    waitForYouMic.calibrationStatus,
    waitForYouMic.micEngineMode,
    waitForYouMic.micEngineV2Active,
    waitForYouMic.v2RuntimeError,
    waitForYouMic.micStatusLabel,
    waitForYouMic.micCalibrating,
    waitForYouMidi.inputFeedback,
    waitForYouMidi.matchingEnabled,
    waitForYouMidi.feedbackOutcome,
    waitForYou.currentCheckpoint?.isChord,
  ])

  // Instrument interpretation for guidance copy: fretted instruments get
  // position phrases ("fret 2 · D string"); keyboard instruments keep the
  // long-standing hand hints. The checkpoint engine itself stays generic.
  const waitForYouGuidance = useWaitForYouGuidance({
    active: isWaitForYou,
    currentCheckpoint: enrichedWfyCheckpoint ?? waitForYou.currentCheckpoint,
    inputFeedback: waitForYouInput.inputFeedback,
    matchingActive: Boolean(waitForYouInput.matchingEnabled),
    complete: waitForYou.isComplete,
    instrument: guidanceInstrument,
    strings: guidanceStrings,
    tabPositions: guidanceTabPositions,
    chordAsSequence:
      waitForYouInput.source === WFY_INPUT_SOURCE.MICROPHONE &&
      Boolean(waitForYou.currentCheckpoint?.isChord) &&
      !Boolean(enrichedWfyCheckpoint?.isGuitarChordShape),
    guitarChordShapeMode: Boolean(enrichedWfyCheckpoint?.isGuitarChordShape),
  })

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
    duration: playback.duration,
    onLoopRestart: handleLoopRestart,
  })

  const handlePlay = useCallback(() => {
    if (isWaitForYou) {
      ensurePaused()
      return
    }
    if (playback.isPlaying) {
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

  const practiceTimeForSnapshotDeps = playback.isPlaying
    ? quantizePracticeTime(clock.practiceTime)
    : clock.practiceTime

  const practicePrefsSnapshot = useMemo(
    () => ({
      practiceMode,
      practiceScope,
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
      practiceScope,
      checkpointMode,
      wfyInputSource,
      practiceTimeForSnapshotDeps,
      loop.snapMode,
      loop.enabled,
      loop.startMeasureNumber,
      loop.endMeasureNumber,
      loop.startBeat,
      loop.endBeat,
      matchSettingsState.rawSettings,
    ],
  )

  const practicePrefsSnapshotRef = useRef(practicePrefsSnapshot)
  practicePrefsSnapshotRef.current = practicePrefsSnapshot

  useEffect(() => {
    savePracticePrefs(practicePrefsSnapshotRef.current)
  }, [
    practiceMode,
    practiceScope,
    checkpointMode,
    wfyInputSource,
    loop.snapMode,
    loop.enabled,
    loop.startMeasureNumber,
    loop.endMeasureNumber,
    loop.startBeat,
    loop.endBeat,
    matchSettingsState.rawSettings,
  ])

  useEffect(() => {
    if (!playback.isPlaying) {
      savePracticePrefs(practicePrefsSnapshotRef.current)
      return undefined
    }
    const intervalId = window.setInterval(() => {
      savePracticePrefs(practicePrefsSnapshotRef.current)
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [playback.isPlaying])

  const waitForYouForUi = useMemo(() => {
    const markCorrectFromUser = () => {
      onRecordWfyEvent?.('manual-continue')
      waitForYou.markCorrectAndContinue({ immediate: true })
    }
    const skipCheckpoint = () => {
      onRecordWfyEvent?.('skipped')
      waitForYou.markCorrectAndContinue({ immediate: true })
    }
    const displayStatus = resolveWfyDisplayStatus({
      active: waitForYou.active,
      engineStatus: waitForYou.status,
      displayPhase: waitForYou.displayPhase,
      inputFeedback: waitForYouInput.inputFeedback,
      guidance: waitForYouGuidance.guidance,
    })
    return {
      ...waitForYou,
      enrichedCheckpoint: enrichedWfyCheckpoint,
      displayStatus,
      displayLabel: labelForWfyDisplayStatus(displayStatus),
      markCorrectAndContinue: markCorrectFromUser,
      skipCheckpoint,
      guidance: waitForYouGuidance.guidance,
      wrongAttempts: waitForYouGuidance.wrongAttempts,
      showHint: waitForYouGuidance.requestHint,
    }
  }, [
    waitForYou,
    waitForYouInput.inputFeedback,
    waitForYouGuidance,
    enrichedWfyCheckpoint,
    onRecordWfyEvent,
  ])

  const playbackForSession = useMemo(
    () => ({
      ...playback,
      controlsDisabled: !hasMusicXml || playback.isLoading,
      playDisabled: !hasMusicXml || playback.isLoading || isWaitForYou,
      seekDisabled: !hasMusicXml || isWaitForYou,
      transportHint: isWaitForYou
        ? 'Paused in Wait For You — play the target note or press Enter to continue.'
        : null,
    }),
    [
      playback,
      hasMusicXml,
      isWaitForYou,
    ],
  )

  return useMemo(
    () => ({
      practicePrefsSnapshot,
      practiceMode,
      setPracticeMode: handlePracticeModeChange,
      practiceScope: effectivePracticeScope,
      rawPracticeScope: practiceScope,
      practiceScopeAvailable,
      setPracticeScope,
      isWaitForYou,
      hasMidi,
      hasMusicXml,
      instrumentId,
      sources: {
        playbackFileName: midiSource?.fileName ?? null,
        timingFileName: musicXmlSource?.fileName ?? null,
      },
      playback: playbackForSession,
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
      wfyInputSourceReady,
      wfyInputSourceSelectedThisSession,
      showWfyInputSourceModal,
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
    }),
    [
      practicePrefsSnapshot,
      practiceMode,
      effectivePracticeScope,
      practiceScope,
      practiceScopeAvailable,
      setPracticeScope,
      handlePracticeModeChange,
      isWaitForYou,
      hasMidi,
      hasMusicXml,
      instrumentId,
      midiSource?.fileName,
      musicXmlSource?.fileName,
      playbackForSession,
      clock,
      practiceTime,
      timing,
      alignment,
      measure,
      beat,
      loop,
      waitForYouForUi,
      waitForYouMidi,
      waitForYouMic,
      waitForYouInput,
      wfyInputSource,
      wfyInputSourceReady,
      wfyInputSourceSelectedThisSession,
      showWfyInputSourceModal,
      handleWfyInputSourceChange,
      microphone,
      matchSettingsState.settings,
      matchSettingsState.rawSettings,
      matchSettingsState.updateSetting,
      matchSettingsState.resetSettings,
      referencePlayback,
      checkpointMode,
      setCheckpointMode,
      webMidi,
      timingDisabled,
      seekToPracticeTimeWithWfy,
      handlePlay,
      handleMidiStop,
      handleMidiSeek,
      handleToggleMute,
      importReadiness,
      isDemoPiece,
    ],
  )
}
