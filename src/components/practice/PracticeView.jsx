import { useCallback, useEffect, useRef, useState } from 'react'
import PracticePageFollowController from './PracticePageFollowController.jsx'
import {
  usePracticeSessionContext,
  usePracticeVisualSession,
} from '../../context/PracticeSessionContext.jsx'
import usePracticeKeyboardShortcuts from '../../features/practice/usePracticeKeyboardShortcuts.js'
import {
  PRACTICE_VIEW_MODE,
  PRACTICE_VIEW_MODE_LABELS,
  loadPracticeViewMode,
  savePracticeViewMode,
} from '../../features/practice/practiceViewMode.js'
import { useInstrument } from '../../context/instrumentContext.js'
import PdfViewer from '../PdfViewer.jsx'
import WorkspaceTransport from './WorkspaceTransport.jsx'
import WorkspaceTools from './WorkspaceTools.jsx'
import NoteGuideButton from './NoteGuideButton.jsx'
import Icon from '../../design/Icon.jsx'
import { handleFocusTrap } from '../../utils/focusTrap.js'
import { PRACTICE_MODE } from '../../features/practice/practiceMode.js'
import OmrQualityWarningBanner from './OmrQualityWarningBanner.jsx'
import RecognitionProblemReportDialog from '../omr/RecognitionProblemReportDialog.jsx'
import VisualPracticeView from './VisualPracticeView.jsx'
import PracticeErrorBoundary from './PracticeErrorBoundary.jsx'
import ArrangementPracticeView from '../audio-vision/ArrangementPracticeView.jsx'
import '../../styles/practice.css'
import '../../styles/workspace.css'

