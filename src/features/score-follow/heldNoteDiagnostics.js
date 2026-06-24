import { getMeasurePlaybackWindow } from '../musicxml/performedTimeline.js'
import {
  buildMeasureMusicalEvents,
  HELD_NOTE_THRESHOLD_SECONDS,
  resolveMusicalXInMeasure,
} from './cursorMusicalProgress.js'
import { resolveTrustedAnchorForMeasure } from './trustedAnchors.js'

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
 * Dev diagnostic for held-note cursor behavior inside one measure.
 */
export function buildHeldNoteDiagnostic({
  timingMap,
  trustedAnchors,
  measureNumber,
  sampleStepSeconds = 0.04,
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
  const heldEvents = events.filter(
    (event) =>
      (event.kind === 'note' || event.kind === 'chord') &&
      (event.durationSeconds ?? 0) > HELD_NOTE_THRESHOLD_SECONDS,
  )

  if (!heldEvents.length) {
    return { active: false, reason: 'no-held-notes', measureNumber, events }
  }

  const samples = []
  let maxOvershoot = 0
  let maxBacktrack = 0
  let prevX = null

  for (
    let t = window.startTimeSeconds + 0.02;
    t < window.endTimeSeconds - 0.001;
    t += sampleStepSeconds
  ) {
    const musical = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: t,
      measureNumber,
      xStart,
      xEnd,
    })
    const segment = findActiveSegment(events, t)
    const nextOnset =
      segment?.after?.kind === 'note' || segment?.after?.kind === 'chord'
        ? segment.after
        : null
    let overshoot = 0
    if (nextOnset && t < nextOnset.timeSeconds - 0.001 && musical.x > nextOnset.x + 0.0001) {
      overshoot = musical.x - nextOnset.x
      maxOvershoot = Math.max(maxOvershoot, overshoot)
    }
    let backtrack = 0
    if (prevX != null && musical.x < prevX - 0.0001) {
      backtrack = prevX - musical.x
      maxBacktrack = Math.max(maxBacktrack, backtrack)
    }
    prevX = musical.x

    samples.push({
      practiceTime: t,
      x: musical.x,
      mode: musical.mode,
      overshoot,
      backtrack,
      segment: segment
        ? {
            beforeKind: segment.before.kind,
            afterKind: segment.after.kind,
            beforeX: segment.before.x,
            afterX: segment.after.x,
          }
        : null,
    })
  }

  return {
    active: true,
    measureNumber,
    heldEvents: heldEvents.map((event) => ({
      timeSeconds: event.timeSeconds,
      x: event.x,
      durationSeconds: event.durationSeconds,
    })),
    events,
    maxOvershoot,
    maxBacktrack,
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
