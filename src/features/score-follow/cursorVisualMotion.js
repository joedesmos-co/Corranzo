import { clamp } from './scoreFollowEasing.js'

/** Same-system Y tolerance (matches resolveScoreFollowCursor). */
export const SAME_SYSTEM_Y_TOLERANCE = 0.02

export function systemKeyForCursor(target) {
  if (!target) {
    return ''
  }
  return `${target.page ?? 1}:${(target.y ?? 0).toFixed(4)}`
}

export function isSameSystemCursor(a, b) {
  if (!a?.visible || !b?.visible) {
    return false
  }
  if (a.page !== b.page) {
    return false
  }
  return Math.abs((a.y ?? 0) - (b.y ?? 0)) < SAME_SYSTEM_Y_TOLERANCE
}

/** Hard right edge for the current system — cursor must not render past this. */
export function resolveVisualMaxX(target) {
  if (!target) {
    return null
  }
  const systemEndX =
    typeof target.meta?.systemEndX === 'number' && Number.isFinite(target.meta.systemEndX)
      ? target.meta.systemEndX
      : null
  // Same-system measure boundary: visualMaxX already encodes the bridge target
  // (the next measure's first onset on this system) and is the authoritative
  // cap. The current measure's playableEndX is NOT a hard edge here, so it must
  // not clamp the bridge motion — only the true system edge stays a hard cap.
  if (
    target.nextSameSystem &&
    typeof target.visualMaxX === 'number' &&
    Number.isFinite(target.visualMaxX)
  ) {
    return systemEndX != null ? Math.min(target.visualMaxX, systemEndX) : target.visualMaxX
  }
  const candidates = [target.visualMaxX, target.playableEndX, systemEndX].filter(
    (value) => typeof value === 'number' && Number.isFinite(value),
  )
  if (!candidates.length) {
    return null
  }
  return Math.min(...candidates)
}

export function isNearSystemEnd(target, epsilon = 0.003) {
  // A same-system measure boundary is NOT a system end — the cursor bridges
  // continuously into the next measure, so predictive motion stays enabled.
  // The hard system-end behavior only applies at an actual system/page break.
  if (target?.nextSameSystem) {
    return false
  }
  const maxX = resolveVisualMaxX(target)
  if (maxX == null || !Number.isFinite(target?.x)) {
    return false
  }
  return target.x >= maxX - epsilon
}

/**
 * Visual cursor position. The musical x is already onset-locked — it reaches each
 * notehead exactly when the note sounds — so the display tracks it with NO
 * predictive lead. A lead made the cursor reach noteheads before they played
 * (a fixed x-lead becomes a large TIME lead in slow/sparse passages). The display
 * is simply the musical x, capped at the system edge.
 */
export function applyVisualCursorX({ displayX, musicalX, sameSystem = true, visualMaxX = null }) {
  if (!Number.isFinite(musicalX)) {
    return displayX
  }
  if (!sameSystem) {
    return musicalX
  }
  return visualMaxX != null ? Math.min(musicalX, visualMaxX) : musicalX
}

export function shouldUseVisualCursorMotion(target) {
  if (!target?.visible) {
    return false
  }
  if (target.lockExact || target.forcedStart) {
    return false
  }
  if (isNearSystemEnd(target)) {
    return false
  }
  const mode = target.progressMode ?? ''
  return (
    mode.includes('bridge') ||
    mode.includes('interpolate') ||
    mode === 'lookahead-glide' ||
    mode === 'beat-linear' ||
    mode === 'beat-gap'
  )
}

export function smoothstep(local) {
  const t = clamp(local, 0, 1)
  return t * t * (3 - 2 * t)
}
