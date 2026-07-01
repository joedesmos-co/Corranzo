import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import TopBar from './components/TopBar.jsx'
import LibraryPanel from './components/LibraryPanel.jsx'
import LibraryWelcomeCard from './components/LibraryWelcomeCard.jsx'
import AppViewPlaceholder from './components/AppViewPlaceholder.jsx'
import AppFooter from './components/AppFooter.jsx'
import SessionRestoreBanner from './components/SessionRestoreBanner.jsx'
import SessionRestoreOverlay from './components/SessionRestoreOverlay.jsx'
import GuidedTutorial from './components/onboarding/GuidedTutorial.jsx'
import useRestoreUploadGate from './features/import/useRestoreUploadGate.js'
import PdfViewer from './components/PdfViewer.jsx'
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
  loadPracticePrefs,
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
import { warmupPianoSamplesOnIdle } from './features/playback/pianoSampleWarmup.js'
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

export default function App() {
  const [activeView, setActiveView] = useState(resolveInitialView)
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfBuffer, setPdfBuffer] = useState(null)
  const [pdfMeta, setPdfMeta] = useState(null)
  const [initialPracticePrefs, setInitialPracticePrefs] = useState(null)
  const [showWelcome, setShowWelcome] = useState(() => !isOnboardingDismissed())
  const [guidedTutorialOpen, setGuidedTutorialOpen] = useState(() =>
    shouldOpenGuidedTutorial({ completed: isGuidedTutorialCompleted() }),
  )
  const [demoCardHidden, setDemoCardHidden] = useState(() => isDemoCardHidden())
  const practicePrefsRef = useRef(null)
  const pendingClassifiedUploadRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState(null)
  const [midiSource, setMidiSource] = useState(null)
  const [musicXmlSource, setMusicXmlSource] = useState(null)
  const [sampleLoadState, setSampleLoadState] = useState({ loading: false, error: null })
  const [demoPieceActive, setDemoPieceActive] = useState(false)
  const [libraryFeedback, setLibraryFeedback] = useState(null)
  const [pdfSoftWarning, setPdfSoftWarning] = useState(null)
  const [practicePdfReady, setPracticePdfReady] = useState(false)
  const [pdfViewerRevision, setPdfViewerRevision] = useState(0)
  const activeViewRef = useRef(activeView)

  const {
    sidebarOpen,
    paperTheme,
    setSidebarOpen,
    toggleSidebar,
    togglePaperTheme,
  } = useWorkspacePreferences()

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
    warmupPianoSamplesOnIdle()
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
    setSidebarOpen(true)
    navigateToView(home.view)
    window.scrollTo(0, 0)
  }, [navigateToView, setSidebarOpen])

  useEffect(() => {
    return () => {
      if (pdfFile) {
        URL.revokeObjectURL(pdfFile)
      }
    }
  }, [pdfFile])

  const clearDemoPiece = useCallback(() => {
    setDemoPieceActive(false)
  }, [])

  const markDemoCardHidden = useCallback(() => {
    hideDemoCard()
    setDemoCardHidden(true)
  }, [])

  const resetPdfViewerRuntime = useCallback(() => {
    clearWarmPages()
    setPracticePdfReady(false)
    setPdfViewerRevision((revision) => revision + 1)
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
      const nextMusicXmlSource = clearOmrGeneratedPlaybackSource(musicXmlSource)
      const clearedGeneratedPlayback = nextMusicXmlSource !== musicXmlSource
      if (clearedGeneratedPlayback) {
        setMusicXmlSource(null)
      }
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
      setPdfSoftWarning(validation.softWarning)
      if (clearedGeneratedPlayback) {
        setLibraryFeedback({
          type: validation.softWarning ? 'info' : 'success',
          message: validation.softWarning
            ? `${validation.softWarning} Loaded ${file.name}. Previous generated playback was cleared.`
            : `Loaded ${file.name}. Previous generated playback was cleared; generate again or upload MusicXML/MXL.`,
        })
      } else if (midiSource || nextMusicXmlSource) {
        setLibraryFeedback({
          type: 'info',
          message: validation.softWarning
            ? `${validation.softWarning} PDF updated — check timing/sound still match.`
            : `PDF updated. Check your timing & sound files still match.`,
        })
      } else {
        setLibraryFeedback(
          validation.softWarning
            ? { type: 'info', message: validation.softWarning }
            : {
                type: 'success',
                message: `Loaded ${file.name}. Add score timing, then open Practice.`,
              },
        )
      }

      if (isFullPracticeSet(true, midiSource, nextMusicXmlSource)) {
        navigateToView('practice')
      } else {
        navigateToView('library')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatPdfImportError(error),
      })
    }
  }, [midiSource, musicXmlSource, clearDemoPiece, markDemoCardHidden, navigateToView, resetPdfViewerRuntime])

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
          : `Loaded ${file.name}. Add a PDF + timing to open Practice.`,
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
      })
      const fullSet = isFullPracticeSet(Boolean(pdfFile), midiSource, { data })
      setLibraryFeedback({
        type: 'success',
        message: fullSet
          ? `Loaded ${file.name}. All files ready — opening Practice.`
          : `Loaded ${file.name}. Add a PDF to open Practice.`,
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
  }, [pdfFile, midiSource, clearDemoPiece, markDemoCardHidden, navigateToView])

  const handleOmrGenerated = useCallback(async ({
    fileName: generatedFileName,
    musicXml,
    noteCount,
    measureCount,
    measureGrid,
  }) => {
    releaseOmrUiLocks()

    const playbackValidation = validateOmrGeneratedPlayback(musicXml, generatedFileName)
    if (!playbackValidation.ok) {
      clearGeneratedPlaybackAfterOmrFailure()
      setLibraryFeedback({
        type: 'error',
        message: playbackValidation.message,
      })
      return { ok: false, message: playbackValidation.message }
    }

    if (!pdfFile) {
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
      const refreshed = await refreshOwnedPdfFromBlobUrl(pdfFile, { revokePrevious: false })
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

    const stablePdfMeta = pdfMeta ?? {
      fileName: generatedFileName?.replace(/\.omr\.musicxml$/i, '.pdf') || 'score.pdf',
      size: nextPdfBuffer?.byteLength ?? null,
      lastModified: Date.now(),
    }
    if (!pdfMeta) {
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
    setLibraryFeedback({
      type: 'success',
      message: `Experimental playback ready (${playbackValidation.noteCount} notes, ${Math.round(playbackValidation.durationSeconds)}s). Saved in Library — open Practice to try it.`,
    })

    const sessionMeta = buildSessionMeta({
      pdfMeta: stablePdfMeta,
      midiSource,
      musicXmlSource: nextMusicXmlSource,
      activeView: activeViewRef.current,
      pageNumber,
      practicePrefs: practicePrefsRef.current,
    })
    saveSessionMeta(sessionMeta)
    try {
      await saveSessionFiles({
        pdf: nextPdfBuffer ? { data: nextPdfBuffer.slice(0) } : null,
        midi: midiSource?.data ? { data: midiSource.data.slice(0) } : null,
        musicXml: nextMusicXmlSource.data ? { data: nextMusicXmlSource.data.slice(0) } : null,
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
    clearDemoPiece,
    markDemoCardHidden,
    clearGeneratedPlaybackAfterOmrFailure,
    resetPdfViewerRuntime,
  ])

  const handleLoadSampleFixtures = useCallback(async () => {
    if (!isDemoSampleEnabled()) {
      return
    }

    setSampleLoadState({ loading: true, error: null })

    try {
      const { pdfFile, midiFile, musicXmlFile, meta } = await fetchSampleFixtureFiles()

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
      setShowWelcome(false)
      dismissOnboarding()
      markDemoCardHidden()
      setDemoPieceActive(true)
      // Demo is loaded — the upload/demo sidebar is no longer useful, so collapse
      // it. The PDF viewer's sidebar toggle still reopens it on demand.
      setSidebarOpen(false)
      const clearedPrefs = {
        ...(loadPracticePrefs() ?? {}),
        practiceTime: 0,
      }
      savePracticePrefs(clearedPrefs)
      setInitialPracticePrefs(clearedPrefs)
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
  }, [setSidebarOpen, markDemoCardHidden, navigateToView, resetPdfViewerRuntime])

  const handleClassifiedUpload = useCallback(
    async (classified) => {
      clearDemoPiece()
      markDemoCardHidden()
      const notices = buildUploadNotices(classified)

      let loadedPdf = Boolean(pdfFile)
      let loadedMidi = midiSource
      let loadedXml = musicXmlSource
      let loadedSoftWarning = pdfSoftWarning
      let clearedGeneratedPlaybackForPdf = false

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
          loadedSoftWarning = validation.softWarning ?? null
          setPdfSoftWarning(loadedSoftWarning)
          loadedPdf = true
          const nextXml = clearOmrGeneratedPlaybackSource(loadedXml)
          clearedGeneratedPlaybackForPdf = nextXml !== loadedXml
          if (clearedGeneratedPlaybackForPdf) {
            setMusicXmlSource(null)
            loadedXml = null
          }
        }

        if (classified.musicXml[0]) {
          const file = classified.musicXml[0]
          if (isMuseScoreSourceFile(file)) {
            setLibraryFeedback({ type: 'info', message: MUSESCORE_PLANNED_MESSAGE })
            return notices
          }
          const data = await readFileArrayBuffer(file, 'musicXml')
          const nextXml = { fileName: file.name, data }
          setMusicXmlSource(nextXml)
          loadedXml = nextXml
        }

        if (classified.midi[0]) {
          const file = classified.midi[0]
          const data = await readFileArrayBuffer(file, 'midi')
          const nextMidi = { fileName: file.name, data }
          setMidiSource(nextMidi)
          loadedMidi = nextMidi
        }

        if (classified.pdf[0]) {
          if (clearedGeneratedPlaybackForPdf && !classified.musicXml[0]) {
            setLibraryFeedback({
              type: loadedSoftWarning ? 'info' : 'success',
              message: loadedSoftWarning
                ? `${loadedSoftWarning} Loaded ${classified.pdf[0].name}. Previous generated playback was cleared.`
                : `Loaded ${classified.pdf[0].name}. Previous generated playback was cleared; generate again or upload MusicXML/MXL.`,
            })
          } else if (loadedMidi || loadedXml) {
            setLibraryFeedback({
              type: 'info',
              message: loadedSoftWarning
                ? `${loadedSoftWarning} PDF updated — check timing/sound still match.`
                : 'PDF updated. Check your timing & sound files still match.',
            })
          } else {
            setLibraryFeedback(
              loadedSoftWarning
                ? { type: 'info', message: loadedSoftWarning }
                : {
                    type: 'success',
                    message: `Loaded ${classified.pdf[0].name}. Add score timing, then open Practice.`,
                  },
            )
          }
        } else if (classified.musicXml[0] || classified.midi[0]) {
          const fullSet = isFullPracticeSet(loadedPdf, loadedMidi, loadedXml)
          setLibraryFeedback({
            type: 'success',
            message: fullSet
              ? 'All files ready — opening Practice.'
              : classified.musicXml[0]
                ? `Loaded ${classified.musicXml[0].name}. Add a PDF to open Practice.`
                : `Loaded ${classified.midi[0].name}. Add a PDF + timing to open Practice.`,
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
  }, [markDemoCardHidden, resetPdfViewerRuntime])

  const onLegalRoute = isLegalPathname(window.location.pathname)

  const sessionPersistence = useSessionPersistence({
    pdfBuffer,
    pdfMeta,
    midiSource,
    musicXmlSource,
    activeView,
    pageNumber,
    practicePrefs: practicePrefsRef.current,
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
          logAppViewDebug('practice-pdf-refresh:error', {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeView, pdfFile, pdfBuffer, resetPdfViewerRuntime])

  const showLibraryIntro =
    activeView === 'library' &&
    showWelcome &&
    restoreGateOpen &&
    !guidedTutorialOpen
  const showLibraryWorkspace = activeView === 'library' && !showLibraryIntro

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
    if (meta?.blocked) {
      dismissOnboarding()
      setShowWelcome(false)
      setSidebarOpen(true)
      setLibraryFeedback({
        type: 'info',
        message: 'Add a PDF and MusicXML/MXL first — then Practice will open.',
      })
      navigateToView('library')
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
          title={omrInvalid ? 'Generated playback is not ready' : 'Practice needs a score first'}
          message={
            omrInvalid
              ? 'Experimental PDF playback could not be validated. Return to Library and regenerate, or upload MusicXML/MXL.'
              : 'Start with the demo piece, or add a PDF and MusicXML/MXL in Library.'
          }
          actionLabel="Back to Library"
          onAction={() => {
            setSidebarOpen(true)
            navigateToView('library')
          }}
          secondaryActionLabel={
            !omrInvalid && isDemoSampleEnabled() && restoreGateOpen ? 'Try Demo Piece' : null
          }
          onSecondaryAction={
            !omrInvalid && isDemoSampleEnabled() && restoreGateOpen
              ? handleLoadSampleFixtures
              : null
          }
        />
      )
    }

    return (
      <PracticeSessionProvider
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
        />
      </PracticeSessionProvider>
    )
  }

  const appBody = (
    <div className={`app${isRestoring ? ' app--restoring' : ''}`}>
      <TopBar
        activeView={activeView}
        onNavigate={handleNavigate}
        onGoHome={goHome}
        onReplayTutorial={replayGuidedTutorial}
        practiceReady={practiceReady}
      />

      {isRestoring && <SessionRestoreOverlay />}

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
            sampleLoading={sampleLoadState.loading}
            sampleError={sampleLoadState.error}
          />
        </main>
      )}

      {showLibraryWorkspace && (
        <main
          className={`main-layout${sidebarOpen ? '' : ' main-layout--sidebar-hidden'}${pdfFile ? '' : ' main-layout--empty-score'}`}
        >
          <LibraryPanel
            className={sidebarOpen ? '' : 'library-panel--hidden'}
            fileName={fileName}
            midiFileName={midiSource?.fileName}
            musicXmlFileName={musicXmlSource?.fileName}
            musicXmlSource={musicXmlSource}
            uploadsDisabled={isRestoring}
            onOpenPractice={() => {
              navigateToView('practice')
              setLibraryFeedback({
                type: 'info',
                message: 'Opened Practice. Add a sound file anytime for backing audio.',
              })
            }}
            onClassifiedUpload={gatedClassifiedUpload}
            onFileSelect={wrapUpload('pdf', handleFileSelect)}
            onMidiSelect={wrapUpload('midi', handleMidiSelect)}
            onMusicXmlSelect={wrapUpload('musicXml', handleMusicXmlSelect)}
            onOmrGenerated={handleOmrGenerated}
            onImportFeedback={setLibraryFeedback}
            pdfSource={pdfBuffer}
            pdfFileUrl={pdfFile}
            onLoadSampleFixtures={
              isDemoSampleEnabled() && restoreGateOpen ? handleLoadSampleFixtures : undefined
            }
            sampleLoadLoading={sampleLoadState.loading}
            sampleLoadError={sampleLoadState.error}
            importFeedback={libraryFeedback}
            showDemo={!demoCardHidden && isDemoSampleEnabled() && restoreGateOpen}
          />
          <div className="main-layout__score">
            <PdfViewer
              key={`library-pdf-${pdfViewerRevision}-${pdfFile ?? 'empty'}`}
              file={pdfFile}
              fileName={fileName}
              pdfMeta={pdfMeta}
              pageNumber={pageNumber}
              numPages={numPages}
              paperTheme={paperTheme}
              sidebarOpen={sidebarOpen}
              onDocumentLoadSuccess={handleDocumentLoadSuccess}
              onPrevPage={handlePrevPage}
              onNextPage={handleNextPage}
              onToggleSidebar={toggleSidebar}
              onTogglePaper={togglePaperTheme}
            />
          </div>
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

      {(activeView === 'library' || activeView === 'profile' || isLegalView(activeView)) && (
        <AppFooter onLegalNavigate={navigateToView} />
      )}

      {guidedTutorialOpen && restoreGateOpen && (
        <GuidedTutorial
          activeView={activeView}
          practiceReady={practiceReady}
          canStartDemo={isDemoSampleEnabled() && restoreGateOpen && !practiceReady}
          demoLoading={sampleLoadState.loading}
          onStartDemo={handleLoadSampleFixtures}
          onNavigate={navigateToView}
          onSkip={() => finishGuidedTutorial('skipped')}
          onDone={() => finishGuidedTutorial('done')}
        />
      )}
    </div>
  )

  return (
    <ProfileStatsProvider>
      {appBody}
    </ProfileStatsProvider>
  )
}
