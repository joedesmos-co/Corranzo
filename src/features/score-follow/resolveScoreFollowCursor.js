import { getMeasureAtTime } from '../musicxml/timingQuery.js'
import {
  getAnchorPlaybackTime,
  getMeasurePlaybackWindow,
  getPerformedBeats,
  getPlaybackDurationSeconds,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import {
  dedupeTrustedAnchorsByMeasure,
  resolveFirstMeasureTrustedAnchor,
  resolveTrustedAnchorForMeasure,
} from './trustedAnchors.js'
import { sortAnchorsByMeasure } from './anchorSort.js'
import { clamp, lerp } from './scoreFollowEasing.js'
import { resolveMusicalXInMeasure } from './cursorMusicalProgress.js'

/** Brief start lock — only until the first audible beat, not a full quarter note. */
export const START_LOCK_THRESHOLD_SECONDS = 0.05

const PAGE_TRANSITION_PROGRESS = 0.88

function findAnchorBracket(sorted, timingMap, practiceTime) {
  let beforeIndex = -1
  let afterIndex = -1

  for (let index = 0; index < sorted.length; index += 1) {
    const anchorTime = getAnchorPlaybackTime(timingMap, sorted[index].measureNumber, practiceTime)
    if (anchorTime == null) {
      if (afterIndex === -1 && beforeIndex >= 0) {
        afterIndex = index
      }
      continue
    }
    if (anchorTime <= practiceTime + 0.02) {
      beforeIndex = index
      afterIndex = -1
    } else if (afterIndex === -1) {
      afterIndex = index
      break
    }
  }

  return { beforeIndex, afterIndex }
}

function beatWeightedProgress(timingMap, practiceTime, t0, t1) {
  if (t1 <= t0) {
    return 0
  }

  const beats = (usesPerformedTimeline(timingMap) ? getPerformedBeats(timingMap) : timingMap.beats).filter(
    (beat) => beat.timeSeconds >= t0 - 0.001 && beat.timeSeconds <= t1 + 0.001,
  )

  if (beats.length < 2) {
    return clamp((practiceTime - t0) / (t1 - t0), 0, 1)
  }

  for (let index = 0; index < beats.length - 1; index += 1) {
    const beatStart = beats[index].timeSeconds
    const beatEnd = beats[index + 1].timeSeconds
    if (practiceTime >= beatStart && practiceTime < beatEnd) {
      const segmentProgress =
        beatEnd > beatStart ? (practiceTime - beatStart) / (beatEnd - beatStart) : 0
      return clamp((index + segmentProgress) / (beats.length - 1), 0, 1)
    }
  }

  return 1
}

function interpolateBetweenAnchors(timingMap, practiceTime, before, after, currentMeasure) {
  const t0 =
    getAnchorPlaybackTime(timingMap, before.measureNumber, practiceTime) ?? before.measureNumber
  let t1 = getAnchorPlaybackTime(timingMap, after.measureNumber, practiceTime)
  if (t1 == null || t1 <= t0) {
    const window = getMeasurePlaybackWindow(timingMap, currentMeasure.number, practiceTime)
    t1 = window?.endTimeSeconds ?? getPlaybackDurationSeconds(timingMap)
  }

  const progress = beatWeightedProgress(timingMap, practiceTime, t0, t1)

  return {
    visible: true,
    page:
      before.page === after.page
        ? before.page
        : progress >= PAGE_TRANSITION_PROGRESS
          ? after.page
          : before.page,
    x: lerp(before.x, after.x, progress),
    y: lerp(before.y, after.y, progress),
    measureNumber: currentMeasure.number,
    progress,
    lockExact: false,
    interpolated: true,
    progressMode: 'beat-gap',
    confidence: 'interpolated',
    transitionPage: after.page,
  }
}

/**
 * Single cursor resolver: exact anchor when present, interpolation across gaps,
 * start-lock only at t ≤ threshold. Gaps never flip needsSetup.
 */
export function resolveScoreFollowCursor({
  timingMap,
  practiceTime,
  trustedAnchors,
  trust = null,
}) {
  const deduped = dedupeTrustedAnchorsByMeasure(trustedAnchors)

  if (!timingMap?.measures?.length || deduped.length === 0) {
    return {
      cursor: { visible: false },
      needsSetup: trust?.needsSetup ?? true,
      confidence: 'none',
    }
  }

  if (trust && !trust.showCursor) {
    return {
      cursor: { visible: false },
      needsSetup: trust.needsSetup ?? true,
      confidence: 'none',
    }
  }

  if (practiceTime <= START_LOCK_THRESHOLD_SECONDS) {
    const startAnchor = resolveFirstMeasureTrustedAnchor(trustedAnchors, timingMap)
    if (!startAnchor) {
      return { cursor: { visible: false }, needsSetup: trust?.needsSetup ?? true, confidence: 'none' }
    }
    return {
      cursor: {
        visible: true,
        page: startAnchor.page,
        x: startAnchor.x,
        y: startAnchor.y,
        measureNumber: startAnchor.measureNumber,
        progress: 0,
        lockExact: true,
        forcedStart: true,
        interpolated: false,
        confidence: 'exact',
      },
      needsSetup: trust?.needsSetup ?? false,
      confidence: 'exact',
    }
  }

  const currentMeasure = getMeasureAtTime(timingMap, practiceTime)
  if (!currentMeasure) {
    return { cursor: { visible: false }, needsSetup: trust?.needsSetup ?? false, confidence: 'none' }
  }

  const exact = resolveTrustedAnchorForMeasure(trustedAnchors, currentMeasure.number)
  if (exact) {
    // Intra-measure glide: advance x within the measure toward a glide target so
    // the cursor moves continuously instead of stalling, then snapping.
    //   - next measure on the SAME system → glide toward it.
    //   - last measure of a system → glide toward the system's right edge
    //     (systemEndX), so it reaches the end before dropping to the next line.
    // The target is always to the RIGHT of exact.x (forward only), so x stays
    // monotonic within the measure — no backward jitter.
    const nextAnchor = resolveTrustedAnchorForMeasure(
      trustedAnchors,
      currentMeasure.number + 1,
    )
    const nextSameSystem = Boolean(
      nextAnchor &&
        nextAnchor.page === exact.page &&
        Math.abs(nextAnchor.y - exact.y) < 0.02,
    )
    // Glide within the CURRENT measure's own visual span (playableStartX →
    // playableEndX). This keeps beat 1 at the measure's first-note x and sweeps
    // only across that measure — later measures don't inherit measure 1's clef
    // padding. Falls back to the next measure's x, then the system end.
    let glideTargetX = null
    if (typeof exact.meta?.playableEndX === 'number' && exact.meta.playableEndX > exact.x) {
      glideTargetX = exact.meta.playableEndX
    } else if (nextSameSystem && nextAnchor.x > exact.x) {
      glideTargetX = nextAnchor.x
    } else if (typeof exact.meta?.systemEndX === 'number' && exact.meta.systemEndX > exact.x) {
      glideTargetX = exact.meta.systemEndX
    }

    if (glideTargetX != null) {
      const measureBridge =
        nextSameSystem && nextAnchor
          ? {
              measureNumber: nextAnchor.measureNumber,
              xStart: nextAnchor.x,
              xEnd:
                typeof nextAnchor.meta?.playableEndX === 'number' &&
                nextAnchor.meta.playableEndX > nextAnchor.x
                  ? nextAnchor.meta.playableEndX
                  : nextAnchor.x + 0.08,
            }
          : null
      const musical = resolveMusicalXInMeasure({
        timingMap,
        practiceTime,
        measureNumber: currentMeasure.number,
        xStart: exact.x,
        xEnd: glideTargetX,
        measureBridge,
      })
      if (musical) {
        const systemEndX =
          typeof exact.meta?.systemEndX === 'number' ? exact.meta.systemEndX : null
        const visualMaxX =
          systemEndX != null && !nextSameSystem
            ? Math.min(glideTargetX, systemEndX)
            : glideTargetX
        return {
          cursor: {
            visible: true,
            page: exact.page,
            x: musical.x,
            y: exact.y,
            measureNumber: exact.measureNumber,
            progress: musical.progress,
            lockExact: false,
            interpolated: !musical.atOnset,
            atOnset: musical.atOnset,
            progressMode: musical.mode,
            meta: exact.meta,
            anchorBeat1X: exact.x,
            playableEndX: glideTargetX,
            visualMaxX,
            nextSameSystem,
            confidence: 'exact',
          },
          needsSetup: trust?.needsSetup ?? false,
          confidence: 'exact',
        }
      }
    }

    return {
      cursor: {
        visible: true,
        page: exact.page,
        x: exact.x,
        y: exact.y,
        measureNumber: exact.measureNumber,
        progress: 0,
        lockExact: false,
        interpolated: false,
        confidence: 'exact',
      },
      needsSetup: trust?.needsSetup ?? false,
      confidence: 'exact',
    }
  }

  const sorted = sortAnchorsByMeasure(deduped, timingMap, practiceTime)
  const { beforeIndex, afterIndex } = findAnchorBracket(sorted, timingMap, practiceTime)
  const before = beforeIndex >= 0 ? sorted[beforeIndex] : null
  const after = afterIndex >= 0 ? sorted[afterIndex] : null

  if (before && after) {
    return {
      cursor: interpolateBetweenAnchors(timingMap, practiceTime, before, after, currentMeasure),
      needsSetup: trust?.needsSetup ?? false,
      confidence: 'interpolated',
    }
  }

  if (before) {
    return {
      cursor: {
        visible: true,
        page: before.page,
        x: before.x,
        y: before.y,
        measureNumber: currentMeasure.number,
        progress: 0,
        lockExact: false,
        interpolated: true,
        confidence: 'hold',
      },
      needsSetup: trust?.needsSetup ?? false,
      confidence: 'hold',
    }
  }

  return { cursor: { visible: false }, needsSetup: trust?.needsSetup ?? false, confidence: 'none' }
}
