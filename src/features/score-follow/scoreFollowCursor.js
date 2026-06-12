import { getMeasureAtTime } from '../musicxml/timingQuery.js'
import { logScoreFollowDecision } from './scoreFollowDebug.js'
import {
  dedupeTrustedAnchorsByMeasure,
  resolveFirstMeasureTrustedAnchor,
  resolveTrustedAnchorForMeasure,
} from './trustedAnchors.js'

export const START_LOCK_THRESHOLD_SECONDS = 0.15

function buildExactCursor(anchor, { reason, practiceTime, currentMeasureNumber = null }) {
  logScoreFollowDecision({
    practiceTime,
    currentMeasure: currentMeasureNumber ?? anchor.measureNumber,
    selectedAnchorMeasure: anchor.measureNumber,
    page: anchor.page,
    systemIndex: anchor.meta?.systemIndex ?? null,
    x: anchor.x,
    y: anchor.y,
    reason,
  })

  return {
    visible: true,
    page: anchor.page,
    x: anchor.x,
    y: anchor.y,
    measureNumber: anchor.measureNumber,
    progress: 0,
    lockExact: true,
    forcedStart: reason === 'start-lock-measure-1',
  }
}

/**
 * Cursor from trusted anchors only — exact measure positions, no interpolation.
 */
export function computeScoreFollowCursor({
  timingMap,
  practiceTime,
  trustedAnchors,
}) {
  const deduped = dedupeTrustedAnchorsByMeasure(trustedAnchors)

  if (!timingMap?.measures?.length || deduped.length === 0) {
    logScoreFollowDecision({
      practiceTime,
      currentMeasure: null,
      selectedAnchorMeasure: null,
      reason: 'no-trusted-anchors',
    })
    return { visible: false }
  }

  if (practiceTime <= START_LOCK_THRESHOLD_SECONDS) {
    const startAnchor = resolveFirstMeasureTrustedAnchor(trustedAnchors, timingMap)
    if (!startAnchor) {
      logScoreFollowDecision({
        practiceTime,
        currentMeasure: timingMap.measures[0]?.number ?? null,
        selectedAnchorMeasure: null,
        reason: 'start-lock-missing-measure-1',
      })
      return { visible: false }
    }
    return buildExactCursor(startAnchor, {
      reason: 'start-lock-measure-1',
      practiceTime,
      currentMeasureNumber: timingMap.measures[0]?.number ?? 1,
    })
  }

  const currentMeasure = getMeasureAtTime(timingMap, practiceTime)
  if (!currentMeasure) {
    logScoreFollowDecision({
      practiceTime,
      currentMeasure: null,
      selectedAnchorMeasure: null,
      reason: 'no-current-measure',
    })
    return { visible: false }
  }

  const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, currentMeasure.number)
  if (!anchor) {
    logScoreFollowDecision({
      practiceTime,
      currentMeasure: currentMeasure.number,
      selectedAnchorMeasure: null,
      reason: 'no-exact-anchor-for-measure',
    })
    return { visible: false }
  }

  return buildExactCursor(anchor, {
    reason: 'exact-measure-anchor',
    practiceTime,
    currentMeasureNumber: currentMeasure.number,
  })
}
