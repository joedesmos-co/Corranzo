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

/**
 * Per-tone boxes for chord partial-completion coloring. Only meaningful when
 * the highlight was built from individual source noteheads
 * (renderMode 'individual-source-boxes'); otherwise returns null so the
 * overlay falls back to the whole-event highlight instead of inventing
 * per-tone coordinates. Each entry carries the tone's MIDI for mapping to
 * the checkpoint's expected tones.
 */
export function resolvePracticeTargetToneRects(noteTarget, viewerRotation = 0) {
  const highlight = noteTarget?.highlight
  if (
    !highlight ||
    highlight.renderMode !== 'individual-source-boxes' ||
    !Array.isArray(highlight.noteBoxes) ||
    highlight.noteBoxes.length === 0
  ) {
    return null
  }

  const coordinateSpace =
    highlight.coordinateSpace ??
    noteTarget.coordinateSpace
  const tones = []
  for (const box of highlight.noteBoxes) {
    const rect = mapPracticeTargetRectToOverlay(box, coordinateSpace, viewerRotation)
    if (!rect) {
      continue
    }
    tones.push({
      rect,
      midi: Number.isFinite(box.midi) ? box.midi : null,
      sourceNoteheadId: box.sourceNoteheadId ?? null,
    })
  }
  return tones.length > 0 ? tones : null
}
