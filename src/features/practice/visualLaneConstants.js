/** Shared Visual Practice lane constants — no timing/checkpoint imports. */

export const VISUAL_LANE_DEFAULTS = {
  /** Seconds of already-played notes kept visible behind the now line. */
  lookBehindSeconds: 3,
  /** Seconds of upcoming notes rendered ahead of the now line. */
  lookAheadSeconds: 12,
  /** Horizontal scale: seconds → staff units. */
  pixelsPerSecond: 110,
  /** Now-line position as a fraction of the lane width. */
  nowLineFraction: 0.22,
  /** Furthest right the Now bar travels during a piece/loop. */
  nowLineEndFraction: 0.82,
}

/** Display-only WFY glide duration. Matching/timing clocks are unchanged. */
export const WFY_VISUAL_MOVE_MS = 420
