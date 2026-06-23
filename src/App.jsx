import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar.jsx'
import LibraryPanel from './components/LibraryPanel.jsx'
import LibraryWelcomeCard from './components/LibraryWelcomeCard.jsx'
import AppFooter from './components/AppFooter.jsx'
import SessionRestoreBanner from './components/SessionRestoreBanner.jsx'
import SessionRestoreOverlay from './components/SessionRestoreOverlay.jsx'
import useRestoreUploadGate from './features/import/useRestoreUploadGate.js'
import PdfViewer from './components/PdfViewer.jsx'
import PracticeView from './components/practice/PracticeView.jsx'
import { PracticeSessionProvider } from './context/PracticeSessionContext.jsx'
import { ProfileStatsProvider } from './context/ProfileStatsContext.jsx'
import ProfileView from './components/profile/ProfileView.jsx'
import useWorkspacePreferences from './hooks/useWorkspacePreferences.js'
import useSessionPersistence from './hooks/useSessionPersistence.js'
import {
  dismissOnboarding,
  isOnboardingDismissed,
  loadPracticePrefs,
  savePracticePrefs,
} from './features/session/practicePrefsStorage.js'
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
import './App.css'
import './styles/profile.css'

function isFullPracticeSet(pdfLoaded, midiSource, musicXmlSource) {
  return Boolean(pdfLoaded && midiSource?.data && musicXmlSource?.data)
}

