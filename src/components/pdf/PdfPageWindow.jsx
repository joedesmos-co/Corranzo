import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import PdfPageFrame from './PdfPageFrame.jsx'
import { ANNOTATION_TOOLS, resolveAnnotationStrokeStyle } from './annotationConstants.js'
import {
  beginPageSwitch,
  completePageSwitch,
  isPageWarm,
  markPageWarm,
  notePageRender,
} from '../../features/pdf/pdfPagePerf.js'

function windowPageNumbers(pageNumber, numPages) {
  const pages = []
  if (pageNumber > 1) {
    pages.push(pageNumber - 1)
  }
  pages.push(pageNumber)
  if (numPages != null && pageNumber < numPages) {
    pages.push(pageNumber + 1)
  }
  return pages
}

const INACTIVE_FRAME_PROPS = {
  strokes: [],
  activeTool: ANNOTATION_TOOLS.POINTER,
  strokeStyle: resolveAnnotationStrokeStyle(null, ANNOTATION_TOOLS.POINTER),
  onStrokeComplete: () => {},
  onErase: () => {},
  onLiveErase: () => {},
  scoreFollow: null,
}

/**
 * Keeps previous, current, and next PDF pages mounted with stable per-page keys.
 * Warm slots stay rasterized off-screen; activation toggles visibility only.
 */
function PdfPageWindow({
  pageNumber,
  numPages,
  resolvePageLayout,
  switchTrigger = 'navigation',
  onPageLoadSuccess,
  activePageProps,
}) {
  const pages = useMemo(
    () => windowPageNumbers(pageNumber, numPages),
    [pageNumber, numPages],
  )
  const prevPageRef = useRef(pageNumber)
  const pendingRasterRef = useRef(false)
  const timingRef = useRef(new Map())

  useEffect(() => {
    const prev = prevPageRef.current
    if (prev === pageNumber) {
      return
    }
    beginPageSwitch({ fromPage: prev, toPage: pageNumber, trigger: switchTrigger })
    if (isPageWarm(pageNumber)) {
      requestAnimationFrame(() => {
        completePageSwitch({ toPage: pageNumber, wasWarm: true, rasterMs: 0 })
      })
      pendingRasterRef.current = false
    } else {
      pendingRasterRef.current = true
    }
    prevPageRef.current = pageNumber
  }, [pageNumber, switchTrigger])

  const markTiming = useCallback((key) => {
    timingRef.current.set(key, performance.now())
  }, [])

  const handlePageLoadSuccess = useCallback(
    (page, slotPageNumber) => {
      const loadKey = `load-${slotPageNumber}`
      const started = timingRef.current.get(loadKey)
      if (started != null) {
        notePageRender({
          pageNumber: slotPageNumber,
          phase: 'pdf-load',
          durationMs: performance.now() - started,
        })
        timingRef.current.delete(loadKey)
      }
      markPageWarm(slotPageNumber)
      if (slotPageNumber === pageNumber) {
        onPageLoadSuccess?.(page)
      }
    },
    [onPageLoadSuccess, pageNumber],
  )

  const handleRenderSuccess = useCallback(
    (slotPageNumber, layout) => {
      const rasterKey = `raster-${slotPageNumber}`
      const started = timingRef.current.get(rasterKey)
      if (started == null) {
        return
      }
      const durationMs = performance.now() - started
      timingRef.current.delete(rasterKey)
      notePageRender({
        pageNumber: slotPageNumber,
        phase: 'raster',
        durationMs,
        width: layout?.width,
      })
      if (slotPageNumber === pageNumber && pendingRasterRef.current) {
        pendingRasterRef.current = false
        completePageSwitch({
          toPage: slotPageNumber,
          wasWarm: false,
          rasterMs: durationMs,
        })
      }
    },
    [pageNumber],
  )

  const activeLayout = resolvePageLayout?.(pageNumber)
  if (!activeLayout?.width && !activeLayout?.height) {
    return null
  }

  return (
    <div className="pdf-page-window" data-active-page={pageNumber}>
      {pages.map((slotPage) => {
        const isActive = slotPage === pageNumber
        const frameProps = isActive ? activePageProps : INACTIVE_FRAME_PROPS
        const layout = resolvePageLayout?.(slotPage)
        if (!layout?.width && !layout?.height) {
          return null
        }
        return (
          <div
            key={`pdf-slot-${slotPage}`}
            className={`pdf-page-window__slot${isActive ? ' pdf-page-window__slot--active' : ' pdf-page-window__slot--warm'}`}
            data-page={slotPage}
            aria-hidden={!isActive}
          >
            <PdfPageFrame
              pageNumber={slotPage}
              width={layout.width}
              height={layout.height}
              displayWidth={layout.displayWidth}
              displayHeight={layout.displayHeight}
              onPageLoadSuccess={(page) => handlePageLoadSuccess(page, slotPage)}
              onLoadStart={() => markTiming(`load-${slotPage}`)}
              onRenderStart={() => markTiming(`raster-${slotPage}`)}
              onRenderSuccess={() => handleRenderSuccess(slotPage, layout)}
              {...frameProps}
            />
          </div>
        )
      })}
    </div>
  )
}

export default memo(PdfPageWindow)
