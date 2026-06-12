import {
  getMeasureByNumber,
  getMeasureListIndex,
} from '../musicxml/measureNavigation.js'
import {
  getBeatEndTime,
  getBeatListIndex,
  getBeatStartTime,
} from '../musicxml/beatNavigation.js'
import { getTimeline } from '../musicxml/timeline.js'
import { usesPerformedTimeline } from '../musicxml/performedTimeline.js'

const LOOP_WRAP_THRESHOLD_SECONDS = 0.05

export const LOOP_SNAP_MODE = {
  MEASURE: 'measure',
  BEAT: 'beat',
}

export function normalizeLoopMeasurePair(timingMap, startMeasure, endMeasure) {
  if (!timingMap || !startMeasure || !endMeasure) {
    return { startMeasure: null, endMeasure: null }
  }

  const startIndex = getMeasureListIndex(timingMap, startMeasure)
  const endIndex = getMeasureListIndex(timingMap, endMeasure)

  if (startIndex < 0 || endIndex < 0) {
    return { startMeasure: null, endMeasure: null }
  }

  if (startIndex <= endIndex) {
    return { startMeasure, endMeasure }
  }

  return { startMeasure: endMeasure, endMeasure: startMeasure }
}

export function normalizeLoopBeatPair(timingMap, startBeat, endBeat) {
  if (!timingMap || !startBeat || !endBeat) {
    return { startBeat: null, endBeat: null }
  }

  const startIndex = getBeatListIndex(timingMap, startBeat)
  const endIndex = getBeatListIndex(timingMap, endBeat)

  if (startIndex < 0 || endIndex < 0) {
    return { startBeat: null, endBeat: null }
  }

  if (startIndex <= endIndex) {
    return { startBeat, endBeat }
  }

  return { startBeat: endBeat, endBeat: startBeat }
}

export function buildMeasureLoopRegion(timingMap, startMeasureNumber, endMeasureNumber) {
  if (!timingMap?.measures?.length) {
    return null
  }

  if (startMeasureNumber == null || endMeasureNumber == null) {
    return null
  }

  const startMeasure = getMeasureByNumber(timingMap, startMeasureNumber)
  const endMeasure = getMeasureByNumber(timingMap, endMeasureNumber)

  if (!startMeasure || !endMeasure) {
    return null
  }

  const normalized = normalizeLoopMeasurePair(timingMap, startMeasure, endMeasure)
  if (!normalized.startMeasure || !normalized.endMeasure) {
    return null
  }

  let startTimeSeconds = normalized.startMeasure.startTimeSeconds
  let endTimeSeconds = normalized.endMeasure.endTimeSeconds

  if (usesPerformedTimeline(timingMap)) {
    const timeline = getTimeline(timingMap)
    const startWindows = timeline.windowsForMeasure(normalized.startMeasure.number)
    const endWindows = timeline.windowsForMeasure(normalized.endMeasure.number)
    if (startWindows.length && endWindows.length) {
      startTimeSeconds = startWindows[0].startTimeSeconds
      endTimeSeconds = endWindows[endWindows.length - 1].endTimeSeconds
    }
  }

  const durationSeconds = endTimeSeconds - startTimeSeconds

  return {
    snapMode: LOOP_SNAP_MODE.MEASURE,
    startMeasureNumber: normalized.startMeasure.number,
    endMeasureNumber: normalized.endMeasure.number,
    startBeatNumber: null,
    endBeatNumber: null,
    startTimeSeconds,
    endTimeSeconds,
    durationSeconds,
    isValid: durationSeconds > 0,
    label: `Measures ${normalized.startMeasure.number}–${normalized.endMeasure.number}`,
  }
}

export function buildBeatLoopRegion(timingMap, startBeat, endBeat) {
  if (!timingMap?.beats?.length || !startBeat || !endBeat) {
    return null
  }

  const normalized = normalizeLoopBeatPair(timingMap, startBeat, endBeat)
  if (!normalized.startBeat || !normalized.endBeat) {
    return null
  }

  const startTimeSeconds = getBeatStartTime(normalized.startBeat)
  const endTimeSeconds = getBeatEndTime(timingMap, normalized.endBeat)
  const durationSeconds = endTimeSeconds - startTimeSeconds

  const sameMeasure =
    normalized.startBeat.measureNumber === normalized.endBeat.measureNumber

  const label = sameMeasure
    ? `Measure ${normalized.startBeat.measureNumber}, beats ${normalized.startBeat.beat}–${normalized.endBeat.beat}`
    : `M${normalized.startBeat.measureNumber} b${normalized.startBeat.beat} → M${normalized.endBeat.measureNumber} b${normalized.endBeat.beat}`

  return {
    snapMode: LOOP_SNAP_MODE.BEAT,
    startMeasureNumber: normalized.startBeat.measureNumber,
    endMeasureNumber: normalized.endBeat.measureNumber,
    startBeatNumber: normalized.startBeat.beat,
    endBeatNumber: normalized.endBeat.beat,
    startTimeSeconds,
    endTimeSeconds,
    durationSeconds,
    isValid: durationSeconds > 0,
    label,
  }
}

/** @deprecated Use buildMeasureLoopRegion — kept as alias for compatibility */
export function buildLoopRegion(timingMap, startMeasureNumber, endMeasureNumber) {
  return buildMeasureLoopRegion(timingMap, startMeasureNumber, endMeasureNumber)
}

export function buildLoopRegionFromState(timingMap, state) {
  if (!state) {
    return null
  }

  if (state.snapMode === LOOP_SNAP_MODE.BEAT) {
    return buildBeatLoopRegion(timingMap, state.startBeat, state.endBeat)
  }

  return buildMeasureLoopRegion(timingMap, state.startMeasureNumber, state.endMeasureNumber)
}

export function shouldRestartLoop(currentTimeSeconds, region, thresholdSeconds = LOOP_WRAP_THRESHOLD_SECONDS) {
  if (!region?.isValid) {
    return false
  }
  return currentTimeSeconds >= region.endTimeSeconds - thresholdSeconds
}

export function getLoopWrapThreshold() {
  return LOOP_WRAP_THRESHOLD_SECONDS
}
