import { useCallback, useEffect, useRef, useState } from 'react'
import { Document } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import '../pdf/setupPdfWorker.js'
import useElementSize from '../hooks/useElementSize.js'
import useAnnotations from '../hooks/useAnnotations.js'
import useAnnotationPersistence from '../hooks/useAnnotationPersistence.js'
import { getPageDimensions } from '../utils/pdfFit.js'
import { ANNOTATION_TOOLS } from './pdf/annotationConstants.js'
import PdfFullscreen from './pdf/PdfFullscreen.jsx'
import PdfPageFrame from './pdf/PdfPageFrame.jsx'
import PdfViewerToolbar from './pdf/PdfViewerToolbar.jsx'
import ScoreFollowControls from './pdf/ScoreFollowControls.jsx'
import PracticeFullscreenHudTick from './practice/PracticeFullscreenHudTick.jsx'
import PracticePdfCursorLayer, {
  usePracticeScoreFollowOverlayProps,
} from './pdf/PracticePdfCursorLayer.jsx'
import { usePracticeSessionContextOptional } from '../context/PracticeSessionContext.jsx'

export default function PdfViewer({
  file,
  fileName,
  pageNumber,
  numPages,
  paperTheme,
  sidebarOpen,
  variant = 'library',
  onDocumentLoadSuccess,
  onPrevPage,
  onNextPage,
  onToggleSidebar,
  onTogglePaper,
  actionsRef,
}) {
  const isPracticeEmbed = variant === 'practice'
  const showSidebarToggle = !isPracticeEmbed && onToggleSidebar
  // Score-follow setup lives in Practice; keep PDF column layout identical to Practice embed.
  const showScoreFollowPanel = false
  const canvasRef = useRef(null)
  const canvasSize = useElementSize(canvasRef)

  const [fitMode, setFitMode] = useState('page')
  const [pageSize, setPageSize] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [pageTurnActive, setPageTurnActive] = useState(false)
  const skipPageTurnOnMountRef = useRef(true)

  const {
    activeTool,
    setActiveTool,
    toolSettings,
    strokesByPage,
    updateToolSettings,
    getStrokeStyle,
    getStrokes,
    addStroke,
    undo,
    clearPage,
    removeStrokes,
    replaceAnnotations,
  } = useAnnotations()

  const { exportAnnotations, importAnnotations } = useAnnotationPersistence({
    file,
    fileName,
    strokesByPage,
    toolSettings,
    replaceAnnotations,
  })

  const canGoPrev = pageNumber > 1
  const canGoNext = numPages != null && pageNumber < numPages
  const pageDimensions = getPageDimensions(fitMode, pageSize, canvasSize)
  const currentStrokes = getStrokes(pageNumber)
  const canUndoAnnotations = currentStrokes.length > 0
  const strokeStyle = getStrokeStyle(activeTool)

  const handlePageLoadSuccess = useCallback((page) => {
    setPageSize({
      width: page.originalWidth,
      height: page.originalHeight,
    })
  }, [])

  useEffect(() => {
    setPageSize(null)
    skipPageTurnOnMountRef.current = true
  }, [file])

  const handleStrokeComplete = useCallback(
    (stroke) => {
      addStroke(pageNumber, stroke)
    },
    [addStroke, pageNumber],
  )

  const handleErase = useCallback(
    (strokeIds) => {
      removeStrokes(pageNumber, strokeIds)
    },
    [removeStrokes, pageNumber],
  )

  const handleUndoAnnotation = useCallback(() => {
    undo(pageNumber)
  }, [undo, pageNumber])

  const handleClearAnnotations = useCallback(() => {
    clearPage(pageNumber)
  }, [clearPage, pageNumber])

  function handleFitModeChange(mode) {
    setFitMode(mode)
  }

  function handleToggleFullscreen() {
    setIsFullscreen((open) => !open)
  }

  function handleCloseFullscreen() {
    setIsFullscreen(false)
  }

  useEffect(() => {
    if (!actionsRef) {
      return undefined
    }
    actionsRef.current = {
      toggleFullscreen: () => setIsFullscreen((open) => !open),
    }
    return () => {
      actionsRef.current = null
    }
  }, [actionsRef])

  useEffect(() => {
    if (skipPageTurnOnMountRef.current) {
      skipPageTurnOnMountRef.current = false
      return undefined
    }
    setPageTurnActive(true)
    const timer = window.setTimeout(() => setPageTurnActive(false), 220)
    return () => window.clearTimeout(timer)
  }, [pageNumber])

  const practiceContext = usePracticeSessionContextOptional()
  const practiceSession = practiceContext?.session ?? null
  const scoreFollow = practiceContext?.scoreFollow ?? null
  const hasTiming = Boolean(practiceContext?.session?.timing?.timingMap)
  const measureBounds = practiceContext?.session?.measure?.bounds
  const practiceOverlayPropsRaw = usePracticeScoreFollowOverlayProps()
  const practiceOverlayProps = isPracticeEmbed ? practiceOverlayPropsRaw : null

  const isDrawingTool =
    activeTool === ANNOTATION_TOOLS.PEN ||
    activeTool === ANNOTATION_TOOLS.HIGHLIGHTER ||
    activeTool === ANNOTATION_TOOLS.ERASER

  const hasPdf = Boolean(file)

  const practiceHud =
    isPracticeEmbed && practiceSession ? (
      <PracticeFullscreenHudTick
        onPlay={practiceSession.handlePlay}
        onPause={practiceSession.playback.pause}
        onWaitForYouContinue={practiceSession.waitForYou.markCorrectAndContinue}
      />
    ) : null

  function renderPdfPage(scoreFollowProps) {
    return (
      <PdfPageFrame
        key={`${file}-${pageNumber}`}
        pageNumber={pageNumber}
        width={pageDimensions.width}
        height={pageDimensions.height}
        onPageLoadSuccess={handlePageLoadSuccess}
        strokes={currentStrokes}
        activeTool={activeTool}
        strokeStyle={strokeStyle}
        onStrokeComplete={handleStrokeComplete}
        onErase={handleErase}
        onLiveErase={handleErase}
        scoreFollow={scoreFollowProps}
      />
    )
  }

  return (
    <section
      className={`pdf-viewer-section${isPracticeEmbed ? ' pdf-viewer-section--practice' : ' pdf-viewer-section--library'}`}
      aria-label="PDF viewer"
    >
      {showSidebarToggle && (
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Hide library sidebar' : 'Show library sidebar'}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
      )}

      <div className="pdf-viewer-stage">
        {file && (
          <PdfViewerToolbar
            variant="embedded"
            visible
            file={file}
            fileName={fileName}
            pageNumber={pageNumber}
            numPages={numPages}
            fitMode={fitMode}
            paperTheme={paperTheme}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            activeTool={activeTool}
            toolSettings={toolSettings}
            canUndoAnnotations={canUndoAnnotations}
            onFitModeChange={handleFitModeChange}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
            onToggleFullscreen={handleToggleFullscreen}
            onTogglePaper={onTogglePaper}
            onToolChange={setActiveTool}
            onUpdateToolSettings={updateToolSettings}
            onUndoAnnotation={handleUndoAnnotation}
            onClearAnnotations={handleClearAnnotations}
            onExportAnnotations={exportAnnotations}
            onImportAnnotations={importAnnotations}
          />
        )}

        <div
          className={`pdf-viewer-body${showScoreFollowPanel ? '' : ' pdf-viewer-body--score-only'}`}
        >
          {showScoreFollowPanel && (
            <ScoreFollowControls
              hasPdf={hasPdf}
              hasTiming={hasTiming}
              enabled={scoreFollow?.enabled ?? true}
              onEnabledChange={scoreFollow?.setEnabled ?? (() => {})}
              alignmentMode={scoreFollow?.alignmentMode ?? false}
              onAlignmentModeChange={scoreFollow?.setAlignmentMode ?? (() => {})}
              beatInterpolation={scoreFollow?.beatInterpolation ?? true}
              onBeatInterpolationChange={scoreFollow?.setBeatInterpolation ?? (() => {})}
              placementMeasureNumber={scoreFollow?.placementMeasureNumber ?? 1}
              onPlacementMeasureNumberChange={
                scoreFollow?.setPlacementMeasureNumber ?? (() => {})
              }
              measureBounds={measureBounds}
              anchors={scoreFollow?.anchors ?? []}
              onDeleteAnchor={scoreFollow?.deleteAnchor ?? (() => {})}
              onClearAnchors={scoreFollow?.clearAnchors ?? (() => {})}
              canFollow={scoreFollow?.canFollow ?? false}
              debug={scoreFollow?.debug}
            />
          )}

          <div
            ref={canvasRef}
            className={`pdf-canvas pdf-canvas--fit-${fitMode} pdf-canvas--paper-${paperTheme}${pageTurnActive ? ' pdf-canvas--page-turn' : ''}`}
          >
          {!file ? (
            <p className="pdf-canvas__placeholder">
              Upload your sheet music in Library to get started.
            </p>
          ) : isFullscreen ? null : (
            <Document
              file={file}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={<p className="pdf-canvas__status">Loading PDF…</p>}
              error={
                <p className="pdf-canvas__status pdf-canvas__status--error">
                  Could not load PDF.
                </p>
              }
            >
              {isPracticeEmbed ? (
                <PracticePdfCursorLayer pageNumber={pageNumber}>
                  {(scoreFollowProps) => renderPdfPage(scoreFollowProps)}
                </PracticePdfCursorLayer>
              ) : (
                renderPdfPage(null)
              )}
            </Document>
          )}
          </div>
        </div>
      </div>

      {isFullscreen && file && (
        <PdfFullscreen
          file={file}
          pageNumber={pageNumber}
          numPages={numPages}
          pageSize={pageSize}
          fitMode={fitMode}
          paperTheme={paperTheme}
          strokes={currentStrokes}
          activeTool={activeTool}
          toolSettings={toolSettings}
          strokeStyle={strokeStyle}
          allowPageZones={!isDrawingTool}
          canUndoAnnotations={canUndoAnnotations}
          onPageLoadSuccess={handlePageLoadSuccess}
          onPrevPage={onPrevPage}
          onNextPage={onNextPage}
          onClose={handleCloseFullscreen}
          onFitModeChange={handleFitModeChange}
          onTogglePaper={onTogglePaper}
          onStrokeComplete={handleStrokeComplete}
          onErase={handleErase}
          onLiveErase={handleErase}
          scoreFollow={practiceOverlayProps}
          onToolChange={setActiveTool}
          onUpdateToolSettings={updateToolSettings}
          onUndoAnnotation={handleUndoAnnotation}
          onClearAnnotations={handleClearAnnotations}
          onExportAnnotations={exportAnnotations}
          onImportAnnotations={importAnnotations}
          practiceHud={practiceHud}
        />
      )}
    </section>
  )
}
