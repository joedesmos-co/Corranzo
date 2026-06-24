import { clamp } from './scoreFollowEasing.js'

/** Lookahead for predictive visual creep (no trailing lag behind current musical x). */
export const VISUAL_LOOKAHEAD_SECONDS = 0.055

/** Max display lead ahead of current musical x (normalized page coords). */
export const VISUAL_MAX_LEAD_X = 0.0045

/** Onset correction — snap display to exact notehead within this window. */
export const VISUAL_ONSET_LOCK_SECONDS = 0.002

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
  const candidates = [target.visualMaxX, target.playableEndX, target.meta?.systemEndX].filter(
    (value) => typeof value === 'number' && Number.isFinite(value),
  )
  if (!candidates.length) {
    return null
  }
  return Math.min(...candidates)
}

export function isNearSystemEnd(target, epsilon = 0.003) {
  const maxX = resolveVisualMaxX(target)
  if (maxX == null || !Number.isFinite(target?.x)) {
    return false
  }
  return target.x >= maxX - epsilon
}

/**
 * Forward-only visual layer: preserves musical onset timing but eases velocity
 * dips using a tiny predictive lead, then corrects exactly at onsets.
 */
export function applyVisualCursorX({
  displayX,
  musicalX,
  musicalAheadX,
  atOnset = false,
  sameSystem = true,
  visualMaxX = null,
  allowPredictiveLead = true,
}) {
  if (!Number.isFinite(musicalX)) {
    return displayX
  }

  if (!sameSystem) {
    return musicalX
  }

  let cappedMusicalX = musicalX
  if (visualMaxX != null) {
    cappedMusicalX = Math.min(cappedMusicalX, visualMaxX)
  }

  if (atOnset) {
    return cappedMusicalX
  }

  let x = Number.isFinite(displayX) ? displayX : cappedMusicalX

  if (cappedMusicalX > x) {
    x = cappedMusicalX
  }

  if (!allowPredictiveLead) {
    if (visualMaxX != null) {
      x = Math.min(x, visualMaxX)
    }
    return Math.max(Number.isFinite(displayX) ? Math.min(displayX, visualMaxX ?? displayX) : x, x)
  }

  const aheadX = Number.isFinite(musicalAheadX) ? musicalAheadX : cappedMusicalX
  const cappedAheadX =
    visualMaxX != null ? Math.min(aheadX, visualMaxX) : aheadX
  const leadRoom = cappedAheadX - cappedMusicalX

  if (leadRoom > 1e-6 && cappedAheadX > x) {
    const creep = Math.min(leadRoom * 0.42, VISUAL_MAX_LEAD_X)
    x = Math.max(x, Math.min(cappedMusicalX + creep, cappedAheadX))
  }

  if (visualMaxX != null) {
    x = Math.min(x, visualMaxX)
  } else {
    x = Math.min(x, cappedMusicalX + VISUAL_MAX_LEAD_X)
  }

  if (Number.isFinite(displayX)) {
    x = Math.max(Math.min(displayX, visualMaxX ?? displayX), x)
  }

  return x
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
