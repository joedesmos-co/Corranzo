import { useCallback, useEffect, useRef, useState } from 'react'
import PdfPage from './PdfPage.jsx'
import PdfPageOverlayStack from './PdfPageOverlayStack.jsx'
import PdfOverlayLayer from './PdfOverlayLayer.jsx'
import AnnotationLayer from './AnnotationLayer.jsx'
import ScoreFollowOverlay from './ScoreFollowOverlay.jsx'
import CalibrationDebugOverlay from './CalibrationDebugOverlay.jsx'
import { ANNOTATION_TOOLS } from './annotationConstants.js'
import { measurePdfOverlayLayout } from '../../utils/pdfOverlayLayout.js'

function PdfPageFrame({
  pageNumber,
  width,
  height,
  displayWidth,
  displayHeight,
  viewerRotation = 0,
  onPageLoadSuccess,
  onLoadStart,
  onRenderStart,
  onRenderSuccess,
  strokes,
  activeTool,
  strokeStyle,
  onStrokeComplete,
  onErase,
  onLiveErase,
  scoreFollow,
}) {
  const frameRef = useRef(null)
  const [overlayLayout, setOverlayLayout] = useState(null)

  const syncOverlayLayout = useCallback(() => {
    const frame = frameRef.current
    const pageElement = frame?.querySelector('.react-pdf__Page')
    if (!frame || !pageElement) {
      setOverlayLayout(null)
      return
    }

    setOverlayLayout(measurePdfOverlayLayout(pageElement))
  }, [])

  useEffect(() => {
    syncOverlayLayout()
    const frame = frameRef.current
    const pageElement = frame?.querySelector('.react-pdf__Page')
    if (!pageElement) {
      return undefined
    }

    const observer = new ResizeObserver(syncOverlayLayout)
    observer.observe(pageElement)
    observer.observe(frame)
    window.addEventListener('resize', syncOverlayLayout)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncOverlayLayout)
    }
  }, [syncOverlayLayout, pageNumber, width, height, viewerRotation, scoreFollow?.pageViewRotations])

  const viewRotation = viewerRotation
  const pageRenderWidth = Number.isFinite(width) && width > 0 ? width : undefined
  const pageRenderHeight = Number.isFinite(height) && height > 0 ? height : undefined
  const frameDisplayWidth =
    Number.isFinite(displayWidth) && displayWidth > 0 ? displayWidth : pageRenderWidth
  const frameDisplayHeight =
    Number.isFinite(displayHeight) && displayHeight > 0 ? displayHeight : pageRenderHeight

  const handlePageLoadSuccess = useCallback(
    (page) => {
      onPageLoadSuccess(page)
      requestAnimationFrame(syncOverlayLayout)
    },
    [onPageLoadSuccess, syncOverlayLayout],
  )

  const alignmentMode = scoreFollow?.alignmentMode ?? false
  const semiAutoPreview = scoreFollow?.semiAutoPreview ?? false
  const systemStartMode = scoreFollow?.systemStartMode ?? false
  // In pointer mode the annotation overlay must not intercept any pointer events —
  // the SVG inside already has pointer-events:none but its wrapping PdfOverlayLayer
  // div was still set to 'auto', blocking scroll, tap, and toolbar clicks.
  const isPointerTool = activeTool === ANNOTATION_TOOLS.POINTER
  const showScoreFollowLayer =
    scoreFollow &&
    (alignmentMode ||
      systemStartMode ||
      scoreFollow.enabled ||
      semiAutoPreview ||
      scoreFollow.showNoteTarget ||
      scoreFollow.showCandidateAnchors)

  const showCalibrationDebugLayer =
    scoreFollow?.showCalibrationOverlay && scoreFollow?.calibrationOverlayPage

  const innerLayout = overlayLayout
    ? {
        left: 0,
        top: 0,
        width: overlayLayout.width,
        height: overlayLayout.height,
      }
    : null

  const frameBoxStyle =
    frameDisplayWidth && frameDisplayHeight
      ? {
          width: frameDisplayWidth,
          height: frameDisplayHeight,
          flexShrink: 0,
        }
      : frameDisplayWidth
        ? { width: frameDisplayWidth, flexShrink: 0 }
        : frameDisplayHeight
          ? { height: frameDisplayHeight, flexShrink: 0 }
          : undefined

  return (
    <div
      className={`pdf-page-frame${viewRotation ? ` pdf-page-frame--rot-${viewRotation}` : ''}`}
      ref={frameRef}
      style={frameBoxStyle}
    >
      <div
        className="pdf-page-rotator__inner"
        style={viewRotation ? { transform: `rotate(${viewRotation}deg)` } : undefined}
      >
      <PdfPage
        pageNumber={pageNumber}
        width={pageRenderWidth}
        height={pageRenderHeight}
        onLoadStart={onLoadStart}
        onRenderStart={onRenderStart}
        onRenderSuccess={onRenderSuccess}
        onPageLoadSuccess={handlePageLoadSuccess}
      />
      {overlayLayout?.width > 0 && (
        <PdfPageOverlayStack layout={overlayLayout}>
          {showCalibrationDebugLayer && (
            <PdfOverlayLayer id="calibration-debug" zIndex={12} pointerEvents="none">
              <CalibrationDebugOverlay
                layout={scoreFollow.calibrationOverlayPage}
                visible={scoreFollow.showCalibrationOverlay}
              />
            </PdfOverlayLayer>
          )}
          {showScoreFollowLayer && (
            <PdfOverlayLayer
              id="score-follow"
              zIndex={15}
              pointerEvents={alignmentMode || systemStartMode ? 'auto' : 'none'}
            >
              <ScoreFollowOverlay
                pageNumber={pageNumber}
                alignmentMode={alignmentMode}
                semiAutoPreview={semiAutoPreview}
                showAnchorMarkers={scoreFollow.showAnchorMarkers}
                showSystemBands={scoreFollow.showSystemBands}
                pageSystems={scoreFollow.pagePreviewSystems}
                placementMeasureNumber={scoreFollow.placementMeasureNumber}
                cursorVisibility={scoreFollow.cursorVisibility}
                cursor={scoreFollow.cursor}
                noteTarget={scoreFollow.noteTarget}
                showNoteTarget={scoreFollow.showNoteTarget}
                anchors={scoreFollow.displayAnchors ?? scoreFollow.anchors}
                onPlaceAnchor={scoreFollow.placeAnchorAt}
                systemStartMode={systemStartMode}
                systemStartMarks={scoreFollow.systemStartMarks ?? []}
                onPlaceSystemStart={scoreFollow.addSystemStartMark}
                candidateAnchors={scoreFollow.candidateAnchors ?? null}
                showCandidateAnchors={scoreFollow.showCandidateAnchors ?? false}
                getPageViewRotation={scoreFollow.getPageViewRotation}
              />
            </PdfOverlayLayer>
          )}
          <PdfOverlayLayer
            id="annotations"
            zIndex={20}
            pointerEvents={alignmentMode || isPointerTool ? 'none' : 'auto'}
            className={alignmentMode ? 'pdf-overlay-layer--disabled' : ''}
          >
            {innerLayout && (
              <AnnotationLayer
                layout={innerLayout}
                strokes={strokes}
                activeTool={activeTool}
                strokeStyle={strokeStyle}
                onStrokeComplete={onStrokeComplete}
                onErase={onErase}
                onLiveErase={onLiveErase}
              />
            )}
          </PdfOverlayLayer>
        </PdfPageOverlayStack>
      )}
      </div>
    </div>
  )
}

export default PdfPageFrame
