import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMeasureAtTime } from '../musicxml/timingQuery.js'
import { ANCHOR_SOURCE, countAnchorsBySource, isAutomaticAnchorSource } from './anchorUtils.js'
import {
  assessMusicXmlLayoutConfidence,
  buildMusicXmlLayoutAnchors,
} from './musicxmlLayoutAnchors.js'
import { assessScoreFollowTrust } from './scoreFollowTrust.js'
import { filterTrustedAnchors } from './trustedAnchors.js'
import {
  buildAutoSetupKey,
  clearAutoSetupAttempted,
  hasAutoSetupBeenAttempted,
  markAutoSetupAttempted,
  shouldClearStaleAutoSetupFlag,
} from './scoreFollowAutoSetupStorage.js'
import { buildAutoSetupRuntimeDiagnostics, describeAutoSetupRejection } from './autoSetupRuntimeDiagnostics.js'
import { analyzeSemiAutoScoreSetup } from './semiAutoScoreAlignment.js'
import { buildAnchorsFromSystemStarts } from './buildAnchorsFromSystemStarts.js'
import { createAnchorId } from './scoreFollowStorage.js'
import {
  resolveScoreFollowCursor,
  START_LOCK_THRESHOLD_SECONDS,
} from './resolveScoreFollowCursor.js'
import {
  findNextUnmarkedMeasureNumber,
  getScoreFollowMarkingProgress,
} from './scoreFollowMarkingProgress.js'
import {
  CURSOR_HIDE_REASON_LABELS,
  getCursorVisibilityState,
} from './scoreFollowVisibility.js'
import useScoreFollowAnchors from './useScoreFollowAnchors.js'
import useScoreFollowCursorDriver from './useScoreFollowDisplayCursor.js'
import {
  getScoreFollowCursorSnapshot,
  publishScoreFollowCursor,
} from './scoreFollowCursorRuntime.js'
import { buildMeasureBoundaryDiagnostic } from './measureBoundaryDiagnostics.js'
import { buildHeldNoteDiagnostic } from './heldNoteDiagnostics.js'
import { buildCursorMotionDiagnostic } from './cursorMotionDiagnostics.js'
import { buildCursorMotionTimeline, resolveCursorMotion } from './cursorMotionTimeline.js'
import { buildScoreFollowPrecisionReport } from './scoreFollowPrecisionDiagnostics.js'
import { isNextGenAlignmentDiagnosticsEnabled } from './nextGenAlignmentFlag.js'
import { deriveNextGenAlignmentDiagnostics } from './nextGenAlignmentDiagnostics.js'
import { compareAnchorSets, assessPromotionReadiness } from './anchorComparison.js'
import {
  buildCalibrationDebugSnapshotFromPreview,
  buildCalibrationDebugSnapshotFromReport,
  CALIBRATION_OVERLAY_DEFAULT_VISIBLE,
  normalizeCalibrationOverlayPage,
} from './calibrationDebug.js'
import {
  clearCalibrationDebugStorage,
  loadCalibrationDebugSnapshot,
  loadPageViewRotations,
  saveCalibrationDebugSnapshot,
  savePageViewRotations,
} from './calibrationDebugStorage.js'
import {
  cycleViewRotation,
  getPageViewRotation as resolvePageViewRotation,
  pageViewRotationsFromOrientation,
} from '../../utils/pdfPageViewRotation.js'
import { buildPromotionDecision, resolveActiveAnchorSource } from './anchorPromotion.js'
import {
  areBundledDemoAnchorsDisabled,
  fetchDemoBundledAnchors,
  isDemoFixtureFileSet,
} from '../demo/demoBundledAnchors.js'
import {
  SCORE_FOLLOW_NEEDS_QUICK_SETUP,
  SCORE_FOLLOW_SETUP_FILE_MISMATCH,
  SCORE_FOLLOW_NEEDS_SETUP,
  SCORE_FOLLOW_NO_SYSTEMS,
  SCORE_FOLLOW_SETUP_APPROXIMATE,
  SCORE_FOLLOW_SETUP_COMPLETE,
  SCORE_FOLLOW_SETUP_FAILED_DEMO,
  SCORE_FOLLOW_SETUP_READY_DEMO,
  SCORE_FOLLOW_SETUP_READY_USER,
  SCORE_FOLLOW_SETUP_RUNNING,
} from './scoreFollowUserMessages.js'
import { LAYOUT_MISMATCH_MESSAGE } from './layoutAssessment.js'
import {
  AUTO_SETUP_SCAN_TIMEOUT_MS,
  hasUsableScoreFollowAnchors,
  idleSemiAutoSetupState,
  shouldClearStaleScanningUi,
  shouldSkipAutoSetupScan,
} from './scoreFollowSetupState.js'

