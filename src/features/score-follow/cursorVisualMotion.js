import { clamp } from './scoreFollowEasing.js'

/**
 * Predictive lead, expressed in TIME (not a fixed x distance). The display eases
 * toward the musical target sampled this far in the future, so the cursor is at
 * most ~this-many-ms ahead of the note regardless of tempo/spacing — slow/sparse
 * passages can no longer drift 0.1–1s early the way a fixed-x lead did.
 */
export const VISUAL_LEAD_SECONDS = 0.02

/** Per-frame follow factor for the bounded correction layer (eases velocity changes). */
export const VISUAL_SMOOTH_ALPHA = 0.45

/**
 * Sub-pixel snap: once the follower is within this of the target, jump exactly to
 * it. Kills the exponential's slow asymptotic tail so the cursor lands crisply on
 * noteheads (otherwise fast passages read as ~1px / tens-of-ms behind). ~1px on a
 * ~1000px-wide page.
 */
export const VISUAL_SNAP_X = 0.0012

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
 * Bounded visual follower (the "correction layer"). The musical x is the exact,
 * onset-locked target. The display eases toward a SMALL time-lead of that target
 * (`musicalAheadX` = musical x at now + VISUAL_LEAD_SECONDS), which keeps motion
 * smooth and natural while guaranteeing the cursor is never more than ~that-lead
 * ahead of the note — a TIME cap, not a fixed-x cap, so slow/sparse passages no
 * longer drift seconds early. The exponential follow eases the velocity changes
 * at onsets (so held → fast transitions don't snap). Forward-only within a system;
 * across systems it tracks the new-system musical x directly (no old/new x blend).
 */
export function applyVisualCursorX({
  displayX,
  musicalX,
  musicalAheadX,
  sameSystem = true,
  visualMaxX = null,
}) {
  if (!Number.isFinite(musicalX)) {
    return displayX
  }
  const cap = (value) => (visualMaxX != null ? Math.min(value, visualMaxX) : value)

  if (!sameSystem) {
    // New system / line break — never blend the old-system x with the new one.
    return cap(musicalX)
  }

  const nowX = cap(musicalX)
  // Time-capped lead target: musical x a few ms ahead. Falls back to the current
  // x when there is no valid forward same-system lookahead (e.g. near a line end).
  const leadTarget =
    Number.isFinite(musicalAheadX) && musicalAheadX > nowX ? cap(musicalAheadX) : nowX

  if (!Number.isFinite(displayX)) {
    return leadTarget
  }
  const prev = cap(displayX)
  const leadActive = leadTarget - nowX > 1e-6

  // Ease toward the lead target (bounded correction layer). Net position lands
  // ≈ on the exact musical x with smoothed velocity; it can never exceed the
  // time-capped lead target, and never steps backward within a system.
  let x = prev + (leadTarget - prev) * VISUAL_SMOOTH_ALPHA
  x = Math.min(x, leadTarget)
  x = Math.max(x, prev)
  // When motion flattens (held note / measure end → no active lead), close the
  // exponential's slow asymptotic tail to the EXACT note x so the cursor lands
  // crisply instead of crawling the last pixel behind. Never snaps ahead.
  if (!leadActive && nowX - x > 0 && nowX - x <= VISUAL_SNAP_X) {
    x = nowX
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