export default function PracticeView({
  pdfFile,
  fileName,
  pdfMeta = null,
  pdfBuffer = null,
  pageNumber,
  numPages,
  paperTheme,
  onDocumentLoadSuccess,
  onPrevPage,
  onNextPage,
  onGoToPage,
  onTogglePaper,
  timingSourceKind = null,
  onReloadPractice = null,
  onReturnToLibrary = null,
  omrQuality = null,
  omrOwnerScoreId = null,
  omrWarningDismissedScoreIds = null,
  onDismissOmrQualityWarning = null,
  musicXmlSource = null,
  activeScoreSnapshot = null,
}) {
  const { session, scoreFollow, practiceStats, practicePiece } = usePracticeSessionContext()
  const { setPdfPageSizes } = usePracticeVisualSession()
  const { instrumentId } = useInstrument()
  const practiceErrorResetKey = [
    session.waitForYou.currentCheckpoint?.id ?? 'none',
    session.waitForYou.checkpointIndex,
    session.sources?.timingFileName ?? '',
  ].join(':')
  const pdfActionsRef = useRef(null)
  const pdfScrollRef = useRef(null)
  const sessionRef = useRef(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const [focus, setFocus] = useState(false)
  const [tool, setTool] = useState(null)
  const workspaceRef = useRef(null)
  const focusButtonRef = useRef(null)
  const toolOriginRef = useRef(null)
  const toggleFocus = useCallback(() => setFocus(value => !value), [])
  const closeTool = useCallback(() => setTool(null), [])
  const openTool = useCallback((next) => {
    toolOriginRef.current = document.activeElement
    setTool(value => value === next ? null : next)
  }, [])
  const waitDisabled = Boolean(scoreFollow.experimentalOmrPlayback && !scoreFollow.canFollow && !(session.sourceVisualMap?.anchorCount > 0))
  useEffect(() => {
    if (!focus) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const background = [...document.querySelectorAll('.cz-shell__sidewrap, .cz-shell__scrim, .cz-shell__header, .app-footer')]
    const priorInert = background.map(el => el.inert)
    background.forEach(el => { el.inert = true })
    const focusButton = focusButtonRef.current
    focusButton?.focus()
    const onKey = event => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); if (!pdfActionsRef.current?.cancelAnnotation?.()) setFocus(false) }
      else handleFocusTrap(workspaceRef.current, event)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      background.forEach((el, i) => { el.inert = priorInert[i] })
      window.removeEventListener('keydown', onKey)
      focusButton?.focus()
    }
  }, [focus])

  // Placement needs the score canvas immediately; discard the open tool before
  // committing a frame that would leave the canvas inert behind its dialog.
  if (tool && (scoreFollow.alignmentMode || scoreFollow.systemStartMode)) {
    setTool(null)
  }

  const [viewMode, setViewMode] = useState(() => loadPracticeViewMode())
  const isVisualView = viewMode === PRACTICE_VIEW_MODE.VISUAL
  const [reportOpen, setReportOpen] = useState(false)
  const [reportDefaultCategory, setReportDefaultCategory] = useState(null)
  const [trackedScoreKey, setTrackedScoreKey] = useState(null)
  const scoreKey =
    omrOwnerScoreId ??
    activeScoreSnapshot?.scoreId ??
    musicXmlSource?.ownerScoreId ??
    null

  // Score replacement closes an open report dialog and clears draft category.
  if (scoreKey !== trackedScoreKey) {
    setTrackedScoreKey(scoreKey)
    if (reportOpen) {
      setReportOpen(false)
    }
    if (reportDefaultCategory != null) {
      setReportDefaultCategory(null)
    }
  }

  const openReportDialog = useCallback((options = {}) => {
    setReportDefaultCategory(options.defaultCategory ?? null)
    setReportOpen(true)
  }, [])

  const handleViewModeChange = useCallback((mode) => {
    setViewMode(mode)
    savePracticeViewMode(mode)
  }, [])

  const handleGoToPage = useCallback(
    (page) => {
      if (onGoToPage) {
        onGoToPage(page)
        return
      }
      if (page === pageNumber - 1) {
        onPrevPage?.()
      } else if (page === pageNumber + 1) {
        onNextPage?.()
      }
    },
    [onGoToPage, onNextPage, onPrevPage, pageNumber],
  )

  const canPrevPage = pageNumber > 1
  const canNextPage = numPages != null && pageNumber < numPages

  usePracticeKeyboardShortcuts({
    enabled: Boolean(pdfFile),
    isPlaying: session.playback.isPlaying,
    hasMidi: session.hasMidi,
    hasMusicXml: session.hasMusicXml,
    isWaitForYou: session.isWaitForYou,
    waitForYouStatus: session.waitForYou.status,
    alignmentMode: scoreFollow.alignmentMode || scoreFollow.semiAutoPreview,
    playbackLoading: session.playback.isLoading,
    allowPageKeys: !scoreFollow.alignmentMode && !scoreFollow.semiAutoPreview,
    canPrevPage,
    canNextPage,
    canPrevMeasure: session.measure.canGoPrevious,
    canNextMeasure: session.measure.canGoNext,
    onTogglePlayPause: () => {
      const current = sessionRef.current
      if (current.playback.isPlaying) {
        current.playback.pause()
      } else {
        current.handlePlay()
      }
    },
    onPrevPage,
    onNextPage,
    onPrevMeasure: () => sessionRef.current.measure.goToPreviousMeasure(),
    onNextMeasure: () => sessionRef.current.measure.goToNextMeasure(),
    onToggleFullscreen: toggleFocus,
    onModeChange: mode => { if (!sessionRef.current.timingDisabled && !(mode === PRACTICE_MODE.WAIT_FOR_YOU && waitDisabled)) sessionRef.current.setPracticeMode(mode) },
    onAdjustTempo: delta => { const p = sessionRef.current.playback; p.setPlaybackRate(Math.max(.25, Math.min(1.5, Math.round((p.playbackRate + delta) * 100) / 100))) },
    onLoop: () => openTool('loop'),
    onWaitForYouContinue: () => sessionRef.current.waitForYou.markCorrectAndContinue(),
  })

  return (
    <main ref={workspaceRef} className={`practice-workspace score-workspace${focus ? ' score-workspace--focus' : ''}`} aria-label="Score workspace" data-mode={session.practiceMode}>
      {!pdfFile ? (
        musicXmlSource?.source === 'audio-arrangement' ? (
          <ArrangementPracticeView musicXmlSource={musicXmlSource} onReturnToLibrary={onReturnToLibrary} />
        ) : (
          <div className="practice-workspace__empty">
            <h2>Choose a piece first</h2>
            <p className="practice-workspace__empty-lead">
              Open a score from <strong>Library</strong> to begin.
            </p>
          </div>
        )
      ) : (
        <div className="workspace-frame">
          <PracticeErrorBoundary
            resetKey={practiceErrorResetKey}
            onReloadPractice={onReloadPractice}
            onReturnToLibrary={onReturnToLibrary}
          >
            {!isVisualView && (
              <PracticePageFollowController
                scrollContainerRef={pdfScrollRef}
                pageNumber={pageNumber}
                numPages={numPages}
                onGoToPage={handleGoToPage}
                onPrevPage={onPrevPage}
                onNextPage={onNextPage}
              />
            )}
            <header className="workspace-header" inert={tool ? true : undefined}>
              <button className="workspace-back" aria-label="Back to Library" onClick={onReturnToLibrary}><Icon name="prev" size={16} /><span>Library</span></button>
              <h1>{(fileName || 'Your score').replace(/\.[^.]+$/, '').replace(/ - (Piano|Guitar)$/, '')}</h1>
              <div className="workspace-representation" role="group" aria-label="Score presentation">
                <button aria-pressed={!isVisualView} onClick={() => handleViewModeChange(PRACTICE_VIEW_MODE.SCORE)}>{PRACTICE_VIEW_MODE_LABELS[PRACTICE_VIEW_MODE.SCORE]}</button>
                <NoteGuideButton active={isVisualView} onSelect={() => handleViewModeChange(PRACTICE_VIEW_MODE.VISUAL)} />
              </div>
              <button ref={focusButtonRef} className="workspace-focus" aria-label={focus ? 'Exit focus (F)' : 'Focus score (F)'} aria-pressed={focus} onClick={toggleFocus}><Icon name={focus ? 'close' : 'fullscreen'} size={18} /><span>{focus ? 'Exit focus' : 'Focus'}</span></button>
            </header>
            {(scoreFollow.alignmentMode || scoreFollow.systemStartMode) && <div className="workspace-placement" role="status">Select the requested position on your score.<button onClick={() => { scoreFollow.setAlignmentMode(false); scoreFollow.exitSystemStartMode?.() }}>Finish placement</button></div>}
            <div className="practice-workspace__main" inert={tool ? true : undefined}>
              {isVisualView ? (
                <div className="workspace-guide"><p className="workspace-guide-caption">Note guide <span>A moving guide to the notes and finger positions. Your score remains the reference.</span></p><VisualPracticeView timingSourceKind={timingSourceKind} /></div>
              ) : (
                <div className="practice-workspace__score">
                  <OmrQualityWarningBanner
                    quality={omrQuality}
                    ownerScoreId={omrOwnerScoreId}
                    dismissedScoreIds={omrWarningDismissedScoreIds}
                    onDismiss={onDismissOmrQualityWarning}
                    onReportProblem={() => openReportDialog({ defaultCategory: null })}
                  />
                  <PdfViewer
                    variant="practice"
                    file={pdfFile}
                    fileName={fileName}
                    pdfMeta={pdfMeta}
                    pageNumber={pageNumber}
                    numPages={numPages}
                    paperTheme={paperTheme}
                    onWorkspaceFocus={toggleFocus}
                    onDocumentLoadSuccess={onDocumentLoadSuccess}
                    onPrevPage={onPrevPage}
                    onNextPage={onNextPage}
                    onTogglePaper={onTogglePaper}
                    actionsRef={pdfActionsRef}
                    scrollContainerRef={pdfScrollRef}
                    onPageSizesChange={setPdfPageSizes}
                  />
                </div>
              )}
            </div>
            <div className="workspace-dock-wrap" inert={tool ? true : undefined}>
              <WorkspaceTransport session={session} scoreFollow={scoreFollow} onTool={openTool} tool={tool} waitDisabled={waitDisabled} />
            </div>
            {tool && <WorkspaceTools tool={tool} onClose={closeTool} returnFocusTo={toolOriginRef} session={session} scoreFollow={scoreFollow} fileName={fileName} pageNumber={pageNumber} practiceStats={practiceStats} pieceId={practicePiece?.id} onReport={() => { closeTool(); openReportDialog() }} />}
            <RecognitionProblemReportDialog
              open={reportOpen}
              onClose={() => setReportOpen(false)}
              ownerScoreId={scoreKey}
              mode="score"
              activeScore={
                activeScoreSnapshot ??
                (typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ : null)
              }
              musicXmlSource={musicXmlSource}
              pdfMeta={pdfMeta}
              pdfBuffer={pdfBuffer}
              instrumentId={instrumentId}
              generation={activeScoreSnapshot?.generation ?? null}
              timingMap={session.timing?.timingMap ?? null}
              diagnostics={musicXmlSource?.omrMeta?.diagnostics ?? null}
              defaultCategory={reportDefaultCategory}
            />
          </PracticeErrorBoundary>
        </div>
      )}
    </main>
  )
}
