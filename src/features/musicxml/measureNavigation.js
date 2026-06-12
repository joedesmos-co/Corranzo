import { getMeasureAtTime } from './timingQuery.js'
import { getTimeline } from './timeline.js'
import { usesPerformedTimeline } from './performedTimeline.js'

export function getMeasureByNumber(timingMap, measureNumber) {
  if (!timingMap?.measures?.length || measureNumber == null) {
    return null
  }

  const target = Number(measureNumber)
  if (!Number.isFinite(target)) {
    return null
  }

  return timingMap.measures.find((measure) => measure.number === target) ?? null
}

export function getMeasureListIndex(timingMap, measure) {
  if (!timingMap?.measures?.length || !measure) {
    return -1
  }
  return timingMap.measures.findIndex(
    (candidate) => candidate.number === measure.number && candidate.startQuarters === measure.startQuarters,
  )
}

export function getNeighborMeasure(timingMap, measure, offset, timeSeconds = null) {
  if (usesPerformedTimeline(timingMap) && timeSeconds != null) {
    const timeline = timingMap.performedMeasureTimeline?.entries
    const current = getTimeline(timingMap).locate(timeSeconds)
    if (timeline?.length && current?.occurrenceIndex != null) {
      const target = timeline[current.occurrenceIndex + offset]
      if (!target) {
        return null
      }
      return (
        timingMap.measures[target.writtenMeasureIndex] ??
        getMeasureByNumber(timingMap, target.writtenMeasureNumber)
      )
    }
  }

  const index = getMeasureListIndex(timingMap, measure)
  if (index < 0) {
    return null
  }
  return timingMap.measures[index + offset] ?? null
}

export function getMeasureBounds(timingMap) {
  if (!timingMap?.measures?.length) {
    return { min: 1, max: 1, count: 0 }
  }

  const numbers = timingMap.measures.map((measure) => measure.number)
  return {
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    count: timingMap.measures.length,
  }
}

export function getMeasureStartTime(measure) {
  return measure?.startTimeSeconds ?? 0
}

export function getPerformedNeighborStartTime(timingMap, timeSeconds, offset) {
  if (!usesPerformedTimeline(timingMap) || timeSeconds == null) {
    return null
  }

  const timeline = timingMap.performedMeasureTimeline?.entries
  const current = getTimeline(timingMap).locate(timeSeconds)
  if (!timeline?.length || current?.occurrenceIndex == null) {
    return null
  }

  const target = timeline[current.occurrenceIndex + offset]
  return target?.startTimeSeconds ?? null
}

export function getFirstPerformedStartForMeasure(timingMap, measureNumber) {
  if (measureNumber == null) {
    return null
  }
  return getTimeline(timingMap).performedStartForMeasure(measureNumber)
}

export function resolveCurrentMeasure(timingMap, timeSeconds) {
  return getMeasureAtTime(timingMap, timeSeconds)
}
