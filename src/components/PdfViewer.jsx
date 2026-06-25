import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Document } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import '../pdf/setupPdfWorker.js'
import useElementSize from '../hooks/useElementSize.js'
import useAnnotations from '../hooks/useAnnotations.js'
import useAnnotationPersistence from '../hooks/useAnnotationPersistence.js'
import { getPageDimensions } from '../utils/pdfFit.js'
import { resetPdfCanvasScroll } from '../utils/pdfViewerScroll.js'
import { ANNOTATION_TOOLS } from './pdf/annotationConstants.js'
import PdfFullscreen from './pdf/PdfFullscreen.jsx'
import PdfPageWindow from './pdf/PdfPageWindow.jsx'
import PdfViewerToolbar from './pdf/PdfViewerToolbar.jsx'
import ScoreFollowControls from './pdf/ScoreFollowControls.jsx'
import PracticeFullscreenHudTick from './practice/PracticeFullscreenHudTick.jsx'
import PracticePdfCursorLayer, {
  usePracticeScoreFollowOverlayProps,
} from './pdf/PracticePdfCursorLayer.jsx'
import { usePracticeSessionContextOptional } from '../context/PracticeSessionContext.jsx'
import { clearWarmPages } from '../features/pdf/pdfPagePerf.js'

export default function PdfViewer({
  file,
  fileName,
  pdfMeta = null,
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
  const hasPdf = Boolean(file)
  const isEmptyLibraryViewer = !isPracticeEmbed && !hasPdf
  const showSidebarToggle = !isPracticeEmbed && hasPdf && onToggleSidebar
  // Score-follow setup lives in Practice; keep PDF column layout identical to Practice embed.
  const showScoreFollowPanel = false
  const canvasRef = useRef(null)
  const canvasSize = useElementSize(canvasRef)

  const [fitMode, setFitMode] = useState('page')
  const [pageSize, setPageSize] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

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
    pdfMeta,
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
    clearWarmPages()
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
    if (mode === 'page') {
      resetPdfCanvasScroll(canvasRef.current)
      requestAnimationFrame(() => resetPdfCanvasScroll(canvasRef.current))
    }
  }

  useLayoutEffect(() => {
    if (fitMode === 'page') {
      resetPdfCanvasScroll(canvasRef.current)
    }
  }, [fitMode, pageNumber, file])

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

  const practiceHud =
    isPracticeEmbed && practiceSession ? (
      <PracticeFullscreenHudTick
        onPlay={practiceSession.handlePlay}
        onPause={practiceSession.playback.pause}
        onWaitForYouContinue={practiceSession.waitForYou.markCorrectAndContinue}
      />
    ) : null

  const activePageProps = {
    strokes: currentStrokes,
    activeTool,
    strokeStyle,
    onStrokeComplete: handleStrokeComplete,
    onErase: handleErase,
    onLiveErase: handleErase,
  }

  function renderPageWindow(scoreFollowProps = null) {
    return (
      <PdfPageWindow
        key={String(file)}
        pageNumber={pageNumber}
        numPages={numPages}
        width={pageDimensions.width}
        height={pageDimensions.height}
        switchTrigger={isPracticeEmbed ? 'score-follow' : 'navigation'}
        onPageLoadSuccess={handlePageLoadSuccess}
        activePageProps={{
          ...activePageProps,
          scoreFollow: scoreFollowProps,
        }}
      />
    )
  }

  return (
    <section
      className={`pdf-viewer-section${isPracticeEmbed ? ' pdf-viewer-section--practice' : ' pdf-viewer-section--library'}${isEmptyLibraryViewer ? ' pdf-viewer-section--empty' : ''}`}
      aria-label="PDF viewer"
    >
      {showSidebarToggle && (
        <button
          type="button"
          className={`sidebar-toggle${sidebarOpen ? '' : ' sidebar-toggle--expand'}`}
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
            className={`pdf-canvas pdf-canvas--fit-${fitMode} pdf-canvas--paper-${paperTheme}`}
          >
          {!file ? (
            <p className="pdf-canvas__placeholder">
              Add a PDF to preview your score.
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
                  {(scoreFollowProps) => renderPageWindow(scoreFollowProps)}
                </PracticePdfCursorLayer>
              ) : (
                renderPageWindow(null)
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
