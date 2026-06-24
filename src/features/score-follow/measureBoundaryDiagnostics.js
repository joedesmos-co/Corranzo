import { getMeasurePlaybackWindow } from '../musicxml/performedTimeline.js'
import {
  buildMeasureMusicalEvents,
  resolveMusicalXInMeasure,
} from './cursorMusicalProgress.js'
import { resolveTrustedAnchorForMeasure } from './trustedAnchors.js'

function segmentVelocity(before, after) {
  const dt = after.timeSeconds - before.timeSeconds
  if (dt <= 0) {
    return 0
  }
  return (after.x - before.x) / dt
}

function findActiveSegment(events, practiceTime) {
  for (let index = 0; index < events.length - 1; index += 1) {
    const before = events[index]
    const after = events[index + 1]
    if (practiceTime >= before.timeSeconds && practiceTime < after.timeSeconds) {
      return {
        before,
        after,
        prior: index > 0 ? events[index - 1] : null,
      }
    }
  }
  return null
}

/**
 * Dev diagnostic for one measure boundary: onset knots, geometry gaps, and
 * cursor velocity immediately before/after the barline.
 */
export function buildMeasureBoundaryDiagnostic({
  timingMap,
  trustedAnchors,
  measureNumber,
  trust = { showCursor: true, needsSetup: false },
}) {
  const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, measureNumber)
  const nextAnchor = resolveTrustedAnchorForMeasure(trustedAnchors, measureNumber + 1)
  if (!anchor || !timingMap) {
    return { active: false, reason: 'missing-anchor' }
  }

  const window = getMeasurePlaybackWindow(timingMap, measureNumber, windowMidTime(timingMap, measureNumber))
  const xEnd =
    typeof anchor.meta?.playableEndX === 'number' && anchor.meta.playableEndX > anchor.x
      ? anchor.meta.playableEndX
      : anchor.x + 0.08

  const nextSameSystem =
    nextAnchor &&
    nextAnchor.page === anchor.page &&
    Math.abs(nextAnchor.y - anchor.y) < 0.02

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

  const events = buildMeasureMusicalEvents(timingMap, measureNumber, window, anchor.x, xEnd, {
    includeMeasureEnd: !measureBridge,
  })
  if (measureBridge) {
    const nextWindow = getMeasurePlaybackWindow(
      timingMap,
      measureBridge.measureNumber,
      window?.endTimeSeconds ?? 0,
    )
    const nextEvents = buildMeasureMusicalEvents(
      timingMap,
      measureBridge.measureNumber,
      nextWindow,
      measureBridge.xStart,
      measureBridge.xEnd,
      { includeMeasureEnd: false },
    )
    const firstNext =
      nextEvents.find((event) => event.kind === 'note' || event.kind === 'chord') ??
      nextEvents.find((event) => event.kind === 'measure-start')
    if (firstNext) {
      events.push({ ...firstNext, kind: 'bridge-next' })
    }
  } else if (window) {
    events.push({ timeSeconds: window.endTimeSeconds, x: xEnd, kind: 'measure-end' })
  }

  const noteEvents = events.filter((event) => event.kind === 'note' || event.kind === 'chord')
  const lastOnset = noteEvents[noteEvents.length - 1] ?? null
  const bridge = events.find((event) => event.kind === 'bridge-next') ?? null
  const measureEnd = events.find((event) => event.kind === 'measure-end') ?? null

  const barlineTime = bridge?.timeSeconds ?? measureEnd?.timeSeconds ?? window?.endTimeSeconds
  const sampleBefore = barlineTime != null ? barlineTime - 0.06 : null
  const sampleAfter = barlineTime != null ? barlineTime + 0.02 : null

  const musicalBefore =
    sampleBefore != null
      ? resolveMusicalXInMeasure({
          timingMap,
          practiceTime: sampleBefore,
          measureNumber,
          xStart: anchor.x,
          xEnd,
          measureBridge,
        })
      : null
  const musicalAfter =
    sampleAfter != null && nextAnchor
      ? resolveMusicalXInMeasure({
          timingMap,
          practiceTime: sampleAfter,
          measureNumber: measureNumber + 1,
          xStart: nextAnchor.x,
          xEnd:
            typeof nextAnchor.meta?.playableEndX === 'number'
              ? nextAnchor.meta.playableEndX
              : nextAnchor.x + 0.08,
          measureBridge: null,
        })
      : null

  const tailSegment =
    lastOnset && bridge
      ? { before: lastOnset, after: bridge, prior: noteEvents[noteEvents.length - 2] ?? null }
      : findActiveSegment(events, sampleBefore ?? 0)

  const priorVel =
    tailSegment?.prior && tailSegment.before
      ? segmentVelocity(tailSegment.prior, tailSegment.before)
      : null
  const tailVel =
    tailSegment?.before && tailSegment.after
      ? segmentVelocity(tailSegment.before, tailSegment.after)
      : null

  const anchorGap =
    bridge && typeof anchor.meta?.playableEndX === 'number'
      ? nextAnchor.x - anchor.meta.playableEndX
      : nextAnchor
        ? nextAnchor.x - xEnd
        : null

  return {
    active: true,
    measureNumber,
    nextMeasureNumber: nextAnchor?.measureNumber ?? null,
    lastOnset: lastOnset
      ? {
          timeSeconds: lastOnset.timeSeconds,
          x: lastOnset.x,
          distanceToPlayableEndX: xEnd - lastOnset.x,
        }
      : null,
    measureEnd: {
      timeSeconds: window?.endTimeSeconds ?? null,
      x: xEnd,
    },
    bridgeTarget: bridge
      ? { timeSeconds: bridge.timeSeconds, x: bridge.x }
      : measureEnd
        ? { timeSeconds: measureEnd.timeSeconds, x: measureEnd.x }
        : null,
    nextFirstOnset: bridge
      ? { timeSeconds: bridge.timeSeconds, x: bridge.x }
      : null,
    anchorGapToNextMeasure: anchorGap,
    velocities: {
      priorSegmentPerSecond: priorVel,
      tailSegmentPerSecond: tailVel,
      stallRatio:
        priorVel != null && Math.abs(priorVel) > 1e-6 && tailVel != null
          ? Math.abs(tailVel / priorVel)
          : null,
      sampleBeforeBarline: sampleBefore,
      sampleAfterBarline: sampleAfter,
      xBefore: musicalBefore?.x ?? null,
      xAfter: musicalAfter?.x ?? null,
      velocityBeforeBarline:
        musicalBefore?.x != null && sampleBefore != null && barlineTime != null
          ? (bridge?.x ?? xEnd) - musicalBefore.x
          : null,
      velocityAfterBarline:
        musicalBefore?.x != null && musicalAfter?.x != null && sampleAfter != null && sampleBefore != null
          ? (musicalAfter.x - musicalBefore.x) / (sampleAfter - sampleBefore)
          : null,
    },
    events,
  }
}

function windowMidTime(timingMap, measureNumber) {
  const start = getMeasurePlaybackWindow(timingMap, measureNumber, 0)?.startTimeSeconds ?? 0
  const end =
    getMeasurePlaybackWindow(timingMap, measureNumber, Number.MAX_SAFE_INTEGER)?.endTimeSeconds ??
    start + 2
  return (start + end) / 2
}
