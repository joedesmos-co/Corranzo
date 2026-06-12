import { getTempoAtTime as resolveTempoAtTime } from './timingMath.js'
import {
  getPerformedBeats,
  getPerformedEntryAtTime,
  usesPerformedTimeline,
} from './performedTimeline.js'

function getWrittenMeasureAtTime(timingMap, timeSeconds) {
  const measures = timingMap.measures
  for (let index = measures.length - 1; index >= 0; index -= 1) {
    const measure = measures[index]
    if (timeSeconds >= measure.startTimeSeconds) {
      return measure
    }
  }
  return measures[0]
}

function getWrittenBeatAtTime(timingMap, timeSeconds) {
  const beats = timingMap.beats
  for (let index = beats.length - 1; index >= 0; index -= 1) {
    const beat = beats[index]
    if (timeSeconds >= beat.timeSeconds) {
      return beat
    }
  }
  return beats[0]
}

function getPerformedBeatAtTime(timingMap, timeSeconds) {
  const beats = getPerformedBeats(timingMap)
  if (!beats.length) {
    return null
  }

  for (let index = beats.length - 1; index >= 0; index -= 1) {
    const beat = beats[index]
    if (timeSeconds >= beat.timeSeconds) {
      return beat
    }
  }
  return beats[0]
}

export function getMeasureAtTime(timingMap, timeSeconds) {
  if (!timingMap?.measures?.length) {
    return null
  }

  if (usesPerformedTimeline(timingMap)) {
    const entry = getPerformedEntryAtTime(timingMap, timeSeconds)
    if (entry) {
      return (
        timingMap.measures[entry.writtenMeasureIndex] ??
        timingMap.measures.find((measure) => measure.number === entry.writtenMeasureNumber) ??
        null
      )
    }
  }

  return getWrittenMeasureAtTime(timingMap, timeSeconds)
}

export function getBeatAtTime(timingMap, timeSeconds) {
  if (!timingMap?.beats?.length) {
    return null
  }

  if (usesPerformedTimeline(timingMap)) {
    return getPerformedBeatAtTime(timingMap, timeSeconds) ?? getWrittenBeatAtTime(timingMap, timeSeconds)
  }

  return getWrittenBeatAtTime(timingMap, timeSeconds)
}

/** Beat for UI display — small lookahead so measure/beat advance at downbeats, not late. */
export function getDisplayBeatAtTime(timingMap, timeSeconds, lookaheadSeconds = 0.02) {
  const beat = getBeatAtTime(timingMap, timeSeconds)
  if (!beat || lookaheadSeconds <= 0) {
    return beat
  }

  const beats = getPerformedBeats(timingMap)
  const index = beats.findIndex(
    (candidate) =>
      candidate.measureNumber === beat.measureNumber &&
      candidate.beat === beat.beat &&
      candidate.timeSeconds === beat.timeSeconds,
  )
  const nextBeat = index >= 0 ? beats[index + 1] : null

  if (
    nextBeat &&
    nextBeat.timeSeconds > timeSeconds &&
    nextBeat.timeSeconds - timeSeconds <= lookaheadSeconds
  ) {
    return nextBeat
  }

  return beat
}

export function getTempoAtTime(timingMap, timeSeconds) {
  return resolveTempoAtTime(timingMap, timeSeconds)
}

export function getEventsNearTime(timingMap, timeSeconds, windowSeconds = 2) {
  if (!timingMap?.timingEvents?.length) {
    return []
  }

  return timingMap.timingEvents.filter(
    (event) =>
      Math.abs(event.timeSeconds - timeSeconds) <= windowSeconds,
  )
}

export function getDebugState(timingMap, timeSeconds) {
  if (!timingMap) {
    return null
  }

  const performedEntry = getPerformedEntryAtTime(timingMap, timeSeconds)
  const measure = getMeasureAtTime(timingMap, timeSeconds)
  const beat = getBeatAtTime(timingMap, timeSeconds)

  return {
    timeSeconds,
    measureNumber: measure?.number ?? null,
    beat: beat?.beat ?? null,
    tempo: getTempoAtTime(timingMap, timeSeconds),
    noteCount: timingMap.noteCount,
    performedIndex: performedEntry?.performedIndex ?? null,
    repeatPass: performedEntry?.repeatPass ?? null,
    timingSource: usesPerformedTimeline(timingMap) ? 'performed' : 'written',
    nearbyEvents: getEventsNearTime(timingMap, timeSeconds),
    recentEvents: timingMap.timingEvents
      .filter((event) => event.timeSeconds <= timeSeconds)
      .slice(-12),
  }
}