export default function App() {
  const [activeView, setActiveView] = useState('library')
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfBuffer, setPdfBuffer] = useState(null)
  const [pdfMeta, setPdfMeta] = useState(null)
  const [initialPracticePrefs, setInitialPracticePrefs] = useState(null)
  const [showWelcome, setShowWelcome] = useState(() => !isOnboardingDismissed())
  const practicePrefsRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState(null)
  const [midiSource, setMidiSource] = useState(null)
  const [musicXmlSource, setMusicXmlSource] = useState(null)
  const [sampleLoadState, setSampleLoadState] = useState({ loading: false, error: null })
  const [demoPieceActive, setDemoPieceActive] = useState(false)
  const [libraryFeedback, setLibraryFeedback] = useState(null)
  const [pdfSoftWarning, setPdfSoftWarning] = useState(null)

  const {
    sidebarOpen,
    paperTheme,
    toggleSidebar,
    togglePaperTheme,
  } = useWorkspacePreferences()

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

  const handleFileSelect = useCallback(async (file) => {
    clearDemoPiece()
    const validation = validateFileForImport(file, 'pdf')
    if (!validation.ok) {
      setLibraryFeedback({ type: 'error', message: validation.message })
      return
    }

    try {
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
      setPdfSoftWarning(validation.softWarning)
      if (midiSource || musicXmlSource) {
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

      if (isFullPracticeSet(true, midiSource, musicXmlSource)) {
        setActiveView('practice')
      } else {
        setActiveView('library')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatPdfImportError(error),
      })
    }
  }, [midiSource, musicXmlSource, clearDemoPiece])

  const handleMidiSelect = useCallback(async (file) => {
    clearDemoPiece()
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
        setActiveView('practice')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatMidiImportError(error),
      })
    }
  }, [pdfFile, musicXmlSource, clearDemoPiece])

  const handleMusicXmlSelect = useCallback(async (file) => {
    clearDemoPiece()
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
        setActiveView('practice')
      }
    } catch (error) {
      setLibraryFeedback({
        type: 'error',
        message: formatMusicXmlImportError(error),
      })
    }
  }, [pdfFile, midiSource, clearDemoPiece])

  const handleLoadSampleFixtures = useCallback(async () => {
    if (!isDemoSampleEnabled()) {
      return
    }

    setSampleLoadState({ loading: true, error: null })

    try {
      const { fetchSampleFixtureFiles } = await import('./dev/loadSampleFixtures.js')
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
      setDemoPieceActive(true)
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
      setActiveView('practice')
      setSampleLoadState({ loading: false, error: null })
    } catch (loadError) {
      setSampleLoadState({
        loading: false,
        error:
          loadError instanceof Error
            ? loadError.message
            : 'Could not load the sample score. Check your connection and try again.',
      })
    }
  }, [])

  function handleDocumentLoadSuccess({ numPages: total }) {
    setNumPages(total)
    setPageNumber(1)
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
    setMidiSource(payload.midiSource)
    setMusicXmlSource(payload.musicXmlSource)
    setPageNumber(payload.pageNumber ?? 1)
    setInitialPracticePrefs(payload.practicePrefs)
    setActiveView(payload.musicXmlSource ? payload.activeView ?? 'library' : 'library')
    setShowWelcome(false)
    setPdfSoftWarning(null)
    setDemoPieceActive(false)
  }, [])

  const sessionPersistence = useSessionPersistence({
    pdfBuffer,
    pdfMeta,
    midiSource,
    musicXmlSource,
    activeView,
    pageNumber,
    practicePrefs: practicePrefsRef.current,
    onRestore: handleSessionRestore,
  })

  const { restoreGateOpen, isRestoring } = sessionPersistence

  const { wrapUpload } = useRestoreUploadGate({
    restoreGateOpen,
    onBlocked: (message) => setLibraryFeedback({ type: 'info', message }),
  })

  const practiceReady =
    restoreGateOpen && Boolean(pdfFile && musicXmlSource?.data)
  const sessionFilesReady = practiceReady

  function handleNavigate(view, meta) {
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
      setLibraryFeedback({
        type: 'info',
        message: 'Add a PDF and MusicXML/MXL first — then Practice will open.',
      })
      setActiveView('library')
      return
    }
    setActiveView(view)
  }

  const showLibraryIntro = activeView === 'library' && showWelcome && restoreGateOpen
  const showLibraryWorkspace = activeView === 'library' && !showLibraryIntro

  const appBody = (
    <div className={`app${isRestoring ? ' app--restoring' : ''}`}>
      <TopBar
        activeView={activeView}
        onNavigate={handleNavigate}
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
        <div className="library-welcome-wrap">
          <LibraryWelcomeCard
            onDismiss={() => setShowWelcome(false)}
            onTrySample={
              isDemoSampleEnabled() && restoreGateOpen ? handleLoadSampleFixtures : undefined
            }
            sampleLoading={sampleLoadState.loading}
            sampleError={sampleLoadState.error}
          />
        </div>
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
            uploadsDisabled={isRestoring}
            onOpenPractice={() => {
              setActiveView('practice')
              setLibraryFeedback({
                type: 'info',
                message: 'Opened Practice. Add a sound file anytime for backing audio.',
              })
            }}
            onFileSelect={wrapUpload('pdf', handleFileSelect)}
            onMidiSelect={wrapUpload('midi', handleMidiSelect)}
            onMusicXmlSelect={wrapUpload('musicXml', handleMusicXmlSelect)}
            onImportFeedback={setLibraryFeedback}
            onLoadSampleFixtures={
              isDemoSampleEnabled() && restoreGateOpen ? handleLoadSampleFixtures : undefined
            }
            sampleLoadLoading={sampleLoadState.loading}
            sampleLoadError={sampleLoadState.error}
            importFeedback={libraryFeedback}
            showDemo={!showWelcome}
          />
          <div className="main-layout__score">
            <PdfViewer
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

      {activeView === 'library' && <AppFooter />}

      {activeView === 'practice' && restoreGateOpen && (
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
      )}
      {activeView === 'profile' && <ProfileView />}
    </div>
  )

  return (
    <ProfileStatsProvider>
      {!restoreGateOpen ? (
        appBody
      ) : (
        <PracticeSessionProvider
          activeView={activeView}
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
          onPracticePrefsChange={(snapshot) => {
            practicePrefsRef.current = snapshot
          }}
        >
          {appBody}
        </PracticeSessionProvider>
      )}
    </ProfileStatsProvider>
  )
}
