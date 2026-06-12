import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import { isTabletLikeDevice } from '../../features/platform/browserPracticeSupport.js'
import { Document } from 'react-pdf'
import '../../pdf/setupPdfWorker.js'
import useElementSize from '../../hooks/useElementSize.js'
import useInactivityHide from '../../hooks/useInactivityHide.js'
import { getPageDimensions } from '../../utils/pdfFit.js'
import PdfPageFrame from './PdfPageFrame.jsx'
import PdfViewerToolbar from './PdfViewerToolbar.jsx'

export default function PdfFullscreen({
  file,
  pageNumber,
  numPages,
  pageSize,
  fitMode,
  paperTheme,
  strokes,
  activeTool,
  toolSettings,
  strokeStyle,
  allowPageZones,
  canUndoAnnotations,
  onPageLoadSuccess,
  onPrevPage,
  onNextPage,
  onClose,
  onFitModeChange,
  onTogglePaper,
  onStrokeComplete,
  onErase,
  onLiveErase,
  onToolChange,
  onUpdateToolSettings,
  onUndoAnnotation,
  onClearAnnotations,
  onExportAnnotations,
  onImportAnnotations,
  scoreFollow,
  practiceHud = null,
}) {
  const containerRef = useRef(null)
  const containerSize = useElementSize(containerRef)
  const { visible: autoVisible, notifyActivity } = useInactivityHide(2800, true)
  const [chromePinned, setChromePinned] = useState(false)
  const chromeVisible = chromePinned || autoVisible

  const pageDimensions = getPageDimensions(fitMode ?? 'page', pageSize, containerSize)
  const canGoPrev = pageNumber > 1
  const canGoNext = numPages != null && pageNumber < numPages
  const alignmentMode = scoreFollow?.alignmentMode ?? false
  const setAlignmentMode = scoreFollow?.setAlignmentMode
  const allowNavigationZones = allowPageZones && !alignmentMode
  const alignmentModeRef = useRef(alignmentMode)
  alignmentModeRef.current = alignmentMode

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (alignmentModeRef.current) {
          setAlignmentMode?.(false)
          alignmentModeRef.current = false
          return
        }
        onClose()
        return
      }
      notifyActivity()
      if (!allowNavigationZones) {
        return
      }
      if (event.key === 'ArrowLeft' && canGoPrev) {
        event.preventDefault()
        onPrevPage()
      }
      if (event.key === 'ArrowRight' && canGoNext) {
        event.preventDefault()
        onNextPage()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    onClose,
    onPrevPage,
    onNextPage,
    canGoPrev,
    canGoNext,
    allowNavigationZones,
    notifyActivity,
    setAlignmentMode,
  ])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function handleZoneClick(event, direction) {
    if (!allowNavigationZones) {
      return
    }
    notifyActivity()
    event.stopPropagation()
    if (direction === 'prev' && canGoPrev) {
      onPrevPage()
    }
    if (direction === 'next' && canGoNext) {
      onNextPage()
    }
  }

  function handleActivity() {
    notifyActivity()
  }

  return (
    <div
      className="pdf-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen PDF reader"
      onPointerMove={handleActivity}
      onPointerDown={handleActivity}
    >
      <PdfViewerToolbar
        variant="fullscreen"
        visible={chromeVisible}
        chromePinned={chromePinned}
        onToggleChromePinned={() => {
          setChromePinned((previous) => !previous)
          notifyActivity()
        }}
        file={file}
        pageNumber={pageNumber}
        numPages={numPages}
        fitMode={fitMode ?? 'page'}
        paperTheme={paperTheme}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        activeTool={activeTool}
        toolSettings={toolSettings}
        canUndoAnnotations={canUndoAnnotations}
        onFitModeChange={onFitModeChange}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        onToggleFullscreen={onClose}
        onTogglePaper={onTogglePaper}
        onToolChange={onToolChange}
        onUpdateToolSettings={onUpdateToolSettings}
        onUndoAnnotation={onUndoAnnotation}
        onClearAnnotations={onClearAnnotations}
        onExportAnnotations={onExportAnnotations}
        onImportAnnotations={onImportAnnotations}
        onClose={onClose}
      />

      <div
        ref={containerRef}
        className={`pdf-fullscreen__stage pdf-canvas--paper-${paperTheme}`}
      >
        <Document
          file={file}
          loading={<p className="pdf-fullscreen__status">Loading…</p>}
          error={<p className="pdf-fullscreen__status">Could not load PDF.</p>}
        >
          <PdfPageFrame
            key={`fullscreen-${pageNumber}`}
            pageNumber={pageNumber}
            width={pageDimensions.width}
            height={pageDimensions.height}
            onPageLoadSuccess={onPageLoadSuccess}
            strokes={strokes}
            activeTool={activeTool}
            strokeStyle={strokeStyle}
            onStrokeComplete={onStrokeComplete}
            onErase={onErase}
            onLiveErase={onLiveErase}
            scoreFollow={scoreFollow}
          />
        </Document>

        {allowNavigationZones && (
          <>
            <button
              type="button"
              className="pdf-fullscreen__zone pdf-fullscreen__zone--left"
              aria-label="Previous page"
              disabled={!canGoPrev}
              onClick={(event) => handleZoneClick(event, 'prev')}
            />
            <button
              type="button"
              className="pdf-fullscreen__zone pdf-fullscreen__zone--right"
              aria-label="Next page"
              disabled={!canGoNext}
              onClick={(event) => handleZoneClick(event, 'next')}
            />
          </>
        )}
      </div>

      {practiceHud && isValidElement(practiceHud)
        ? cloneElement(practiceHud, { chromeVisible })
        : practiceHud}

      {!chromeVisible && (
        <button
          type="button"
          className="pdf-fullscreen__chrome-reveal"
          aria-label="Show controls"
          onClick={() => {
            setChromePinned(true)
            notifyActivity()
          }}
        >
          <span className="pdf-fullscreen__chrome-reveal-icon" aria-hidden>
            ⌃
          </span>
          Controls
        </button>
      )}

      <p
        className={`pdf-fullscreen__hint${chromeVisible ? ' pdf-fullscreen__hint--visible' : ''}`}
      >
        {alignmentMode
          ? 'Marking measures · Esc when finished · Esc again leaves fullscreen'
          : isTabletLikeDevice()
            ? 'Tap screen edges to turn pages · Esc to exit · Pinch to zoom if needed'
            : 'Move pointer for controls · F fullscreen · Esc to exit'}
      </p>
    </div>
  )
}
