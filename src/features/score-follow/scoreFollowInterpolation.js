import { getBeatAtTime, getMeasureAtTime } from '../musicxml/timingQuery.js'
import { getBeatsForMeasure } from '../musicxml/beatNavigation.js'
import {
  getAnchorPlaybackTime,
  getMeasurePlaybackWindow,
  getPerformedBeats,
  getPlaybackDurationSeconds,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import { clamp, lerp, smoothstep, smootherstep } from './scoreFollowEasing.js'
export { clamp, lerp }

export function sortAnchorsByMeasure(anchors, timingMap, practiceTime = 0) {
  return [...anchors].sort((left, right) => {
    const timeLeft =
      getAnchorPlaybackTime(timingMap, left.measureNumber, practiceTime) ??
      Number.POSITIVE_INFINITY
    const timeRight =
      getAnchorPlaybackTime(timingMap, right.measureNumber, practiceTime) ??
      Number.POSITIVE_INFINITY
    if (timeLeft !== timeRight) {
      return timeLeft - timeRight
    }
    return left.measureNumber - right.measureNumber
  })
}

function isDenseMeasurePair(before, after) {
  if (before.page !== after.page) {
    return false
  }
  if (after.measureNumber - before.measureNumber !== 1) {
    return false
  }
  const denseRoles = new Set(['measure'])
  const beforeRole = before.meta?.role
  const afterRole = after.meta?.role
  if (denseRoles.has(beforeRole) && denseRoles.has(afterRole)) {
    return true
  }
  if (beforeRole === 'measure' || afterRole === 'measure') {
    return Math.abs(before.y - after.y) < 0.05
  }
  return false
}

function isSystemSpanSweep(before, after) {
  if (isDenseMeasurePair(before, after)) {
    return false
  }
  if (before.page !== after.page) {
    return false
  }
  if (Math.abs(before.y - after.y) > 0.06) {
    return false
  }
  if (after.x <= before.x + 0.06) {
    return false
  }
  const beforeRole = before.meta?.role
  const afterRole = after.meta?.role
  if (beforeRole === 'system-start' && afterRole === 'system-end') {
    return before.meta?.systemIndex === after.meta?.systemIndex
  }
  return after.x - before.x > 0.15 && Math.abs(before.y - after.y) < 0.04
}

function clampToStaffCorridor(x, y, anchorBefore, anchorAfter) {
  const yMin = Math.min(anchorBefore.y, anchorAfter.y) - 0.015
  const yMax = Math.max(anchorBefore.y, anchorAfter.y) + 0.015
  const xMin = Math.min(anchorBefore.x, anchorAfter.x) - 0.01
  const xMax = Math.max(anchorBefore.x, anchorAfter.x) + 0.01
  return {
    x: clamp(x, Math.max(0.02, xMin), Math.min(0.98, xMax)),
    y: clamp(y, Math.max(0.08, yMin), Math.min(0.95, yMax)),
  }
}

function interpolateAcrossPages(anchorBefore, anchorAfter, linearProgress) {
  const t = smootherstep(linearProgress)
  const handoff = 0.88

  if (t < handoff) {
    const local = smoothstep(t / handoff)
    return {
      page: anchorBefore.page,
      x: lerp(anchorBefore.x, Math.min(0.96, anchorBefore.x + 0.12), local),
      y: anchorBefore.y,
    }
  }

  const local = smoothstep((t - handoff) / (1 - handoff))
  return {
    page: anchorAfter.page,
    x: lerp(Math.max(0.04, anchorAfter.x - 0.12), anchorAfter.x, local),
    y: lerp(anchorBefore.y, anchorAfter.y, local),
  }
}

/**
 * Progress along playback time using beat checkpoints (musical) instead of measure starts only.
 */
function computeBeatWeightedProgress(timingMap, practiceTime, t0, t1) {
  if (t1 <= t0) {
    return 0
  }

  const beats = (usesPerformedTimeline(timingMap) ? getPerformedBeats(timingMap) : timingMap.beats).filter(
    (beat) => beat.timeSeconds >= t0 - 0.001 && beat.timeSeconds <= t1 + 0.001,
  )

  if (beats.length < 2) {
    return clamp((practiceTime - t0) / (t1 - t0), 0, 1)
  }

  if (practiceTime <= beats[0].timeSeconds) {
    return 0
  }
  if (practiceTime >= beats[beats.length - 1].timeSeconds) {
    return 1
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

function resolveSegmentEndTime(timingMap, practiceTime, anchorAfter, currentMeasure) {
  const afterStart =
    getAnchorPlaybackTime(timingMap, anchorAfter.measureNumber, practiceTime) ??
    anchorAfter.measureNumber

  if (afterStart != null && afterStart > practiceTime) {
    return afterStart
  }

  const window = getMeasurePlaybackWindow(timingMap, currentMeasure.number, practiceTime)
  if (window?.endTimeSeconds > practiceTime) {
    return window.endTimeSeconds
  }

  return getPlaybackDurationSeconds(timingMap)
}

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

