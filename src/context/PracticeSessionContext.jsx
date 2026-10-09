import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { disposeReferencePlayer, releaseReferenceVoices, warmupReferenceVoice } from '../features/practice/referenceNotePlayer.js'
import { setupAudioVisibilityResume } from '../features/audio/audioLifecycle.js'
import { isDemoFixtureFileSet } from '../features/demo/demoBundledAnchors.js'
import { buildPdfFingerprint } from '../features/score-follow/scoreFollowStorage.js'
import { resolvePracticePieceId, recordAutoPracticeLoop } from '../features/profile/autoPracticeTracker.js'
import usePracticeStatsTracker from '../features/profile/usePracticeStatsTracker.js'
import usePracticeSession from '../features/practice/usePracticeSession.js'
import useWaitForYouNoteTarget from '../features/practice/useWaitForYouNoteTarget.js'
import useScoreFollow from '../features/score-follow/useScoreFollow.js'
import { PRACTICE_MODE } from '../features/practice/practiceMode.js'
import {
  useScoreEventCheckpoints,
  useTimelineScoreTarget,
  useWfyScoreTrail,
} from '../features/practice/useScoreNoteTargets.js'
import {
  SCORE_NOTE_STATE,
  mapPlayAlongOutcomeToScoreState,
  resolveChordToneStates,
} from '../features/practice/scoreNoteStates.js'
import { resolveNoteTargetPosition } from '../features/practice/noteTargetPosition.js'

/** Nearest lane group to a score onset (±11 ms): links lane outcomes to score events. */
function groupAtOnset(groups, timeSeconds) {
  let best = null
  let bestDelta = 0.011
  for (const group of groups ?? []) {
    const delta = Math.abs(Number(group.timeSeconds) - Number(timeSeconds))
    if (delta < bestDelta) {
      best = group
      bestDelta = delta
    }
  }
  return best
}
import { WFY_CHECKPOINT_MODE } from '../features/practice/waitForYouCheckpointMode.js'
import { WFY_STATUS } from '../features/practice/waitForYouEngine.js'
import { useProfileStats } from './ProfileStatsContext.jsx'
import { PracticeTickContext, ScoreFollowCursorContext, quantizePracticeTime } from './PracticeTickContext.jsx'
import { useInstrument } from './instrumentContext.js'

