import {
  mapAnalysisAxisRectToViewerOverlay,
  mapAnalysisPointToViewerOverlay,
} from '../../utils/analysisViewerCoords.js'

export const PRACTICE_TARGET_COORDINATE_SPACE = {
  PDF_SOURCE_NORMALIZED: 'pdf-source-normalized',
  PDF_ANALYSIS_NORMALIZED: 'pdf-analysis-normalized',
}

/**
 * The PDF canvas and its overlay are siblings inside the same CSS rotator.
 * Source-PDF normalized geometry therefore already belongs to the overlay's
 * pre-transform plane. Upright analysis geometry still needs the established
 * analysis -> pre-transform mapping before the shared CSS rotation is applied.
 */
export function mapPracticeTargetPointToOverlay(
  x,
  y,
  coordinateSpace,
  viewerRotation = 0,
) {
  if (coordinateSpace === PRACTICE_TARGET_COORDINATE_SPACE.PDF_SOURCE_NORMALIZED) {
    return { x, y }
  }
  if (coordinateSpace === PRACTICE_TARGET_COORDINATE_SPACE.PDF_ANALYSIS_NORMALIZED) {
    return mapAnalysisPointToViewerOverlay(x, y, viewerRotation)
  }
  return null
}

export function mapPracticeTargetRectToOverlay(
  rect,
  coordinateSpace,
  viewerRotation = 0,
) {
  if (!rect) {
    return null
  }
  if (coordinateSpace === PRACTICE_TARGET_COORDINATE_SPACE.PDF_SOURCE_NORMALIZED) {
    return rect
  }
  if (coordinateSpace === PRACTICE_TARGET_COORDINATE_SPACE.PDF_ANALYSIS_NORMALIZED) {
    return mapAnalysisAxisRectToViewerOverlay(rect, viewerRotation)
  }
  return null
}

/**
 * Exact source-owned chords render one box per owned notehead. Reconstructed
 * and legacy targets keep the existing tight union highlight.
 */
export function resolvePracticeTargetHighlightRects(noteTarget, viewerRotation = 0) {
  const highlight = noteTarget?.highlight
  if (!highlight) {
    return []
  }

  const coordinateSpace =
    highlight.coordinateSpace ??
    noteTarget.coordinateSpace
  const sourceRects =
    highlight.renderMode === 'individual-source-boxes' && highlight.noteBoxes?.length
      ? highlight.noteBoxes
      : [highlight]

  return sourceRects
    .map((rect) => mapPracticeTargetRectToOverlay(rect, coordinateSpace, viewerRotation))
    .filter(Boolean)
}
