import { WFY_STATUS } from '../practice/waitForYouEngine.js'
import { WFY_CHECKPOINT_MODE } from '../practice/waitForYouCheckpointMode.js'
import { mapViewerOverlayToAnalysisPoint } from '../../utils/analysisViewerCoords.js'
import { CURSOR_PRECISION } from './cursorPrecision.js'

// noteTargetPosition.js source taxonomy (string literals here to keep the
// score-follow layer free of a practice import cycle).
const LOCKABLE_NOTE_SOURCES = new Set([
  'source-notehead',
  'direct-geometry',
  'musicxml-layout',
])
const SOURCE_COORDINATE_SPACE = 'pdf-source-normalized'
const ANALYSIS_COORDINATE_SPACE = 'pdf-analysis-normalized'

/**
 * Wait For You checkpoint-locked cursor (I2).
 *
 * In WFY note mode the canonical checkpoint owns a resolved score position.
 * The shared timeline cursor keeps driving y (system-anchored bar) and all
 * non-WFY modes untouched; only the x column (and page on disagreement)
 * locks to the checkpoint so the playhead sits on the required notehead
 * instead of a time-proportional guess inside the measure.
 *
 * Two honesty guards (score-follow precision rescue):
 * 1. Coordinate spaces must match. The painted bar lives in ANALYSIS space
 *    (the overlay maps analysis -> viewer with the page rotation). A
 *    source-normalized noteTarget (exact OMR notehead) is converted with the
 *    page's viewer rotation before locking; without a known rotation the
 *    lock is refused rather than planted in the wrong place.
 * 2. Guessed positions never lock the bar. measure-beat / system-heuristic /
 *    anchor-only targets are beat/measure guesses, not note columns — the
 *    timeline cursor (correct measure + system) keeps the bar instead of
 *    jumping to a false note position.
 *
 * Pure function of engine state — never advances anything.
 */
export function resolveWfyCheckpointCursor({
  practiceMode,
  checkpointMode,
  waitForYouStatus,
  currentCheckpoint,
  noteTarget,
  scoreFollowCursor,
  pageViewRotations = null,
}) {
  const locked =
    practiceMode === 'wait-for-you' &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    waitForYouStatus === WFY_STATUS.WAITING &&
    currentCheckpoint != null &&
    noteTarget?.visible === true &&
    Number.isFinite(noteTarget.x)
  if (!locked) {
    return null
  }
  // Legacy targets (no source metadata) keep the historical lock behavior.
  if (noteTarget.source != null && !LOCKABLE_NOTE_SOURCES.has(noteTarget.source)) {
    return null
  }
  const coordinateSpace = noteTarget.coordinateSpace ?? ANALYSIS_COORDINATE_SPACE
  let lockX = noteTarget.x
  if (coordinateSpace === SOURCE_COORDINATE_SPACE) {
    const page = noteTarget.page ?? scoreFollowCursor?.page ?? 1
    const rotation = normalizeRotation(pageViewRotations?.[page])
    if (rotation == null) {
      return null
    }
    // Source space IS the pre-transform overlay plane, so the overlay point
    // is (x, noteAnchorY); invert the analysis->overlay map to get the
    // analysis column the bar must paint.
    const overlayY = Number.isFinite(noteTarget.noteAnchorY)
      ? noteTarget.noteAnchorY
      : noteTarget.y
    const analysis = mapViewerOverlayToAnalysisPoint(noteTarget.x, overlayY, rotation)
    if (!Number.isFinite(analysis?.x)) {
      return null
    }
    lockX = analysis.x
  } else if (coordinateSpace !== ANALYSIS_COORDINATE_SPACE) {
    return null
  }
  const approximate = noteTarget.approximate ?? (noteTarget.confidence ?? 1) < 0.7
  return {
    visible: Boolean(scoreFollowCursor?.visible ?? true),
    page: noteTarget.page ?? scoreFollowCursor?.page ?? 1,
    measureNumber: currentCheckpoint.measureNumber ?? scoreFollowCursor?.measureNumber ?? null,
    x: lockX,
    y: scoreFollowCursor?.y ?? noteTarget.noteAnchorY ?? noteTarget.y ?? null,
    smoothed: false,
    checkpointLocked: true,
    coordinateSpace: ANALYSIS_COORDINATE_SPACE,
    approximate,
    precision:
      noteTarget.source === 'source-notehead' || noteTarget.source === 'direct-geometry'
        ? CURSOR_PRECISION.NOTEHEAD
        : CURSOR_PRECISION.ENGRAVED_MAPPED,
  }
}

function normalizeRotation(rotation) {
  if (rotation == null) {
    return 0
  }
  const value = Number(rotation)
  if (!Number.isFinite(value)) {
    return null
  }
  const normalized = ((value % 360) + 360) % 360
  return normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : null
}
