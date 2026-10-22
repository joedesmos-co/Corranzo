import { resolveCursorMotion } from './cursorMotionTimeline.js'
import { withPrecision } from './cursorPrecision.js'
import { resolveScoreFollowCursor } from './resolveScoreFollowCursor.js'

/**
 * Single source of truth for "where is the score cursor at score time T".
 *
 * Primary path: the precomputed motion timeline (smooth, onset-locked,
 * playback-ordered). Fallback: the legacy anchor resolver for times/measures
 * the timeline does not cover (gaps with no anchor). Every consumer —
 * useScoreFollow (posed + realtime), the WFY note-target geometry lookup,
 * and the precision diagnostics — must resolve through here so the painted
 * bar, the checkpoint lock, and the measurements can never diverge.
 *
 * Returned cursor carries an honest `precision` tier:
 * - 'notehead'        exact printed notehead (OMR source geometry; today only
 *                     reachable via the WFY checkpoint lock, not the timeline)
 * - 'engraved-mapped' MusicXML engraved default-x mapped into the PDF anchor
 *                     span (same-engraving uploads; approximate otherwise)
 * - 'time-mapped'     time-proportional fallback (missing/non-monotonic
 *                     default-x)
 * - 'gap'             held/interpolated across an anchor gap (no local geometry)
 * - 'none'            cursor hidden
 *
 * Precision tiers live in cursorPrecision.js; this module only picks the
 * motion source.
 */
export function resolveDisplayCursorAtTime({
  timingMap,
  trustedAnchors,
  trust = null,
  practiceTime,
  motionTimeline = null,
}) {
  const motion = motionTimeline ? resolveCursorMotion(motionTimeline, practiceTime) : null
  if (motion) {
    return {
      ...motion,
      lockExact: false,
      interpolated: true,
      interpolationSource: `motion-timeline:${motion.segmentType ?? 'phrase'}`,
      fallbackTier: 'motion-timeline',
    }
  }
  const { cursor } = resolveScoreFollowCursor({
    timingMap,
    practiceTime,
    trustedAnchors,
    trust,
  })
  if (!cursor?.visible) {
    return { visible: false }
  }
  return withPrecision(cursor)
}


