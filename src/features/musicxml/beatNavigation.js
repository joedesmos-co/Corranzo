import { getDisplayBeatAtTime, getMeasureAtTime } from './timingQuery.js'
import { getMeasureByNumber, getMeasureStartTime } from './measureNavigation.js'
import { getPerformedEntryAtTime, usesPerformedTimeline } from './performedTimeline.js'

function getActiveBeats(timingMap) {
  if (usesPerformedTimeline(timingMap)) {
    return timingMap.performedMeasureTimeline?.performedBeats ?? timingMap.beats
  }
  return timingMap?.beats ?? []
}

export function getBeatListIndex(timingMap, beat) {
  const beats = getActiveBeats(timingMap)
  if (!beats.length || !beat) {
    return -1
  }

  return beats.findIndex(
    (candidate) =>
      candidate.measureNumber === beat.measureNumber &&
      candidate.beat === beat.beat &&
      candidate.timeSeconds === beat.timeSeconds,
  )
}

export function getNeighborBeat(timingMap, beat, offset) {
  const beats = getActiveBeats(timingMap)
  const index = getBeatListIndex(timingMap, beat)
  if (index < 0) {
    return null
  }
  return beats[index + offset] ?? null
}

export function getBeatsForMeasure(timingMap, measureNumber, timeSeconds = null) {
  const beats = getActiveBeats(timingMap)
  if (!beats.length || measureNumber == null) {
    return []
  }

  if (usesPerformedTimeline(timingMap) && timeSeconds != null) {
    const entry = getPerformedEntryAtTime(timingMap, timeSeconds)
    if (entry) {
      return beats.filter(
        (beat) =>
          beat.measureNumber === measureNumber &&
          beat.performedMeasureIndex === entry.performedIndex,
      )
    }
  }

  return beats.filter((beat) => beat.measureNumber === measureNumber)
}

export function getBeatStartTime(beat) {
  return beat?.timeSeconds ?? 0
}

export function getBeatEndTime(timingMap, beat) {
  if (!beat) {
    return 0
  }

  const nextBeat = getNeighborBeat(timingMap, beat, 1)
  if (nextBeat) {
    return nextBeat.timeSeconds
  }

  const measure = getMeasureByNumber(timingMap, beat.measureNumber)
  return measure?.endTimeSeconds ?? beat.timeSeconds
}

export function resolvePracticePosition(timingMap, timeSeconds) {
  if (!timingMap) {
    return null
  }

  const performedEntry = getPerformedEntryAtTime(timingMap, timeSeconds)
  const beat = getDisplayBeatAtTime(timingMap, timeSeconds)
  const measureFromBeat = beat
    ? getMeasureByNumber(timingMap, beat.measureNumber)
    : null
  const measure = measureFromBeat ?? getMeasureAtTime(timingMap, timeSeconds)
  const beatsInMeasure = measure
    ? getBeatsForMeasure(timingMap, measure.number, timeSeconds)
    : []
  const beatsPerMeasure = measure?.beats ?? beatsInMeasure.length ?? 0
  const usingPerformed = usesPerformedTimeline(timingMap)

  return {
    measure,
    beat,
    measureNumber: beat?.measureNumber ?? measure?.number ?? null,
    writtenMeasureNumber: measure?.number ?? null,
    beatNumber: beat?.beat ?? null,
    beatInMeasure: beat?.beat ?? null,
    beatsPerMeasure,
    measureStartTimeSeconds: performedEntry?.startTimeSeconds ?? (
      measure ? getMeasureStartTime(measure) : null
    ),
    performedIndex: performedEntry?.performedIndex ?? null,
    repeatPass: performedEntry?.repeatPass ?? null,
    isRepeatPass: (performedEntry?.repeatPass ?? 1) > 1,
    timingSource: usingPerformed ? 'performed' : 'written',
  }
}