const PracticeSessionContext = createContext(null)
const PracticeSessionStableContext = createContext(null)
const PracticeVisualContext = createContext(null)

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
  autoSetupGateOpen = true,
  experimentalOmrPlayback = false,
}) {
  const [pdfPageSizesState, setPdfPageSizesState] = useState(null)

  const { recordWfyEvent, refreshStats } = useProfileStats()
  const { instrumentId } = useInstrument()

  const resolvedDemoPiece = useMemo(
    () =>
      isDemoPiece ||
      isDemoFixtureFileSet(
        pdfFileName ?? pdfMeta?.fileName ?? null,
        musicXmlSource?.fileName ?? null,
      ),
    [isDemoPiece, pdfFileName, pdfMeta?.fileName, musicXmlSource?.fileName],
  )

  const practicePiece = useMemo(() => {
    const id = resolvePracticePieceId({
      pdfFingerprint: buildPdfFingerprint(pdfMeta),
      pdfFileName: pdfFileName ?? pdfMeta?.fileName ?? null,
      musicXmlFileName: musicXmlSource?.fileName ?? null,
    })
    if (!id) {
      return null
    }
    const title =
      (pdfFileName ?? pdfMeta?.fileName ?? musicXmlSource?.fileName ?? 'Practice piece')
        .replace(/\.[^.]+$/, '')
    return { id, title }
  }, [pdfMeta, pdfFileName, musicXmlSource?.fileName])

  const session = usePracticeSession({
    midiSource,
    musicXmlSource,
    pdfSoftWarning,
    hasPdf,
    practiceActive: activeView === 'practice',
    initialPracticePrefs,
    isDemoPiece: resolvedDemoPiece,
    onRecordWfyEvent: recordWfyEvent,
    onWfyCheckpointCompleted: ({ loopCompleted }) => {
      if (loopCompleted) {
        recordAutoPracticeLoop()
      }
    },
    instrumentId,
  })

  const pdfFingerprint = useMemo(() => buildPdfFingerprint(pdfMeta), [pdfMeta])

  const practiceStatsTracker = usePracticeStatsTracker({
    active: activeView === 'practice' && Boolean(practicePiece?.id),
    piece: practicePiece,
    measureNumber: session.measure.currentMeasure?.number ?? null,
    tempoBpm: session.playback.effectiveTempo ?? null,
    onStatsFlush: refreshStats,
    instrumentId,
  })

  const sessionReady = Boolean(
    sessionFilesReady &&
      hasPdf &&
      !session.timing.isLoading &&
      Boolean(session.timing.timingMap),
  )

  const scoreFollow = useScoreFollow({
    timingMap: session.timing.timingMap,
    timingLoading: session.timing.isLoading,
    timingSourceId: session.sources.timingFileName ?? session.timing.timingMap?.fileName ?? null,
    practiceTime: session.clock.practiceTime,
    getScoreTime: session.playback.getScoreTime,
    pdfFingerprint,
    pdfFileName: pdfMeta?.fileName ?? pdfFileName ?? null,
    pdfSource: pdfFile ?? null,
    numPages,
    hasPdf,
    visiblePageNumber,
    isPlaying: session.playback.isPlaying,
    sessionReady,
    isDemoPiece: resolvedDemoPiece,
    autoSetupGateOpen,
    experimentalOmrPlayback,
    omrMeasureGrid: experimentalOmrPlayback
      ? musicXmlSource?.omrMeta?.measureGrid ?? null
      : null,
  })

  useEffect(() => {
    if (
      experimentalOmrPlayback &&
      session.isWaitForYou &&
      !scoreFollow.canFollow &&
      !(session.sourceVisualMap?.anchorCount > 0)
    ) {
      session.setPracticeMode(PRACTICE_MODE.PREVIEW)
    }
  }, [
    experimentalOmrPlayback,
    session.isWaitForYou,
    session.setPracticeMode,
    session.sourceVisualMap?.anchorCount,
    scoreFollow.canFollow,
  ])

  const waitForYouNoteTarget = useWaitForYouNoteTarget({
    active: session.isWaitForYou,
    checkpointMode: session.checkpointMode,
    waitForYouStatus: session.waitForYou.status,
    currentCheckpoint: session.waitForYou.currentCheckpoint,
    timingMap: session.timing.timingMap,
    // Target resolution owns analysis/source coordinate conversion. Supplying
    // displayAnchors here would rotate anchor-derived targets a second time.
    anchors: scoreFollow.anchors,
    sourceVisualMap: session.sourceVisualMap,
    preferredRepresentation: scoreFollow.guitarScoreTarget?.activeTarget,
    mode: 'wait-for-you',
    visiblePageNumber,
  })

  const wfyNoteMode =
    session.isWaitForYou && session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE

  const wfyNoteTargetVisible =
    wfyNoteMode && (waitForYouNoteTarget?.showOnPage ?? false)

  // Timeline-following score highlight (Preview + Play Along): the note event
  // under the playhead, resolved through the same note-target geometry as
  // Wait For You so all three modes share one score language. Read-only —
  // it follows the timeline and never advances it.
  const isPlayAlong = session.practiceMode === PRACTICE_MODE.PLAY_ALONG
  const isPreview = session.practiceMode === PRACTICE_MODE.PREVIEW
  const timelineHighlightActive = isPlayAlong || isPreview
  const scoreEventCheckpoints = useScoreEventCheckpoints({
    timingMap: session.timing.timingMap,
    loopRegion: session.loop.enabled ? session.loop.region : null,
    practiceScope: session.practiceScope,
  })
  const timelineScoreTarget = useTimelineScoreTarget({
    checkpoints: scoreEventCheckpoints,
    practiceTime: session.clock.practiceTime,
    timingMap: session.timing.timingMap,
    anchors: scoreFollow.anchors,
    sourceVisualMap: session.sourceVisualMap,
    preferredRepresentation: scoreFollow.guitarScoreTarget?.activeTarget,
    mode: isPlayAlong ? 'play-along' : 'preview',
    enabled: timelineHighlightActive,
  })

  // Play Along accuracy on the score: lane outcomes (canonical bounded
  // evaluator, 150 ms early / 280 ms late) mapped onto score events by onset
  // proximity. Current event + a bounded trail of decided past events.
  // Keyed on the event index (not the clock), so geometry resolves once per
  // event while the playhead moves.
  const playAlongScoreStates = useMemo(() => {
    if (!isPlayAlong || timelineScoreTarget.index < 0) {
      return []
    }
    const timingMap = session.timing.timingMap
    const anchors = scoreFollow.anchors
    const sourceVisualMap = session.sourceVisualMap
    const preferredRepresentation = scoreFollow.guitarScoreTarget?.activeTarget
    const resolvePastTarget = (checkpoint) =>
      resolveNoteTargetPosition({
        checkpoint,
        timingMap,
        anchors,
        sourceVisualMap,
        preferredRepresentation,
        mode: 'play-along',
      })
    const groups = session.playAlongLaneGroups ?? []
    const outcomes = session.playAlongFeedback?.outcomes ?? new Map()
    const entries = []
    const currentCheckpoint = scoreEventCheckpoints[timelineScoreTarget.index] ?? null
    if (currentCheckpoint && timelineScoreTarget.target?.visible) {
      let state = SCORE_NOTE_STATE.CURRENT
      if (groups.length > 0) {
        const group = groupAtOnset(groups, currentCheckpoint.timeSeconds)
        const outcome = group ? outcomes.get(group.id) ?? null : null
        if (outcome) {
          state = mapPlayAlongOutcomeToScoreState(outcome)
        }
      }
      entries.push({
        key: `play-along-current:${currentCheckpoint.id ?? timelineScoreTarget.index}`,
        checkpoint: currentCheckpoint,
        target: timelineScoreTarget.target,
        state,
        toneStates: null,
      })
    }
    if (groups.length > 0) {
      // Decided past events: most recent first, bounded so seeking through a
      // long piece cannot queue hundreds of geometry resolutions per event.
      let resolved = 0
      for (let index = timelineScoreTarget.index - 1; index >= 0; index -= 1) {
        const checkpoint = scoreEventCheckpoints[index] ?? null
        if (!checkpoint) {
          continue
        }
        const group = groupAtOnset(groups, checkpoint.timeSeconds)
        const outcome = group ? outcomes.get(group.id) ?? null : null
        if (!outcome) {
          continue
        }
        const target = resolvePastTarget(checkpoint)
        if (!target?.visible) {
          continue
        }
        let state = mapPlayAlongOutcomeToScoreState(outcome)
        // Past misses stay visible but muted — the current event owns the
        // strong red flash.
        if (state === SCORE_NOTE_STATE.WRONG) {
          state = SCORE_NOTE_STATE.MISSED
        }
        entries.push({
          key: `play-along-past:${checkpoint.id ?? index}`,
          checkpoint,
          target,
          state,
          toneStates: null,
        })
        resolved += 1
        if (resolved >= 64) {
          break
        }
      }
    }
    return entries
  }, [
    isPlayAlong,
    timelineScoreTarget.index,
    timelineScoreTarget.target,
    scoreEventCheckpoints,
    session.timing.timingMap,
    scoreFollow.anchors,
    session.sourceVisualMap,
    scoreFollow.guitarScoreTarget,
    session.playAlongLaneGroups,
    session.playAlongFeedback,
  ])

  // Wait For You score states: current required checkpoint + completed trail.
  const wfyScoreTrail = useWfyScoreTrail({
    active: session.isWaitForYou,
    checkpoints: session.waitForYou.checkpoints,
    checkpointIndex: session.waitForYou.checkpointIndex,
    status: session.waitForYou.status,
    inputFeedback: session.waitForYouInput?.inputFeedback ?? null,
    timingMap: session.timing.timingMap,
    anchors: scoreFollow.anchors,
    sourceVisualMap: session.sourceVisualMap,
    preferredRepresentation: scoreFollow.guitarScoreTarget?.activeTarget,
    enabled: wfyNoteMode,
  })

  // Per-tone completion for the current WFY chord (blue → green per tone).
  const wfyCurrentToneStates = useMemo(() => {
    if (!wfyNoteMode) {
      return null
    }
    const checkpoint = session.waitForYou.currentCheckpoint
    if (!checkpoint?.isChord) {
      return null
    }
    const matched = session.waitForYouInput?.inputFeedback?.matchedIndices
    if (matched == null) {
      return null
    }
    return resolveChordToneStates(checkpoint, matched)
  }, [
    wfyNoteMode,
    session.waitForYou.currentCheckpoint,
    session.waitForYouInput,
  ])

  const scoreNoteStates = useMemo(() => {
    if (wfyNoteMode) {
      return wfyScoreTrail.map((entry) => ({
        key: `wfy:${entry.checkpoint?.id ?? entry.index}`,
        checkpoint: entry.checkpoint,
        target: entry.target,
        state: entry.state,
        toneStates:
          entry.index === session.waitForYou.checkpointIndex ? wfyCurrentToneStates : null,
      }))
    }
    if (isPlayAlong) {
      return playAlongScoreStates
    }
    if (isPreview && timelineScoreTarget.target?.visible && timelineScoreTarget.checkpoint) {
      return [{
        key: `preview:${timelineScoreTarget.checkpoint.id ?? timelineScoreTarget.index}`,
        checkpoint: timelineScoreTarget.checkpoint,
        target: timelineScoreTarget.target,
        state: SCORE_NOTE_STATE.CURRENT,
        toneStates: null,
      }]
    }
    return []
  }, [
    wfyNoteMode,
    wfyScoreTrail,
    wfyCurrentToneStates,
    session.waitForYou.checkpointIndex,
    isPlayAlong,
    playAlongScoreStates,
    isPreview,
    timelineScoreTarget.target,
    timelineScoreTarget.checkpoint,
    timelineScoreTarget.index,
  ])

  const practiceNoteTarget = session.isWaitForYou
    ? {
        ...waitForYouNoteTarget,
        active: Boolean(
          session.waitForYou.status === WFY_STATUS.WAITING &&
            waitForYouNoteTarget?.target?.visible,
        ),
        mode: 'wait-for-you',
      }
    : {
        target: timelineHighlightActive ? timelineScoreTarget.target : null,
        showOnPage: Boolean(
          timelineHighlightActive &&
            timelineScoreTarget.target?.visible &&
            timelineScoreTarget.target.page === visiblePageNumber,
        ),
        active: Boolean(
          timelineHighlightActive && timelineScoreTarget.target?.visible,
        ),
        mode: isPlayAlong ? 'play-along' : 'preview',
      }

  const practiceNoteTargetVisible = wfyNoteTargetVisible || practiceNoteTarget.showOnPage

  const previousViewRef = useRef(activeView)

  const onPracticePrefsChangeRef = useRef(onPracticePrefsChange)
  onPracticePrefsChangeRef.current = onPracticePrefsChange

  const practicePrefsSnapshotRef = useRef(session.practicePrefsSnapshot)
  practicePrefsSnapshotRef.current = session.practicePrefsSnapshot

  const pausedPracticeTime = session.playback.isPlaying ? null : session.practiceTime
  useEffect(() => {
    onPracticePrefsChangeRef.current?.(practicePrefsSnapshotRef.current)
  }, [
    session.practiceMode,
    session.playback.playbackRate,
    session.playback.metronomeEnabled,
    session.playback.metronomeLevel,
    session.playback.metronomeSubdivision,
    session.playback.metronomeCountIn,
    pausedPracticeTime,
    session.rawPracticeScope,
    session.checkpointMode,
    session.wfyInputSource,
    session.loop.snapMode,
    session.loop.enabled,
    session.loop.startMeasureNumber,
    session.loop.endMeasureNumber,
    session.loop.startBeat,
    session.loop.endBeat,
    session.rawMatchSettings,
  ])

  useEffect(() => {
    if (!session.playback.isPlaying) {
      onPracticePrefsChangeRef.current?.(practicePrefsSnapshotRef.current)
      return undefined
    }
    const intervalId = window.setInterval(() => {
      onPracticePrefsChangeRef.current?.(practicePrefsSnapshotRef.current)
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [session.playback.isPlaying])

  useEffect(() => {
    return () => {
      disposeReferencePlayer()
    }
  }, [])

  useEffect(() => {
    releaseReferenceVoices()
    warmupReferenceVoice(instrumentId).catch(() => {
      // Non-fatal — Hear It still attempts load on first click.
    })
  }, [instrumentId])

  useEffect(() => {
    return setupAudioVisibilityResume(() => [Tone.getContext()], { onlyAfterUserUnlock: true })
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
      practiceTime: quantizePracticeTime(session.clock.practiceTime),
      playbackCurrentTime: quantizePracticeTime(session.playback.currentTime),
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

  // One shared score cursor across Preview / Play Along / Wait For You.
  // Advancement behavior differs per mode, but the cursor always marks the
  // same musical position on the same score — WFY no longer hides it in
  // favor of a separate highlight-only language.
  const cursorValue = useMemo(
    () => ({
      displayCursor: {
        visible: Boolean(scoreFollow.displayCursor?.visible ?? scoreFollow.cursor?.visible),
        page: scoreFollow.displayCursor?.page ?? scoreFollow.cursor?.page ?? 1,
        measureNumber:
          scoreFollow.displayCursor?.measureNumber ??
          scoreFollow.cursor?.measureNumber ??
          null,
        x: scoreFollow.displayCursor?.x ?? scoreFollow.cursor?.x ?? null,
        y: scoreFollow.displayCursor?.y ?? scoreFollow.cursor?.y ?? null,
        smoothed: Boolean(scoreFollow.displayCursor?.smoothed),
      },
      cursorVisibility: scoreFollow.cursorVisibility,
      noteTarget: practiceNoteTarget?.target ?? null,
      showNoteTarget: practiceNoteTargetVisible,
      scoreNoteStates,
      showScoreNoteStates: scoreNoteStates.length > 0,
    }),
    [
      scoreFollow.displayCursor?.visible,
      scoreFollow.displayCursor?.page,
      scoreFollow.displayCursor?.measureNumber,
      scoreFollow.displayCursor?.smoothed,
      scoreFollow.cursor?.visible,
      scoreFollow.cursor?.page,
      scoreFollow.cursor?.measureNumber,
      scoreFollow.cursorVisibility,
      practiceNoteTarget?.target,
      practiceNoteTargetVisible,
      scoreNoteStates,
    ],
  )

  const value = useMemo(
    () => ({
      session,
      scoreFollow,
      waitForYouNoteTarget,
      playAlongNoteTarget: timelineHighlightActive ? timelineScoreTarget : null,
      practiceNoteTarget,
      sessionReady,
      practicePiece,
      practiceStats: practiceStatsTracker,
    }),
    [
      session,
      scoreFollow,
      waitForYouNoteTarget,
      timelineHighlightActive,
      timelineScoreTarget,
      practiceNoteTarget,
      sessionReady,
      practicePiece,
      practiceStatsTracker,
    ],
  )

  const visualValue = useMemo(
    () => ({
      practiceMode: session.practiceMode,
      timingMap: session.timing.timingMap,
      timingLoading: session.timing.isLoading,
      loopRegion:
        session.isWaitForYou || session.loop.enabled ? session.loop.region : null,
      practiceScope: session.practiceScope,
      wfyInputSource: session.wfyInputSource,
      isWaitForYou: session.isWaitForYou,
      wfyStatus: session.waitForYou.status,
      wfyCheckpoint: session.isWaitForYou ? session.waitForYou.currentCheckpoint : null,
      wfyCheckpointIndex: session.isWaitForYou ? session.waitForYou.checkpointIndex : -1,
      laneOutcomesByGroupId: session.laneOutcomesByGroupId,
      getScoreTime: session.playback.getScoreTime,
      guitarScoreTarget: scoreFollow.guitarScoreTarget,
      pdfFile,
      pdfPageSizes: pdfPageSizesState,
      setPdfPageSizes: setPdfPageSizesState,
      visiblePageNumber,
      pageViewRotations: scoreFollow.pageViewRotations ?? {},
    }),
    [
      session.practiceMode,
      session.timing.timingMap,
      session.timing.isLoading,
      session.isWaitForYou,
      session.loop.enabled,
      session.loop.region,
      session.practiceScope,
      session.wfyInputSource,
      session.waitForYou.status,
      session.waitForYou.currentCheckpoint,
      session.waitForYou.checkpointIndex,
      session.laneOutcomesByGroupId,
      session.playback.getScoreTime,
      scoreFollow.guitarScoreTarget,
      pdfFile,
      pdfPageSizesState,
      visiblePageNumber,
      scoreFollow.pageViewRotations,
    ],
  )

  const stableValue = useMemo(
    () => ({
      hasMidi: session.hasMidi,
      hasMusicXml: session.hasMusicXml,
      isDemoPiece: session.isDemoPiece,
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
        metronomeSubdivision: session.playback.metronomeSubdivision,
        metronomeCountIn: session.playback.metronomeCountIn,
        metronomeDisplay: session.playback.metronomeDisplay,
        mappingWarning: session.playback.mappingWarning,
        audioSource: session.playback.audioSource,
        instrumentStatus: session.playback.instrumentStatus,
        setPlaybackRate: session.playback.setPlaybackRate,
        setMetronomeEnabled: session.playback.setMetronomeEnabled,
        setMetronomeLevel: session.playback.setMetronomeLevel,
        setMetronomeSubdivision: session.playback.setMetronomeSubdivision,
        setMetronomeCountIn: session.playback.setMetronomeCountIn,
      },
      waitForYou: {
        active: session.waitForYou.active,
        status: session.waitForYou.status,
        displayStatus: session.waitForYou.displayStatus,
        markCorrectAndContinue: session.waitForYou.markCorrectAndContinue,
      },
      handlePlay: session.handlePlay,
      handleMidiStop: session.handleMidiStop,
      handleMidiSeek: session.handleMidiSeek,
    }),
    [
      session.hasMidi,
      session.hasMusicXml,
      session.isDemoPiece,
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
      session.playback.metronomeSubdivision,
      session.playback.metronomeCountIn,
      session.playback.metronomeDisplay,
      session.playback.mappingWarning,
      session.playback.audioSource,
      session.playback.instrumentStatus,
      session.playback.setPlaybackRate,
      session.playback.setMetronomeEnabled,
      session.playback.setMetronomeLevel,
      session.playback.setMetronomeSubdivision,
      session.playback.setMetronomeCountIn,
      session.waitForYou.active,
      session.waitForYou.status,
      session.waitForYou.displayStatus,
      session.waitForYou.markCorrectAndContinue,
      session.handlePlay,
      session.handleMidiStop,
      session.handleMidiSeek,
    ],
  )

  return (
    <PracticeSessionContext.Provider value={value}>
      <PracticeSessionStableContext.Provider value={stableValue}>
        <PracticeVisualContext.Provider value={visualValue}>
          <PracticeTickContext.Provider value={tickValue}>
            <ScoreFollowCursorContext.Provider value={cursorValue}>
              {children}
            </ScoreFollowCursorContext.Provider>
          </PracticeTickContext.Provider>
        </PracticeVisualContext.Provider>
      </PracticeSessionStableContext.Provider>
    </PracticeSessionContext.Provider>
  )
}

export function usePracticeVisualSession() {
  const value = useContext(PracticeVisualContext)
  if (!value) {
    throw new Error('usePracticeVisualSession must be used within PracticeSessionProvider')
  }
  return value
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
