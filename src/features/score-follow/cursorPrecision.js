/**
 * Honest cursor precision taxonomy (S3: never pretend precision is exact).
 *
 * - 'notehead'        exact printed notehead (OMR source geometry; today only
 *                     reachable via the WFY checkpoint lock, not the timeline)
 * - 'engraved-mapped' MusicXML engraved default-x mapped into the PDF anchor
 *                     span (same-engraving uploads; approximate otherwise)
 * - 'time-mapped'     time-proportional fallback (missing/non-monotonic
 *                     default-x)
 * - 'gap'             held/interpolated across an anchor gap (no local geometry)
 * - 'none'            cursor hidden
 */
export const CURSOR_PRECISION = {
  NOTEHEAD: 'notehead',
  ENGRAVED_MAPPED: 'engraved-mapped',
  TIME_MAPPED: 'time-mapped',
  GAP: 'gap',
  NONE: 'none',
}

export function precisionForLegacyCursor(cursor) {
  if (!cursor?.visible) {
    return CURSOR_PRECISION.NONE
  }
  if (cursor.precision) {
    return cursor.precision
  }
  if (cursor.lockExact || cursor.forcedStart) {
    return CURSOR_PRECISION.ENGRAVED_MAPPED
  }
  const tier = cursor.fallbackTier ?? ''
  if (tier.startsWith('gap-') || tier === 'hold-previous-anchor') {
    return CURSOR_PRECISION.GAP
  }
  if (cursor.geometry === 'time') {
    return CURSOR_PRECISION.TIME_MAPPED
  }
  if (cursor.geometry === 'engraved') {
    return CURSOR_PRECISION.ENGRAVED_MAPPED
  }
  const mode = cursor.progressMode ?? cursor.mode ?? ''
  if (mode === 'beat-linear' || mode === 'beat-interpolate' || mode === 'beat-gap') {
    return CURSOR_PRECISION.TIME_MAPPED
  }
  // Legacy exact-measure-box path without geometry provenance: the x came
  // from engraved default-x when available, else time. Call it mapped, not
  // exact — only printed noteheads earn 'notehead'.
  if (tier === 'exact-measure-box' || tier === 'motion-timeline') {
    return CURSOR_PRECISION.ENGRAVED_MAPPED
  }
  return CURSOR_PRECISION.TIME_MAPPED
}

export function withPrecision(cursor) {
  if (!cursor?.visible) {
    return cursor ?? { visible: false }
  }
  if (cursor.precision) {
    return cursor
  }
  return { ...cursor, precision: precisionForLegacyCursor(cursor) }
}
