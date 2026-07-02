import { memo, useCallback, useRef } from 'react'
import {
  mapAnalysisAxisRectToViewerOverlay,
  mapAnalysisPointToViewerOverlay,
} from '../../utils/analysisViewerCoords.js'
import useScoreFollowCursorElement from '../../features/score-follow/useScoreFollowCursorElement.js'
import {
  ANCHOR_SOURCE,
  isAutomaticAnchorSource,
  normalizeAnchorSource,
} from '../../features/score-follow/anchorUtils.js'

function clientToNormalized(clientX, clientY, rect) {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  }
}

function scoreFollowOverlayPropsEqual(prev, next) {
  if (prev.pageNumber !== next.pageNumber) return false
  if (prev.alignmentMode !== next.alignmentMode) return false
  if (prev.semiAutoPreview !== next.semiAutoPreview) return false
  if (prev.showAnchorMarkers !== next.showAnchorMarkers) return false
  if (prev.showSystemBands !== next.showSystemBands) return false
  if (prev.showNoteTarget !== next.showNoteTarget) return false
  if (prev.placementMeasureNumber !== next.placementMeasureNumber) return false
  if (prev.cursorVisibility?.show !== next.cursorVisibility?.show) return false
  if (prev.pageSystems !== next.pageSystems) return false
  if (prev.anchors !== next.anchors) return false
  if (prev.systemStartMode !== next.systemStartMode) return false
  if (prev.systemStartMarks !== next.systemStartMarks) return false
  if (prev.showCandidateAnchors !== next.showCandidateAnchors) return false
  if (prev.candidateAnchors !== next.candidateAnchors) return false
  if (prev.viewerRotation !== next.viewerRotation) return false
  const pc = prev.cursor
  const nc = next.cursor
  if (pc?.visible !== nc?.visible) return false
  if (pc?.page !== nc?.page) return false
  if (pc?.smoothed !== nc?.smoothed) return false
  const pt = prev.noteTarget
  const nt = next.noteTarget
  if (pt?.targetKey !== nt?.targetKey) return false
  if (pt?.page !== nt?.page) return false
  if (pt?.displayMode !== nt?.displayMode) return false
  if (pt?.x !== nt?.x || pt?.y !== nt?.y) return false
  if (pt?.highlight?.x0 !== nt?.highlight?.x0) return false
  if (pt?.highlight?.y0 !== nt?.highlight?.y0) return false
  if (pt?.highlight?.x1 !== nt?.highlight?.x1) return false
  if (pt?.highlight?.y1 !== nt?.highlight?.y1) return false
  return true
}

