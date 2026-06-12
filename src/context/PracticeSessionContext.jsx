import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { disposeReferencePlayer } from '../features/practice/referenceNotePlayer.js'
import { setupAudioVisibilityResume } from '../features/audio/audioLifecycle.js'
import { isDemoFixtureFileSet } from '../features/demo/demoBundledAnchors.js'
import { buildPdfFingerprint } from '../features/score-follow/scoreFollowStorage.js'
import usePracticeSession from '../features/practice/usePracticeSession.js'
import useWaitForYouNoteTarget from '../features/practice/useWaitForYouNoteTarget.js'
import useScoreFollow from '../features/score-follow/useScoreFollow.js'
import { WFY_CHECKPOINT_MODE } from '../features/practice/waitForYouCheckpointMode.js'
import { WFY_STATUS } from '../features/practice/waitForYouEngine.js'
import usePracticeStatsTracker from '../features/profile/usePracticeStatsTracker.js'
import { useProfileStats } from './ProfileStatsContext.jsx'
import { PracticeTickContext, ScoreFollowCursorContext } from './PracticeTickContext.jsx'

const PracticeSessionContext = createContext(null)
const PracticeSessionStableContext = createContext(null)

export function PracticeSessionProvider({
  activeView = 'library',
  midiSource,
  musicXmlSource,
  pdfMeta,
  pdfFile,
  pdfFileName,
  hasPdf,
  numPages = null,
  visiblePageNumber = 1,
  pdfSoftWarning = null,
  initialPracticePrefs = null,
  sessionFilesReady = false,
  isDemoPiece = false,
  onPracticePrefsChange,
  children,
}) {
  const { recordWfyManualContinue } = useProfileStats()

  const resolvedDemoPiece = useMemo(
    () =>
      isDemoPiece ||
      isDemoFixtureFileSet(
        pdfFileName ?? pdfMeta?.fileName ?? null,
        musicXmlSource?.fileName ?? null,
      ),
    [isDemoPiece, pdfFileName, pdfMeta?.fileName, musicXmlSource?.fileName],
  )

  const session = usePracticeSession({
    midiSource,
    musicXmlSource,
    pdfSoftWarning,
    hasPdf,
    practiceActive: activeView === 'practice',
    initialPracticePrefs,
    isDemoPiece: resolvedDemoPiece,
    onRecordManualContinue: recordWfyManualContinue,
  })

  const pdfFingerprint = useMemo(() => buildPdfFingerprint(pdfMeta), [pdfMeta])

  const sessionReady = Boolean(
    sessionFilesReady &&
      hasPdf &&
      !session.timing.isLoading &&
      Boolean(session.timing.timingMap),
  )

  usePracticeStatsTracker({
    enabled: activeView === 'practice',
    sessionReady,
    pdfMeta,
    musicXmlSource,
    timingMap: session.timing.timingMap,
    isDemoPiece: resolvedDemoPiece,
    practiceMode: session.practiceMode,
    isWaitForYou: session.isWaitForYou,
    wfyInputSource: session.wfyInputSource,
    waitForYouInput: session.waitForYouInput,
    playback: session.playback,
    loop: session.loop,
  })

  const scoreFollow = useScoreFollow({
    timingMap: session.timing.timingMap,
    timingLoading: session.timing.isLoading,
    timingSourceId: session.sources.timingFileName ?? session.timing.timingMap?.fileName ?? null,
    practiceTime: session.clock.practiceTime,
    pdfFingerprint,
    pdfFileName: pdfMeta?.fileName ?? pdfFileName ?? null,
    pdfSource: pdfFile ?? null,
    numPages,
    hasPdf,
    visiblePageNumber,
    isPlaying: session.playback.isPlaying,
    sessionReady,
    isDemoPiece: resolvedDemoPiece,
  })

  const waitForYouNoteTarget = useWaitForYouNoteTarget({
    active: session.isWaitForYou,
    checkpointMode: session.checkpointMode,
    waitForYouStatus: session.waitForYou.status,
    currentCheckpoint: session.waitForYou.currentCheckpoint,
    timingMap: session.timing.timingMap,
    anchors: scoreFollow.displayAnchors ?? scoreFollow.anchors,
    visiblePageNumber,
  })

  const hidePlaybackScoreFollowCursor =
    session.isWaitForYou &&
    session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    session.waitForYou.status === WFY_STATUS.WAITING

  const wfyNoteMode =
    session.isWaitForYou && session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE

  const previousViewRef = useRef(activeView)

  useEffect(() => {
    onPracticePrefsChange?.(session.practicePrefsSnapshot)
  }, [session.practicePrefsSnapshot, onPracticePrefsChange])

  useEffect(() => {
    return () => {
      disposeReferencePlayer()
    }
  }, [])

  useEffect(() => {
    return setupAudioVisibilityResume(() => [])
  }, [])

  useEffect(() => {
    const previousView = previousViewRef.current
    previousViewRef.current = activeView

    if (previousView === 'practice' && activeView !== 'practice') {
      session.playback.pause()
      scoreFollow.setAlignmentMode(false)
    }
  }, [activeView, session.playback.pause, scoreFollow.setAlignmentMode])

  const tickValue = useMemo(
    () => ({
      practiceTime: session.clock.practiceTime,
      playbackCurrentTime: session.playback.currentTime,
      playbackDuration: session.playback.duration,
      playbackIsPlaying: session.playback.isPlaying,
    }),
    [
      session.clock.practiceTime,
      session.playback.currentTime,
      session.playback.duration,
      session.playback.isPlaying,
    ],
  )

  const wfyNoteTargetVisible =
    wfyNoteMode && (waitForYouNoteTarget?.showOnPage ?? false)

  const cursorValue = useMemo(
    () => ({
      displayCursor: scoreFollow.displayCursor ?? scoreFollow.cursor,
      cursorVisibility:
        hidePlaybackScoreFollowCursor || wfyNoteTargetVisible
          ? {
              show: false,
              reason: hidePlaybackScoreFollowCursor
                ? 'wait-for-you-note'
                : 'note-target',
              cursorPage: scoreFollow.cursorVisibility?.cursorPage ?? null,
            }
          : scoreFollow.cursorVisibility,
      noteTarget: waitForYouNoteTarget?.target ?? null,
      showNoteTarget: wfyNoteTargetVisible,
      hidePlaybackScoreFollowCursor,
    }),
    [
      scoreFollow.displayCursor,
      scoreFollow.cursor,
      scoreFollow.cursorVisibility,
      hidePlaybackScoreFollowCursor,
      waitForYouNoteTarget?.target,
      waitForYouNoteTarget?.showOnPage,
      wfyNoteTargetVisible,
    ],
  )

  const value = useMemo(
    () => ({
      session,
      scoreFollow,
      waitForYouNoteTarget,
      hidePlaybackScoreFollowCursor,
      sessionReady,
    }),
    [session, scoreFollow, waitForYouNoteTarget, hidePlaybackScoreFollowCursor, sessionReady],
  )

  const stableValue = useMemo(
    () => ({
      hasMidi: session.hasMidi,
      hasMusicXml: session.hasMusicXml,
      sources: session.sources,
      playback: {
        isLoading: session.playback.isLoading,
        error: session.playback.error,
        controlsDisabled: session.playback.controlsDisabled,
        playDisabled: session.playback.playDisabled,
        seekDisabled: session.playback.seekDisabled,
        transportHint: session.playback.transportHint,
        testSound: session.playback.testSound,
        pause: session.playback.pause,
        playbackRate: session.playback.playbackRate,
        effectiveTempo: session.playback.effectiveTempo,
        metronomeEnabled: session.playback.metronomeEnabled,
        metronomeLevel: session.playback.metronomeLevel,
        mappingWarning: session.playback.mappingWarning,
        setPlaybackRate: session.playback.setPlaybackRate,
        setMetronomeEnabled: session.playback.setMetronomeEnabled,
        setMetronomeLevel: session.playback.setMetronomeLevel,
      },
      handlePlay: session.handlePlay,
      handleMidiStop: session.handleMidiStop,
      handleMidiSeek: session.handleMidiSeek,
    }),
    [
      session.hasMidi,
      session.hasMusicXml,
      session.sources,
      session.playback.isLoading,
      session.playback.error,
      session.playback.controlsDisabled,
      session.playback.playDisabled,
      session.playback.seekDisabled,
      session.playback.transportHint,
      session.playback.testSound,
      session.playback.pause,
      session.playback.playbackRate,
      session.playback.effectiveTempo,
      session.playback.metronomeEnabled,
      session.playback.metronomeLevel,
      session.playback.mappingWarning,
      session.playback.setPlaybackRate,
      session.playback.setMetronomeEnabled,
      session.playback.setMetronomeLevel,
      session.handlePlay,
      session.handleMidiStop,
      session.handleMidiSeek,
    ],
  )

  return (
    <PracticeSessionContext.Provider value={value}>
      <PracticeSessionStableContext.Provider value={stableValue}>
        <PracticeTickContext.Provider value={tickValue}>
          <ScoreFollowCursorContext.Provider value={cursorValue}>
            {children}
          </ScoreFollowCursorContext.Provider>
        </PracticeTickContext.Provider>
      </PracticeSessionStableContext.Provider>
    </PracticeSessionContext.Provider>
  )
}

export function usePracticeSessionStable() {
  const value = useContext(PracticeSessionStableContext)
  if (!value) {
    throw new Error('usePracticeSessionStable must be used within PracticeSessionProvider')
  }
  return value
}

export function usePracticeSessionContext() {
  const context = useContext(PracticeSessionContext)
  if (!context) {
    throw new Error('usePracticeSessionContext must be used within PracticeSessionProvider')
  }
  return context
}

/**
 * Optional hook for components outside the provider (returns null).
 */
export function usePracticeSessionContextOptional() {
  return useContext(PracticeSessionContext)
}
