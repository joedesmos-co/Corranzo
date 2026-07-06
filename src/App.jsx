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
  createEmptyInstrumentBundle,
  createInstrumentBundleStore,
  snapshotInstrumentBundle,
} from './features/instruments/instrumentPracticeBundle.js'
import { createMusicXmlSource, cloneMusicXmlSource, clearOmrGeneratedPlaybackSource, describeMusicXmlSource, isMusicXmlSourceReady, isOmrGeneratedPlayback, isPracticePlaybackReady, validateRestoredOmrPlayback } from './features/import/musicXmlSource.js'
import { describePdfPracticeSource, refreshOwnedPdfFromBlobUrl } from './features/import/pdfPracticeSource.js'
import { validateOmrGeneratedPlayback } from './features/omr/validateOmrGeneratedPlayback.js'
import { normalizeOmrMeasureGridMetadata } from './features/omr/omrMeasureGridMeta.js'
import { isPdfBufferAttached } from './features/omr/omrPdfSource.js'
import { logAppViewDebug, normalizeAppView } from './features/navigation/appViewDebug.js'
import { releaseOmrUiLocks } from './features/omr/omrUiGuard.js'
import { clearWarmPages } from './features/pdf/pdfPagePerf.js'
import { buildPdfFingerprint } from './features/score-follow/scoreFollowStorage.js'
import {
  buildSessionMeta,
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

function buildAutoOmrRequest(file, instrumentId) {
  if (!file) {
    return null
  }
  const normalizedInstrument = normalizeInstrumentId(instrumentId)
  const fileName = file.name ?? 'score.pdf'
  const size = Number.isFinite(file.size) ? file.size : 0
  const lastModified = Number.isFinite(file.lastModified) ? file.lastModified : 0
  return {
    key: `${normalizedInstrument}:${fileName}:${size}:${lastModified}`,
    instrumentId: normalizedInstrument,
    pdfFileName: fileName,
  }
}

function pdfOmrPreparingMessage(fileName, { clearedCompanionFiles = false, softWarning = null } = {}) {
  const clearedHint = clearedCompanionFiles
    ? ' Previous timing and sound files were cleared.'
    : ''
  const warningHint = softWarning ? `${softWarning} ` : ''
  return `${warningHint}Loaded ${fileName}.${clearedHint} Getting your music ready... This may take a moment. Upload MusicXML/MXL anytime for the most accurate timing.`
}

export default function App() {
  const { instrumentId, setInstrumentId } = useInstrument()
  const [activeView, setActiveView] = useState(resolveInitialView)
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfBuffer, setPdfBuffer] = useState(null)
  const [pdfMeta, setPdfMeta] = useState(null)
  const [initialPracticePrefs, setInitialPracticePrefs] = useState(null)
  // Bumped every time an instrument bundle is applied so the practice session
  // subtree remounts and re-reads the incoming instrument's prefs (practice
  // mode, WFY input source, loop, scrub time are all mount-time state).
  const [practiceSessionEpoch, setPracticeSessionEpoch] = useState(0)
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
  const liveBundleRef = useRef(null)
  liveBundleRef.current = {
    pdfFile,
    instrumentId: activeInstrumentRef.current,
    pdfBuffer,
    pdfMeta,
    fileName,
    pageNumber,
    numPages,
    midiSource,
    musicXmlSource,
    practicePrefs: practicePrefsRef.current,
    pdfSoftWarning,
    demoPieceActive,
  }

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
    setPracticeSessionEpoch((value) => value + 1)
    resetPdfViewerRuntime()
  }, [resetPdfViewerRuntime])

  // Save the current instrument's bundle and restore the newly selected one
  // whenever the app-wide instrument changes. This keeps Piano and Guitar
  // active files/practice state fully separate.
  useEffect(() => {
    const nextInstrument = normalizeInstrumentId(instrumentId)
    const previousInstrument = activeInstrumentRef.current
    if (nextInstrument === previousInstrument) {
      return
    }

    const store = instrumentBundleStoreRef.current
    store.set(previousInstrument, snapshotInstrumentBundle(liveBundleRef.current))
    activeInstrumentRef.current = nextInstrument
    applyInstrumentBundle(store.get(nextInstrument))
  }, [instrumentId, applyInstrumentBundle])

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
      const clearedCompanionFiles = Boolean(midiSource || musicXmlSource)
      setMusicXmlSource(null)
      setMidiSource(null)
      setPdfBuffer(buffer.slice(0))
      setPdfFile((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return URL.createObjectURL(file)
      })
      setFileName(file.name)
      setPdfMeta({
        fileName: file.name,
        size: file.size,
        lastModified: file.lastModified,
      })
      setPageNumber(1)
      setNumPages(null)
      resetPdfViewerRuntime()
      resetPracticePrefsForNewScore()
      setPdfSoftWarning(validation.softWarning)
      setAutoOmrRequest(buildAutoOmrRequest(file, activeInstrumentRef.current))
      setLibraryFeedback({
        type: clearedCompanionFiles || validation.softWarning ? 'info' : 'success',
        message: pdfOmrPreparingMessage(file.name, {
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
  }, [midiSource, musicXmlSource, clearDemoPiece, markDemoCardHidden, navigateToView, resetPdfViewerRuntime, resetPracticePrefsForNewScore])

  const handleMidiSelect = useCallback(async (file) => {
    clearDemoPiece()
    markDemoCardHidden()
    try {
      const data = await readFileArrayBuffer(file, 'midi')
      setMidiSource({
        fileName: file.name,
        data,
      })
      const fullSet = isFullPracticeSet(Boolean(pdfFile), { data }, musicXmlSource)
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
  }, [pdfFile, musicXmlSource, clearDemoPiece, markDemoCardHidden, navigateToView])

  const handleMusicXmlSelect = useCallback(async (file) => {
    clearDemoPiece()
    markDemoCardHidden()
    if (isMuseScoreSourceFile(file)) {
      setLibraryFeedback({ type: 'info', message: MUSESCORE_PLANNED_MESSAGE })
      return
    }

    try {
      const data = await readFileArrayBuffer(file, 'musicXml')
      setMusicXmlSource({
        fileName: file.name,
        data,
        source: 'upload',
      })
      setAutoOmrRequest(null)
      resetPracticePrefsForNewScore()
      const fullSet = isFullPracticeSet(Boolean(pdfFile), midiSource, { data })
      setLibraryFeedback({
        type: 'success',
        message: fullSet
          ? `Loaded ${file.name}. All files ready — opening Practice.`
          : `Loaded ${file.name}. Add sheet music to open Practice.`,
      })
      if (fullSet) {
        navigateToView('practice')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatMusicXmlImportError(error),
      })
    }
  }, [pdfFile, midiSource, clearDemoPiece, markDemoCardHidden, navigateToView, resetPracticePrefsForNewScore])

  const handleClearMusicXml = useCallback(() => {
    clearDemoPiece()
    setMusicXmlSource(null)
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
  }) => {
    releaseOmrUiLocks()
    const currentBundle = liveBundleRef.current ?? {}
    const currentInstrument = normalizeInstrumentId(activeInstrumentRef.current)
    const generatedInstrument = normalizeInstrumentId(sourceInstrumentId ?? currentInstrument)
    if (generatedInstrument !== currentInstrument) {
      const message = 'That PDF changed before timing finished. Upload it again or retry.'
      setLibraryFeedback({ type: 'info', message })
      return { ok: false, message }
    }
    if (sourcePdfFileUrl && currentBundle.pdfFile && sourcePdfFileUrl !== currentBundle.pdfFile) {
      const message = 'That PDF changed before timing finished. Upload it again or retry.'
      setLibraryFeedback({ type: 'info', message })
      return { ok: false, message }
    }
    if (sourcePdfFileName && currentBundle.pdfMeta?.fileName && sourcePdfFileName !== currentBundle.pdfMeta.fileName) {
      const message = 'That PDF changed before timing finished. Upload it again or retry.'
      setLibraryFeedback({ type: 'info', message })
      return { ok: false, message }
    }

    const playbackValidation = validateOmrGeneratedPlayback(musicXml, generatedFileName)
    if (!playbackValidation.ok) {
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
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({
        type: 'error',
        message,
      })
      return { ok: false, message }
    }

    let nextPdfFile
    let nextPdfBuffer
    try {
      const refreshed = await refreshOwnedPdfFromBlobUrl(activePdfFile, { revokePrevious: false })
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
    } catch (error) {
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

    const stablePdfMeta = activePdfMeta ?? {
      fileName: generatedFileName?.replace(/\.omr\.musicxml$/i, '.pdf') || 'score.pdf',
      size: nextPdfBuffer?.byteLength ?? null,
      lastModified: Date.now(),
    }
    if (!activePdfMeta) {
      setPdfMeta(stablePdfMeta)
      setFileName(stablePdfMeta.fileName)
    }

    const title = stablePdfMeta.fileName.replace(/\.pdf$/i, '') || 'Generated score'
    const pdfFingerprint =
      buildPdfFingerprint(stablePdfMeta) ??
      `${stablePdfMeta.fileName}::${nextPdfBuffer?.byteLength ?? 0}`
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
    const nextMusicXmlSource = createMusicXmlSource(generatedFileName, musicXml, {
      source: 'omr',
      omrMeta,
    })

    clearDemoPiece()
    markDemoCardHidden()
    dismissOnboarding()
    setShowWelcome(false)
    setMusicXmlSource(nextMusicXmlSource)
    setAutoOmrRequest(null)
    setLibraryFeedback({
      type: 'success',
      message: `Timing ready from PDF (${playbackValidation.noteCount} notes, ${Math.round(playbackValidation.durationSeconds)}s). Opening Practice.`,
    })
    navigateToView('practice')

    const activeBundleForPersistence = snapshotInstrumentBundle({
      ...currentBundle,
      instrumentId: currentInstrument,
      pdfFile: nextPdfFile,
      pdfBuffer: nextPdfBuffer,
      pdfMeta: stablePdfMeta,
      fileName: stablePdfMeta.fileName,
      pageNumber,
      midiSource,
      musicXmlSource: nextMusicXmlSource,
      practicePrefs: practicePrefsRef.current,
      demoPieceActive: false,
    })
    const persistedInstrumentBundles = Object.fromEntries(instrumentBundleStoreRef.current.entries())
    persistedInstrumentBundles[currentInstrument] = activeBundleForPersistence

    const sessionMeta = buildSessionMeta({
      pdfMeta: stablePdfMeta,
      midiSource,
      musicXmlSource: nextMusicXmlSource,
      activeView: 'practice',
      pageNumber,
      practicePrefs: practicePrefsRef.current,
      instrumentId: currentInstrument,
      instrumentBundles: persistedInstrumentBundles,
    })
    saveSessionMeta(sessionMeta)
    try {
      await saveSessionFiles({
        pdf: nextPdfBuffer ? { data: nextPdfBuffer.slice(0) } : null,
        midi: midiSource?.data ? { data: midiSource.data.slice(0) } : null,
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
    } catch (error) {
      logAppViewDebug('omr-generated:save-files-error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }

    logAppViewDebug('omr-generated', {
      pdf: describePdfPracticeSource({ pdfFile: nextPdfFile, pdfBuffer: nextPdfBuffer }),
      musicXml: describeMusicXmlSource(nextMusicXmlSource),
      durationSeconds: playbackValidation.durationSeconds,
    })

    return {
      ok: true,
      noteCount: playbackValidation.noteCount,
      measureCount: playbackValidation.measureCount,
      durationSeconds: playbackValidation.durationSeconds,
    }
  }, [
    pdfFile,
    pdfMeta,
    midiSource,
    pageNumber,
    instrumentId,
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
      setPdfBuffer(pdfData.slice(0))
      setPdfFile((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return URL.createObjectURL(pdfFile)
      })
      setFileName(pdfFile.name)
      setPdfMeta({
        fileName: pdfFile.name,
        size: pdfFile.size,
        lastModified: pdfFile.lastModified,
      })
      setPageNumber(1)
      setNumPages(null)
      resetPdfViewerRuntime()

      const midiData = await midiFile.arrayBuffer()
      setMidiSource({
        fileName: midiFile.name,
        data: midiData,
      })

      const xmlData = await musicXmlFile.arrayBuffer()
      setMusicXmlSource({
        fileName: musicXmlFile.name,
        data: xmlData,
      })

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
          setPdfBuffer(buffer.slice(0))
          setPdfFile((previous) => {
            if (previous) {
              URL.revokeObjectURL(previous)
            }
            return URL.createObjectURL(file)
          })
          setFileName(file.name)
          setPdfMeta({
            fileName: file.name,
            size: file.size,
            lastModified: file.lastModified,
          })
          setPageNumber(1)
          setNumPages(null)
          resetPdfViewerRuntime()
          resetPracticePrefsForNewScore()
          loadedSoftWarning = validation.softWarning ?? null
          setPdfSoftWarning(loadedSoftWarning)
          loadedPdf = true
          clearedCompanionFilesForPdf = Boolean(loadedMidi || loadedXml)
          setMidiSource(null)
          setMusicXmlSource(null)
          loadedMidi = null
          loadedXml = null
        }

        if (classified.musicXml[0]) {
          const file = classified.musicXml[0]
          if (isMuseScoreSourceFile(file)) {
            setLibraryFeedback({ type: 'info', message: MUSESCORE_PLANNED_MESSAGE })
          } else {
            const data = await readFileArrayBuffer(file, 'musicXml')
            const nextXml = { fileName: file.name, data, source: 'upload' }
            setMusicXmlSource(nextXml)
            loadedXml = nextXml
            resetPracticePrefsForNewScore()
          }
        }

        if (classified.midi[0]) {
          const file = classified.midi[0]
          const data = await readFileArrayBuffer(file, 'midi')
          const nextMidi = { fileName: file.name, data }
          setMidiSource(nextMidi)
          loadedMidi = nextMidi
        }

        if (classified.pdf[0]) {
          if (loadedXml?.data) {
            setAutoOmrRequest(null)
          } else {
            setAutoOmrRequest(buildAutoOmrRequest(classified.pdf[0], activeInstrumentRef.current))
          }
          const loadedNewCompanionFile = Boolean(classified.musicXml[0] || classified.midi[0])
          const fullSet = isFullPracticeSet(loadedPdf, loadedMidi, loadedXml)
          if (fullSet) {
            setLibraryFeedback({
              type: 'success',
              message: loadedSoftWarning
                ? `${loadedSoftWarning} Loaded ${classified.pdf[0].name} with matching timing and sound — opening Practice.`
                : `Loaded ${classified.pdf[0].name} with matching timing and sound — opening Practice.`,
            })
          } else if (clearedCompanionFilesForPdf && !loadedNewCompanionFile) {
            setLibraryFeedback({
              type: 'info',
              message: pdfOmrPreparingMessage(classified.pdf[0].name, {
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
              message: pdfOmrPreparingMessage(classified.pdf[0].name, {
                softWarning: loadedSoftWarning,
              }),
            })
          } else {
            setLibraryFeedback({
              type: loadedSoftWarning ? 'info' : 'success',
              message: pdfOmrPreparingMessage(classified.pdf[0].name, {
                softWarning: loadedSoftWarning,
              }),
            })
          }
        } else if (classified.musicXml[0] || classified.midi[0]) {
          if (classified.musicXml[0]) {
            setAutoOmrRequest(null)
          }
          const fullSet = isFullPracticeSet(loadedPdf, loadedMidi, loadedXml)
          setLibraryFeedback({
            type: 'success',
            message: fullSet
              ? 'All files ready — opening Practice.'
              : classified.musicXml[0]
                ? `Loaded ${classified.musicXml[0].name}. Add sheet music to open Practice.`
                : `Loaded ${classified.midi[0].name}. Add sheet music and a timing file to open Practice.`,
          })
        }

        if (isFullPracticeSet(loadedPdf, loadedMidi, loadedXml)) {
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
      midiSource,
      musicXmlSource,
      pdfSoftWarning,
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
    setPdfBuffer(restoredBuffer.slice(0))
    setPdfFile((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous)
      }
      return URL.createObjectURL(payload.pdfFile)
    })
    setFileName(payload.pdfMeta.fileName)
    setPdfMeta(payload.pdfMeta)
    setMidiSource(
      payload.midiSource?.data
        ? {
            fileName: payload.midiSource.fileName,
            data: payload.midiSource.data.slice(0),
          }
        : null,
    )

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
    setMusicXmlSource(nextMusicXml)
    setPageNumber(payload.pageNumber ?? 1)
    resetPdfViewerRuntime()
    setAutoOmrRequest(null)
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
    const restoredInstrument = normalizeInstrumentId(payload.instrumentId ?? DEFAULT_INSTRUMENT_ID)
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
        key={practiceSessionEpoch}
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
          onReloadPractice={() => setPracticeSessionEpoch((epoch) => epoch + 1)}
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
            onAutoOmrRequestConsumed={() => setAutoOmrRequest(null)}
            onImportFeedback={setLibraryFeedback}
            pdfSource={pdfBuffer}
            pdfFileUrl={pdfFile}
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
