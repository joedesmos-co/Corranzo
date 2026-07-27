import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import TopBar from './components/TopBar.jsx'
import LibraryPanel from './components/LibraryPanel.jsx'
import LibraryWelcomeCard from './components/LibraryWelcomeCard.jsx'
import AppViewPlaceholder from './components/AppViewPlaceholder.jsx'
import AppFooter from './components/AppFooter.jsx'
import SessionRestoreBanner from './components/SessionRestoreBanner.jsx'
import SessionRestoreOverlay from './components/SessionRestoreOverlay.jsx'
import GuidedTutorial from './components/onboarding/GuidedTutorial.jsx'
import useRestoreUploadGate from './features/import/useRestoreUploadGate.js'
import PracticeView from './components/practice/PracticeView.jsx'
import { PracticeSessionProvider } from './context/PracticeSessionContext.jsx'
import { ProfileStatsProvider } from './context/ProfileStatsContext.jsx'

const ProfileView = lazy(() => import('./components/profile/ProfileView.jsx'))
import PrivacyPolicyPage from './components/legal/PrivacyPolicyPage.jsx'
import TermsOfServicePage from './components/legal/TermsOfServicePage.jsx'
import ContactPage from './components/legal/ContactPage.jsx'
import useWorkspacePreferences from './hooks/useWorkspacePreferences.js'
import useSessionPersistence from './hooks/useSessionPersistence.js'
import {
  dismissOnboarding,
  hideDemoCard,
  isDemoCardHidden,
  isOnboardingDismissed,
  resetPracticeTimePrefs,
  savePracticePrefs,
} from './features/session/practicePrefsStorage.js'
import {
  completeGuidedTutorial,
  isGuidedTutorialCompleted,
  shouldOpenGuidedTutorial,
} from './features/onboarding/guidedTutorial.js'
import {
  readFileArrayBuffer,
  validateFileForImport,
} from './features/import/fileImportLimits.js'
import { isMuseScoreSourceFile, MUSESCORE_PLANNED_MESSAGE } from './features/import/sourceNotationFiles.js'
import {
  formatMidiImportError,
  formatMusicXmlImportError,
  formatPdfImportError,
} from './features/import/formatImportError.js'
import { isDemoSampleEnabled } from './features/demo/demoSampleAccess.js'
import { formatDemoLoadError } from './features/demo/formatDemoLoadError.js'
import { fetchSampleFixtureFiles } from './dev/loadSampleFixtures.js'
import { getDemoPieceForInstrument } from './dev/fixturePaths.js'
import {
  getViewFromPathname,
  isLegalPathname,
  isLegalView,
  pathnameForView,
} from './features/legal/legalRoutes.js'
import {
  buildUploadNotices,
} from './features/import/classifyUploadFiles.js'
import { resolveRestoredActiveView } from './features/session/sessionRestoreRouting.js'
import { getHomeNavigationTarget } from './features/navigation/goHome.js'
import { warmupAllInstrumentSamplesOnIdle } from './features/playback/instrumentSampleWarmup.js'
import { useInstrument } from './context/instrumentContext.js'
import { DEFAULT_INSTRUMENT_ID, normalizeInstrumentId } from './features/instruments/instruments.js'
import { LIBRARY_TABS, buildUploadedPracticePieces } from './features/library/practiceLibrary.js'
import {
  buildAutoOmrRequestFromPdfMeta,
  buildAutoOmrRequestKey,
  cancelInFlightOmrGeneration,
  pdfPreparingScoreMessage,
  shouldAcceptOmrGeneratedResult,
  shouldQueueAutoOmr,
} from './features/library/autoOmrOrchestration.js'
import {
  activatePdfScoreSource,
  assertScoreSourceMutationAllowed,
  getActiveScoreSourceGeneration,
  logScoreSourceLifecycle,
  requestOmrCancellation,
  setActiveScoreIdOnGate,
} from './features/library/scoreSourceGenerationGate.js'
import {
  buildPdfSourceIdentity,
  clearLiveBundleCompanions,
  describeScoreSourceIdentities,
  hadCompanionScoreSources,
  invalidatePreviousScoreSideEffects,
  logScoreSourceIdentities,
  reconcileCompanionsToPdfIdentity,
  withOwnerPdfIdentity,
} from './features/library/scoreSourceReplacement.js'
import {
  contentIdentitySync,
  describeMusicXmlContent,
  describePdfContent,
  pushScoreSourceContentTrace,
} from './features/library/scoreSourceContentIdentity.js'
import {
  logActiveScoreChange,
  publishActiveScore,
  stampMidiOwnerScoreId,
  stampMusicXmlOwnerScoreId,
  syncActiveScoreFromLegacy,
} from './features/score/activeScore.js'
import {
  createEmptyInstrumentBundle,
  createInstrumentBundleStore,
  snapshotInstrumentBundle,
  bundleHasActiveFile,
} from './features/instruments/instrumentPracticeBundle.js'
import {
  createMusicXmlSource,
  cloneMusicXmlSource,
  clearOmrGeneratedPlaybackSource,
  describeMusicXmlSource,
  isMusicXmlSourceReady,
  isOmrGeneratedPlayback,
  isPracticePlaybackReady,
  validateRestoredOmrPlayback,
} from './features/import/musicXmlSource.js'
import {
  describePdfPracticeSource,
  refreshOwnedPdfFromBlobUrl,
  reuseOwnedPdfPracticeSource,
} from './features/import/pdfPracticeSource.js'
import { validateOmrGeneratedPlayback } from './features/omr/validateOmrGeneratedPlayback.js'
import { normalizeOmrMeasureGridMetadata } from './features/omr/omrMeasureGridMeta.js'
import { isPdfBufferAttached } from './features/omr/omrPdfSource.js'
import { logAppViewDebug, normalizeAppView } from './features/navigation/appViewDebug.js'
import { releaseOmrUiLocks } from './features/omr/omrUiGuard.js'
import { clearWarmPages } from './features/pdf/pdfPagePerf.js'
import { buildPdfFingerprint } from './features/score-follow/scoreFollowStorage.js'
import { clearScoreFollowAnchors } from './features/score-follow/scoreFollowStorage.js'
import {
  buildSessionMeta,
  clearSessionCompanionFiles,
  clearSessionStorage,
  saveSessionFiles,
  saveSessionMeta,
} from './features/session/sessionPersistence.js'
import './App.css'
import './styles/profile.css'
import './styles/legal.css'

function resolveInitialView() {
  return getViewFromPathname(window.location.pathname) ?? 'library'
}

function isFullPracticeSet(pdfLoaded, midiSource, musicXmlSource) {
  return Boolean(pdfLoaded && midiSource?.data && musicXmlSource?.data)
}

/** Practice needs PDF + timing; MIDI is optional sound. */
function isPracticeNavigableSet(pdfLoaded, musicXmlSource) {
  return Boolean(pdfLoaded && musicXmlSource?.data)
}

function buildAutoOmrRequest(file, instrumentId) {
  return buildAutoOmrRequestKey(file, instrumentId)
}

