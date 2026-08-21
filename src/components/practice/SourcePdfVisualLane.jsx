import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '../../pdf/setupPdfWorker.js'
import useElementSize from '../../hooks/useElementSize.js'
import useStableElementSize from '../../hooks/useStableElementSize.js'
import { resolvePracticeTargetHighlightRects } from '../../features/practice/practiceNoteTargetOverlay.js'
import {
  mapSourceRectIntoCrop,
  normalizePreferredSourceRepresentation,
  resolveSourceCropTransform,
  resolveSourceSystemCrop,
  resolveSourceVisualSystem,
} from '../../features/practice/sourcePdfVisualGeometry.js'

function rawPageSize(page) {
  let size = { width: page.originalWidth, height: page.originalHeight }
  try {
    const raw = page.getViewport?.({ scale: 1, rotation: 0 })
    if (raw?.width > 0 && raw?.height > 0) {
      size = { width: raw.width, height: raw.height }
    }
  } catch {
    // originalWidth/originalHeight remain a safe PDF.js fallback.
  }
  return size
}

function samePageSize(left, right) {
  return left?.width === right?.width && left?.height === right?.height
}

function SourcePdfVisualLane({
  pdfFile,
  pdfPageSizes,
  setPdfPageSizes,
  visiblePageNumber,
  noteTarget,
  sourceVisualMap,
  omrMeasureGrid,
  scoreAnchors = [],
  activeMeasureNumber = null,
  preferredRepresentation = null,
  pageViewRotations = {},
  onSourcePageChange = null,
}) {
  const containerRef = useRef(null)
  const rawSize = useElementSize(containerRef)
  const size = useStableElementSize(rawSize)
  const [readyFrame, setReadyFrame] = useState(null)
  const representation = normalizePreferredSourceRepresentation(preferredRepresentation)

  const targetSystem = useMemo(
    () =>
      resolveSourceVisualSystem({
        noteTarget,
        activeMeasureNumber,
        visiblePageNumber,
        sourceVisualMap,
        omrMeasureGrid,
        scoreAnchors,
      }),
    [
      noteTarget,
      activeMeasureNumber,
      visiblePageNumber,
      sourceVisualMap,
      omrMeasureGrid,
      scoreAnchors,
    ],
  )

  const crop = useMemo(
    () =>
      resolveSourceSystemCrop({
        targetSystem,
        omrMeasureGrid,
        sourceVisualMap,
        scoreAnchors,
        preferredRepresentation: representation,
      }),
    [targetSystem, omrMeasureGrid, sourceVisualMap, scoreAnchors, representation],
  )

  const targetPage = crop?.page ?? targetSystem?.page ?? visiblePageNumber ?? 1
  const pageSize = pdfPageSizes?.[targetPage] ?? null
  const viewerRotation = pageViewRotations?.[targetPage] ?? 0
  const cropTransform = useMemo(
    () =>
      resolveSourceCropTransform({
        crop,
        pageSize,
        containerSize: size,
        rotation: viewerRotation,
      }),
    [crop, pageSize, size, viewerRotation],
  )
  const currentFrame = useMemo(
    () => ({
      page: targetPage,
      crop,
      transform: cropTransform,
      rotation: viewerRotation,
      bootstrapWidth: Math.max(320, Number(size.width) || 0),
    }),
    [targetPage, crop, cropTransform, viewerRotation, size.width],
  )

  useEffect(() => {
    if (
      onSourcePageChange &&
      Number(targetPage) > 0 &&
      Number(targetPage) !== Number(visiblePageNumber)
    ) {
      onSourcePageChange(Number(targetPage))
    }
  }, [onSourcePageChange, targetPage, visiblePageNumber])

  const handlePageLoadSuccess = useCallback(
    (page) => {
      const nextSize = rawPageSize(page)
      setPdfPageSizes?.((previous) => {
        const current = previous?.[page.pageNumber]
        if (samePageSize(current, nextSize)) return previous
        return { ...(previous ?? {}), [page.pageNumber]: nextSize }
      })
    },
    [setPdfPageSizes],
  )

  const handleRenderSuccess = useCallback((frame) => {
    setReadyFrame(frame)
  }, [])

  const highlightRects = useMemo(() => {
    if (!noteTarget?.visible || !noteTarget.highlight || !cropTransform) return []
    return resolvePracticeTargetHighlightRects(noteTarget, viewerRotation)
      .map((rect) => mapSourceRectIntoCrop(rect, cropTransform))
      .filter(Boolean)
  }, [noteTarget, cropTransform, viewerRotation])

  if (!pdfFile) {
    return null
  }

  const isPageTransition = readyFrame && readyFrame.page !== currentFrame.page
  const frames = isPageTransition ? [readyFrame, currentFrame] : [currentFrame]
  const currentPageVisible = !isPageTransition

  return (
    <div
      ref={containerRef}
      className="source-pdf-visual-lane"
      aria-label="Source PDF visual practice"
      data-source-page={targetPage}
      data-source-system={targetSystem?.systemIndex ?? 'page'}
      data-crop-source={crop?.source ?? 'loading'}
      data-page-ready={readyFrame?.page === targetPage ? 'true' : 'false'}
    >
      <Document
        file={pdfFile}
        loading={null}
        error={
          <div className="source-pdf-visual-lane__error">
            The source PDF could not be displayed. Switch to Score and reopen the piece.
          </div>
        }
      >
        {frames.map((frame) => {
          const frameTransform = frame.transform
          const isCurrent = frame.page === currentFrame.page
          const pageFrameStyle = frameTransform
            ? {
                position: 'absolute',
                left: `${frameTransform.pageLeft}px`,
                top: `${frameTransform.pageTop}px`,
                width: `${frameTransform.renderedPageWidth}px`,
                height: `${frameTransform.renderedPageHeight}px`,
                opacity: isCurrent && !currentPageVisible ? 0 : 1,
              }
            : {
                position: 'absolute',
                inset: 0,
                opacity: isCurrent && !currentPageVisible ? 0 : 1,
              }
          return (
            <div
              key={`source-page-${frame.page}`}
              className="source-pdf-visual-lane__page"
              style={pageFrameStyle}
            >
              <Page
                pageNumber={frame.page}
                width={frameTransform?.renderedPageWidth ?? frame.bootstrapWidth}
                rotate={frame.rotation}
                onLoadSuccess={handlePageLoadSuccess}
                onRenderSuccess={() => {
                  if (isCurrent) handleRenderSuccess(currentFrame)
                }}
                loading={null}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </div>
          )
        })}
      </Document>

      {currentPageVisible && cropTransform && highlightRects.length > 0 && (
        <div className="source-pdf-visual-lane__highlights" aria-hidden="true">
          {highlightRects.map((rect, index) => (
            <div
              key={`${noteTarget.targetKey ?? 'target'}:${index}`}
              className={`source-pdf-visual-lane__highlight${
                noteTarget.highlight.isChord
                  ? ' source-pdf-visual-lane__highlight--chord'
                  : ''
              }${
                noteTarget.highlight.approximate
                  ? ' source-pdf-visual-lane__highlight--approximate'
                  : ''
              }${
                noteTarget.mode === 'play-along'
                  ? ' source-pdf-visual-lane__highlight--play-along'
                  : ''
              }`}
              style={{
                left: `${rect.x0}px`,
                top: `${rect.y0}px`,
                width: `${rect.x1 - rect.x0}px`,
                height: `${rect.y1 - rect.y0}px`,
              }}
              data-practice-note-target="true"
              data-practice-note-target-key={noteTarget.targetKey}
              data-practice-note-mode={noteTarget.mode}
            />
          ))}
        </div>
      )}

      {!cropTransform && (
        <div className="source-pdf-visual-lane__empty">
          <span>Preparing the source system…</span>
        </div>
      )}
    </div>
  )
}

export default memo(SourcePdfVisualLane)
