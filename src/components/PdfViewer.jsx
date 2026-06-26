import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Document } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import '../pdf/setupPdfWorker.js'
import useElementSize from '../hooks/useElementSize.js'
import useStableElementSize from '../hooks/useStableElementSize.js'
import usePdfViewerGeometry from '../hooks/usePdfViewerGeometry.js'
import useAnnotations from '../hooks/useAnnotations.js'
import useAnnotationPersistence from '../hooks/useAnnotationPersistence.js'
import { resolvePdfPageLayout, PRACTICE_CANVAS_PADDING } from '../utils/pdfFit.js'
import { upsertPdfPageSize, arePdfPageSizesEqual } from '../utils/pdfPageSizeCache.js'
import { buildLibraryLayoutCacheKey, getCachedLibraryPageLayout } from '../utils/pdfViewerLayoutCache.js'
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
  const rawCanvasSize = useElementSize(canvasRef)
  const canvasSize = useStableElementSize(rawCanvasSize, {
    enabled: !isPracticeEmbed,
    resetKey: file,
  })
  const pageSizesRef = useRef({})
  const libraryLayoutCacheRef = useRef(new Map())
  const [pageSizesVersion, setPageSizesVersion] = useState(0)

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
  const currentStrokes = getStrokes(pageNumber)
  const canUndoAnnotations = currentStrokes.length > 0
  const strokeStyle = getStrokeStyle(activeTool)

  const handlePageLoadSuccess = useCallback((page) => {
    const size = {
      width: page.originalWidth,
      height: page.originalHeight,
    }
    const changed = upsertPdfPageSize(pageSizesRef.current, page.pageNumber, size)
    if (changed) {
      setPageSizesVersion((version) => version + 1)
    }
    if (page.pageNumber === pageNumber) {
      setPageSize((previous) => (arePdfPageSizesEqual(previous, size) ? previous : size))
    }
  }, [pageNumber])

  useEffect(() => {
    setPageSize(null)
    pageSizesRef.current = {}
    setPageSizesVersion(0)
    libraryLayoutCacheRef.current.clear()
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
  const { referenceDisplaySize, getPageViewRotation, viewerRotationKey } = usePdfViewerGeometry({
    pageSizesByPage: pageSizesRef.current,
    pageSizesVersion,
    currentPageSize: pageSize,
  })

  useEffect(() => {
    libraryLayoutCacheRef.current.clear()
  }, [file, fitMode, viewerRotationKey])

  const pageWindowKey = useMemo(() => {
    const rotationSuffix = viewerRotationKey ? `::${viewerRotationKey}` : ''
    return `${String(file)}${rotationSuffix}`
  }, [file, viewerRotationKey])

  const resolvePageLayout = useCallback(
    (slotPageNumber) => {
      const layout = resolvePdfPageLayout({
        fitMode,
        pageNumber,
        slotPageNumber,
        pageSize,
        pageSizesByPage: pageSizesRef.current,
        containerSize: canvasSize,
        getPageViewRotation,
        canvasPadding: isPracticeEmbed ? PRACTICE_CANVAS_PADDING : undefined,
        referenceDisplaySize,
      })

      if (isPracticeEmbed) {
        return layout
      }

      const sourceSize =
        pageSizesRef.current[slotPageNumber] ??
        (slotPageNumber === pageNumber ? pageSize : null)
      const hasSourceSize =
        Number.isFinite(sourceSize?.width) &&
        sourceSize.width > 0 &&
        Number.isFinite(sourceSize?.height) &&
        sourceSize.height > 0

      if (!hasSourceSize) {
        return layout
      }

      if (!referenceDisplaySize?.correctedWidth || !referenceDisplaySize?.correctedHeight) {
        return layout
      }

      const cacheKey = buildLibraryLayoutCacheKey({
        fitMode,
        containerSize: canvasSize,
        referenceDisplaySize,
        viewerRotationKey,
        slotPageNumber,
        viewRotation: layout.viewerRotation ?? 0,
      })

      return getCachedLibraryPageLayout(libraryLayoutCacheRef.current, cacheKey, layout)
    },
    [
      canvasSize,
      fitMode,
      getPageViewRotation,
      isPracticeEmbed,
      pageNumber,
      pageSize,
      pageSizesVersion,
      referenceDisplaySize,
      viewerRotationKey,
    ],
  )
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
        key={pageWindowKey}
        pageNumber={pageNumber}
        numPages={numPages}
        resolvePageLayout={resolvePageLayout}
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
          pageSizesRef={pageSizesRef}
          pageSizesVersion={pageSizesVersion}
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
          stabilizeLayout={!isPracticeEmbed}
        />
      )}
    </section>
  )
}
