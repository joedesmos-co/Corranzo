import { memo, useCallback, useRef } from 'react'
import PracticePageFollowController from './PracticePageFollowController.jsx'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import usePracticeKeyboardShortcuts from '../../features/practice/usePracticeKeyboardShortcuts.js'
import PdfViewer from '../PdfViewer.jsx'
import PracticeControlPanel from './PracticeControlPanel.jsx'
import ScoreFollowSetupStatus from './ScoreFollowSetupStatus.jsx'
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
}) {
  const { session, scoreFollow, waitForYouNoteTarget } = usePracticeSessionContext()
  const pdfActionsRef = useRef(null)
  const scoreScrollRef = useRef(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

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
          <PracticePageFollowController
            scrollContainerRef={scoreScrollRef}
            pageNumber={pageNumber}
            numPages={numPages}
            onGoToPage={handleGoToPage}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
          />
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
          <PracticeControlPanel
            pdfFileName={fileName || null}
            session={session}
            scoreFollow={scoreFollow}
            waitForYouNoteTarget={waitForYouNoteTarget}
          />
        </PracticeWorkspaceLayout>
      )}
    </main>
  )
}

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