export default function App() {
  const { instrumentId, setInstrumentId } = useInstrument()
  const [activeView, setActiveView] = useState(resolveInitialView)
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfBuffer, setPdfBuffer] = useState(null)
  const [pdfMeta, setPdfMeta] = useState(null)
  const [initialPracticePrefs, setInitialPracticePrefs] = useState(null)
  // Ownership epoch: bumped on PDF replacement / instrument switch / uploaded
  // timing takeover. OMR callbacks must match this epoch to mutate sources.
  const [practiceSessionEpoch, setPracticeSessionEpoch] = useState(0)
  // Remount-only counter — does NOT participate in OMR ownership. Bumped after
  // a successful OMR apply so Practice remounts without invalidating the apply
  // token used for persistence.
  const [practiceRemountKey, setPracticeRemountKey] = useState(0)
  const [sessionSaveGeneration, setSessionSaveGeneration] = useState(0)
  // Sync mirrors — OMR accept / persistence must not wait for React to flush.
  const practiceSessionEpochRef = useRef(0)
  const sessionSaveGenerationRef = useRef(0)
  const [instrumentBundleRevision, setInstrumentBundleRevision] = useState(0)
  const [showWelcome, setShowWelcome] = useState(() => !isOnboardingDismissed())
  const [guidedTutorialOpen, setGuidedTutorialOpen] = useState(() =>
    shouldOpenGuidedTutorial({ completed: isGuidedTutorialCompleted() }),
  )
  const [demoCardHidden, setDemoCardHidden] = useState(() => isDemoCardHidden())
  const practicePrefsRef = useRef(null)
  const pendingClassifiedUploadRef = useRef(null)
  // Instrument-scoped active practice bundles. The currently selected
  // instrument's bundle lives in the App-level state below; the store keeps the
  // other instruments' saved bundles so switching never bleeds files/state.
  const instrumentBundleStoreRef = useRef(createInstrumentBundleStore())
  const activeInstrumentRef = useRef(normalizeInstrumentId(instrumentId))

  const syncPracticePrefsSnapshot = useCallback((snapshot) => {
    practicePrefsRef.current = snapshot
    setInitialPracticePrefs(snapshot)
    if (snapshot) {
      savePracticePrefs(snapshot)
    }
  }, [])

  const resetPracticePrefsForNewScore = useCallback(() => {
    syncPracticePrefsSnapshot(resetPracticeTimePrefs())
  }, [syncPracticePrefsSnapshot])
  const [fileName, setFileName] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState(null)
  const [midiSource, setMidiSource] = useState(null)
  const [musicXmlSource, setMusicXmlSource] = useState(null)
  const [sampleLoadState, setSampleLoadState] = useState({ loading: false, error: null })
  const [demoPieceActive, setDemoPieceActive] = useState(false)
  const [libraryFeedback, setLibraryFeedback] = useState(null)
  const [autoOmrRequest, setAutoOmrRequest] = useState(null)
  const [libraryTab, setLibraryTab] = useState(LIBRARY_TABS.PRACTICE)
  const [fileHelpSignal, setFileHelpSignal] = useState(0)
  const [pdfSoftWarning, setPdfSoftWarning] = useState(null)
  const [practicePdfReady, setPracticePdfReady] = useState(false)
  const activeViewRef = useRef(activeView)
  const libraryNavAtRef = useRef(0)
  const omrRunStartedAtRef = useRef(0)
  const activeDemoPiece = useMemo(
    () => getDemoPieceForInstrument(instrumentId),
    [instrumentId],
  )

  const {
    paperTheme,
    setSidebarOpen,
    togglePaperTheme,
  } = useWorkspacePreferences()

  const resetPdfViewerRuntime = useCallback(() => {
    clearWarmPages()
    setPracticePdfReady(false)
  }, [])

  // Live mirror of the currently selected instrument's active bundle. Kept in a
  // ref (updated every render) so the instrument-switch effect can snapshot the
  // OUTGOING instrument before applying the incoming one.
  // pdfIdentity is derived so sync readers can enforce companion ownership.
  const liveBundleRef = useRef(null)
  liveBundleRef.current = {
    pdfFile,
    instrumentId: activeInstrumentRef.current,
    pdfBuffer,
    pdfMeta,
    pdfIdentity: buildPdfSourceIdentity(pdfMeta),
    fileName,
    pageNumber,
    numPages,
    midiSource,
    musicXmlSource,
    practicePrefs: practicePrefsRef.current,
    pdfSoftWarning,
    demoPieceActive,
  }

  // ActiveScore mirror of legacy App fields. Ref is updated in an effect and
  // also bumped synchronously inside PDF replacement / OMR apply.
  const activeScoreRef = useRef(null)

  useEffect(() => {
    const previous = activeScoreRef.current
    const next = syncActiveScoreFromLegacy(previous, {
      pdfFile,
      pdfBuffer,
      pdfMeta,
      fileName,
      musicXmlSource,
      midiSource,
      generation: practiceSessionEpoch,
      activeOmrRunId: getActiveScoreSourceGeneration().activeOmrRunId,
    })
    activeScoreRef.current = next
    setActiveScoreIdOnGate(next.scoreId)
    publishActiveScore(next, {
      reason: previous?.scoreId !== next.scoreId ? 'score-id-changed' : 'sync',
    })
    if (
      previous?.scoreId !== next.scoreId ||
      previous?.musicXml?.hash !== next.musicXml?.hash ||
      previous?.generation !== next.generation
    ) {
      logActiveScoreChange(
        previous?.scoreId !== next.scoreId ? 'score-id-changed' : 'sync',
        next,
      )
    }
  }, [
    pdfFile,
    pdfBuffer,
    pdfMeta,
    fileName,
    musicXmlSource,
    midiSource,
    practiceSessionEpoch,
  ])

  // Epoch/generation refs are bumped synchronously on PDF replacement and kept
  // in sync via effects — do not assign from render state here or a stale paint
  // can overwrite the replacement bump before setState commits.

  useEffect(() => {
    practiceSessionEpochRef.current = practiceSessionEpoch
  }, [practiceSessionEpoch])

  useEffect(() => {
    sessionSaveGenerationRef.current = sessionSaveGeneration
  }, [sessionSaveGeneration])

  // Enforce ownership invariant: companions must belong to the active PDF.
  useEffect(() => {
    const pdfIdentity = buildPdfSourceIdentity(pdfMeta)
    if (!pdfIdentity) {
      return
    }
    const reconciled = reconcileCompanionsToPdfIdentity({
      pdfIdentity,
      musicXmlSource,
      midiSource,
    })
    if (reconciled.musicXmlRejected || reconciled.midiRejected) {
      logScoreSourceIdentities(
        'invariant-reject-mismatch',
        describeScoreSourceIdentities({
          pdfMeta,
          musicXmlSource,
          midiSource,
          practiceSessionEpoch: practiceSessionEpochRef.current,
          bundle: liveBundleRef.current,
        }),
      )
      if (reconciled.musicXmlRejected) {
        setMusicXmlSource(null)
        if (liveBundleRef.current) {
          liveBundleRef.current.musicXmlSource = null
        }
      }
      if (reconciled.midiRejected) {
        setMidiSource(null)
        if (liveBundleRef.current) {
          liveBundleRef.current.midiSource = null
        }
      }
    }
  }, [pdfMeta, musicXmlSource, midiSource])

  // Apply an instrument's saved bundle to the App-level active state. Passing
  // an empty bundle shows that instrument's empty Practice state. The PDF blob
  // URL is owned per bundle, so we never revoke here — the owning bundle keeps
  // it alive until its own PDF is replaced/cleared.
  const applyInstrumentBundle = useCallback((bundle) => {
    const next = bundle ?? createEmptyInstrumentBundle()
    setPdfFile(next.pdfFile)
    setPdfBuffer(next.pdfBuffer)
    setPdfMeta(next.pdfMeta)
    setFileName(next.fileName ?? '')
    setPageNumber(next.pageNumber ?? 1)
    setNumPages(next.numPages ?? null)
    setMidiSource(next.midiSource)
    setMusicXmlSource(next.musicXmlSource)
    setPdfSoftWarning(next.pdfSoftWarning ?? null)
    setDemoPieceActive(Boolean(next.demoPieceActive))
    setAutoOmrRequest(null)
    practicePrefsRef.current = next.practicePrefs ?? null
    setInitialPracticePrefs(next.practicePrefs ?? null)
    const nextEpoch = practiceSessionEpochRef.current + 1
    practiceSessionEpochRef.current = nextEpoch
    setPracticeSessionEpoch(nextEpoch)
    requestOmrCancellation({ reason: 'instrument-bundle-apply' })
    activatePdfScoreSource({
      pdfIdentity: buildPdfSourceIdentity(next.pdfMeta),
      epoch: nextEpoch,
      reason: 'instrument-bundle-apply',
    })
    setPracticeRemountKey((key) => key + 1)
    resetPdfViewerRuntime()
  }, [resetPdfViewerRuntime])

  // Save the outgoing instrument's prefs/history, but NEVER replace activeScore.
  // Piano ↔ Guitar only changes interpretation; the same scoreId stays active.
  useEffect(() => {
    const nextInstrument = normalizeInstrumentId(instrumentId)
    const previousInstrument = activeInstrumentRef.current
    if (nextInstrument === previousInstrument) {
      return
    }

    const store = instrumentBundleStoreRef.current
    const outgoing = snapshotInstrumentBundle(liveBundleRef.current)
    store.set(previousInstrument, outgoing)
    activeInstrumentRef.current = nextInstrument

    // Mirror the active score into the destination slot for My Uploads listing,
    // but do not apply a different bundle's MusicXML/PDF.
    const carried = {
      ...outgoing,
      instrumentId: nextInstrument,
      practicePrefs: store.get(nextInstrument)?.practicePrefs ?? null,
    }
    store.set(nextInstrument, carried)
    practicePrefsRef.current = carried.practicePrefs ?? null
    setInitialPracticePrefs(carried.practicePrefs ?? null)
    setPracticeRemountKey((key) => key + 1)
    setInstrumentBundleRevision((value) => value + 1)
    logScoreSourceLifecycle('instrument-switch-score-retained', {
      fromInstrument: previousInstrument,
      toInstrument: nextInstrument,
      scoreId: activeScoreRef.current?.scoreId ?? null,
      pdfIdentity: buildPdfSourceIdentity(outgoing.pdfMeta),
      musicXmlOwner: outgoing.musicXmlSource?.ownerScoreId ?? outgoing.musicXmlSource?.ownerPdfIdentity ?? null,
    })
  }, [instrumentId])

  const getInstrumentSessionBundles = useCallback(() => {
    const bundles = Object.fromEntries(instrumentBundleStoreRef.current.entries())
    const activeInstrument = normalizeInstrumentId(activeInstrumentRef.current)
    const activeBundle = snapshotInstrumentBundle(liveBundleRef.current)
    if (activeBundle.pdfFile && activeBundle.pdfBuffer) {
      bundles[activeInstrument] = activeBundle
    }
    return bundles
  }, [])

  useEffect(() => {
    function handlePopState() {
      setActiveView(normalizeAppView(getViewFromPathname(window.location.pathname) ?? 'library'))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  useEffect(() => {
    if (autoOmrRequest) {
      omrRunStartedAtRef.current = Date.now()
    }
  }, [autoOmrRequest])

  useEffect(() => {
    if (activeView === 'practice') {
      setPracticePdfReady(false)
    }
  }, [activeView, pdfFile])

  useEffect(() => {
    // Warm every supported instrument during idle time so the first Play / Hear It
    // on either Piano or Guitar uses decoded samples, not the synth fallback.
    warmupAllInstrumentSamplesOnIdle()
  }, [])

  useEffect(() => {
    if (musicXmlSource?.data) {
      releaseOmrUiLocks()
    }
  }, [musicXmlSource?.data])

  const navigateToView = useCallback((view) => {
    releaseOmrUiLocks()
    const nextView = normalizeAppView(view)
    if (nextView === 'library') {
      libraryNavAtRef.current = Date.now()
    }
    setActiveView(nextView)
    const nextPath = pathnameForView(nextView)
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
  }, [])

  const goHome = useCallback(() => {
    const home = getHomeNavigationTarget()
    setShowWelcome(home.showWelcome)
    setLibraryTab(LIBRARY_TABS.PRACTICE)
    setSidebarOpen(true)
    navigateToView(home.view)
    window.scrollTo(0, 0)
  }, [navigateToView, setSidebarOpen])

  useEffect(() => {
    return () => {
      const pdfUrls = new Set()
      if (liveBundleRef.current?.pdfFile) {
        pdfUrls.add(liveBundleRef.current.pdfFile)
      }
      for (const bundle of instrumentBundleStoreRef.current.values()) {
        if (bundle?.pdfFile) {
          pdfUrls.add(bundle.pdfFile)
        }
      }
      for (const pdfUrl of pdfUrls) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [])

  const clearDemoPiece = useCallback(() => {
    setDemoPieceActive(false)
  }, [])

  const markDemoCardHidden = useCallback(() => {
    hideDemoCard()
    setDemoCardHidden(true)
  }, [])

  const clearGeneratedPlaybackAfterOmrFailure = useCallback(() => {
    releaseOmrUiLocks()
    setMusicXmlSource((source) => clearOmrGeneratedPlaybackSource(source))
    resetPdfViewerRuntime()
  }, [resetPdfViewerRuntime])

  /**
   * Drop every prior score source before a different PDF becomes active.
   * Clears refs synchronously so auto-OMR / persistence cannot read Piece A.
   */
  const beginPdfScoreSourceReplacement = useCallback(
    ({ previousPdfMeta, previousFileName, previousMidi, previousMusicXml }) => {
      const previousPdfIdentity = buildPdfSourceIdentity(previousPdfMeta)
      logScoreSourceIdentities(
        'before-pdf-replacement',
        describeScoreSourceIdentities({
          pdfMeta: previousPdfMeta,
          musicXmlSource: previousMusicXml,
          midiSource: previousMidi,
          practiceSessionEpoch: practiceSessionEpochRef.current,
          bundle: liveBundleRef.current,
        }),
      )
      pushScoreSourceContentTrace('before-pdf-replacement', {
        pdf: describePdfContent(previousPdfMeta, liveBundleRef.current?.pdfBuffer),
        musicXml: describeMusicXmlContent(previousMusicXml),
        midiHash: contentIdentitySync(previousMidi?.data)?.hash ?? null,
        practiceSessionEpoch: practiceSessionEpochRef.current,
        previousPdfIdentity,
        ...getActiveScoreSourceGeneration(),
      })

      invalidatePreviousScoreSideEffects({
        previousPdfMeta,
        previousFileName,
        previousMusicXmlSource: previousMusicXml,
      })
      // Cancel Piece A's worker + invalidate its run id. Clearing the auto
      // request is correct here — Piece B queues a fresh request after activate.
      cancelInFlightOmrGeneration(setAutoOmrRequest, {
        previousPdfIdentity,
        reason: 'pdf-replacement',
        clearAutoRequest: true,
      })

      // Synchronous ref wipe — must happen before setState flush / OMR queue.
      clearLiveBundleCompanions(liveBundleRef.current)

      // Bump epoch/generation on refs first so late OMR/persistence cannot use
      // a stale closed-over React state value from before this replacement.
      const nextEpoch = practiceSessionEpochRef.current + 1
      const nextSaveGeneration = sessionSaveGenerationRef.current + 1
      practiceSessionEpochRef.current = nextEpoch
      sessionSaveGenerationRef.current = nextSaveGeneration

      // Gate: no PDF identity until B is installed; no OMR run may apply.
      activatePdfScoreSource({
        pdfIdentity: null,
        epoch: nextEpoch,
        previousPdfIdentity,
        reason: 'pdf-replacement-clear',
      })

      // Drop prior authoritative / playback snapshots so automation cannot
      // mistake Piece A for a successful Piece B prepare.
      if (typeof window !== 'undefined') {
        window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ = null
        window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ = null
      }

      setMusicXmlSource(null)
      setMidiSource(null)
      setDemoPieceActive(false)
      resetPracticePrefsForNewScore()
      setPracticeSessionEpoch(nextEpoch)
      setSessionSaveGeneration(nextSaveGeneration)
      setPracticeRemountKey((key) => key + 1)

      const instrument = normalizeInstrumentId(activeInstrumentRef.current)
      instrumentBundleStoreRef.current.set(
        instrument,
        snapshotInstrumentBundle({
          ...(liveBundleRef.current ?? {}),
          instrumentId: instrument,
          midiSource: null,
          musicXmlSource: null,
          demoPieceActive: false,
          practicePrefs: practicePrefsRef.current,
        }),
      )

      // Drop persisted companions immediately so a late Piece A IDB write cannot
      // keep old MusicXML around until the debounced saver runs.
      void clearSessionCompanionFiles().catch(() => {})

      logScoreSourceIdentities(
        'after-companions-cleared',
        describeScoreSourceIdentities({
          pdfMeta: previousPdfMeta,
          musicXmlSource: liveBundleRef.current?.musicXmlSource ?? null,
          midiSource: liveBundleRef.current?.midiSource ?? null,
          practiceSessionEpoch: nextEpoch,
          bundle: liveBundleRef.current,
        }),
      )
      pushScoreSourceContentTrace('after-companions-cleared', {
        musicXml: describeMusicXmlContent(liveBundleRef.current?.musicXmlSource),
        midiHash: contentIdentitySync(liveBundleRef.current?.midiSource?.data)?.hash ?? null,
        practiceSessionEpoch: nextEpoch,
        ...getActiveScoreSourceGeneration(),
      })

      return hadCompanionScoreSources({
        midiSource: previousMidi,
        musicXmlSource: previousMusicXml,
      })
    },
    [resetPracticePrefsForNewScore],
  )

  const handleFileSelect = useCallback(async (file) => {
    clearDemoPiece()
    markDemoCardHidden()
    const validation = validateFileForImport(file, 'pdf')
    if (!validation.ok) {
      setLibraryFeedback({ type: 'error', message: validation.message })
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      const clearedCompanionFiles = beginPdfScoreSourceReplacement({
        previousPdfMeta: pdfMeta,
        previousFileName: fileName,
        previousMidi: midiSource,
        previousMusicXml: musicXmlSource,
      })
      const nextPdfMeta = {
        fileName: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }
      const nextPdfBuffer = buffer.slice(0)
      const nextPdfUrl = URL.createObjectURL(file)
      setPdfBuffer(nextPdfBuffer)
      setPdfFile((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return nextPdfUrl
      })
      setFileName(file.name)
      setPdfMeta(nextPdfMeta)
      setPageNumber(1)
      setNumPages(null)
      resetPdfViewerRuntime()
      setPdfSoftWarning(validation.softWarning)
      const nextIdentity = buildPdfSourceIdentity(nextPdfMeta)
      // Keep live ref aligned before React paints so OMR accept cannot see Piece A.
      if (liveBundleRef.current) {
        liveBundleRef.current.pdfFile = nextPdfUrl
        liveBundleRef.current.pdfBuffer = nextPdfBuffer
        liveBundleRef.current.pdfMeta = nextPdfMeta
        liveBundleRef.current.fileName = file.name
        liveBundleRef.current.midiSource = null
        liveBundleRef.current.musicXmlSource = null
        liveBundleRef.current.pdfIdentity = nextIdentity
      }
      // Synchronously mint ActiveScore for B before OMR can register.
      const nextScore = syncActiveScoreFromLegacy(activeScoreRef.current, {
        pdfFile: nextPdfUrl,
        pdfBuffer: nextPdfBuffer,
        pdfMeta: nextPdfMeta,
        fileName: file.name,
        musicXmlSource: null,
        midiSource: null,
        generation: practiceSessionEpochRef.current,
        activeOmrRunId: null,
      })
      activeScoreRef.current = nextScore
      setActiveScoreIdOnGate(nextScore.scoreId)
      publishActiveScore(nextScore, { reason: 'pdf-file-select' })
      logActiveScoreChange('pdf-file-select', nextScore)
      activatePdfScoreSource({
        pdfIdentity: nextIdentity,
        epoch: practiceSessionEpochRef.current,
        previousPdfIdentity: buildPdfSourceIdentity(pdfMeta),
        reason: 'pdf-file-select',
        scoreId: nextScore.scoreId,
      })
      logScoreSourceIdentities(
        'before-omr-queue',
        describeScoreSourceIdentities({
          pdfMeta: nextPdfMeta,
          pdfFile: nextPdfUrl,
          musicXmlSource: null,
          midiSource: null,
          practiceSessionEpoch: practiceSessionEpochRef.current,
          bundle: liveBundleRef.current,
        }),
      )
      pushScoreSourceContentTrace('before-omr-queue', {
        pdf: describePdfContent(nextPdfMeta, nextPdfBuffer),
        musicXml: null,
        practiceSessionEpoch: practiceSessionEpochRef.current,
        ...getActiveScoreSourceGeneration(),
      })
      setAutoOmrRequest(buildAutoOmrRequest(file, activeInstrumentRef.current))
      const instrument = normalizeInstrumentId(activeInstrumentRef.current)
      instrumentBundleStoreRef.current.set(
        instrument,
        snapshotInstrumentBundle({
          instrumentId: instrument,
          pdfFile: nextPdfUrl,
          pdfBuffer: nextPdfBuffer,
          pdfMeta: nextPdfMeta,
          fileName: file.name,
          pageNumber: 1,
          numPages: null,
          midiSource: null,
          musicXmlSource: null,
          demoPieceActive: false,
          practicePrefs: practicePrefsRef.current,
          pdfSoftWarning: validation.softWarning ?? null,
        }),
      )
      setLibraryFeedback({
        type: clearedCompanionFiles || validation.softWarning ? 'info' : 'success',
        message: pdfPreparingScoreMessage(file.name, {
          clearedCompanionFiles,
          softWarning: validation.softWarning,
        }),
      })

      navigateToView('library')
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatPdfImportError(error),
      })
    }
  }, [
    pdfMeta,
    fileName,
    midiSource,
    musicXmlSource,
    beginPdfScoreSourceReplacement,
    clearDemoPiece,
    markDemoCardHidden,
    navigateToView,
    resetPdfViewerRuntime,
  ])

  const handleMidiSelect = useCallback(async (file) => {
    clearDemoPiece()
    markDemoCardHidden()
    try {
      const data = await readFileArrayBuffer(file, 'midi')
      const ownerPdfIdentity = buildPdfSourceIdentity(pdfMeta)
      const nextMidi = withOwnerPdfIdentity({ fileName: file.name, data }, ownerPdfIdentity)
      setMidiSource(nextMidi)
      if (liveBundleRef.current) {
        liveBundleRef.current.midiSource = nextMidi
      }
      const fullSet = isFullPracticeSet(Boolean(pdfFile), nextMidi, musicXmlSource)
      setLibraryFeedback({
        type: 'success',
        message: fullSet
          ? `Loaded ${file.name}. All files ready — opening Practice.`
          : `Loaded ${file.name}. Add sheet music and a timing file to open Practice.`,
      })
      if (fullSet) {
        navigateToView('practice')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatMidiImportError(error),
      })
    }
  }, [pdfFile, pdfMeta, musicXmlSource, clearDemoPiece, markDemoCardHidden, navigateToView])

  const handleMusicXmlSelect = useCallback(async (file) => {
    clearDemoPiece()
    markDemoCardHidden()
    if (isMuseScoreSourceFile(file)) {
      setLibraryFeedback({ type: 'info', message: MUSESCORE_PLANNED_MESSAGE })
      return
    }

    try {
      const data = await readFileArrayBuffer(file, 'musicXml')
      const replacingOmr = isOmrGeneratedPlayback(musicXmlSource)
      // User-supplied timing owns the session — cancel any in-flight preparation.
      cancelInFlightOmrGeneration(setAutoOmrRequest, {
        previousPdfIdentity: buildPdfSourceIdentity(pdfMeta),
        reason: 'uploaded-musicxml',
      })
      const ownerPdfIdentity = buildPdfSourceIdentity(pdfMeta)
      const nextXml = withOwnerPdfIdentity(
        { fileName: file.name, data, source: 'upload' },
        ownerPdfIdentity,
      )
      setMusicXmlSource(nextXml)
      if (liveBundleRef.current) {
        liveBundleRef.current.musicXmlSource = nextXml
      }
      resetPracticePrefsForNewScore()
      if (replacingOmr || pdfMeta?.fileName) {
        clearScoreFollowAnchors({
          fingerprint: buildPdfFingerprint(pdfMeta),
          fileName: pdfMeta?.fileName ?? fileName,
        })
        const nextEpoch = practiceSessionEpochRef.current + 1
        practiceSessionEpochRef.current = nextEpoch
        setPracticeSessionEpoch(nextEpoch)
        activatePdfScoreSource({
          pdfIdentity: ownerPdfIdentity,
          epoch: nextEpoch,
          reason: 'uploaded-musicxml',
        })
        setPracticeRemountKey((key) => key + 1)
      }
      const canPractice = isPracticeNavigableSet(Boolean(pdfFile), nextXml)
      setLibraryFeedback({
        type: 'success',
        message: canPractice
          ? `Loaded ${file.name}. Opening Practice.`
          : `Loaded ${file.name}. Add sheet music to open Practice.`,
      })
      if (canPractice) {
        navigateToView('practice')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatMusicXmlImportError(error),
      })
    }
  }, [
    pdfFile,
    pdfMeta,
    fileName,
    musicXmlSource,
    clearDemoPiece,
    markDemoCardHidden,
    navigateToView,
    resetPracticePrefsForNewScore,
  ])

  const handleAutoOmrRequestConsumed = useCallback(() => {
    setAutoOmrRequest(null)
  }, [])

  const handleClearMusicXml = useCallback(() => {
    clearDemoPiece()
    setMusicXmlSource(null)
    if (liveBundleRef.current) {
      liveBundleRef.current.musicXmlSource = null
    }
    setAutoOmrRequest(null)
    setLibraryFeedback({
      type: 'info',
      message: 'Timing file removed. Add a timing file to use Practice, loops, and Wait For You.',
    })
    navigateToView('library')
  }, [clearDemoPiece, navigateToView])

  const handleClearMidi = useCallback(() => {
    clearDemoPiece()
    setMidiSource(null)
    if (liveBundleRef.current) {
      liveBundleRef.current.midiSource = null
    }
    setLibraryFeedback({
      type: 'info',
      message: 'Sound file removed. Timing, the score cursor, and Wait For You still work without MIDI.',
    })
    navigateToView('library')
  }, [clearDemoPiece, navigateToView])

  const handleOmrGenerated = useCallback(async ({
    fileName: generatedFileName,
    musicXml,
    noteCount,
    measureCount,
    measureGrid,
    warnings = [],
    sourcePdfFileName = null,
    sourcePdfFileUrl = null,
    sourceInstrumentId = null,
    sourcePdfIdentity = null,
    sourcePracticeSessionEpoch = null,
    sourceOmrRunId = null,
    sourceScoreId = null,
  }) => {
    const callbackToken = {
      callbackPdfIdentity: sourcePdfIdentity,
      callbackEpoch: sourcePracticeSessionEpoch,
      callbackRunId: sourceOmrRunId,
      callbackScoreId: sourceScoreId ?? activeScoreRef.current?.scoreId ?? null,
    }
    const discardStale = (acceptance) => {
      logScoreSourceLifecycle('omr-result-discarded', {
        ...callbackToken,
        reason: acceptance?.reason ?? 'rejected',
        message: acceptance?.message ?? null,
      })
      // Zero side effects: do not clear prep, cancel B's queue, feedback, or playback.
      return {
        ok: false,
        discarded: true,
        reason: acceptance?.reason ?? 'rejected',
        message: acceptance?.message
          ?? 'That PDF changed before timing finished. Upload it again or retry.',
      }
    }

    // Hard gate BEFORE any mutation — including UI unlock / companion reconcile.
    const gateOpen = assertScoreSourceMutationAllowed({
      ...callbackToken,
      phase: 'omr-result-apply-attempt',
    })
    if (!gateOpen.ok) {
      return discardStale(gateOpen)
    }

    releaseOmrUiLocks()
    // Always read live sources — never trust the callback closure, which can still
    // hold Piece A's MusicXML/MIDI if generation started across a PDF replacement.
    const currentBundle = liveBundleRef.current ?? {}
    const currentPdfIdentity =
      buildPdfSourceIdentity(currentBundle.pdfMeta) ??
      buildPdfSourceIdentity(pdfMeta) ??
      null
    // Drop any companion that does not belong to the active PDF before accept.
    const reconciled = reconcileCompanionsToPdfIdentity({
      pdfIdentity: currentPdfIdentity,
      musicXmlSource: currentBundle.musicXmlSource ?? null,
      midiSource: currentBundle.midiSource ?? null,
    })
    if (reconciled.musicXmlRejected || reconciled.midiRejected) {
      const stillOwns = assertScoreSourceMutationAllowed({
        ...callbackToken,
        phase: 'omr-result-reconcile-gate',
      })
      if (!stillOwns.ok) {
        return discardStale(stillOwns)
      }
      currentBundle.musicXmlSource = reconciled.musicXmlSource
      currentBundle.midiSource = reconciled.midiSource
      setMusicXmlSource(reconciled.musicXmlSource)
      setMidiSource(reconciled.midiSource)
    }
    const liveMusicXmlSource = reconciled.musicXmlSource
    const liveMidiSource = reconciled.midiSource
    const currentInstrument = normalizeInstrumentId(activeInstrumentRef.current)

    logScoreSourceIdentities(
      'omr-complete',
      describeScoreSourceIdentities({
        pdfMeta: currentBundle.pdfMeta ?? pdfMeta,
        pdfFile: currentBundle.pdfFile ?? pdfFile,
        musicXmlSource: liveMusicXmlSource,
        midiSource: liveMidiSource,
        practiceSessionEpoch: practiceSessionEpochRef.current,
        bundle: currentBundle,
      }),
    )

    const acceptance = shouldAcceptOmrGeneratedResult({
      musicXmlSource: liveMusicXmlSource,
      sourceInstrumentId,
      currentInstrumentId: currentInstrument,
      sourcePdfFileName,
      sourcePdfFileUrl,
      currentPdfFileName: currentBundle.pdfMeta?.fileName ?? null,
      currentPdfFileUrl: currentBundle.pdfFile ?? null,
      sourcePdfIdentity,
      currentPdfIdentity,
      sourcePracticeSessionEpoch,
      currentPracticeSessionEpoch: practiceSessionEpochRef.current,
      sourceOmrRunId,
    })
    if (!acceptance.ok) {
      return discardStale(acceptance)
    }

    const playbackValidation = validateOmrGeneratedPlayback(musicXml, generatedFileName)
    if (!playbackValidation.ok) {
      if (!assertScoreSourceMutationAllowed({ ...callbackToken, phase: 'omr-validation-failure-gate' }).ok) {
        return discardStale({ reason: 'stale-after-validation' })
      }
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({
        type: 'error',
        message: playbackValidation.message,
      })
      return { ok: false, message: playbackValidation.message }
    }

    const activePdfFile = currentBundle.pdfFile ?? pdfFile
    const activePdfMeta = currentBundle.pdfMeta ?? pdfMeta
    if (!activePdfFile) {
      const message = 'Generated playback failed — PDF preview is missing. Re-upload the PDF and try again.'
      if (!assertScoreSourceMutationAllowed({ ...callbackToken, phase: 'omr-missing-pdf-gate' }).ok) {
        return discardStale({ reason: 'stale-missing-pdf' })
      }
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({
        type: 'error',
        message,
      })
      return { ok: false, message }
    }

    let nextPdfFile = activePdfFile
    let nextPdfBuffer = currentBundle.pdfBuffer ?? pdfBuffer
    const reusablePdf = reuseOwnedPdfPracticeSource({
      pdfFile: activePdfFile,
      pdfBuffer: nextPdfBuffer,
    })
    try {
      if (!reusablePdf) {
        const refreshed = await refreshOwnedPdfFromBlobUrl(activePdfFile, {
          revokePrevious: false,
        })
        // The await above yields. If the user replaced the PDF meanwhile, do NOT
        // write Piece A's refreshed blob over Piece B — and do not apply A's MusicXML.
        const stillOwnsSession = assertScoreSourceMutationAllowed({
          ...callbackToken,
          phase: 'omr-result-apply-after-refresh',
        })
        if (!stillOwnsSession.ok) {
          if (refreshed.pdfFile?.startsWith?.('blob:')) {
            URL.revokeObjectURL(refreshed.pdfFile)
          }
          return discardStale(stillOwnsSession)
        }
        const liveAfterRefresh = liveBundleRef.current ?? {}
        const acceptanceAfterRefresh = shouldAcceptOmrGeneratedResult({
          musicXmlSource: liveAfterRefresh.musicXmlSource ?? null,
          sourceInstrumentId,
          currentInstrumentId: normalizeInstrumentId(activeInstrumentRef.current),
          sourcePdfFileName,
          sourcePdfFileUrl,
          currentPdfFileName: liveAfterRefresh.pdfMeta?.fileName ?? null,
          currentPdfFileUrl: liveAfterRefresh.pdfFile ?? null,
          sourcePdfIdentity,
          currentPdfIdentity: buildPdfSourceIdentity(liveAfterRefresh.pdfMeta),
          sourcePracticeSessionEpoch,
          currentPracticeSessionEpoch: practiceSessionEpochRef.current,
          sourceOmrRunId,
        })
        if (!acceptanceAfterRefresh.ok) {
          if (refreshed.pdfFile?.startsWith?.('blob:')) {
            URL.revokeObjectURL(refreshed.pdfFile)
          }
          return discardStale(acceptanceAfterRefresh)
        }
        nextPdfFile = refreshed.pdfFile
        nextPdfBuffer = refreshed.pdfBuffer
        setPdfBuffer(refreshed.pdfBuffer)
        setPdfFile((previous) => {
          if (previous && previous !== refreshed.pdfFile) {
            URL.revokeObjectURL(previous)
          }
          return refreshed.pdfFile
        })
        setNumPages(null)
        resetPdfViewerRuntime()
      }
    } catch (error) {
      if (!assertScoreSourceMutationAllowed({ ...callbackToken, phase: 'omr-refresh-error-gate' }).ok) {
        return discardStale({ reason: 'stale-refresh-error' })
      }
      const message =
        error instanceof Error
          ? `Generated playback failed — ${error.message}`
          : 'Generated playback failed — PDF could not be reloaded.'
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({
        type: 'error',
        message,
      })
      return { ok: false, message }
    }

    // Final ownership check immediately before applying MusicXML — covers the
    // no-await path and any replace that landed after refresh state writes.
    const liveBeforeApply = liveBundleRef.current ?? {}
    const livePdfIdentity =
      buildPdfSourceIdentity(liveBeforeApply.pdfMeta) ??
      buildPdfSourceIdentity(activePdfMeta) ??
      null
    const liveEpoch = practiceSessionEpochRef.current
    const reacceptance = shouldAcceptOmrGeneratedResult({
      musicXmlSource: liveBeforeApply.musicXmlSource ?? null,
      sourceInstrumentId,
      currentInstrumentId: normalizeInstrumentId(activeInstrumentRef.current),
      sourcePdfFileName,
      sourcePdfFileUrl,
      currentPdfFileName: liveBeforeApply.pdfMeta?.fileName ?? activePdfMeta?.fileName ?? null,
      currentPdfFileUrl: liveBeforeApply.pdfFile ?? nextPdfFile ?? null,
      sourcePdfIdentity,
      currentPdfIdentity: livePdfIdentity,
      sourcePracticeSessionEpoch,
      currentPracticeSessionEpoch: liveEpoch,
      sourceOmrRunId,
    })
    if (!reacceptance.ok) {
      return discardStale(reacceptance)
    }

    // Prefer the live PDF identity/meta so we never stamp Piece A ownership onto Piece B.
    const commitPdfMeta = liveBeforeApply.pdfMeta ?? activePdfMeta
    const commitPdfFile = liveBeforeApply.pdfFile ?? nextPdfFile
    const commitPdfBuffer = liveBeforeApply.pdfBuffer ?? nextPdfBuffer
    const commitPdfIdentity =
      livePdfIdentity ?? buildPdfSourceIdentity(commitPdfMeta) ?? null

    const stablePdfMeta = commitPdfMeta ?? {
      fileName: generatedFileName?.replace(/\.omr\.musicxml$/i, '.pdf') || 'score.pdf',
      size: commitPdfBuffer?.byteLength ?? null,
      lastModified: Date.now(),
    }
    if (!commitPdfMeta) {
      setPdfMeta(stablePdfMeta)
      setFileName(stablePdfMeta.fileName)
    }

    const title = stablePdfMeta.fileName.replace(/\.pdf$/i, '') || 'Generated score'
    const pdfFingerprint =
      buildPdfFingerprint(stablePdfMeta) ??
      `${stablePdfMeta.fileName}::${commitPdfBuffer?.byteLength ?? 0}`
    const omrMeta = {
      noteCount: playbackValidation.noteCount ?? noteCount ?? 0,
      measureCount: playbackValidation.measureCount ?? measureCount ?? 0,
      durationSeconds: playbackValidation.durationSeconds,
      title,
      pdfFingerprint,
      pdfFileName: stablePdfMeta.fileName,
      createdAt: new Date().toISOString(),
    }
    const omrWarnings = [...new Set((warnings ?? []).filter(Boolean))].slice(0, 8)
    if (omrWarnings.length) {
      omrMeta.warnings = omrWarnings
    }
    const normalizedMeasureGrid = normalizeOmrMeasureGridMetadata(measureGrid)
    if (normalizedMeasureGrid) {
      omrMeta.measureGrid = normalizedMeasureGrid
    }
    const nextMusicXmlSource = stampMusicXmlOwnerScoreId(
      createMusicXmlSource(generatedFileName, musicXml, {
        source: 'omr',
        omrMeta,
        ownerPdfIdentity: commitPdfIdentity ?? buildPdfSourceIdentity(stablePdfMeta),
      }),
      callbackToken.callbackScoreId ?? activeScoreRef.current?.scoreId,
    )
    const generatedContent = describeMusicXmlContent(nextMusicXmlSource, musicXml)
    const pdfContent = describePdfContent(stablePdfMeta, commitPdfBuffer)
    pushScoreSourceContentTrace('omr-generated-input', {
      pdf: pdfContent,
      musicXml: generatedContent,
      practiceSessionEpoch: practiceSessionEpochRef.current,
      currentPdfIdentity: commitPdfIdentity,
      sourcePdfIdentity,
      sourcePracticeSessionEpoch,
      sourceOmrRunId,
      ...getActiveScoreSourceGeneration(),
    })

    // Hard reject: generated MusicXML must be owned by the active score instance.
    const ownerScoreId = nextMusicXmlSource.ownerScoreId
    const activeScoreId = activeScoreRef.current?.scoreId ?? null
    if (!ownerScoreId || !activeScoreId || ownerScoreId !== activeScoreId) {
      const message = 'Prepared timing did not match the active score — upload the PDF again.'
      pushScoreSourceContentTrace('omr-generated-owner-reject', {
        ownerScoreId,
        activeScoreId,
        ownerIdentity: nextMusicXmlSource.ownerPdfIdentity,
        currentPdfIdentity: commitPdfIdentity,
        musicXmlHash: generatedContent.contentHash,
      })
      if (!assertScoreSourceMutationAllowed({ ...callbackToken, phase: 'omr-owner-reject-gate' }).ok) {
        return discardStale({ reason: 'stale-owner-reject' })
      }
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({ type: 'error', message })
      return { ok: false, message }
    }

    const ownerIdentity = nextMusicXmlSource.ownerPdfIdentity
    if (!ownerIdentity || ownerIdentity !== (commitPdfIdentity ?? buildPdfSourceIdentity(stablePdfMeta))) {
      const message = 'Prepared timing did not match the active PDF — upload the PDF again.'
      pushScoreSourceContentTrace('omr-generated-pdf-owner-reject', {
        ownerIdentity,
        currentPdfIdentity: commitPdfIdentity,
        musicXmlHash: generatedContent.contentHash,
      })
      if (!assertScoreSourceMutationAllowed({ ...callbackToken, phase: 'omr-pdf-owner-reject-gate' }).ok) {
        return discardStale({ reason: 'stale-owner-reject' })
      }
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({ type: 'error', message })
      return { ok: false, message }
    }

    clearDemoPiece()
    markDemoCardHidden()
    dismissOnboarding()
    setShowWelcome(false)
    // Keep React midi aligned with the live bundle (null after PDF-only replace).
    // Re-stamp MIDI ownership onto the active PDF when it survived replacement.
    const ownedMidi = stampMidiOwnerScoreId(
      withOwnerPdfIdentity(
        liveBeforeApply.midiSource ?? liveMidiSource,
        commitPdfIdentity ?? buildPdfSourceIdentity(stablePdfMeta),
      ),
      ownerScoreId,
    )

    // Remount Practice without bumping the ownership epoch — persistence still
    // belongs to this callback token until a newer PDF replacement.
    setPracticeRemountKey((key) => key + 1)

    setMidiSource(ownedMidi)
    setMusicXmlSource(nextMusicXmlSource)
    if (liveBundleRef.current) {
      liveBundleRef.current.midiSource = ownedMidi
      liveBundleRef.current.musicXmlSource = nextMusicXmlSource
      liveBundleRef.current.pdfMeta = stablePdfMeta
      liveBundleRef.current.pdfBuffer = commitPdfBuffer
      liveBundleRef.current.pdfFile = commitPdfFile
      liveBundleRef.current.pdfIdentity = commitPdfIdentity ?? buildPdfSourceIdentity(stablePdfMeta)
    }
    // Keep ActiveScore in sync immediately (before React effect flush).
    const appliedScore = syncActiveScoreFromLegacy(activeScoreRef.current, {
      pdfFile: commitPdfFile,
      pdfBuffer: commitPdfBuffer,
      pdfMeta: stablePdfMeta,
      fileName: stablePdfMeta.fileName,
      musicXmlSource: nextMusicXmlSource,
      midiSource: ownedMidi,
      generation: practiceSessionEpochRef.current,
      activeOmrRunId: sourceOmrRunId,
    })
    activeScoreRef.current = appliedScore
    setActiveScoreIdOnGate(appliedScore.scoreId)
    publishActiveScore(appliedScore, { reason: 'omr-apply' })
    logActiveScoreChange('omr-apply', appliedScore)
    setAutoOmrRequest(null)
    setLibraryFeedback({
      type: 'success',
      message: `Ready to practice (${playbackValidation.noteCount} notes, ${Math.round(playbackValidation.durationSeconds)}s).`,
    })
    // Rapid A→B→C: if the user returned to Library after this OMR started
    // (to upload a replacement), do not yank them into Practice mid-upload.
    if (libraryNavAtRef.current <= omrRunStartedAtRef.current) {
      navigateToView('practice')
    }

    logScoreSourceLifecycle('authoritative-musicxml-changed', {
      ...callbackToken,
      authoritativeMusicXmlHash: generatedContent.contentHash,
      ownerPdfIdentity: ownerIdentity,
      generatedMusicXmlOwnerIdentity: ownerIdentity,
      practiceSessionEpoch: practiceSessionEpochRef.current,
    })

    pushScoreSourceContentTrace('app-state-after-onGenerated', {
      pdf: pdfContent,
      musicXml: generatedContent,
      practiceSessionEpoch: practiceSessionEpochRef.current,
      authoritativeMusicXmlHash: generatedContent.contentHash,
      ownerPdfIdentity: ownerIdentity,
      sourceOmrRunId,
      ...getActiveScoreSourceGeneration(),
    })

    const activeBundleForPersistence = snapshotInstrumentBundle({
      instrumentId: currentInstrument,
      pdfFile: commitPdfFile,
      pdfBuffer: commitPdfBuffer,
      pdfMeta: stablePdfMeta,
      fileName: stablePdfMeta.fileName,
      pageNumber: liveBeforeApply.pageNumber ?? currentBundle.pageNumber ?? pageNumber,
      numPages: liveBeforeApply.numPages ?? currentBundle.numPages ?? null,
      midiSource: ownedMidi,
      musicXmlSource: nextMusicXmlSource,
      practicePrefs: practicePrefsRef.current,
      demoPieceActive: false,
      pdfSoftWarning: liveBeforeApply.pdfSoftWarning ?? currentBundle.pdfSoftWarning ?? null,
    })
    if (!assertScoreSourceMutationAllowed({
      ...callbackToken,
      phase: 'instrument-bundle-update-gate',
    }).ok) {
      return discardStale({ reason: 'stale-before-bundle-update' })
    }
    instrumentBundleStoreRef.current.set(currentInstrument, activeBundleForPersistence)
    const persistedInstrumentBundles = Object.fromEntries(instrumentBundleStoreRef.current.entries())
    persistedInstrumentBundles[currentInstrument] = activeBundleForPersistence

    pushScoreSourceContentTrace('instrument-bundle-update', {
      pdf: pdfContent,
      musicXml: describeMusicXmlContent(activeBundleForPersistence.musicXmlSource),
      practiceSessionEpoch: practiceSessionEpochRef.current,
      bundleInstrumentId: currentInstrument,
      sourceOmrRunId,
    })

    logScoreSourceIdentities(
      'persistence-after-omr',
      describeScoreSourceIdentities({
        pdfMeta: stablePdfMeta,
        pdfFile: commitPdfFile,
        musicXmlSource: nextMusicXmlSource,
        midiSource: ownedMidi,
        practiceSessionEpoch: practiceSessionEpochRef.current,
        bundle: activeBundleForPersistence,
      }),
    )

    const persistGate = assertScoreSourceMutationAllowed({
      ...callbackToken,
      phase: 'persistence-run',
    })
    if (!persistGate.ok) {
      return discardStale(persistGate)
    }

    const sessionMeta = buildSessionMeta({
      pdfMeta: stablePdfMeta,
      midiSource: ownedMidi,
      musicXmlSource: nextMusicXmlSource,
      activeView: 'practice',
      pageNumber: liveBeforeApply.pageNumber ?? currentBundle.pageNumber ?? pageNumber,
      practicePrefs: practicePrefsRef.current,
      instrumentId: currentInstrument,
      instrumentBundles: persistedInstrumentBundles,
      scoreId: ownerScoreId,
    })
    saveSessionMeta(sessionMeta)
    try {
      await saveSessionFiles({
        pdf: commitPdfBuffer ? { data: commitPdfBuffer.slice(0) } : null,
        midi: ownedMidi?.data ? { data: ownedMidi.data.slice(0) } : null,
        musicXml: nextMusicXmlSource.data ? { data: nextMusicXmlSource.data.slice(0) } : null,
        instrumentFiles: Object.fromEntries(
          Object.entries(persistedInstrumentBundles).map(([bundleInstrumentId, bundle]) => [
            bundleInstrumentId,
            {
              pdf: bundle.pdfBuffer ? { data: bundle.pdfBuffer.slice(0) } : null,
              midi: bundle.midiSource?.data ? { data: bundle.midiSource.data.slice(0) } : null,
              musicXml: bundle.musicXmlSource?.data
                ? { data: bundle.musicXmlSource.data.slice(0) }
                : null,
            },
          ]),
        ),
      })
      const afterPersist = assertScoreSourceMutationAllowed({
        ...callbackToken,
        phase: 'persistence-after-await',
      })
      if (!afterPersist.ok) {
        await clearSessionCompanionFiles().catch(() => {})
        return discardStale(afterPersist)
      }
      logScoreSourceLifecycle('persistence-run', {
        ...callbackToken,
        pdf: pdfContent,
        musicXml: generatedContent,
        practiceSessionEpoch: practiceSessionEpochRef.current,
      })
      pushScoreSourceContentTrace('indexeddb-persistence', {
        pdf: pdfContent,
        musicXml: generatedContent,
        practiceSessionEpoch: practiceSessionEpochRef.current,
        sourceOmrRunId,
      })
    } catch (error) {
      logAppViewDebug('omr-generated:save-files-error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }

    logAppViewDebug('omr-generated', {
      pdf: describePdfPracticeSource({ pdfFile: commitPdfFile, pdfBuffer: commitPdfBuffer }),
      musicXml: describeMusicXmlSource(nextMusicXmlSource),
      durationSeconds: playbackValidation.durationSeconds,
      contentHash: generatedContent.contentHash,
    })

    if (typeof window !== 'undefined') {
      window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ = {
        scoreId: ownerScoreId,
        ownerScoreId,
        pdfMetaIdentity: pdfContent.metaIdentity,
        pdfContentHash: pdfContent.contentHash,
        musicXmlHash: generatedContent.contentHash,
        musicXmlByteLength: generatedContent.byteLength,
        measureCount: generatedContent.measureCount,
        durationSeconds: generatedContent.durationSeconds,
        ownerPdfIdentity: ownerIdentity,
        practiceSessionEpoch: practiceSessionEpochRef.current,
        sourceOmrRunId,
        sourceType: 'omr',
        at: Date.now(),
      }
    }

    return {
      ok: true,
      noteCount: playbackValidation.noteCount,
      measureCount: playbackValidation.measureCount,
      durationSeconds: playbackValidation.durationSeconds,
      contentHash: generatedContent.contentHash,
      ownerPdfIdentity: ownerIdentity,
      ownerScoreId,
    }
  }, [
    pdfFile,
    pdfMeta,
    pdfBuffer,
    pageNumber,
    navigateToView,
    clearDemoPiece,
    markDemoCardHidden,
    clearGeneratedPlaybackAfterOmrFailure,
    resetPdfViewerRuntime,
  ])

  const handleLoadSampleFixtures = useCallback(async (pieceId = null) => {
    if (!isDemoSampleEnabled()) {
      return
    }

    setSampleLoadState({ loading: true, error: null })

    try {
      const { pdfFile, midiFile, musicXmlFile, meta } = await fetchSampleFixtureFiles(instrumentId, pieceId)

      const pdfData = await pdfFile.arrayBuffer()
      const pdfBufferCopy = pdfData.slice(0)
      const nextPdfUrl = URL.createObjectURL(pdfFile)
      setPdfBuffer(pdfBufferCopy)
      setPdfFile((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return nextPdfUrl
      })
      setFileName(pdfFile.name)
      const samplePdfMeta = {
        fileName: pdfFile.name,
        size: pdfFile.size,
        lastModified: pdfFile.lastModified,
      }
      setPdfMeta(samplePdfMeta)
      setPageNumber(1)
      setNumPages(null)
      resetPdfViewerRuntime()

      const midiData = await midiFile.arrayBuffer()
      const samplePdfIdentity = buildPdfSourceIdentity(samplePdfMeta)
      const nextEpoch = practiceSessionEpochRef.current + 1
      practiceSessionEpochRef.current = nextEpoch
      // Mint ActiveScore for the library piece before stamping companions.
      const libraryScore = syncActiveScoreFromLegacy(null, {
        pdfFile: nextPdfUrl,
        pdfBuffer: pdfBufferCopy,
        pdfMeta: samplePdfMeta,
        fileName: pdfFile.name,
        musicXmlSource: null,
        midiSource: null,
        generation: nextEpoch,
        activeOmrRunId: null,
      })
      const libraryScoreId = libraryScore.scoreId
      activeScoreRef.current = libraryScore
      setActiveScoreIdOnGate(libraryScoreId)

      setMidiSource(
        stampMidiOwnerScoreId(
          withOwnerPdfIdentity(
            {
              fileName: midiFile.name,
              data: midiData,
            },
            samplePdfIdentity,
          ),
          libraryScoreId,
        ),
      )

      const xmlData = await musicXmlFile.arrayBuffer()
      const nextMusicXml = stampMusicXmlOwnerScoreId(
        withOwnerPdfIdentity(
          {
            fileName: musicXmlFile.name,
            data: xmlData,
            source: 'upload',
          },
          samplePdfIdentity,
        ),
        libraryScoreId,
      )
      setMusicXmlSource(nextMusicXml)

      setPdfSoftWarning(null)
      setAutoOmrRequest(null)
      setShowWelcome(false)
      dismissOnboarding()
      markDemoCardHidden()
      setDemoPieceActive(true)
      // Demo is loaded — the upload/demo sidebar is no longer useful, so collapse
      // it. The PDF viewer's sidebar toggle still reopens it on demand.
      setSidebarOpen(false)
      const clearedPrefs = resetPracticeTimePrefs()
      savePracticePrefs(clearedPrefs)
      syncPracticePrefsSnapshot(clearedPrefs)

      setPracticeSessionEpoch(nextEpoch)
      setPracticeRemountKey((key) => key + 1)
      activatePdfScoreSource({
        pdfIdentity: samplePdfIdentity,
        epoch: nextEpoch,
        reason: 'library-piece-load',
        scoreId: libraryScoreId,
      })

      const musicXmlContent = describeMusicXmlContent(nextMusicXml)
      const pdfContent = describePdfContent(samplePdfMeta, pdfBufferCopy)
      const appliedLibraryScore = syncActiveScoreFromLegacy(libraryScore, {
        pdfFile: nextPdfUrl,
        pdfBuffer: pdfBufferCopy,
        pdfMeta: samplePdfMeta,
        fileName: pdfFile.name,
        musicXmlSource: nextMusicXml,
        midiSource: {
          fileName: midiFile.name,
          data: midiData,
          ownerPdfIdentity: samplePdfIdentity,
          ownerScoreId: libraryScoreId,
        },
        generation: nextEpoch,
      })
      activeScoreRef.current = appliedLibraryScore
      publishActiveScore(appliedLibraryScore, { reason: 'library-piece-load' })
      logActiveScoreChange('library-piece-load', appliedLibraryScore)
      if (typeof window !== 'undefined') {
        window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ = {
          scoreId: libraryScoreId,
          ownerScoreId: libraryScoreId,
          pdfMetaIdentity: pdfContent.metaIdentity,
          pdfContentHash: pdfContent.contentHash,
          musicXmlHash: musicXmlContent.contentHash,
          musicXmlByteLength: musicXmlContent.byteLength,
          measureCount: musicXmlContent.measureCount,
          durationSeconds: musicXmlContent.durationSeconds,
          ownerPdfIdentity: samplePdfIdentity,
          practiceSessionEpoch: nextEpoch,
          sourceType: 'library',
          libraryPieceId: meta?.id ?? pieceId ?? null,
          at: Date.now(),
        }
      }
      logScoreSourceLifecycle('authoritative-musicxml-changed', {
        reason: 'library-piece-load',
        libraryPieceId: meta?.id ?? pieceId ?? null,
        authoritativeMusicXmlHash: musicXmlContent.contentHash,
        ownerPdfIdentity: samplePdfIdentity,
        practiceSessionEpoch: nextEpoch,
      })

      if (liveBundleRef.current) {
        liveBundleRef.current.pdfMeta = samplePdfMeta
        liveBundleRef.current.pdfBuffer = pdfData.slice(0)
        liveBundleRef.current.musicXmlSource = nextMusicXml
        liveBundleRef.current.pdfIdentity = samplePdfIdentity
        liveBundleRef.current.demoPieceActive = true
      }
      const instrument = normalizeInstrumentId(activeInstrumentRef.current)
      instrumentBundleStoreRef.current.set(
        instrument,
        snapshotInstrumentBundle({
          ...(liveBundleRef.current ?? {}),
          instrumentId: instrument,
          pdfMeta: samplePdfMeta,
          pdfBuffer: pdfData.slice(0),
          fileName: pdfFile.name,
          musicXmlSource: nextMusicXml,
          demoPieceActive: true,
          practicePrefs: practicePrefsRef.current,
        }),
      )

      setLibraryFeedback({
        type: 'success',
        message: `${meta.title} loaded — opening Practice. Press Play, then try Wait For You.`,
      })
      navigateToView('practice')
      setSampleLoadState({ loading: false, error: null })
    } catch (loadError) {
      setSampleLoadState({
        loading: false,
        error: formatDemoLoadError(loadError),
      })
    }
  }, [
    instrumentId,
    setSidebarOpen,
    markDemoCardHidden,
    navigateToView,
    resetPdfViewerRuntime,
    syncPracticePrefsSnapshot,
  ])

  const handleClassifiedUpload = useCallback(
    async (classified) => {
      clearDemoPiece()
      markDemoCardHidden()
      const notices = buildUploadNotices(classified)

      let loadedPdf = Boolean(pdfFile)
      let loadedMidi = midiSource
      let loadedXml = musicXmlSource
      let loadedSoftWarning = pdfSoftWarning
      let clearedCompanionFilesForPdf = false

      try {
        if (classified.pdf[0]) {
          const file = classified.pdf[0]
          const validation = validateFileForImport(file, 'pdf')
          if (!validation.ok) {
            setLibraryFeedback({ type: 'error', message: validation.message })
            return notices
          }
          const buffer = await file.arrayBuffer()
          clearedCompanionFilesForPdf = beginPdfScoreSourceReplacement({
            previousPdfMeta: pdfMeta,
            previousFileName: fileName,
            previousMidi: loadedMidi,
            previousMusicXml: loadedXml,
          })
          const nextPdfMeta = {
            fileName: file.name,
            size: file.size,
            lastModified: file.lastModified,
          }
          const nextPdfBuffer = buffer.slice(0)
          const nextPdfUrl = URL.createObjectURL(file)
          setPdfBuffer(nextPdfBuffer)
          setPdfFile((previous) => {
            if (previous) {
              URL.revokeObjectURL(previous)
            }
            return nextPdfUrl
          })
          setFileName(file.name)
          setPdfMeta(nextPdfMeta)
          setPageNumber(1)
          setNumPages(null)
          resetPdfViewerRuntime()
          loadedSoftWarning = validation.softWarning ?? null
          setPdfSoftWarning(loadedSoftWarning)
          loadedPdf = true
          loadedMidi = null
          loadedXml = null
          const nextIdentity = buildPdfSourceIdentity(nextPdfMeta)
          if (liveBundleRef.current) {
            liveBundleRef.current.pdfFile = nextPdfUrl
            liveBundleRef.current.pdfBuffer = nextPdfBuffer
            liveBundleRef.current.pdfMeta = nextPdfMeta
            liveBundleRef.current.fileName = file.name
            liveBundleRef.current.midiSource = null
            liveBundleRef.current.musicXmlSource = null
            liveBundleRef.current.pdfIdentity = nextIdentity
          }
          activatePdfScoreSource({
            pdfIdentity: nextIdentity,
            epoch: practiceSessionEpochRef.current,
            previousPdfIdentity: buildPdfSourceIdentity(pdfMeta),
            reason: 'classified-pdf-upload',
          })
          logScoreSourceIdentities(
            'before-omr-queue',
            describeScoreSourceIdentities({
              pdfMeta: nextPdfMeta,
              pdfFile: nextPdfUrl,
              musicXmlSource: null,
              midiSource: null,
              practiceSessionEpoch: practiceSessionEpochRef.current,
              bundle: liveBundleRef.current,
            }),
          )
          const instrument = normalizeInstrumentId(activeInstrumentRef.current)
          instrumentBundleStoreRef.current.set(
            instrument,
            snapshotInstrumentBundle({
              instrumentId: instrument,
              pdfFile: nextPdfUrl,
              pdfBuffer: nextPdfBuffer,
              pdfMeta: nextPdfMeta,
              fileName: file.name,
              pageNumber: 1,
              numPages: null,
              midiSource: null,
              musicXmlSource: null,
              demoPieceActive: false,
              practicePrefs: practicePrefsRef.current,
              pdfSoftWarning: loadedSoftWarning,
            }),
          )
        }

        if (classified.musicXml[0]) {
          const file = classified.musicXml[0]
          if (isMuseScoreSourceFile(file)) {
            setLibraryFeedback({ type: 'info', message: MUSESCORE_PLANNED_MESSAGE })
          } else {
            const data = await readFileArrayBuffer(file, 'musicXml')
            const ownerMeta = classified.pdf[0]
              ? {
                  fileName: classified.pdf[0].name,
                  size: classified.pdf[0].size,
                  lastModified: classified.pdf[0].lastModified,
                }
              : pdfMeta
            const nextXml = withOwnerPdfIdentity(
              { fileName: file.name, data, source: 'upload' },
              buildPdfSourceIdentity(ownerMeta),
            )
            // Uploaded timing wins — cancel any preparation started for this PDF.
            cancelInFlightOmrGeneration(setAutoOmrRequest)
            setMusicXmlSource(nextXml)
            loadedXml = nextXml
            if (liveBundleRef.current) {
              liveBundleRef.current.musicXmlSource = nextXml
            }
            resetPracticePrefsForNewScore()
            if (classified.pdf[0] || pdfMeta?.fileName) {
              clearScoreFollowAnchors({
                fingerprint: buildPdfFingerprint(
                  classified.pdf[0]
                    ? {
                        fileName: classified.pdf[0].name,
                        size: classified.pdf[0].size,
                        lastModified: classified.pdf[0].lastModified,
                      }
                    : pdfMeta,
                ),
                fileName: classified.pdf[0]?.name ?? pdfMeta?.fileName,
              })
              const nextEpoch = practiceSessionEpochRef.current + 1
              practiceSessionEpochRef.current = nextEpoch
              setPracticeSessionEpoch(nextEpoch)
            }
          }
        }

        if (classified.midi[0]) {
          const file = classified.midi[0]
          const data = await readFileArrayBuffer(file, 'midi')
          const ownerMeta = classified.pdf[0]
            ? {
                fileName: classified.pdf[0].name,
                size: classified.pdf[0].size,
                lastModified: classified.pdf[0].lastModified,
              }
            : pdfMeta
          const nextMidi = withOwnerPdfIdentity(
            { fileName: file.name, data },
            buildPdfSourceIdentity(ownerMeta),
          )
          setMidiSource(nextMidi)
          loadedMidi = nextMidi
          if (liveBundleRef.current) {
            liveBundleRef.current.midiSource = nextMidi
          }
          // MIDI is playback-only; do not cancel score preparation — timing still
          // comes from MusicXML or automatic PDF preparation.
        }

        if (classified.pdf[0] && (loadedMidi || loadedXml)) {
          const instrument = normalizeInstrumentId(activeInstrumentRef.current)
          const existing = instrumentBundleStoreRef.current.get(instrument) ?? {}
          instrumentBundleStoreRef.current.set(
            instrument,
            snapshotInstrumentBundle({
              ...existing,
              instrumentId: instrument,
              midiSource: loadedMidi,
              musicXmlSource: loadedXml,
              practicePrefs: practicePrefsRef.current,
            }),
          )
        }

        if (classified.pdf[0]) {
          if (loadedXml?.data || !shouldQueueAutoOmr({ musicXmlSource: loadedXml })) {
            cancelInFlightOmrGeneration(setAutoOmrRequest)
          } else {
            setAutoOmrRequest(buildAutoOmrRequest(classified.pdf[0], activeInstrumentRef.current))
          }
          const loadedNewCompanionFile = Boolean(classified.musicXml[0] || classified.midi[0])
          const canPractice = isPracticeNavigableSet(loadedPdf, loadedXml)
          const fullSet = isFullPracticeSet(loadedPdf, loadedMidi, loadedXml)
          if (canPractice) {
            setLibraryFeedback({
              type: 'success',
              message: loadedSoftWarning
                ? `${loadedSoftWarning} Loaded ${classified.pdf[0].name} with timing${fullSet ? ' and sound' : ''} — opening Practice.`
                : `Loaded ${classified.pdf[0].name} with timing${fullSet ? ' and sound' : ''} — opening Practice.`,
            })
          } else if (clearedCompanionFilesForPdf && !loadedNewCompanionFile) {
            setLibraryFeedback({
              type: 'info',
              message: pdfPreparingScoreMessage(classified.pdf[0].name, {
                clearedCompanionFiles: true,
                softWarning: loadedSoftWarning,
              }),
            })
          } else if (loadedXml?.data) {
            setLibraryFeedback({
              type: 'success',
              message: loadedSoftWarning
                ? `${loadedSoftWarning} Loaded ${classified.pdf[0].name} with timing.`
                : `Loaded ${classified.pdf[0].name} with timing.`,
            })
          } else if (loadedNewCompanionFile) {
            setLibraryFeedback({
              type: loadedSoftWarning ? 'info' : 'success',
              message: pdfPreparingScoreMessage(classified.pdf[0].name, {
                softWarning: loadedSoftWarning,
              }),
            })
          } else {
            setLibraryFeedback({
              type: loadedSoftWarning ? 'info' : 'success',
              message: pdfPreparingScoreMessage(classified.pdf[0].name, {
                softWarning: loadedSoftWarning,
              }),
            })
          }
        } else if (classified.musicXml[0] || classified.midi[0]) {
          if (classified.musicXml[0]) {
            cancelInFlightOmrGeneration(setAutoOmrRequest)
          }
          const canPractice = isPracticeNavigableSet(loadedPdf, loadedXml)
          const fullSet = isFullPracticeSet(loadedPdf, loadedMidi, loadedXml)
          setLibraryFeedback({
            type: 'success',
            message: canPractice
              ? fullSet
                ? 'All files ready — opening Practice.'
                : 'Timing loaded — opening Practice.'
              : classified.musicXml[0]
                ? `Loaded ${classified.musicXml[0].name}. Add sheet music to open Practice.`
                : `Loaded ${classified.midi[0].name}. Add sheet music; score preparation continues if needed.`,
          })
        }

        if (isPracticeNavigableSet(loadedPdf, loadedXml)) {
          navigateToView('practice')
        } else if (!classified.pdf[0]) {
          navigateToView('library')
        }
      } catch (error) {
        setLibraryFeedback({
          type: 'error',
          message: formatPdfImportError(error),
        })
      }

      return notices
    },
    [
      pdfFile,
      pdfMeta,
      fileName,
      midiSource,
      musicXmlSource,
      pdfSoftWarning,
      beginPdfScoreSourceReplacement,
      clearDemoPiece,
      markDemoCardHidden,
      navigateToView,
      resetPdfViewerRuntime,
      resetPracticePrefsForNewScore,
    ],
  )

  function handleDocumentLoadSuccess({ numPages: total }) {
    setNumPages(total)
    setPageNumber((page) => Math.min(Math.max(1, page), total))
    if (activeViewRef.current === 'practice') {
      setPracticePdfReady(true)
    }
  }

  function handlePrevPage() {
    setPageNumber((page) => Math.max(1, page - 1))
  }

  function handleNextPage() {
    setPageNumber((page) => (numPages ? Math.min(numPages, page + 1) : page))
  }

  function handleGoToPage(page) {
    if (!numPages) {
      setPageNumber(Math.max(1, page))
      return
    }
    setPageNumber(Math.min(numPages, Math.max(1, page)))
  }

  const handleSessionRestore = useCallback(async (payload) => {
    const restoredBuffer = await payload.pdfFile.arrayBuffer()
    const pdfBufferCopy = restoredBuffer.slice(0)
    const nextPdfUrl = URL.createObjectURL(payload.pdfFile)
    setPdfBuffer(pdfBufferCopy)
    setPdfFile((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous)
      }
      return nextPdfUrl
    })
    setFileName(payload.pdfMeta.fileName)
    setPdfMeta(payload.pdfMeta)

    const restoredPdfIdentity = buildPdfSourceIdentity(payload.pdfMeta)
    const nextEpoch = practiceSessionEpochRef.current + 1
    practiceSessionEpochRef.current = nextEpoch
    // Mint a fresh ActiveScore for the restored snapshot; discard mismatched companions.
    const restoredShell = syncActiveScoreFromLegacy(null, {
      pdfFile: nextPdfUrl,
      pdfBuffer: pdfBufferCopy,
      pdfMeta: payload.pdfMeta,
      fileName: payload.pdfMeta.fileName,
      generation: nextEpoch,
    })
    const restoredScoreId = payload.scoreId ?? restoredShell.scoreId
    activeScoreRef.current = { ...restoredShell, scoreId: restoredScoreId }
    setActiveScoreIdOnGate(restoredScoreId)

    const restoredMidi = payload.midiSource?.data
      ? stampMidiOwnerScoreId(
          {
            fileName: payload.midiSource.fileName,
            data: payload.midiSource.data.slice(0),
            ownerPdfIdentity: payload.midiSource.ownerPdfIdentity ?? restoredPdfIdentity,
            ownerScoreId: payload.midiSource.ownerScoreId ?? null,
          },
          restoredScoreId,
        )
      : null
    // Drop MIDI that belonged to a different score snapshot.
    const safeMidi =
      restoredMidi?.ownerScoreId &&
      payload.midiSource?.ownerScoreId &&
      payload.midiSource.ownerScoreId !== restoredScoreId
        ? null
        : restoredMidi
    setMidiSource(safeMidi)

    let nextMusicXml = payload.musicXmlSource
      ? cloneMusicXmlSource(payload.musicXmlSource)
      : null
    if (nextMusicXml && isOmrGeneratedPlayback(nextMusicXml)) {
      const validation = validateRestoredOmrPlayback(nextMusicXml)
      if (!validation.ok) {
        nextMusicXml = null
        setLibraryFeedback({
          type: 'info',
          message: validation.message,
        })
      }
    }
    if (
      nextMusicXml?.ownerScoreId &&
      payload.musicXmlSource?.ownerScoreId &&
      payload.musicXmlSource.ownerScoreId !== restoredScoreId
    ) {
      nextMusicXml = null
    }
    if (nextMusicXml) {
      nextMusicXml = stampMusicXmlOwnerScoreId(nextMusicXml, restoredScoreId)
    }
    setMusicXmlSource(nextMusicXml)
    setPageNumber(payload.pageNumber ?? 1)
    resetPdfViewerRuntime()
    const restoredInstrument = normalizeInstrumentId(payload.instrumentId ?? DEFAULT_INSTRUMENT_ID)
    setPracticeSessionEpoch(nextEpoch)
    setPracticeRemountKey((key) => key + 1)
    activatePdfScoreSource({
      pdfIdentity: restoredPdfIdentity,
      epoch: nextEpoch,
      reason: 'session-restore',
      scoreId: restoredScoreId,
    })
    if (shouldQueueAutoOmr({ musicXmlSource: nextMusicXml }) && payload.pdfMeta?.fileName) {
      setAutoOmrRequest(buildAutoOmrRequestFromPdfMeta(payload.pdfMeta, restoredInstrument))
    } else {
      setAutoOmrRequest(null)
    }
    practicePrefsRef.current = payload.practicePrefs ?? null
    setInitialPracticePrefs(payload.practicePrefs)
    setActiveView(
      normalizeAppView(
        resolveRestoredActiveView({
          pathname: window.location.pathname,
          savedActiveView: payload.activeView,
          hasMusicXml: Boolean(nextMusicXml),
        }),
      ),
    )
    setShowWelcome(false)
    setPdfSoftWarning(null)
    setDemoPieceActive(false)
    markDemoCardHidden()
    // Restore the instrument the session was saved with. Legacy piano-era sessions
    // omit instrumentId — normalize to Piano per instruments.js default contract.
    for (const [bundleInstrumentId, bundle] of Object.entries(payload.instrumentBundles ?? {})) {
      const normalizedBundleInstrument = normalizeInstrumentId(bundleInstrumentId)
      if (normalizedBundleInstrument === restoredInstrument || !bundle?.pdfFile) {
        continue
      }
      const bundleBuffer = await bundle.pdfFile.arrayBuffer()
      instrumentBundleStoreRef.current.set(normalizedBundleInstrument, {
        ...bundle,
        pdfFile: URL.createObjectURL(bundle.pdfFile),
        pdfBuffer: bundleBuffer.slice(0),
        musicXmlSource: bundle.musicXmlSource ? cloneMusicXmlSource(bundle.musicXmlSource) : null,
      })
    }
    // The restored files ARE this instrument's active bundle — mark it as the
    // current instrument so the switch effect treats the restore as authoritative
    // and does not clobber it with an empty bundle. Any other instrument keeps an
    // empty bundle until the user loads files for it.
    activeInstrumentRef.current = restoredInstrument
    instrumentBundleStoreRef.current.clear(restoredInstrument)
    setInstrumentId(restoredInstrument)

    if (typeof window !== 'undefined' && nextMusicXml?.data) {
      const musicXml = describeMusicXmlContent(nextMusicXml)
      const pdfContent = describePdfContent(payload.pdfMeta, pdfBufferCopy)
      const ownerPdfIdentity =
        nextMusicXml.ownerPdfIdentity ?? restoredPdfIdentity ?? null
      window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ = {
        scoreId: restoredScoreId,
        ownerScoreId: restoredScoreId,
        pdfMetaIdentity: pdfContent.metaIdentity,
        pdfContentHash: pdfContent.contentHash,
        musicXmlHash: musicXml.contentHash,
        musicXmlByteLength: musicXml.byteLength,
        measureCount: musicXml.measureCount,
        durationSeconds: musicXml.durationSeconds,
        ownerPdfIdentity,
        practiceSessionEpoch: nextEpoch,
        sourceType: nextMusicXml.source ?? 'restore',
        at: Date.now(),
      }
      logScoreSourceLifecycle('authoritative-musicxml-changed', {
        reason: 'session-restore',
        authoritativeMusicXmlHash: musicXml.contentHash,
        ownerPdfIdentity,
        ownerScoreId: restoredScoreId,
        practiceSessionEpoch: nextEpoch,
      })
      const restoredActive = syncActiveScoreFromLegacy(activeScoreRef.current, {
        pdfFile: nextPdfUrl,
        pdfBuffer: pdfBufferCopy,
        pdfMeta: payload.pdfMeta,
        fileName: payload.pdfMeta.fileName,
        musicXmlSource: nextMusicXml,
        midiSource: safeMidi,
        generation: nextEpoch,
      })
      activeScoreRef.current = restoredActive
      publishActiveScore(restoredActive, { reason: 'session-restore' })
      logActiveScoreChange('session-restore', restoredActive)
    }
  }, [markDemoCardHidden, resetPdfViewerRuntime, setInstrumentId])

  const onLegalRoute = isLegalPathname(window.location.pathname)

  const sessionPersistence = useSessionPersistence({
    pdfBuffer,
    pdfMeta,
    midiSource,
    musicXmlSource,
    activeView,
    pageNumber,
    practicePrefsRef,
    instrumentId,
    getInstrumentSessionBundles,
    onRestore: handleSessionRestore,
    restoreSuspended: onLegalRoute,
    sessionSaveGeneration,
    sessionSaveGenerationRef,
  })

  const { restoreGateOpen, isRestoring } = sessionPersistence

  const { wrapUpload } = useRestoreUploadGate({
    restoreGateOpen,
    onBlocked: (message) => setLibraryFeedback({ type: 'info', message }),
  })

  const gatedClassifiedUpload = useCallback(
    async (classified) => {
      if (!restoreGateOpen) {
        pendingClassifiedUploadRef.current = classified
        setLibraryFeedback({
          type: 'info',
          message:
            'Restoring your last session — your files will load as soon as that finishes.',
        })
        return buildUploadNotices(classified)
      }
      return handleClassifiedUpload(classified)
    },
    [restoreGateOpen, handleClassifiedUpload],
  )

  useEffect(() => {
    if (!restoreGateOpen || !pendingClassifiedUploadRef.current) {
      return
    }
    const pending = pendingClassifiedUploadRef.current
    pendingClassifiedUploadRef.current = null
    handleClassifiedUpload(pending)
  }, [restoreGateOpen, handleClassifiedUpload])

  const practiceReady = isPracticePlaybackReady({
    restoreGateOpen,
    pdfFile,
    musicXmlSource,
  })
  const sessionFilesReady = practiceReady
  const uploadedPracticePieces = useMemo(
    () =>
      buildUploadedPracticePieces(getInstrumentSessionBundles(), {
        activeInstrumentId: instrumentId,
      }),
    [
      getInstrumentSessionBundles,
      instrumentId,
      pdfFile,
      pdfBuffer,
      pdfMeta,
      fileName,
      midiSource,
      musicXmlSource,
      pageNumber,
      initialPracticePrefs,
      pdfSoftWarning,
      demoPieceActive,
      instrumentBundleRevision,
    ],
  )

  const handleOpenUploadedPiece = useCallback((targetInstrumentId) => {
    const targetInstrument = normalizeInstrumentId(targetInstrumentId)
    const currentInstrument = normalizeInstrumentId(activeInstrumentRef.current)
    const store = instrumentBundleStoreRef.current

    if (targetInstrument !== currentInstrument) {
      store.set(currentInstrument, snapshotInstrumentBundle(liveBundleRef.current))
      const targetBundle = store.get(targetInstrument)
      if (!targetBundle?.pdfFile) {
        setLibraryFeedback({
          type: 'error',
          message: 'That uploaded piece is no longer available. Add the files again to practice it.',
        })
        return
      }
      activeInstrumentRef.current = targetInstrument
      applyInstrumentBundle(targetBundle)
      setInstrumentId(targetInstrument)
    }

    setLibraryFeedback({ type: 'info', message: 'Opened Practice.' })
    navigateToView('practice')
  }, [applyInstrumentBundle, navigateToView, setInstrumentId])

  const persistUploadBundlesNow = useCallback(async ({
    activeBundle,
    activeInstrument,
    instrumentBundles,
    activeViewOverride = activeView,
  }) => {
    const bundleEntries = Object.entries(instrumentBundles ?? {})
      .filter(([, bundle]) => Boolean(bundle?.pdfMeta?.fileName && bundle?.pdfBuffer))
      .map(([bundleInstrumentId, bundle]) => [
        normalizeInstrumentId(bundleInstrumentId),
        {
          ...snapshotInstrumentBundle(bundle),
          instrumentId: normalizeInstrumentId(bundleInstrumentId),
        },
      ])
    const normalizedBundles = Object.fromEntries(bundleEntries)
    const hasActiveBundle = Boolean(activeBundle?.pdfMeta?.fileName && activeBundle?.pdfBuffer)

    if (!hasActiveBundle && bundleEntries.length === 0) {
      await clearSessionStorage()
      return
    }

    saveSessionMeta(
      buildSessionMeta({
        pdfMeta: hasActiveBundle ? activeBundle.pdfMeta : null,
        midiSource: hasActiveBundle ? activeBundle.midiSource : null,
        musicXmlSource: hasActiveBundle ? activeBundle.musicXmlSource : null,
        activeView: activeViewOverride,
        pageNumber: hasActiveBundle ? activeBundle.pageNumber : 1,
        practicePrefs: hasActiveBundle ? activeBundle.practicePrefs : null,
        instrumentId: activeInstrument,
        instrumentBundles: normalizedBundles,
        scoreId: activeScoreRef.current?.scoreId ?? null,
      }),
    )

    try {
      await saveSessionFiles({
        pdf: hasActiveBundle ? { data: activeBundle.pdfBuffer.slice(0) } : null,
        midi: hasActiveBundle && activeBundle.midiSource?.data
          ? { data: activeBundle.midiSource.data.slice(0) }
          : null,
        musicXml: hasActiveBundle && activeBundle.musicXmlSource?.data
          ? { data: activeBundle.musicXmlSource.data.slice(0) }
          : null,
        instrumentFiles: Object.fromEntries(
          Object.entries(normalizedBundles).map(([bundleInstrumentId, bundle]) => [
            bundleInstrumentId,
            {
              pdf: bundle.pdfBuffer ? { data: bundle.pdfBuffer.slice(0) } : null,
              midi: bundle.midiSource?.data ? { data: bundle.midiSource.data.slice(0) } : null,
              musicXml: bundle.musicXmlSource?.data
                ? { data: bundle.musicXmlSource.data.slice(0) }
                : null,
            },
          ]),
        ),
      })
    } catch (error) {
      logAppViewDebug('delete-upload:save-files-error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [activeView])

  const handleDeleteUploadedPiece = useCallback((piece) => {
    const targetInstrument = normalizeInstrumentId(piece?.instrumentId)
    const currentInstrument = normalizeInstrumentId(activeInstrumentRef.current)
    const store = instrumentBundleStoreRef.current
    const activeBundle = {
      ...snapshotInstrumentBundle(liveBundleRef.current),
      instrumentId: currentInstrument,
    }
    const deletingActive = targetInstrument === currentInstrument
    const storedBundle = deletingActive ? activeBundle : store.get(targetInstrument)

    if (!storedBundle?.pdfMeta?.fileName) {
      setLibraryFeedback({
        type: 'info',
        message: 'That upload was already removed.',
      })
      setInstrumentBundleRevision((value) => value + 1)
      return
    }

    if (storedBundle.pdfFile) {
      URL.revokeObjectURL(storedBundle.pdfFile)
    }
    store.clear(targetInstrument)

    const remainingBundles = Object.fromEntries(store.entries())
    if (!deletingActive && activeBundle.pdfFile && activeBundle.pdfBuffer) {
      remainingBundles[currentInstrument] = activeBundle
    }

    if (deletingActive) {
      applyInstrumentBundle(createEmptyInstrumentBundle())
      setLibraryTab(LIBRARY_TABS.UPLOADS)
      setSidebarOpen(true)
      navigateToView('library')
    }

    setInstrumentBundleRevision((value) => value + 1)
    setLibraryFeedback({
      type: 'success',
      message: `Removed ${piece?.title ?? 'uploaded piece'} from My Uploads.`,
    })

    persistUploadBundlesNow({
      activeBundle: deletingActive ? createEmptyInstrumentBundle() : activeBundle,
      activeInstrument: currentInstrument,
      instrumentBundles: remainingBundles,
      activeViewOverride: deletingActive ? 'library' : activeViewRef.current,
    })
  }, [applyInstrumentBundle, navigateToView, persistUploadBundlesNow, setSidebarOpen])

  useEffect(() => {
    if (activeView !== 'practice' || !pdfFile) {
      return undefined
    }

    const pdfSummary = describePdfPracticeSource({ pdfFile, pdfBuffer })
    if (pdfSummary.bufferAttached !== false) {
      return undefined
    }

    let cancelled = false
    refreshOwnedPdfFromBlobUrl(pdfFile, { revokePrevious: false })
      .then((refreshed) => {
        if (cancelled) {
          URL.revokeObjectURL(refreshed.pdfFile)
          return
        }
        setPdfBuffer(refreshed.pdfBuffer)
        setPdfFile((previous) => {
          if (previous && previous !== refreshed.pdfFile) {
            URL.revokeObjectURL(previous)
          }
          return refreshed.pdfFile
        })
        setNumPages(null)
        resetPdfViewerRuntime()
        logAppViewDebug('practice-pdf-refresh', describePdfPracticeSource({
          pdfFile: refreshed.pdfFile,
          pdfBuffer: refreshed.pdfBuffer,
        }))
      })
      .catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'Could not reload the PDF in Practice.'
          setPdfSoftWarning(`PDF reload failed: ${message}. Return to Library and reopen the file.`)
          logAppViewDebug('practice-pdf-refresh:error', { message })
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeView, pdfFile, pdfBuffer, resetPdfViewerRuntime])

  const practiceLibraryIsFirstRunHome = true
  const showLibraryIntro =
    !practiceLibraryIsFirstRunHome &&
    activeView === 'library' &&
    showWelcome &&
    restoreGateOpen &&
    !guidedTutorialOpen
  const showLibraryWorkspace = activeView === 'library'

  function finishGuidedTutorial(reason) {
    completeGuidedTutorial(reason)
    dismissOnboarding()
    setShowWelcome(false)
    setGuidedTutorialOpen(false)
  }

  function replayGuidedTutorial() {
    setShowWelcome(false)
    setGuidedTutorialOpen(true)
  }

  function showFileHelp() {
    setShowWelcome(false)
    setSidebarOpen(true)
    setLibraryTab(LIBRARY_TABS.UPLOADS)
    setFileHelpSignal((signal) => signal + 1)
    navigateToView('library')
  }

  function handleTutorialAddSheetMusic() {
    finishGuidedTutorial('add-sheet-music')
    setSidebarOpen(true)
    setLibraryTab(LIBRARY_TABS.UPLOADS)
    navigateToView('library')
  }

  useEffect(() => {
    logAppViewDebug('render-state', {
      activeView,
      restoreGateOpen,
      isRestoring,
      restoreStatus: sessionPersistence.restoreStatus,
      hasPdf: Boolean(pdfFile),
      pdf: describePdfPracticeSource({ pdfFile, pdfBuffer }),
      pdfBufferAttached: pdfBuffer instanceof ArrayBuffer ? isPdfBufferAttached(pdfBuffer) : null,
      hasMusicXml: isMusicXmlSourceReady(musicXmlSource),
      musicXml: describeMusicXmlSource(musicXmlSource),
      omrGenerated: isOmrGeneratedPlayback(musicXmlSource),
      omrDurationSeconds: musicXmlSource?.omrMeta?.durationSeconds ?? null,
      practiceFile: pdfMeta?.fileName ?? fileName ?? null,
      practiceReady,
      numPages,
      showLibraryIntro,
      showLibraryWorkspace,
      rendering:
        showLibraryIntro
          ? 'LibraryWelcomeCard'
          : showLibraryWorkspace
            ? 'LibraryWorkspace'
            : activeView === 'practice'
              ? sessionFilesReady
                ? 'PracticeView'
                : 'PracticePlaceholder'
              : activeView === 'profile'
                ? 'ProfileView'
                : activeView,
    })
  }, [
    activeView,
    restoreGateOpen,
    isRestoring,
    sessionPersistence.restoreStatus,
    pdfFile,
    pdfBuffer,
    musicXmlSource,
    pdfMeta?.fileName,
    fileName,
    showLibraryIntro,
    showLibraryWorkspace,
    sessionFilesReady,
    practiceReady,
    numPages,
  ])

  function handleNavigate(view, meta) {
    releaseOmrUiLocks()
    if (isRestoring) {
      setLibraryFeedback({
        type: 'info',
        message: 'Restoring your last session — Practice will be available in a moment.',
      })
      return
    }
    if (meta?.emptyPractice) {
      dismissOnboarding()
      setShowWelcome(false)
      setSidebarOpen(false)
      navigateToView('practice')
      return
    }
    if (view === 'library') {
      setSidebarOpen(true)
    }
    navigateToView(view)
  }

  function renderPracticeContent() {
    if (isRestoring || !restoreGateOpen) {
      return (
        <AppViewPlaceholder
          title="Restoring your last session"
          message="Practice will be available as soon as restore finishes."
        />
      )
    }

    if (!sessionFilesReady) {
      const omrInvalid =
        isOmrGeneratedPlayback(musicXmlSource) &&
        !((musicXmlSource?.omrMeta?.durationSeconds ?? 0) > 0)
      return (
        <AppViewPlaceholder
          title={omrInvalid ? 'Generated playback is not ready' : 'No piece open yet'}
          message={
            omrInvalid
              ? 'This experimental PDF playback could not be validated. Go back to Library to regenerate it, or add a timing file.'
              : 'Open the demo piece to start now, or add your own sheet music and timing file in Library.'
          }
          actionLabel={
            !omrInvalid && isDemoSampleEnabled() && restoreGateOpen
              ? 'Try Demo Piece'
              : 'Back to Library'
          }
          onAction={
            !omrInvalid && isDemoSampleEnabled() && restoreGateOpen
              ? handleLoadSampleFixtures
              : () => {
                  setSidebarOpen(true)
                  setLibraryTab(LIBRARY_TABS.UPLOADS)
                  navigateToView('library')
                }
          }
          secondaryActionLabel={!omrInvalid ? 'Add My Sheet Music' : null}
          onSecondaryAction={!omrInvalid
            ? () => {
                setSidebarOpen(true)
                setLibraryTab(LIBRARY_TABS.UPLOADS)
                navigateToView('library')
              }
            : null}
        />
      )
    }

    return (
      <PracticeSessionProvider
        key={`${practiceSessionEpoch}:${practiceRemountKey}`}
        activeView="practice"
        midiSource={midiSource}
        musicXmlSource={musicXmlSource}
        pdfMeta={pdfMeta}
        pdfFile={pdfFile}
        pdfFileName={fileName || null}
        hasPdf={Boolean(pdfFile)}
        numPages={numPages}
        visiblePageNumber={pageNumber}
        pdfSoftWarning={pdfSoftWarning}
        initialPracticePrefs={initialPracticePrefs}
        sessionFilesReady={sessionFilesReady}
        isDemoPiece={demoPieceActive}
        autoSetupGateOpen={practicePdfReady}
        experimentalOmrPlayback={isOmrGeneratedPlayback(musicXmlSource)}
        onPracticePrefsChange={(snapshot) => {
          practicePrefsRef.current = snapshot
        }}
      >
        <PracticeView
          pdfFile={pdfFile}
          fileName={fileName}
          pdfMeta={pdfMeta}
          pageNumber={pageNumber}
          numPages={numPages}
          paperTheme={paperTheme}
          onDocumentLoadSuccess={handleDocumentLoadSuccess}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          onGoToPage={handleGoToPage}
          onTogglePaper={togglePaperTheme}
          timingSourceKind={musicXmlSource?.source ?? null}
          onReloadPractice={() => setPracticeRemountKey((key) => key + 1)}
          onReturnToLibrary={() => navigateToView('library')}
        />
      </PracticeSessionProvider>
    )
  }

  const guidedChoiceOpen = guidedTutorialOpen && restoreGateOpen && !practiceReady

  const appBody = (
    <>
      <div
        className={`app${isRestoring ? ' app--restoring' : ''}${guidedChoiceOpen ? ' app--guided-choice' : ''}`}
        inert={isRestoring ? true : undefined}
      >
        <TopBar
          activeView={activeView}
          onNavigate={handleNavigate}
          onGoHome={goHome}
          onReplayTutorial={replayGuidedTutorial}
          onShowFileHelp={showFileHelp}
          practiceReady={practiceReady}
        />

      <SessionRestoreBanner
        status={sessionPersistence.restoreStatus}
        message={sessionPersistence.restoreMessage}
        onDismiss={sessionPersistence.dismissRestoreMessage}
        onClearSaved={sessionPersistence.clearSavedSession}
      />

      {showLibraryIntro && (
        <main className="library-welcome-wrap">
          <LibraryWelcomeCard
            onDismiss={() => setShowWelcome(false)}
            onTrySample={
              isDemoSampleEnabled() && restoreGateOpen ? handleLoadSampleFixtures : undefined
            }
            demoPiece={activeDemoPiece}
            sampleLoading={sampleLoadState.loading}
            sampleError={sampleLoadState.error}
          />
        </main>
      )}

      {showLibraryWorkspace && (
        <main className="library-main">
          <LibraryPanel
            className={
              libraryTab === LIBRARY_TABS.PRACTICE
                ? 'library-panel--practice-library'
                : 'library-panel--uploads-library'
            }
            activeTab={libraryTab}
            onTabChange={setLibraryTab}
            instrumentId={instrumentId}
            fileName={fileName}
            midiFileName={midiSource?.fileName}
            musicXmlFileName={musicXmlSource?.fileName}
            musicXmlSource={musicXmlSource}
            uploadsDisabled={isRestoring}
            uploadedPieces={uploadedPracticePieces}
            onOpenUploadedPiece={handleOpenUploadedPiece}
            onDeleteUploadedPiece={handleDeleteUploadedPiece}
            onClassifiedUpload={gatedClassifiedUpload}
            onFileSelect={wrapUpload('pdf', handleFileSelect)}
            onMidiSelect={wrapUpload('midi', handleMidiSelect)}
            onMusicXmlSelect={wrapUpload('musicXml', handleMusicXmlSelect)}
            onClearMidi={handleClearMidi}
            onClearMusicXml={handleClearMusicXml}
            onOmrGenerated={handleOmrGenerated}
            autoOmrRequest={autoOmrRequest}
            onAutoOmrRequestConsumed={handleAutoOmrRequestConsumed}
            onImportFeedback={setLibraryFeedback}
            pdfSource={pdfBuffer}
            pdfFileUrl={pdfFile}
            pdfIdentity={buildPdfSourceIdentity(pdfMeta)}
            practiceSessionEpoch={practiceSessionEpoch}
            onLoadSampleFixtures={
              isDemoSampleEnabled() && restoreGateOpen ? handleLoadSampleFixtures : undefined
            }
            demoPiece={activeDemoPiece}
            sampleLoadLoading={sampleLoadState.loading}
            sampleLoadError={sampleLoadState.error}
            importFeedback={libraryFeedback}
            showDemo={!demoCardHidden && isDemoSampleEnabled() && restoreGateOpen}
            fileHelpSignal={fileHelpSignal}
          />
        </main>
      )}

      {activeView === 'practice' && renderPracticeContent()}

      {activeView === 'profile' && (
        <Suspense
          fallback={
            <AppViewPlaceholder title="Loading profile" message="Opening your practice log…" />
          }
        >
          <ProfileView />
        </Suspense>
      )}

      {activeView === 'privacy' && <PrivacyPolicyPage />}
      {activeView === 'terms' && <TermsOfServicePage />}
      {activeView === 'contact' && <ContactPage />}

      {(activeView === 'library' ||
        activeView === 'practice' ||
        activeView === 'profile' ||
        isLegalView(activeView)) && <AppFooter onLegalNavigate={navigateToView} />}

      {guidedTutorialOpen &&
        restoreGateOpen &&
        (activeView === 'library' || activeView === 'practice') && (
        <GuidedTutorial
          activeView={activeView}
          practiceReady={practiceReady}
          canStartDemo={isDemoSampleEnabled() && restoreGateOpen && !practiceReady}
          demoLoading={sampleLoadState.loading}
          onStartDemo={handleLoadSampleFixtures}
          onAddSheetMusic={handleTutorialAddSheetMusic}
          onNavigate={navigateToView}
          onSkip={() => finishGuidedTutorial('skipped')}
          onDone={() => finishGuidedTutorial('done')}
        />
      )}
      </div>
      {isRestoring && <SessionRestoreOverlay onSkip={sessionPersistence.skipRestore} />}
    </>
  )

  return (
    <ProfileStatsProvider>
      {appBody}
    </ProfileStatsProvider>
  )
}
