import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMeasureAtTime } from '../musicxml/timingQuery.js'
import { ANCHOR_SOURCE, countAnchorsBySource, isAutomaticAnchorSource } from './anchorUtils.js'
import {
  assessMusicXmlLayoutConfidence,
  buildMusicXmlLayoutAnchors,
} from './musicxmlLayoutAnchors.js'
import { assessScoreFollowTrust } from './scoreFollowTrust.js'
import {
  buildAutoSetupKey,
  clearAutoSetupAttempted,
  hasAutoSetupBeenAttempted,
  markAutoSetupAttempted,
} from './scoreFollowAutoSetupStorage.js'
import {
  analyzeSemiAutoScoreSetup,
  shouldAutoApplySemiAutoResult,
} from './semiAutoScoreAlignment.js'
import { resolveScoreFollowCursor } from './resolveScoreFollowCursor.js'
import {
  findNextUnmarkedMeasureNumber,
  getScoreFollowMarkingProgress,
} from './scoreFollowMarkingProgress.js'
import {
  CURSOR_HIDE_REASON_LABELS,
  getCursorVisibilityState,
} from './scoreFollowVisibility.js'
import useScoreFollowAnchors from './useScoreFollowAnchors.js'
import useScoreFollowDisplayCursor from './useScoreFollowDisplayCursor.js'
import {
  fetchDemoBundledAnchors,
  isDemoFixtureFileSet,
} from '../demo/demoBundledAnchors.js'
import {
  SCORE_FOLLOW_NEEDS_SETUP,
  SCORE_FOLLOW_SETUP_FAILED_DEMO,
  SCORE_FOLLOW_SETUP_NEEDS_CORRECTION,
  SCORE_FOLLOW_SETUP_READY_DEMO,
  SCORE_FOLLOW_SETUP_READY_USER,
  SCORE_FOLLOW_SETUP_RUNNING,
} from './scoreFollowUserMessages.js'

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

  const setupFailedMessage = isDemoSession
    ? SCORE_FOLLOW_SETUP_FAILED_DEMO
    : SCORE_FOLLOW_SETUP_NEEDS_CORRECTION
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

  const autoSetupKey = useMemo(
    () => buildAutoSetupKey(pdfFingerprint, timingSourceId),
    [pdfFingerprint, timingSourceId],
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

  const cursor = resolved.cursor
  const followNeedsSetup = anchorTrust.needsSetup

  const lockExactCursor = Boolean(cursor?.lockExact || cursor?.forcedStart)
  const smoothCursorActive = Boolean(
    enabled &&
      isPlaying &&
      !alignmentMode &&
      !semiAutoPreview &&
      cursor?.visible &&
      !lockExactCursor &&
      practiceTime > 0.15,
  )

  const resetSnapKey = `${timingSourceId ?? ''}:${practiceTime <= 0.15 ? 'start' : Math.floor(practiceTime * 4)}`

  const displayCursor = useScoreFollowDisplayCursor({
    targetCursor: cursor,
    active: smoothCursorActive,
    resetSnapKey,
    lockExact: lockExactCursor,
  })

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

  const runSemiAutoSetupInternal = useCallback(
    async ({ force = false } = {}) => {
      if (!pdfSource || !numPages || !timingMap) {
        setSetupStatus({
          phase: 'failed',
          message: setupFailedMessage,
        })
        return
      }

      if (!force && anchorCounts.manual > 0) {
        setSetupStatus({
          phase: 'ready',
          message: setupReadyMessage,
        })
        return
      }

      if (!force && anchors.length > 0) {
        setSetupStatus({
          phase: 'ready',
          message: setupReadyMessage,
        })
        return
      }

      if (!force && hasAutoSetupBeenAttempted(autoSetupKey)) {
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

      try {
        const result = await analyzeSemiAutoScoreSetup({
          pdfSource,
          numPages,
          timingMap,
          onProgress: (progress, message) => {
            setSemiAutoSetup((previous) => ({
              ...previous,
              status: 'analyzing',
              progress,
              message,
            }))
          },
        })

        markAutoSetupAttempted(autoSetupKey)

        if (!result.ok) {
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
        if (shouldAutoApplySemiAutoResult(preview)) {
          setAutoAnchors(preview.proposedAnchors)
          setEnabled(true)
          setSemiAutoSetup({
            status: 'confirmed',
            progress: 1,
            message: '',
            error: null,
            preview: null,
          })
          setSetupStatus({ phase: 'ready', message: setupReadyMessage })
          return
        }

        setSemiAutoSetup({
          status: 'failed',
          progress: 0,
          message: '',
          error:
            preview.validationMessage ||
            'Score layout could not be matched reliably enough for automatic setup.',
          preview: null,
        })
        setSetupStatus({
          phase: 'failed',
          message: setupFailedMessage,
        })
      } catch (error) {
        markAutoSetupAttempted(autoSetupKey)
        setSemiAutoSetup({
          status: 'failed',
          progress: 0,
          message: '',
          error:
            error instanceof Error
              ? error.message
              : 'Automatic setup failed.',
          preview: null,
        })
        setSetupStatus({
          phase: 'failed',
          message: setupFailedMessage,
        })
      } finally {
        autoSetupInFlightRef.current = false
      }
    },
    [
      pdfSource,
      numPages,
      timingMap,
      autoSetupKey,
      anchorCounts.manual,
      anchors.length,
      clearAutoAnchors,
      setAutoAnchors,
    ],
  )

  const runSemiAutoSetup = useCallback(() => {
    runSemiAutoSetupInternal({ force: true })
  }, [runSemiAutoSetupInternal])

  const retryAutoSetup = runSemiAutoSetup

  useEffect(() => {
    autoSetupTriggerKeyRef.current = null
    demoBundledLoadRef.current = null
    layoutSupplementKeyRef.current = null
    setDemoBundledStatus({ loading: false, applied: false, error: null })
  }, [autoSetupKey])

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
    if (!isDemoSession || !sessionReady || !isHydrated || timingLoading || !hasTiming) {
      return
    }
    if (anchorCounts.manual > 0) {
      return
    }
    if (anchorCounts.demo > 0) {
      return
    }

    const loadKey = `${autoSetupKey}::demo-bundled`
    if (demoBundledLoadRef.current === loadKey) {
      return
    }
    demoBundledLoadRef.current = loadKey

    let cancelled = false
    setDemoBundledStatus({ loading: true, applied: false, error: null })

    fetchDemoBundledAnchors()
      .then(({ anchors: bundled }) => {
        if (cancelled) {
          return
        }
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
        demoBundledLoadRef.current = null
        setDemoBundledStatus({
          loading: false,
          applied: false,
          error: error instanceof Error ? error.message : 'Could not load demo anchors',
        })
      })

    return () => {
      cancelled = true
    }
  }, [
    isDemoSession,
    sessionReady,
    isHydrated,
    timingLoading,
    hasTiming,
    autoSetupKey,
    anchorCounts.manual,
    anchorCounts.demo,
    setBundledDemoAnchors,
    setupReadyMessage,
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

    if (anchorCounts.manual > 0 || anchorCounts.demo > 0 || anchors.length > 0) {
      setSetupStatus({ phase: 'ready', message: setupReadyMessage })
      return
    }

    if (isDemoSession) {
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
    if (hasAutoSetupBeenAttempted(autoSetupKey)) {
      setSetupStatus({
        phase: 'failed',
        message: setupFailedMessage,
      })
      return
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
    anchors.length,
    runSemiAutoSetupInternal,
    isPlaying,
    sessionReady,
    isDemoSession,
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
    setEnabled(true)
    setSemiAutoSetup({
      status: 'confirmed',
      progress: 1,
      message: `Linked ${preview.systemCount} staff systems (${preview.anchorCount} guides). Mark measures manually to show a follow cursor.`,
      error: null,
      preview: null,
    })
  }, [semiAutoSetup.preview, setAutoAnchors])

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
    autoSetupTriggerKeyRef.current = null
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
    if (!hasTiming || !hasAnchors || alignmentMode || semiAutoPreview) {
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
    followNeedsSetup,
    anchorTrust.showCursor,
    isDemoSession,
    setupStatus.phase,
  ])
  const isSemiAutoAnalyzing = semiAutoSetup.status === 'analyzing'

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
    }),
    [currentMeasure, cursorVisibility, visiblePageNumber, anchors.length, anchorCounts, anchorTrust],
  )

  return {
    enabled,
    setEnabled,
    alignmentMode,
    setAlignmentMode,
    setupPanelOpen,
    setSetupPanelOpen,
    showAnchorMarkers,
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
    smoothCursorActive,
    canFollow,
    currentMeasure,
    hasTiming,
    hasAnchors,
    debug,
    anchorStorageWarning: storageWarning,
    anchorTrust,
    followNeedsSetup,
    followApproximateLabel: anchorTrust.label,
  }
}