function isEditableTarget(target) {
  if (!target || !(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export default function useScoreFollow({
  timingMap,
  timingLoading = false,
  timingSourceId = null,
  practiceTime,
  getScoreTime = null,
  pdfFingerprint,
  pdfFileName,
  pdfSource,
  numPages,
  hasPdf,
  visiblePageNumber,
  isPlaying = false,
  sessionReady = false,
  isDemoPiece = false,
}) {
  const isDemoSession =
    isDemoPiece || isDemoFixtureFileSet(pdfFileName, timingSourceId ?? null)
  // When bundled demo anchors are disabled (dev/test honesty switch), the demo
  // piece runs the SAME automatic setup pipeline as a user upload.
  const useBundledDemoAnchors = isDemoSession && !areBundledDemoAnchorsDisabled()

  const setupFailedMessage = isDemoSession
    ? SCORE_FOLLOW_SETUP_FAILED_DEMO
    : SCORE_FOLLOW_NEEDS_QUICK_SETUP
  const setupReadyMessage = isDemoSession
    ? SCORE_FOLLOW_SETUP_READY_DEMO
    : SCORE_FOLLOW_SETUP_READY_USER

  const anchorsHook = useScoreFollowAnchors({
    fingerprint: pdfFingerprint,
    fileName: pdfFileName,
  })
  const {
    anchors,
    placeManualAnchor,
    setAutoAnchors,
    setSupplementalAnchors,
    clearAutoAnchors,
    deleteAnchor,
    clearAnchors,
    clearManualAnchors,
    setBundledDemoAnchors,
    storageWarning,
    isHydrated,
  } = anchorsHook

  const autoSetupInFlightRef = useRef(false)
  const autoSetupTriggerKeyRef = useRef(null)
  const demoBundledLoadRef = useRef(null)
  const demoBundledInFlightRef = useRef(false)
  const layoutSupplementKeyRef = useRef(null)
  const [demoBundledStatus, setDemoBundledStatus] = useState({
    loading: false,
    applied: false,
    error: null,
  })

  const [enabled, setEnabled] = useState(true)
  const [alignmentMode, setAlignmentModeState] = useState(false)
  const [setupPanelOpen, setSetupPanelOpen] = useState(false)
  const manualPlacementStackRef = useRef([])
  const [placementMeasureNumber, setPlacementMeasureNumber] = useState(1)
  const [semiAutoSetup, setSemiAutoSetup] = useState({
    status: 'idle',
    progress: 0,
    message: '',
    error: null,
    preview: null,
  })
  const [setupStatus, setSetupStatus] = useState({ phase: 'idle', message: '' })
  // Dev-only structured report of the last auto-setup analysis (systems, measure
  // ranges, hints used, stage/confidence). Surfaced via `debug`, not normal UI.
  const [autoSetupReport, setAutoSetupReport] = useState(null)
  const [autoSetupRuntimeDiagnostics, setAutoSetupRuntimeDiagnostics] = useState(null)
  const [calibrationDebugSnapshot, setCalibrationDebugSnapshot] = useState(null)
  const [showCalibrationOverlay, setShowCalibrationOverlay] = useState(
    CALIBRATION_OVERLAY_DEFAULT_VISIBLE,
  )
  const [pageViewRotations, setPageViewRotations] = useState({})
  const pageViewRotationsRef = useRef({})

  // System-start fallback mode: user taps the start of each staff system
  // instead of marking every measure. Used when auto PDF analysis fails.
  const [systemStartMode, setSystemStartMode] = useState(false)
  const [systemStartMarks, setSystemStartMarks] = useState([])
  const systemStartStackRef = useRef([])

  const autoSetupKey = useMemo(
    () => buildAutoSetupKey(pdfFingerprint, timingSourceId),
    [pdfFingerprint, timingSourceId],
  )

  useEffect(() => {
    pageViewRotationsRef.current = pageViewRotations
  }, [pageViewRotations])

  const captureCalibrationSnapshot = useCallback(
    (preview, { rotations = pageViewRotationsRef.current, phase = null } = {}) => {
      if (!preview) {
        return
      }
      const snapshot = buildCalibrationDebugSnapshotFromPreview(preview, {
        pageViewRotations: rotations,
      })
      if (!snapshot) {
        return
      }
      if (phase) {
        snapshot.setupPhase = phase
      }
      setCalibrationDebugSnapshot(snapshot)
      saveCalibrationDebugSnapshot(autoSetupKey, snapshot)
    },
    [autoSetupKey],
  )

  const hasTiming = Boolean(timingMap?.measures?.length)
  const hasAnchors = anchors.length > 0
  const anchorCounts = useMemo(() => countAnchorsBySource(anchors), [anchors])

  const anchorTrust = useMemo(
    () =>
      assessScoreFollowTrust({
        anchors,
        timingMap,
        isDemoSession,
      }),
    [anchors, timingMap, isDemoSession],
  )

  const trustedAnchors = useMemo(
    () => filterTrustedAnchors(anchors),
    [anchors],
  )

  const maxMeasureNumber = useMemo(() => {
    const measures = timingMap?.measures
    if (!measures?.length) {
      return 9999
    }
    return measures[measures.length - 1].number
  }, [timingMap])

  const minMeasureNumber = useMemo(() => timingMap?.measures?.[0]?.number ?? 1, [timingMap])

  const markingProgress = useMemo(
    () =>
      getScoreFollowMarkingProgress({
        anchors,
        timingMap,
        placementMeasureNumber,
      }),
    [anchors, timingMap, placementMeasureNumber],
  )

  const semiAutoPreview = semiAutoSetup.status === 'preview'
  const showSystemBands = semiAutoPreview
  const showAnchorMarkers =
    alignmentMode || setupPanelOpen || semiAutoPreview || setupStatus.phase === 'running'
  // System-start marks are shown as separate visual indicators during fallback mode
  const showSystemStartMarkers = systemStartMode && systemStartMarks.length > 0

  const setAlignmentMode = useCallback(
    (value) => {
      const next = Boolean(value)
      setAlignmentModeState(next)
      if (next) {
        setEnabled(false)
        const nextMeasure = findNextUnmarkedMeasureNumber(anchors, {
          min: minMeasureNumber,
          max: maxMeasureNumber,
        })
        setPlacementMeasureNumber(nextMeasure)
        manualPlacementStackRef.current = []
      } else if (anchors.length > 0) {
        setEnabled(true)
      }
    },
    [anchors, minMeasureNumber, maxMeasureNumber],
  )

  const advancePlacementMeasure = useCallback(() => {
    setPlacementMeasureNumber((previous) =>
      Math.min(Math.max(previous, minMeasureNumber) + 1, maxMeasureNumber),
    )
  }, [minMeasureNumber, maxMeasureNumber])

  const undoLastMarker = useCallback(() => {
    const stack = manualPlacementStackRef.current
    const last = stack.pop()
    if (!last) {
      return false
    }
    deleteAnchor(last.id)
    setPlacementMeasureNumber(last.measureNumber)
    return true
  }, [deleteAnchor])

  useEffect(() => {
    if (!alignmentMode) {
      return undefined
    }

    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setAlignmentModeState(false)
        if (anchors.length > 0) {
          setEnabled(true)
        }
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        advancePlacementMeasure()
        return
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        undoLastMarker()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [alignmentMode, anchors.length, advancePlacementMeasure, undoLastMarker])

  const currentMeasure = useMemo(() => {
    if (!timingMap) {
      return null
    }
    return getMeasureAtTime(timingMap, practiceTime)
  }, [timingMap, practiceTime])

  useEffect(() => {
    if (alignmentMode) {
      return
    }
    if (currentMeasure?.number != null) {
      setPlacementMeasureNumber(currentMeasure.number)
    }
  }, [alignmentMode, currentMeasure?.number])

  // Motion Engine v2: a precomputed cursor motion timeline (one smooth, onset-
  // locked monotone curve per system). Rebuilt only when the score timing or the
  // trusted anchors change — never per frame. The cursor position at any score
  // time is then a pure lookup into this timeline.
  const motionTimeline = useMemo(
    () =>
      hasTiming && trustedAnchors.length > 0
        ? buildCursorMotionTimeline({ timingMap, trustedAnchors })
        : null,
    [hasTiming, timingMap, trustedAnchors],
  )

  const resolved = useMemo(
    () =>
      hasTiming && trustedAnchors.length > 0 && anchorTrust.showCursor
        ? resolveScoreFollowCursor({
            timingMap,
            practiceTime,
            trustedAnchors,
            trust: anchorTrust,
          })
        : { cursor: { visible: false }, needsSetup: anchorTrust.needsSetup, confidence: 'none' },
    [hasTiming, trustedAnchors, anchorTrust, timingMap, practiceTime],
  )

  // Position comes from the motion timeline (exact, smooth); resolveScoreFollowCursor
  // still owns visibility/trust gating and the no-timeline fallback. Using one
  // source for both the static (paused) and realtime (playing) cursor keeps them
  // consistent — no jump when playback pauses.
  const cursor = useMemo(() => {
    const base = resolved.cursor
    if (!base?.visible || !motionTimeline) {
      return base
    }
    const motion = resolveCursorMotion(motionTimeline, practiceTime)
    if (!motion) {
      return base
    }
    return {
      ...base,
      x: motion.x,
      y: motion.y,
      page: motion.page,
      measureNumber: motion.measureNumber ?? base.measureNumber,
      progressMode: motion.segmentType ?? base.progressMode,
    }
  }, [resolved, motionTimeline, practiceTime])
  const followNeedsSetup = anchorTrust.needsSetup

  const lockExactCursor = Boolean(cursor?.lockExact || cursor?.forcedStart)
  const realtimeCursorActive = Boolean(
    enabled &&
      isPlaying &&
      !alignmentMode &&
      !semiAutoPreview &&
      cursor?.visible &&
      !lockExactCursor,
  )

  const resetSnapKey = [
    timingSourceId ?? '',
    followNeedsSetup ? 'setup' : 'ready',
    trustedAnchors.length,
    anchorTrust.showCursor ? 1 : 0,
  ].join(':')

  // Real-time cursor resolver: called every animation frame by the display
  // cursor hook so the cursor position advances continuously (not just at the
  // 5 Hz React state update rate).  Memoised on the inputs that rarely change;
  // getScoreTime() is called lazily inside the RAF loop.
  const resolveRealtimeCursor = useCallback(
    (t) => {
      if (!hasTiming || trustedAnchors.length === 0 || !anchorTrust.showCursor) {
        return { visible: false }
      }
      // Primary path: the precomputed motion timeline (already smooth + onset
      // locked, so the driver publishes it directly with no predictive follower).
      const motion = motionTimeline ? resolveCursorMotion(motionTimeline, t) : null
      if (motion) {
        return { ...motion, lockExact: false, interpolated: true }
      }
      // Fallback for times/measures the timeline does not cover (e.g. gaps with
      // no anchor): the legacy resolver.
      return resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors,
        trust: anchorTrust,
      }).cursor
    },
    [hasTiming, trustedAnchors, anchorTrust, timingMap, motionTimeline],
  )

  useScoreFollowCursorDriver({
    targetCursor: cursor,
    active: realtimeCursorActive,
    resetSnapKey,
    lockExact: lockExactCursor,
    getScoreTime: realtimeCursorActive ? getScoreTime : null,
    resolveRealtimeCursor: realtimeCursorActive ? resolveRealtimeCursor : null,
  })

  useEffect(() => {
    if (realtimeCursorActive || followNeedsSetup || !enabled || !cursor?.visible) {
      return
    }
    publishScoreFollowCursor({ ...cursor, smoothed: false })
  }, [
    realtimeCursorActive,
    followNeedsSetup,
    enabled,
    cursor?.visible,
    cursor?.x,
    cursor?.y,
    cursor?.page,
    cursor?.measureNumber,
    cursor?.lockExact,
    cursor?.progressMode,
  ])

  const displayCursor = realtimeCursorActive
    ? getScoreFollowCursorSnapshot()
    : (cursor ?? { visible: false })

  const cursorVisibility = useMemo(
    () =>
      getCursorVisibilityState({
        hasPdf,
        hasTiming,
        hasAnchors,
        enabled,
        alignmentMode,
        semiAutoPreview,
        cursor: displayCursor,
        visiblePageNumber,
        anchorTrust,
        needsSetup: followNeedsSetup,
      }),
    [
      hasPdf,
      hasTiming,
      hasAnchors,
      enabled,
      alignmentMode,
      semiAutoPreview,
      displayCursor,
      visiblePageNumber,
      anchorTrust,
      followNeedsSetup,
    ],
  )

  const placeAnchorAt = useCallback(
    (page, x, y) => {
      const measureNumber = placementMeasureNumber
      const anchor = placeManualAnchor({
        page,
        x,
        y,
        measureNumber,
      })
      if (anchor?.id) {
        manualPlacementStackRef.current.push({
          id: anchor.id,
          measureNumber,
        })
      }
      const nextMeasure = findNextUnmarkedMeasureNumber(
        [...anchors, anchor].filter(Boolean),
        { min: minMeasureNumber, max: maxMeasureNumber },
      )
      setPlacementMeasureNumber(nextMeasure)
      return anchor
    },
    [
      placeManualAnchor,
      placementMeasureNumber,
      maxMeasureNumber,
      minMeasureNumber,
      anchors,
    ],
  )

  const clearManualMarkers = useCallback(() => {
    manualPlacementStackRef.current = []
    const remaining = anchors.filter((anchor) => isAutomaticAnchorSource(anchor.source))
    clearManualAnchors()
    setPlacementMeasureNumber(
      findNextUnmarkedMeasureNumber(remaining, {
        min: minMeasureNumber,
        max: maxMeasureNumber,
      }),
    )
  }, [clearManualAnchors, anchors, minMeasureNumber, maxMeasureNumber])

  // ---------------------------------------------------------------------------
  // System-start fallback mode
  // ---------------------------------------------------------------------------

  const enterSystemStartMode = useCallback(() => {
    setSystemStartMode(true)
    setSystemStartMarks([])
    systemStartStackRef.current = []
    setAlignmentModeState(false)
  }, [])

  const exitSystemStartMode = useCallback(() => {
    setSystemStartMode(false)
    setSystemStartMarks([])
    systemStartStackRef.current = []
  }, [])

  const addSystemStartMark = useCallback((page, x, y) => {
    const mark = { id: createAnchorId(), page, x, y }
    setSystemStartMarks((prev) => [...prev, mark])
    systemStartStackRef.current.push(mark)
  }, [])

  const undoLastSystemStartMark = useCallback(() => {
    const last = systemStartStackRef.current.pop()
    if (!last) {
      return false
    }
    setSystemStartMarks((prev) => prev.filter((m) => m.id !== last.id))
    return true
  }, [])

  const confirmSystemStartMarks = useCallback(() => {
    if (systemStartMarks.length === 0 || !timingMap) {
      return
    }
    const generatedAnchors = buildAnchorsFromSystemStarts(systemStartMarks, timingMap)
    if (generatedAnchors.length === 0) {
      return
    }
    setAutoAnchors(generatedAnchors)
    setEnabled(true)
    setSystemStartMode(false)
    setSystemStartMarks([])
    systemStartStackRef.current = []
    setSemiAutoSetup({
      status: 'confirmed',
      progress: 1,
      message: '',
      error: null,
      preview: null,
    })
    setSetupStatus({ phase: 'ready', message: setupReadyMessage })
  }, [systemStartMarks, timingMap, setAutoAnchors, setupReadyMessage])

  // Keyboard shortcuts in system-start mode: Escape = cancel, Backspace = undo
  useEffect(() => {
    if (!systemStartMode) {
      return undefined
    }
    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        exitSystemStartMode()
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        undoLastSystemStartMark()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [systemStartMode, exitSystemStartMode, undoLastSystemStartMark])

  const runSemiAutoSetupInternal = useCallback(
    async ({ force = false } = {}) => {
      if (!pdfSource || !numPages || !timingMap) {
        setSetupStatus({
          phase: 'failed',
          message: setupFailedMessage,
        })
        return
      }

      if (
        shouldSkipAutoSetupScan({
          force,
          anchorCounts,
          anchorTrust,
          autoSetupAttempted: hasAutoSetupBeenAttempted(autoSetupKey),
        })
      ) {
        setSetupStatus({
          phase: 'ready',
          message: setupReadyMessage,
        })
        setSemiAutoSetup(idleSemiAutoSetupState())
        autoSetupInFlightRef.current = false
        return
      }

      if (autoSetupInFlightRef.current) {
        return
      }

      autoSetupInFlightRef.current = true
      setAlignmentModeState(false)
      setSetupStatus({ phase: 'running', message: SCORE_FOLLOW_SETUP_RUNNING })
      setSemiAutoSetup({
        status: 'analyzing',
        progress: 0,
        message: SCORE_FOLLOW_SETUP_RUNNING,
        error: null,
        preview: null,
      })

      if (force) {
        clearAutoSetupAttempted(autoSetupKey)
        clearAutoAnchors()
      }

      let scanTimeoutId
      try {
        const result = await Promise.race([
          analyzeSemiAutoScoreSetup({
            pdfSource,
            numPages,
            timingMap,
            pageViewRotations: pageViewRotationsRef.current,
            onProgress: (progress, message) => {
              setSemiAutoSetup((previous) => ({
                ...previous,
                status: 'analyzing',
                progress,
                message,
              }))
            },
          }),
          new Promise((_, reject) => {
            scanTimeoutId = window.setTimeout(() => {
              reject(
                new Error('PDF scan timed out. Use Re-run auto setup to try again.'),
              )
            }, AUTO_SETUP_SCAN_TIMEOUT_MS)
          }),
        ])

        const recordAutoSetupRuntime = (partial) => {
          setAutoSetupRuntimeDiagnostics(
            buildAutoSetupRuntimeDiagnostics({
              timingMap,
              numPages,
              autoSetupAttempted: hasAutoSetupBeenAttempted(autoSetupKey),
              ...partial,
            }),
          )
        }

        if (!result.ok) {
          if (result.preview) {
            captureCalibrationSnapshot(result.preview, { phase: 'failed' })
          }
          recordAutoSetupRuntime({
            result,
            preview: null,
            setupStatus: { phase: 'failed', message: setupFailedMessage },
            semiAutoSetup: { status: 'failed', error: result.message },
          })
          setSemiAutoSetup({
            status: 'failed',
            progress: 0,
            message: '',
            error: result.message,
            preview: null,
          })
          setSetupStatus({
            phase: 'failed',
            message: setupFailedMessage,
          })
          return
        }

        const { preview } = result
        setAutoSetupReport(preview.debugReport ?? null)

        const detectedRotations = pageViewRotationsFromOrientation(preview.orientation)
        const mergedRotations = { ...pageViewRotationsRef.current, ...detectedRotations }
        pageViewRotationsRef.current = mergedRotations
        setPageViewRotations(mergedRotations)
        savePageViewRotations(autoSetupKey, mergedRotations)

        const setupPhase = preview.plausible
          ? preview.approximate
            ? 'approximate'
            : 'ready'
          : 'needs-setup'
        captureCalibrationSnapshot(preview, {
          rotations: mergedRotations,
          phase: setupPhase,
        })

        // Apply only when the page→system mapping is plausible AND we have at
        // least a system-start + system-end pair. A plausible high-confidence
        // conservative result reads "Auto setup complete"; tolerant / geometric
        // / reconciled / low-confidence reads "Approximate cursor". Manual
        // markers always override these auto guides.
        if (preview.proposedAnchors?.length >= 2 && preview.plausible) {
          markAutoSetupAttempted(autoSetupKey)
          setAutoAnchors(preview.proposedAnchors)
          // Barline-derived per-measure anchors refine the coarse system spans.
          if (preview.supplementalMeasureAnchors?.length >= 2) {
            setSupplementalAnchors(preview.supplementalMeasureAnchors)
          }
          setEnabled(true)
          setSemiAutoSetup({
            status: 'confirmed',
            progress: 1,
            message: '',
            error: null,
            preview: null,
          })
          const baseReadyMessage = isDemoSession
            ? SCORE_FOLLOW_SETUP_READY_DEMO
            : preview.approximate
              ? SCORE_FOLLOW_SETUP_APPROXIMATE
              : SCORE_FOLLOW_SETUP_COMPLETE
          // When the printed PDF layout disagrees with the score-data layout, say
          // so plainly — the PDF layout is what the cursor follows.
          const readyMessage =
            preview.layoutMismatch?.mismatch && !isDemoSession
              ? LAYOUT_MISMATCH_MESSAGE
              : baseReadyMessage
          recordAutoSetupRuntime({
            result,
            preview,
            setupStatus: { phase: 'ready', message: readyMessage },
            semiAutoSetup: { status: 'confirmed', error: null },
          })
          setSetupStatus({ phase: 'ready', message: readyMessage })
          return
        }

        // Implausible mapping (e.g. detected system count can't be reconciled
        // with MusicXML) → do NOT show a confidently-wrong cursor. Fall back to
        // a short "Needs quick setup" prompt instead.
        const rejection = describeAutoSetupRejection(result, preview)
        const needsSetupError = result.noSystems
          ? SCORE_FOLLOW_NO_SYSTEMS
          : rejection?.code === 'implausible-mapping' || rejection?.code === 'too-few-anchors'
            ? SCORE_FOLLOW_SETUP_FILE_MISMATCH
            : SCORE_FOLLOW_NEEDS_QUICK_SETUP
        recordAutoSetupRuntime({
          result,
          preview,
          setupStatus: { phase: 'needs-setup', message: SCORE_FOLLOW_NEEDS_QUICK_SETUP },
          semiAutoSetup: { status: 'failed', error: needsSetupError },
        })
        setSemiAutoSetup({
          status: 'failed',
          progress: 0,
          message: '',
          error: needsSetupError,
          preview,
        })
        setSetupStatus({
          phase: 'needs-setup',
          message: SCORE_FOLLOW_NEEDS_QUICK_SETUP,
        })
      } catch (error) {
        const setupError =
          error instanceof Error ? error.message : 'Automatic setup failed.'
        setAutoSetupRuntimeDiagnostics(
          buildAutoSetupRuntimeDiagnostics({
            result: { ok: false },
            preview: null,
            timingMap,
            numPages,
            setupStatus: { phase: 'failed', message: setupFailedMessage },
            semiAutoSetup: { status: 'failed', error: setupError },
            autoSetupAttempted: hasAutoSetupBeenAttempted(autoSetupKey),
          }),
        )
        setSemiAutoSetup({
          status: 'failed',
          progress: 0,
          message: '',
          error: setupError,
          preview: null,
        })
        setSetupStatus({
          phase: 'failed',
          message: setupFailedMessage,
        })
      } finally {
        if (scanTimeoutId) {
          window.clearTimeout(scanTimeoutId)
        }
        autoSetupInFlightRef.current = false
      }
    },
    [
      pdfSource,
      numPages,
      timingMap,
      autoSetupKey,
      anchorCounts.manual,
      anchorCounts.auto,
      anchorCounts.demo,
      anchorTrust.showCursor,
      clearAutoAnchors,
      setAutoAnchors,
      setSupplementalAnchors,
      isDemoSession,
      setupFailedMessage,
      setupReadyMessage,
      captureCalibrationSnapshot,
    ],
  )

  const runSemiAutoSetup = useCallback(() => {
    runSemiAutoSetupInternal({ force: true })
  }, [runSemiAutoSetupInternal])

  const retryAutoSetup = runSemiAutoSetup

  useEffect(() => {
    autoSetupTriggerKeyRef.current = null
    demoBundledLoadRef.current = null
    demoBundledInFlightRef.current = false
    layoutSupplementKeyRef.current = null
    const storedRotations = loadPageViewRotations(autoSetupKey)
    pageViewRotationsRef.current = storedRotations
    setPageViewRotations(storedRotations)
    setCalibrationDebugSnapshot(loadCalibrationDebugSnapshot(autoSetupKey))
    setShowCalibrationOverlay(CALIBRATION_OVERLAY_DEFAULT_VISIBLE)
    setAutoSetupReport(null)
    setAutoSetupRuntimeDiagnostics(null)
    setDemoBundledStatus({ loading: false, applied: false, error: null })
    // Clear any stale setup status/warning from the previous score or PDF. Without
    // this, a "does not match the PDF" warning (or a failed/needs-setup banner)
    // from an earlier piece lingers on a freshly loaded, valid one until its own
    // auto-setup finishes. Reset to idle; the auto-setup effect re-derives status.
    setSemiAutoSetup(idleSemiAutoSetupState())
    setSetupStatus({ phase: 'idle', message: '' })
  }, [autoSetupKey])

  useEffect(() => {
    if (!autoSetupKey || calibrationDebugSnapshot) {
      return
    }
    const stored = loadCalibrationDebugSnapshot(autoSetupKey)
    if (stored) {
      setCalibrationDebugSnapshot(stored)
      return
    }
    if (autoSetupReport && anchors.length >= 2) {
      const fallback = buildCalibrationDebugSnapshotFromReport(autoSetupReport, {
        anchors,
        pageViewRotations,
        setupPhase: setupStatus.phase,
      })
      if (fallback) {
        setCalibrationDebugSnapshot(fallback)
        saveCalibrationDebugSnapshot(autoSetupKey, fallback)
      }
    }
  }, [
    autoSetupKey,
    calibrationDebugSnapshot,
    autoSetupReport,
    anchors,
    pageViewRotations,
    setupStatus.phase,
  ])

  useEffect(() => {
    if (!sessionReady || !isHydrated || timingLoading || !hasTiming) {
      return
    }

    const autoSetupAttempted = hasAutoSetupBeenAttempted(autoSetupKey)
    const usable = hasUsableScoreFollowAnchors({
      anchorCounts,
      anchorTrust,
      autoSetupAttempted,
    })
    if (!usable) {
      return
    }

    if (
      shouldClearStaleScanningUi({
        setupPhase: setupStatus.phase,
        semiAutoStatus: semiAutoSetup.status,
        hasUsableAnchors: true,
      })
    ) {
      autoSetupInFlightRef.current = false
      setSemiAutoSetup(idleSemiAutoSetupState())
    }

    if (setupStatus.phase === 'running' || setupStatus.phase === 'idle') {
      setEnabled(true)
      setSetupStatus({ phase: 'ready', message: setupReadyMessage })
    }
  }, [
    sessionReady,
    isHydrated,
    timingLoading,
    hasTiming,
    anchorCounts,
    anchorTrust,
    autoSetupKey,
    setupStatus.phase,
    semiAutoSetup.status,
    setupReadyMessage,
  ])

  useEffect(() => {
    if (isDemoSession || !sessionReady || !isHydrated || timingLoading || !hasTiming || !timingMap) {
      return
    }

    const systemAnchors = anchors.filter(
      (anchor) =>
        anchor.source === ANCHOR_SOURCE.AUTO_SYSTEM || anchor.source === ANCHOR_SOURCE.AUTO,
    )
    if (systemAnchors.length < 2) {
      return
    }

    if (!assessMusicXmlLayoutConfidence(timingMap).ok) {
      return
    }

    const supplementKey = `${autoSetupKey}::musicxml-layout`
    if (layoutSupplementKeyRef.current === supplementKey) {
      return
    }

    const layoutAnchors = buildMusicXmlLayoutAnchors(timingMap, systemAnchors)
    if (!layoutAnchors.length) {
      return
    }

    layoutSupplementKeyRef.current = supplementKey
    setSupplementalAnchors(layoutAnchors)
  }, [
    isDemoSession,
    sessionReady,
    isHydrated,
    timingLoading,
    hasTiming,
    timingMap,
    anchors,
    autoSetupKey,
    setSupplementalAnchors,
  ])

  useEffect(() => {
    if (!useBundledDemoAnchors || !sessionReady || !isHydrated || timingLoading || !hasTiming) {
      return
    }
    if (anchorCounts.manual > 0) {
      return
    }
    if (anchorCounts.demo > 0) {
      return
    }

    const loadKey = `${autoSetupKey}::demo-bundled`
    if (demoBundledLoadRef.current === loadKey || demoBundledInFlightRef.current) {
      return
    }

    let cancelled = false
    let timeoutId
    demoBundledInFlightRef.current = true
    setDemoBundledStatus({ loading: true, applied: false, error: null })

    Promise.race([
      fetchDemoBundledAnchors(),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error('Demo anchors timed out loading. Try Re-run auto setup.'))
        }, 30_000)
      }),
    ])
      .then(({ anchors: bundled }) => {
        if (cancelled) {
          return
        }
        demoBundledLoadRef.current = loadKey
        setBundledDemoAnchors(bundled)
        clearAutoSetupAttempted(autoSetupKey)
        markAutoSetupAttempted(autoSetupKey)
        setEnabled(true)
        setSetupStatus({ phase: 'ready', message: setupReadyMessage })
        setDemoBundledStatus({ loading: false, applied: true, error: null })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setDemoBundledStatus({
          loading: false,
          applied: false,
          error: error instanceof Error ? error.message : 'Could not load demo anchors',
        })
        setSetupStatus({
          phase: 'failed',
          message: setupFailedMessage,
        })
      })
      .finally(() => {
        demoBundledInFlightRef.current = false
        if (timeoutId) {
          window.clearTimeout(timeoutId)
        }
      })

    return () => {
      cancelled = true
      demoBundledInFlightRef.current = false
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
      setDemoBundledStatus((previous) =>
        previous.loading
          ? { loading: false, applied: false, error: null }
          : previous,
      )
    }
  }, [
    useBundledDemoAnchors,
    sessionReady,
    isHydrated,
    timingLoading,
    hasTiming,
    autoSetupKey,
    anchorCounts.manual,
    anchorCounts.demo,
    setBundledDemoAnchors,
    setupReadyMessage,
    setupFailedMessage,
  ])

  useEffect(() => {
    if (
      !sessionReady ||
      !isHydrated ||
      timingLoading ||
      !hasPdf ||
      !hasTiming ||
      !pdfSource ||
      !numPages ||
      isPlaying
    ) {
      return
    }

    const autoSetupAttempted = hasAutoSetupBeenAttempted(autoSetupKey)
    if (
      hasUsableScoreFollowAnchors({
        anchorCounts,
        anchorTrust,
        autoSetupAttempted,
      })
    ) {
      return
    }

    // Only defer to bundled demo anchors when they're actually in use. With the
    // honesty switch on, the demo falls through to the real auto-setup pipeline.
    if (useBundledDemoAnchors) {
      if (demoBundledStatus.loading) {
        setSetupStatus({ phase: 'running', message: SCORE_FOLLOW_SETUP_RUNNING })
        return
      }
      if (!demoBundledStatus.error) {
        return
      }
    }

    const triggerKey = `${autoSetupKey}::${numPages}`
    if (autoSetupTriggerKeyRef.current === triggerKey) {
      return
    }
    if (
      shouldClearStaleAutoSetupFlag({
        attempted: autoSetupAttempted,
        autoAnchorCount: anchorCounts.auto,
      })
    ) {
      clearAutoSetupAttempted(autoSetupKey)
    }

    autoSetupTriggerKeyRef.current = triggerKey
    runSemiAutoSetupInternal({ force: false })
  }, [
    isHydrated,
    timingLoading,
    hasPdf,
    hasTiming,
    pdfSource,
    numPages,
    autoSetupKey,
    anchorCounts.manual,
    anchorCounts.demo,
    anchorCounts.auto,
    anchorTrust.showCursor,
    runSemiAutoSetupInternal,
    isPlaying,
    sessionReady,
    useBundledDemoAnchors,
    demoBundledStatus.loading,
    demoBundledStatus.error,
    demoBundledStatus.applied,
    setupReadyMessage,
    setupFailedMessage,
  ])

  const confirmSemiAutoSetup = useCallback(() => {
    const preview = semiAutoSetup.preview
    if (!preview?.proposedAnchors?.length) {
      return
    }
    setAutoAnchors(preview.proposedAnchors)
    // Apply the per-measure anchors too, so the follow cursor starts at each
    // measure's playable content — including system-start measures, which sit
    // after the clef/key area rather than at the far-left margin. Mirrors the
    // auto-apply path.
    const hasSupplemental = preview.supplementalMeasureAnchors?.length >= 2
    if (hasSupplemental) {
      setSupplementalAnchors(preview.supplementalMeasureAnchors)
    }
    captureCalibrationSnapshot(preview, { phase: 'confirmed' })
    setEnabled(true)
    setSemiAutoSetup({
      status: 'confirmed',
      progress: 1,
      message: hasSupplemental
        ? `Linked ${preview.systemCount} staff systems with a follow cursor.`
        : `Linked ${preview.systemCount} staff systems (${preview.anchorCount} guides). Mark measures manually to show a follow cursor.`,
      error: null,
      preview: null,
    })
  }, [semiAutoSetup.preview, setAutoAnchors, setSupplementalAnchors, captureCalibrationSnapshot])

  const rotatePageView = useCallback(
    (pageNumber = visiblePageNumber) => {
      const page = pageNumber ?? visiblePageNumber
      const updated = {
        ...pageViewRotationsRef.current,
        [page]: cycleViewRotation(pageViewRotationsRef.current[page] ?? 0),
      }
      pageViewRotationsRef.current = updated
      setPageViewRotations(updated)
      savePageViewRotations(autoSetupKey, updated)
      runSemiAutoSetupInternal({ force: true })
    },
    [autoSetupKey, visiblePageNumber, runSemiAutoSetupInternal],
  )

  const applyAutoPageRotations = useCallback(() => {
    const orientation =
      calibrationDebugSnapshot?.orientation ?? semiAutoSetup.preview?.orientation ?? null
    if (!orientation?.anyRotated) {
      return
    }
    const detected = pageViewRotationsFromOrientation(orientation)
    pageViewRotationsRef.current = detected
    setPageViewRotations(detected)
    savePageViewRotations(autoSetupKey, detected)
    runSemiAutoSetupInternal({ force: true })
  }, [
    calibrationDebugSnapshot?.orientation,
    semiAutoSetup.preview?.orientation,
    autoSetupKey,
    runSemiAutoSetupInternal,
  ])

  const getPageViewRotation = useCallback(
    (pageNumber) => resolvePageViewRotation(pageViewRotations, pageNumber),
    [pageViewRotations],
  )

  const cancelSemiAutoPreview = useCallback(() => {
    setSemiAutoSetup({
      status: 'idle',
      progress: 0,
      message: '',
      error: null,
      preview: null,
    })
  }, [])

  const fixSemiAutoManually = useCallback(() => {
    cancelSemiAutoPreview()
    setAlignmentMode(true)
  }, [cancelSemiAutoPreview, setAlignmentMode])

  const resetSemiAutoSetup = useCallback(() => {
    clearAutoAnchors()
    clearAutoSetupAttempted(autoSetupKey)
    clearCalibrationDebugStorage(autoSetupKey)
    autoSetupTriggerKeyRef.current = null
    pageViewRotationsRef.current = {}
    setPageViewRotations({})
    setCalibrationDebugSnapshot(null)
    setSemiAutoSetup({
      status: 'idle',
      progress: 0,
      message: '',
      error: null,
      preview: null,
    })
    setSetupStatus({ phase: 'idle', message: '' })
  }, [clearAutoAnchors, autoSetupKey])

  const pagePreviewSystems = useMemo(() => {
    if (!semiAutoPreview || !semiAutoSetup.preview?.systemsByPage) {
      return []
    }
    return semiAutoSetup.preview.systemsByPage[visiblePageNumber] ?? []
  }, [semiAutoPreview, semiAutoSetup.preview, visiblePageNumber])

  const calibrationOverlayPage = useMemo(
    () =>
      normalizeCalibrationOverlayPage(
        calibrationDebugSnapshot,
        visiblePageNumber,
        anchors,
      ),
    [calibrationDebugSnapshot, visiblePageNumber, anchors],
  )

  const displayAnchors = useMemo(() => {
    if (semiAutoPreview && semiAutoSetup.preview?.proposedAnchors) {
      return semiAutoSetup.preview.proposedAnchors
    }
    return anchors
  }, [semiAutoPreview, semiAutoSetup.preview, anchors])

  const canFollow = Boolean(
    hasTiming &&
      hasAnchors &&
      enabled &&
      !semiAutoPreview &&
      anchorTrust.showCursor &&
      !followNeedsSetup,
  )

  useEffect(() => {
    if (!hasTiming || alignmentMode || semiAutoPreview) {
      return
    }
    if (semiAutoSetup.status === 'analyzing' || setupStatus.phase === 'running') {
      return
    }
    if (!hasAnchors) {
      return
    }
    if (followNeedsSetup || !anchorTrust.showCursor) {
      setSetupStatus({ phase: 'needs-setup', message: SCORE_FOLLOW_NEEDS_SETUP })
      return
    }
    if (setupStatus.phase === 'needs-setup') {
      setSetupStatus({
        phase: 'ready',
        message: isDemoSession ? SCORE_FOLLOW_SETUP_READY_DEMO : SCORE_FOLLOW_SETUP_READY_USER,
      })
    }
  }, [
    hasTiming,
    hasAnchors,
    alignmentMode,
    semiAutoPreview,
    semiAutoSetup.status,
    setupStatus.phase,
    followNeedsSetup,
    anchorTrust.showCursor,
    isDemoSession,
  ])
  const isSemiAutoAnalyzing = semiAutoSetup.status === 'analyzing'

  // ---------------------------------------------------------------------------
  // Phase 4 — next-gen alignment diagnostics (FLAG-GATED, DISPLAY-ONLY).
  //
  // When the flag is OFF (public default) this is null and nothing changes.
  // When ON, it derives the new reconciliation / confidence-decision / anchor-
  // coverage view-model from the EXISTING auto-setup report. It NEVER touches
  // the cursor, auto-setup, manual setup, or bundled demo anchors. Candidate
  // anchors are display-only (tagged `meta.candidate`) and are surfaced for an
  // opt-in debug overlay; they are never added to `anchors`.
  // ---------------------------------------------------------------------------
  const nextGenEnabled = useMemo(() => isNextGenAlignmentDiagnosticsEnabled(), [])
  const [showNextGenCandidates, setShowNextGenCandidates] = useState(false)

  const nextGenDiagnostics = useMemo(() => {
    if (!nextGenEnabled) {
      return null
    }
    const result = deriveNextGenAlignmentDiagnostics({
      timingMap,
      autoSetupReport,
    })
    return result.available ? result : null
  }, [nextGenEnabled, timingMap, autoSetupReport])

  const nextGenCandidateAnchors = useMemo(() => {
    if (!nextGenEnabled || !showNextGenCandidates) {
      return null
    }
    return nextGenDiagnostics?.candidateAnchors ?? null
  }, [nextGenEnabled, showNextGenCandidates, nextGenDiagnostics])

  // ---------------------------------------------------------------------------
  // Phase 5b — runtime promotion layer (FLAG-GATED, SAFE FALLBACK).
  //
  // Decides whether validated generated anchors may drive runtime score-follow,
  // reusing the Phase 5a readiness framework. The decision path is:
  //   READY → generated allowed | NEEDS_REVIEW / NOT_SAFE → existing behavior.
  //
  // Safety: promotion never replaces bundled demo anchors (isDemoSession is
  // excluded), never fires unless the flag is on, and falls back automatically
  // whenever readiness is not READY. At runtime, generated candidate geometry is
  // estimated (not pixel-accurate), so it does not match the calibrated bundled
  // anchors → readiness is NOT_SAFE → the existing path is preserved. This
  // surfaces the decision + active source for diagnostics WITHOUT changing how
  // anchors are applied or how the cursor resolves.
  // ---------------------------------------------------------------------------
  const anchorPromotion = useMemo(() => {
    if (!nextGenEnabled) {
      return {
        enabled: false,
        useGenerated: false,
        reason: 'flag-disabled',
        status: null,
        statusReasons: [],
        comparable: false,
        activeSource: resolveActiveAnchorSource({ useGenerated: false, anchorCounts }),
        activeSourceLabel: null,
      }
    }
    const generated = nextGenDiagnostics?.candidateAnchors ?? []
    // The only trusted runtime reference is the bundled demo anchor set.
    const referenceAnchors = anchors.filter((anchor) => anchor.source === ANCHOR_SOURCE.DEMO)
    const comparison = compareAnchorSets(generated, referenceAnchors)
    const readiness = assessPromotionReadiness(comparison)
    return buildPromotionDecision({
      enabled: true,
      isDemoSession,
      comparison,
      readiness,
      anchorCounts,
      generatedAnchors: generated,
    })
  }, [nextGenEnabled, nextGenDiagnostics, anchors, anchorCounts, isDemoSession])

  const autoSetupRuntimeForDebug = useMemo(() => {
    if (!autoSetupRuntimeDiagnostics) {
      return null
    }
    if (autoSetupRuntimeDiagnostics.needsQuickSetupReason) {
      return autoSetupRuntimeDiagnostics
    }
    if (
      hasAnchors &&
      (setupStatus.phase === 'needs-setup' || setupStatus.phase === 'failed') &&
      (followNeedsSetup || !anchorTrust.showCursor)
    ) {
      return {
        ...autoSetupRuntimeDiagnostics,
        needsQuickSetupReason:
          'ui-state: setup phase needs-setup/failed with no trusted cursor anchors',
      }
    }
    return autoSetupRuntimeDiagnostics
  }, [
    autoSetupRuntimeDiagnostics,
    hasAnchors,
    setupStatus.phase,
    followNeedsSetup,
    anchorTrust.showCursor,
  ])

  const measureBoundary = useMemo(
    () =>
      currentMeasure?.number != null && hasTiming && trustedAnchors.length > 0
        ? buildMeasureBoundaryDiagnostic({
            timingMap,
            trustedAnchors,
            measureNumber: currentMeasure.number,
          })
        : null,
    [timingMap, trustedAnchors, currentMeasure?.number, hasTiming],
  )

  const heldNote = useMemo(
    () =>
      currentMeasure?.number != null && hasTiming && trustedAnchors.length > 0
        ? buildHeldNoteDiagnostic({
            timingMap,
            trustedAnchors,
            measureNumber: currentMeasure.number,
          })
        : null,
    [timingMap, trustedAnchors, currentMeasure?.number, hasTiming],
  )

  const cursorMotion = useMemo(
    () =>
      currentMeasure?.number != null && hasTiming && trustedAnchors.length > 0
        ? buildCursorMotionDiagnostic({
            timingMap,
            trustedAnchors,
            measureNumber: currentMeasure.number,
          })
        : null,
    [timingMap, trustedAnchors, currentMeasure?.number, hasTiming],
  )

  const precisionReport = useMemo(
    () =>
      buildScoreFollowPrecisionReport({
        timingMap,
        practiceTime,
        audioTime: getScoreTime?.() ?? practiceTime,
        targetCursor: cursor,
        displayCursor,
      }),
    [timingMap, practiceTime, getScoreTime, cursor, displayCursor],
  )

  const debug = useMemo(
    () => ({
      currentMeasureNumber: currentMeasure?.number ?? null,
      cursorPage: cursorVisibility.cursorPage,
      visiblePageNumber,
      anchorCount: anchors.length,
      autoAnchorCount: anchorCounts.auto,
      manualAnchorCount: anchorCounts.manual,
      hideReason: cursorVisibility.reason,
      hideReasonLabel: CURSOR_HIDE_REASON_LABELS[cursorVisibility.reason] ?? '',
      cursorVisibleOnPage: cursorVisibility.show,
      followTrustLevel: anchorTrust.level,
      followApproximate: anchorTrust.approximate,
      // Provenance — which anchor source is actually driving the cursor.
      fileName: pdfFileName ?? null,
      fingerprint: pdfFingerprint ?? null,
      bundledAnchorsUsed: anchorCounts.demo > 0,
      autoAnchorsUsed: anchorCounts.auto > 0,
      manualAnchorsUsed: anchorCounts.manual > 0,
      bundledAnchorsDisabled: !useBundledDemoAnchors && isDemoSession,
      cursorShownBecause: anchorTrust.showCursor
        ? `trust=${anchorTrust.level}`
        : `blocked: needsSetup=${anchorTrust.needsSetup}`,
      // Live cursor decision (a dev trace: log `debug` each frame while playing).
      playbackTime: practiceTime,
      cursorScoreMeasure: cursor?.measureNumber ?? null,
      cursorBeatProgress: cursor?.progress ?? null,
      cursorX: cursor?.x ?? null,
      cursorY: cursor?.y ?? null,
      cursorConfidence: cursor?.confidence ?? null,
      cursorInterpolated: Boolean(cursor?.interpolated),
      cursorMotionLabel: cursor?.lockExact
        ? 'locked'
        : cursor?.atOnset
          ? 'onset-snap'
          : cursor?.interpolated
            ? cursor?.progressMode ?? 'glide'
            : 'hold',
      cursorProgressMode: cursor?.progressMode ?? null,
      cursorAtOnset: Boolean(cursor?.atOnset),
      precision: precisionReport,
      measureBoundary,
      heldNote,
      cursorMotionDiagnostic: cursorMotion,
      // The cursor's single timing source of truth is the MusicXML timeline.
      timingSource: 'musicxml',
      timingSourceId: timingSourceId ?? null,
      // Dev-only auto-setup analysis report (null until auto setup runs).
      autoSetup: autoSetupReport,
      autoSetupRuntime: autoSetupRuntimeForDebug,
      // Phase 5b: which anchor source is active + the promotion decision.
      anchorSource: anchorPromotion.activeSource,
      anchorPromotion,
    }),
    [
      currentMeasure,
      cursorVisibility,
      visiblePageNumber,
      anchors.length,
      anchorCounts,
      anchorTrust,
      autoSetupReport,
      autoSetupRuntimeDiagnostics,
      autoSetupRuntimeForDebug,
      anchorPromotion,
      cursor,
      displayCursor,
      practiceTime,
      precisionReport,
      measureBoundary,
      heldNote,
      cursorMotion,
      timingSourceId,
      pdfFileName,
      pdfFingerprint,
      useBundledDemoAnchors,
      isDemoSession,
    ],
  )

  return {
    enabled,
    setEnabled,
    alignmentMode,
    setAlignmentMode,
    setupPanelOpen,
    setSetupPanelOpen,
    showAnchorMarkers,
    showSystemStartMarkers,
    markingProgress,
    advancePlacementMeasure,
    undoLastMarker,
    placementMeasureNumber,
    setPlacementMeasureNumber,
    anchors,
    placeAnchorAt,
    deleteAnchor,
    clearAnchors,
    clearManualMarkers,
    runSemiAutoSetup,
    retryAutoSetup,
    setupStatus,
    confirmSemiAutoSetup,
    cancelSemiAutoPreview,
    fixSemiAutoManually,
    resetSemiAutoSetup,
    semiAutoSetup,
    isSemiAutoAnalyzing,
    semiAutoPreview,
    showSystemBands,
    pagePreviewSystems,
    displayAnchors,
    anchorCounts,
    cursor,
    displayCursor,
    cursorVisibility,
    realtimeCursorActive,
    canFollow,
    currentMeasure,
    hasTiming,
    hasAnchors,
    debug,
    anchorStorageWarning: storageWarning,
    anchorTrust,
    followNeedsSetup,
    followApproximateLabel: anchorTrust.label,
    // System-start fallback mode
    systemStartMode,
    systemStartMarks,
    enterSystemStartMode,
    exitSystemStartMode,
    addSystemStartMark,
    undoLastSystemStartMark,
    confirmSystemStartMarks,
    // Phase 4 (flag-gated, display-only): next-gen alignment diagnostics +
    // opt-in candidate-anchor debug overlay. null/false when the flag is off.
    nextGenEnabled,
    nextGenDiagnostics,
    nextGenCandidateAnchors,
    showNextGenCandidates,
    setShowNextGenCandidates,
    // Phase 5b (flag-gated): runtime promotion decision + active anchor source.
    // Diagnostics only — falls back to existing behavior unless readiness=READY.
    anchorPromotion,
    anchorSource: anchorPromotion.activeSource,
    calibrationDebugSnapshot,
    showCalibrationOverlay,
    setShowCalibrationOverlay,
    calibrationOverlayPage,
    pageViewRotations,
    getPageViewRotation,
    rotatePageView,
    applyAutoPageRotations,
  }
}
