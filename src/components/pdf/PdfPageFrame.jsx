import { useCallback, useEffect, useRef, useState } from 'react'
import PdfPage from './PdfPage.jsx'
import PdfPageOverlayStack from './PdfPageOverlayStack.jsx'
import PdfOverlayLayer from './PdfOverlayLayer.jsx'
import AnnotationLayer from './AnnotationLayer.jsx'
import ScoreFollowOverlay from './ScoreFollowOverlay.jsx'
import { ANNOTATION_TOOLS } from './annotationConstants.js'

export default function PdfPageFrame({
  pageNumber,
  width,
  height,
  onPageLoadSuccess,
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

    const frameRect = frame.getBoundingClientRect()
    const pageRect = pageElement.getBoundingClientRect()

    setOverlayLayout({
      left: pageRect.left - frameRect.left,
      top: pageRect.top - frameRect.top,
      width: pageRect.width,
      height: pageRect.height,
    })
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
  }, [syncOverlayLayout, pageNumber, width, height])

  const handlePageLoadSuccess = useCallback(
    (page) => {
      onPageLoadSuccess(page)
      requestAnimationFrame(syncOverlayLayout)
    },
    [onPageLoadSuccess, syncOverlayLayout],
  )

  const alignmentMode = scoreFollow?.alignmentMode ?? false
  const semiAutoPreview = scoreFollow?.semiAutoPreview ?? false
  // In pointer mode the annotation overlay must not intercept any pointer events —
  // the SVG inside already has pointer-events:none but its wrapping PdfOverlayLayer
  // div was still set to 'auto', blocking scroll, tap, and toolbar clicks.
  const isPointerTool = activeTool === ANNOTATION_TOOLS.POINTER
  const showScoreFollowLayer =
    scoreFollow &&
    (alignmentMode ||
      scoreFollow.enabled ||
      semiAutoPreview ||
      scoreFollow.showNoteTarget)

  const innerLayout = overlayLayout
    ? {
        left: 0,
        top: 0,
        width: overlayLayout.width,
        height: overlayLayout.height,
      }
    : null

  return (
    <div className="pdf-page-frame" ref={frameRef}>
      <PdfPage
        pageNumber={pageNumber}
        width={width}
        height={height}
        onPageLoadSuccess={handlePageLoadSuccess}
      />
      {overlayLayout?.width > 0 && (
        <PdfPageOverlayStack layout={overlayLayout}>
          {showScoreFollowLayer && (
            <PdfOverlayLayer
              id="score-follow"
              zIndex={15}
              pointerEvents={alignmentMode ? 'auto' : 'none'}
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
  )
}
