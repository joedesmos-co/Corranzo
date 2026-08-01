import { staffLineGap } from './pitchFromStaffPosition.js'

/** Trailing noteheads on the last system measure can sit slightly past the barline. */
const LAST_MEASURE_X_PAD = 0.028
const DEFAULT_Y_PAD = 0.035
/** Staff-space pad so extreme ledger stacks stay in-measure (not orphaned). */
const LEDGER_STAFF_SPACE_PAD = 8

/**
 * Normalized bounds for assigning vector SMuFL noteheads to a measure.
 * Uses measure x0 (not playableX0) and a vertical pad for ledger tails.
 */
export function vectorGlyphAllocationBounds(measureBox, { isLastInSystem = false } = {}) {
  const trebleLines = measureBox?.staffLines?.treble ?? []
  const bassLines = measureBox?.staffLines?.bass ?? []
  const gap = Math.max(staffLineGap(trebleLines), staffLineGap(bassLines))
  const yPad = Math.max(DEFAULT_Y_PAD, gap > 0 ? gap * LEDGER_STAFF_SPACE_PAD : 0)

  return {
    x0: measureBox.x0,
    x1: measureBox.x1 + (isLastInSystem ? LAST_MEASURE_X_PAD : 0),
    y0: measureBox.y0 - yPad,
    y1: measureBox.y1 + yPad,
  }
}

export function vectorGlyphInMeasure(glyph, measureBox, imageData, placement = {}) {
  if (!glyph || !measureBox || !imageData?.width || !imageData?.height) {
    return false
  }
  const bounds = vectorGlyphAllocationBounds(measureBox, placement)
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  return xNorm >= bounds.x0 && xNorm <= bounds.x1 && yNorm >= bounds.y0 && yNorm <= bounds.y1
}
