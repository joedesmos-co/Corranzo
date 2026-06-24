import { getMeasurePlaybackWindow } from '../musicxml/performedTimeline.js'
import { getTempoAtTime } from '../musicxml/timingMath.js'
import {
  buildMeasureMusicalEvents,
  resolveMusicalXInMeasure,
} from './cursorMusicalProgress.js'
import { resolveTrustedAnchorForMeasure } from './trustedAnchors.js'
import { resolveScoreFollowCursor } from './resolveScoreFollowCursor.js'

function findActiveSegment(events, practiceTime) {
  for (let index = 0; index < events.length - 1; index += 1) {
    const before = events[index]
    const after = events[index + 1]
    if (practiceTime >= before.timeSeconds && practiceTime < after.timeSeconds) {
      return { before, after, prior: index > 0 ? events[index - 1] : null }
    }
  }
  return null
}

function anchorExtents(anchor) {
  const xStart = anchor.x
  const xEnd =
    typeof anchor.meta?.playableEndX === 'number' && anchor.meta.playableEndX > anchor.x
      ? anchor.meta.playableEndX
      : anchor.x + 0.08
  return { xStart, xEnd }
}

/**
 * Dev diagnostic: cursor velocity, mode, and stall windows inside one measure.
 */
export function buildCursorMotionDiagnostic({
  timingMap,
  trustedAnchors,
  measureNumber,
  sampleStepSeconds = 0.04,
  trust = { showCursor: true, needsSetup: false },
}) {
  const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, measureNumber)
  if (!anchor || !timingMap) {
    return { active: false, reason: 'missing-anchor' }
  }

  const window = getMeasurePlaybackWindow(timingMap, measureNumber, windowMidTime(timingMap, measureNumber))
  if (!window) {
    return { active: false, reason: 'missing-window' }
  }

  const { xStart, xEnd } = anchorExtents(anchor)
  const events = buildMeasureMusicalEvents(timingMap, measureNumber, window, xStart, xEnd)
  const tempoBpm = getTempoAtTime(timingMap, (window.startTimeSeconds + window.endTimeSeconds) / 2)

  const samples = []
  let maxStallSeconds = 0
  let minVelocity = Infinity
  let stallStart = null
  let prevX = null
  let prevTime = null

  for (
    let t = window.startTimeSeconds + 0.02;
    t < window.endTimeSeconds - 0.001;
    t += sampleStepSeconds
  ) {
    const resolved = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors,
      trust,
    }).cursor
    const musical = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: t,
      measureNumber,
      xStart,
      xEnd,
    })
    const segment = findActiveSegment(events, t)
    const velocity =
      prevX != null && prevTime != null && t > prevTime
        ? (resolved.x - prevX) / (t - prevTime)
        : 0

    if (Number.isFinite(velocity)) {
      minVelocity = Math.min(minVelocity, velocity)
    }

    if (Math.abs(velocity) < 1e-5 && resolved.visible) {
      stallStart = stallStart ?? t - sampleStepSeconds
    } else if (stallStart != null) {
      maxStallSeconds = Math.max(maxStallSeconds, t - stallStart)
      stallStart = null
    }

    samples.push({
      practiceTime: t,
      x: resolved.x,
      velocity,
      progressMode: resolved.progressMode ?? musical?.mode ?? null,
      musicalMode: musical?.mode ?? null,
      segment: segment
        ? {
            beforeKind: segment.before.kind,
            afterKind: segment.after.kind,
            beforeX: segment.before.x,
            afterX: segment.after.x,
            nextOnsetTime: segment.after.timeSeconds,
          }
        : null,
    })

    prevX = resolved.x
    prevTime = t
  }

  return {
    active: true,
    measureNumber,
    tempoBpm,
    events,
    maxStallSeconds,
    minVelocity: Number.isFinite(minVelocity) ? minVelocity : 0,
    samples,
  }
}

function windowMidTime(timingMap, measureNumber) {
  const start = getMeasurePlaybackWindow(timingMap, measureNumber, 0)?.startTimeSeconds ?? 0
  const end =
    getMeasurePlaybackWindow(timingMap, measureNumber, timingMap.durationSeconds ?? 999)
      ?.endTimeSeconds ?? start + 2
  return (start + end) / 2
}

/** Test helper: longest zero-velocity window while the cursor is visible. */
export function measureMaxCursorStall({
  timingMap,
  trustedAnchors,
  measureNumber,
  xStart,
  xEnd,
  sampleStepSeconds = 0.05,
  trust = { showCursor: true, needsSetup: false },
}) {
  let maxStallSeconds = 0
  let stallStart = null
  let prevX = null
  let prevTime = null
  const window = getMeasurePlaybackWindow(
    timingMap,
    measureNumber,
    windowMidTime(timingMap, measureNumber),
  )
  if (!window) {
    return 0
  }

  for (
    let t = window.startTimeSeconds + 0.04;
    t < window.endTimeSeconds - 0.001;
    t += sampleStepSeconds
  ) {
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors,
      trust,
    })
    if (!cursor.visible) {
      stallStart = null
      prevX = null
      prevTime = null
      continue
    }
    if (prevX != null && Math.abs(cursor.x - prevX) < 1e-6) {
      stallStart = stallStart ?? prevTime
    } else if (stallStart != null) {
      maxStallSeconds = Math.max(maxStallSeconds, t - stallStart)
      stallStart = null
    }
    prevX = cursor.x
    prevTime = t
  }

  return maxStallSeconds
}
