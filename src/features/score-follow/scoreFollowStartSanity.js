import { START_LOCK_THRESHOLD_SECONDS } from './scoreFollowCursor.js'
import {
  resolveFirstMeasureTrustedAnchor,
  resolveTrustedAnchorForMeasure,
} from './trustedAnchors.js'
import { getMeasureAtTime } from '../musicxml/timingQuery.js'

function buildExactCursor(anchor) {
  return {
    visible: true,
    page: anchor.page,
    x: anchor.x,
    y: anchor.y,
    measureNumber: anchor.measureNumber,
    progress: 0,
    lockExact: true,
    forcedStart: true,
  }
}

/**
 * Final gate: trusted anchors only; no nearest-neighbor fallback.
 */
export function validateScoreFollowPosition({
  timingMap,
  trustedAnchors,
  cursor,
  practiceTime,
  trust,
}) {
  if (!trust?.showCursor || !timingMap?.measures?.length || !trustedAnchors?.length) {
    return {
      ok: false,
      cursor: { visible: false },
      needsSetup: true,
      warning: null,
    }
  }

  if (practiceTime <= START_LOCK_THRESHOLD_SECONDS) {
    const startAnchor = resolveFirstMeasureTrustedAnchor(trustedAnchors, timingMap)
    if (!startAnchor) {
      return {
        ok: false,
        cursor: { visible: false },
        needsSetup: true,
        warning: null,
      }
    }
    return {
      ok: true,
      cursor: buildExactCursor(startAnchor),
      needsSetup: false,
      warning: null,
    }
  }

  if (!cursor?.visible || !cursor.lockExact) {
    return {
      ok: false,
      cursor: { visible: false },
      needsSetup: true,
      warning: null,
    }
  }

  const currentMeasure = getMeasureAtTime(timingMap, practiceTime)
  if (!currentMeasure) {
    return {
      ok: false,
      cursor: { visible: false },
      needsSetup: true,
      warning: null,
    }
  }

  const expected = resolveTrustedAnchorForMeasure(trustedAnchors, currentMeasure.number)
  if (!expected) {
    return {
      ok: false,
      cursor: { visible: false },
      needsSetup: true,
      warning: null,
    }
  }

  if (
    cursor.measureNumber !== expected.measureNumber ||
    cursor.page !== expected.page ||
    Math.abs(cursor.x - expected.x) > 0.002 ||
    Math.abs(cursor.y - expected.y) > 0.002
  ) {
    return {
      ok: false,
      cursor: { visible: false },
      needsSetup: true,
      warning: null,
    }
  }

  return {
    ok: true,
    cursor,
    needsSetup: false,
    warning: null,
  }
}

/** @deprecated */
export function resolveStartAnchor() {
  return null
}

/** @deprecated */
export function validateScoreFollowStart(args) {
  return validateScoreFollowPosition(args)
}
