import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTabletLikeDevice } from '../../features/platform/browserPracticeSupport.js'
import { Document } from 'react-pdf'
import '../../pdf/setupPdfWorker.js'
import useElementSize from '../../hooks/useElementSize.js'
import useInactivityHide from '../../hooks/useInactivityHide.js'
import {
  computeDocumentDisplayReference,
  DEFAULT_CANVAS_PADDING,
  getPageDimensions,
} from '../../utils/pdfFit.js'
import PdfPageWindow from './PdfPageWindow.jsx'
import PdfViewerToolbar from './PdfViewerToolbar.jsx'

/** Idle delay before auto-hiding fullscreen chrome. */
const CHROME_IDLE_MS = 3500

export default function PdfFullscreen({
  file,
  pageNumber,
  numPages,
  pageSize,
  pageSizesRef,
  pageSizesVersion = 0,
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
  const { visible: autoVisible, notifyActivity } = useInactivityHide(CHROME_IDLE_MS, true)
  const [chromePinned, setChromePinned] = useState(false)
  const chromeVisible = chromePinned || autoVisible
  const hasPracticeHud = Boolean(practiceHud)

  const orientation = scoreFollow?.calibrationDebugSnapshot?.orientation ?? null
  const pageViewRotations = scoreFollow?.pageViewRotations ?? {}

  const referenceDisplaySize = useMemo(
    () =>
      computeDocumentDisplayReference(pageSizesRef?.current ?? {}, pageViewRotations, orientation),
    [pageSizesRef, pageSizesVersion, pageViewRotations, orientation],
  )

  const resolvePageLayout = useCallback(
    (slotPageNumber) => {
      const sourceSize =
        pageSizesRef?.current?.[slotPageNumber] ??
        (slotPageNumber === pageNumber ? pageSize : null)
      if (!sourceSize?.width || !sourceSize?.height) {
        return null
      }

      const viewRotation = scoreFollow?.getPageViewRotation?.(slotPageNumber) ?? 0
      return getPageDimensions(
        fitMode ?? 'page',
        sourceSize,
        containerSize,
        viewRotation,
        DEFAULT_CANVAS_PADDING,
        referenceDisplaySize,
      )
    },
    [
      containerSize,
      fitMode,
      pageNumber,
      pageSize,
      pageSizesRef,
      referenceDisplaySize,
      scoreFollow,
    ],
  )

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
      // Keyboard shortcuts (arrows, space, etc.) keep working without revealing chrome.
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
    event.stopPropagation()
    if (direction === 'prev' && canGoPrev) {
      onPrevPage()
    }
    if (direction === 'next' && canGoNext) {
      onNextPage()
    }
  }

  return (
    <div
      className="pdf-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen PDF reader"
    >
      <PdfViewerToolbar
        variant="fullscreen"
        visible={chromeVisible}
        chromePinned={chromePinned}
        onChromeActivity={notifyActivity}
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
          <PdfPageWindow
            key={String(file)}
            pageNumber={pageNumber}
            numPages={numPages}
            resolvePageLayout={resolvePageLayout}
            switchTrigger="fullscreen"
            onPageLoadSuccess={onPageLoadSuccess}
            activePageProps={{
              strokes,
              activeTool,
              strokeStyle,
              onStrokeComplete,
              onErase,
              onLiveErase,
              scoreFollow,
            }}
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
        <>
          <div
            className="pdf-fullscreen__chrome-zone pdf-fullscreen__chrome-zone--top"
            aria-hidden="true"
            onPointerEnter={notifyActivity}
            onPointerDown={notifyActivity}
          />
          {hasPracticeHud && (
            <div
              className="pdf-fullscreen__chrome-zone pdf-fullscreen__chrome-zone--bottom"
              aria-hidden="true"
              onPointerEnter={notifyActivity}
              onPointerDown={notifyActivity}
            />
          )}
          <button
            type="button"
            className="pdf-fullscreen__chrome-reveal"
            aria-label="Show controls"
            onClick={notifyActivity}
          >
            <span className="pdf-fullscreen__chrome-reveal-icon" aria-hidden>
              ⌃
            </span>
            Controls
          </button>
        </>
      )}

      <p
        className={`pdf-fullscreen__hint${chromeVisible ? ' pdf-fullscreen__hint--visible' : ''}`}
      >
        {alignmentMode
          ? 'Marking measures · Esc when finished · Esc again leaves fullscreen'
          : isTabletLikeDevice()
            ? 'Tap top edge for controls · Esc to exit'
            : 'Move pointer to top edge for controls · Esc to exit'}
      </p>
    </div>
  )
}