function ScoreFollowOverlay({
  pageNumber,
  alignmentMode,
  semiAutoPreview = false,
  showAnchorMarkers = false,
  showSystemBands = false,
  pageSystems = [],
  placementMeasureNumber,
  cursorVisibility,
  cursor,
  noteTarget = null,
  showNoteTarget = false,
  anchors,
  onPlaceAnchor,
  systemStartMode = false,
  systemStartMarks = [],
  onPlaceSystemStart,
  // Phase 4 (flag-gated, debug-only): generated candidate anchors. These NEVER
  // drive the cursor — they are a diagnostic overlay shown only when opted in.
  candidateAnchors = null,
  showCandidateAnchors = false,
  getPageViewRotation,
  viewerRotation = 0,
}) {
  const layerRef = useRef(null)
  const cursorRef = useRef(null)

  const showCursor = cursorVisibility?.show ?? false
  useScoreFollowCursorElement({
    elementRef: cursorRef,
    pageNumber,
    showCursor,
    getPageViewRotation: getPageViewRotation,
  })
  const pageAnchors = anchors.filter((anchor) => anchor.page === pageNumber)
  const pageSystemStartMarks = systemStartMarks.filter((m) => m.page === pageNumber)
  const pageCandidateAnchors =
    showCandidateAnchors && Array.isArray(candidateAnchors)
      ? candidateAnchors.filter((anchor) => anchor.page === pageNumber)
      : []
  const hasCandidates = pageCandidateAnchors.length > 0
  const hasBands = showSystemBands && pageSystems.length > 0
  // Auto "guide" dots only belong while actively aligning or reviewing the auto
  // preview. In plain practice / setup-panel views they are diagnostic markers
  // that can drift, so show only user-placed (manual) markers there.
  const showAutoMarkers = alignmentMode || semiAutoPreview
  const markerAnchors = showAutoMarkers
    ? pageAnchors
    : pageAnchors.filter((anchor) => normalizeAnchorSource(anchor) === ANCHOR_SOURCE.MANUAL)
  const hasMarkers = showAnchorMarkers && markerAnchors.length > 0
  const hasSystemStartMarks = systemStartMode && pageSystemStartMarks.length > 0
  const cursorSmoothed = cursor?.smoothed ?? false

  const noteTargetOnPage =
    showNoteTarget && noteTarget?.visible && noteTarget.page === pageNumber
  const noteHighlightOverlay =
    noteTargetOnPage && noteTarget.highlight
      ? mapAnalysisAxisRectToViewerOverlay(
          noteTarget.highlight,
          viewerRotation,
        )
      : null
  const noteFallbackOverlay =
    noteTargetOnPage && !noteHighlightOverlay
      ? mapAnalysisPointToViewerOverlay(
          noteTarget.x,
          noteTarget.y,
          viewerRotation,
        )
      : null

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== 0) {
        return
      }
      const rect = layerRef.current?.getBoundingClientRect()
      if (!rect?.width) {
        return
      }
      const { x, y } = clientToNormalized(event.clientX, event.clientY, rect)

      if (systemStartMode && onPlaceSystemStart) {
        event.preventDefault()
        event.stopPropagation()
        onPlaceSystemStart(pageNumber, x, y)
        return
      }
      if (alignmentMode && onPlaceAnchor) {
        event.preventDefault()
        event.stopPropagation()
        onPlaceAnchor(pageNumber, x, y)
      }
    },
    [alignmentMode, onPlaceAnchor, systemStartMode, onPlaceSystemStart, pageNumber],
  )

  if (
    !alignmentMode &&
    !systemStartMode &&
    !showCursor &&
    !noteTargetOnPage &&
    !hasBands &&
    !hasMarkers &&
    !hasCandidates
  ) {
    return null
  }

  return (
    <div
      ref={layerRef}
      className={`score-follow-overlay${alignmentMode ? ' score-follow-overlay--align' : ''}${
        systemStartMode ? ' score-follow-overlay--system-start' : ''
      }${semiAutoPreview ? ' score-follow-overlay--semi-auto-preview' : ''}`}
      onPointerDown={alignmentMode || systemStartMode ? handlePointerDown : undefined}
    >
      {hasBands &&
        pageSystems.map((system) => (
          <div
            key={system.id}
            className="score-follow-overlay__system-band"
            style={{
              left: `${system.x0 * 100}%`,
              top: `${system.y0 * 100}%`,
              width: `${(system.x1 - system.x0) * 100}%`,
              height: `${(system.y1 - system.y0) * 100}%`,
            }}
            title={system.label}
          >
            <span className="score-follow-overlay__system-band-label">{system.label}</span>
          </div>
        ))}

      {hasMarkers &&
        markerAnchors.map((anchor) => {
          const isAuto =
            isAutomaticAnchorSource(anchor.source) &&
            normalizeAnchorSource(anchor) !== ANCHOR_SOURCE.MANUAL
          const isPreview = semiAutoPreview
          const isNext =
            alignmentMode && anchor.measureNumber === placementMeasureNumber
          const role = anchor.meta?.role
          return (
            <span
              key={anchor.id}
              className={`score-follow-overlay__anchor-marker${
                alignmentMode
                  ? ' score-follow-overlay__anchor-marker--align'
                  : isPreview
                    ? ' score-follow-overlay__anchor-marker--preview'
                    : ' score-follow-overlay__anchor-marker--setup'
              }${isAuto ? ' score-follow-overlay__anchor-marker--auto' : ' score-follow-overlay__anchor-marker--manual'}${
                isNext ? ' score-follow-overlay__anchor-marker--next' : ''
              }${role === 'system-end' ? ' score-follow-overlay__anchor-marker--system-end' : ''}`}
              style={{
                left: `${anchor.x * 100}%`,
                top: `${anchor.y * 100}%`,
              }}
              title={`Measure ${anchor.measureNumber}${role ? ` (${role})` : ''}${isAuto ? ` · ${anchor.source ?? 'auto'}` : ''}`}
            />
          )
        })}

      {hasCandidates &&
        pageCandidateAnchors.map((anchor) => (
          <span
            key={anchor.id}
            className="score-follow-overlay__candidate-marker"
            style={{
              left: `${anchor.x * 100}%`,
              top: `${anchor.y * 100}%`,
            }}
            title={`Candidate m${anchor.measureNumber}${anchor.trust ? ` · ${anchor.trust}` : ''} (diagnostic)`}
          />
        ))}

      {showCursor && (
        <div
          ref={cursorRef}
          className={`score-follow-cursor${cursorSmoothed ? ' score-follow-cursor--active' : ''}`}
          style={{ display: 'none' }}
          aria-hidden
        >
          <span className="score-follow-cursor__line" />
        </div>
      )}

      {noteHighlightOverlay && (
        <div
          className={`score-follow-overlay__note-highlight${
            noteTarget.highlight.isChord ? ' score-follow-overlay__note-highlight--chord' : ''
          }${
            noteTarget.highlight.approximate ? ' score-follow-overlay__note-highlight--approximate' : ''
          }`}
          style={{
            left: `${noteHighlightOverlay.x0 * 100}%`,
            top: `${noteHighlightOverlay.y0 * 100}%`,
            width: `${(noteHighlightOverlay.x1 - noteHighlightOverlay.x0) * 100}%`,
            height: `${(noteHighlightOverlay.y1 - noteHighlightOverlay.y0) * 100}%`,
          }}
          role="img"
          aria-label={`Target note${noteTarget.isChord ? ' chord' : ''} highlight at measure ${noteTarget.measureNumber ?? ''}`}
        />
      )}

      {noteFallbackOverlay && (
        <div
          className={`score-follow-overlay__note-target score-follow-overlay__note-target--compact${
            noteTarget.isWideChord
              ? ' score-follow-overlay__note-target--wide-chord'
              : noteTarget.isChord
                ? ' score-follow-overlay__note-target--chord'
                : ''
          }`}
          style={{
            left: `${noteFallbackOverlay.x * 100}%`,
            top: `${noteFallbackOverlay.y * 100}%`,
          }}
          role="img"
          aria-label={`Approximate target note${noteTarget.isChord ? ' chord' : ''} marker at measure ${noteTarget.measureNumber ?? ''}`}
        >
          <span className="score-follow-overlay__note-target-ring" />
          <span className="score-follow-overlay__note-target-dot" />
        </div>
      )}

      {hasSystemStartMarks &&
        pageSystemStartMarks.map((mark, idx) => (
          <span
            key={mark.id}
            className="score-follow-overlay__system-start-mark"
            style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
            title={`System ${idx + 1}`}
          >
            <span className="score-follow-overlay__system-start-label">{idx + 1}</span>
          </span>
        ))}

      {alignmentMode && (
        <p className="score-follow-overlay__align-hint">
          Tap measure {placementMeasureNumber ?? '—'} start · <kbd>Enter</kbd> skip ·{' '}
          <kbd>⌫</kbd> undo · <kbd>Esc</kbd> done
        </p>
      )}

      {systemStartMode && (
        <p className="score-follow-overlay__align-hint score-follow-overlay__align-hint--system-start">
          Tap the start of each staff line · <kbd>⌫</kbd> undo · <kbd>Esc</kbd> cancel
        </p>
      )}

      {semiAutoPreview && (
        <p className="score-follow-overlay__align-hint score-follow-overlay__align-hint--semi-auto">
          Shaded regions = detected staff systems · cyan dots = rough guides (not every measure)
        </p>
      )}
    </div>
  )
}

export default memo(ScoreFollowOverlay, scoreFollowOverlayPropsEqual)
