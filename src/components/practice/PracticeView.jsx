import { memo, useCallback, useRef, useState } from 'react'
import PracticePageFollowController from './PracticePageFollowController.jsx'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import usePracticeKeyboardShortcuts from '../../features/practice/usePracticeKeyboardShortcuts.js'
import {
  PRACTICE_VIEW_MODE,
  PRACTICE_VIEW_MODE_LABELS,
  loadPracticeViewMode,
  savePracticeViewMode,
} from '../../features/practice/practiceViewMode.js'
import PdfViewer from '../PdfViewer.jsx'
import PracticeControlPanel from './PracticeControlPanel.jsx'
import ScoreFollowSetupStatus from './ScoreFollowSetupStatus.jsx'
import VisualPracticeView from './VisualPracticeView.jsx'
import '../../styles/practice.css'

export default function PracticeView({
  pdfFile,
  fileName,
  pdfMeta = null,
  pageNumber,
  numPages,
  paperTheme,
  onDocumentLoadSuccess,
  onPrevPage,
  onNextPage,
  onGoToPage,
  onTogglePaper,
  timingSourceKind = null,
}) {
  const { session, scoreFollow, waitForYouNoteTarget } = usePracticeSessionContext()
  const pdfActionsRef = useRef(null)
  const scoreScrollRef = useRef(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const [viewMode, setViewMode] = useState(() => loadPracticeViewMode())
  const isVisualView = viewMode === PRACTICE_VIEW_MODE.VISUAL

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
    onToggleFullscreen: () => pdfActionsRef.current?.toggleFullscreen?.(),
    onWaitForYouContinue: () => sessionRef.current.waitForYou.markCorrectAndContinue(),
  })

  return (
    <main className="practice-workspace" aria-label="Practice">
      {!pdfFile ? (
        <div className="practice-workspace__empty">
          <h2>Choose a piece first</h2>
          <p className="practice-workspace__empty-lead">
            Open a PDF and timing file from <strong>Library</strong>.
          </p>
        </div>
      ) : (
        <PracticeWorkspaceLayout>
          {!isVisualView && (
            <PracticePageFollowController
              scrollContainerRef={scoreScrollRef}
              pageNumber={pageNumber}
              numPages={numPages}
              onGoToPage={handleGoToPage}
              onPrevPage={onPrevPage}
              onNextPage={onNextPage}
            />
          )}
          <div className="practice-workspace__main">
            <PracticeViewSwitchBar viewMode={viewMode} onViewModeChange={handleViewModeChange} />
            {isVisualView ? (
              <VisualPracticeView timingSourceKind={timingSourceKind} />
            ) : (
              <div ref={scoreScrollRef} className="practice-workspace__score">
                <ScoreFollowSetupStatus setupStatus={scoreFollow.setupStatus} />
                <PdfViewer
                  variant="practice"
                  file={pdfFile}
                  fileName={fileName}
                  pdfMeta={pdfMeta}
                  pageNumber={pageNumber}
                  numPages={numPages}
                  paperTheme={paperTheme}
                  onDocumentLoadSuccess={onDocumentLoadSuccess}
                  onPrevPage={onPrevPage}
                  onNextPage={onNextPage}
                  onTogglePaper={onTogglePaper}
                  actionsRef={pdfActionsRef}
                />
              </div>
            )}
          </div>
          <PracticeControlPanel
            pdfFileName={fileName || null}
            pdfPageNumber={pageNumber}
            waitForYouNoteTarget={waitForYouNoteTarget}
          />
        </PracticeWorkspaceLayout>
      )}
    </main>
  )
}

const PracticeViewSwitchBar = memo(function PracticeViewSwitchBar({
  viewMode,
  onViewModeChange,
}) {
  return (
    <div className="practice-view-switchbar">
      <span className="practice-view-switchbar__label" id="practice-view-switch-label">
        View
      </span>
      <div
        className="practice-view-switch"
        role="group"
        aria-labelledby="practice-view-switch-label"
      >
        {Object.values(PRACTICE_VIEW_MODE).map((mode) => (
          <button
            key={mode}
            type="button"
            className="practice-view-switch__option"
            aria-pressed={viewMode === mode}
            onClick={() => onViewModeChange(mode)}
          >
            {PRACTICE_VIEW_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
    </div>
  )
})

const PracticeWorkspaceLayout = memo(function PracticeWorkspaceLayout({ children }) {
  const tick = usePracticeTick()
  return (
    <div
      className={`practice-workspace__layout${
        tick.playbackIsPlaying ? ' practice-workspace__layout--playing' : ''
      }`}
    >
      {children}
    </div>
  )
})
