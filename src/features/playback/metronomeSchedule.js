import { getTimeline } from '../musicxml/timeline.js'
import { getBeatAtTime, getMeasureAtTime } from '../musicxml/timingQuery.js'
import { getPerformedEntryAtTime } from '../musicxml/performedTimeline.js'
import {
  METRONOME_COUNT_IN,
  METRONOME_SUBDIVISION,
  subdivisionDivisions,
} from './metronomeConstants.js'

function beatEvent(beat, { accent, isSubdivision = false, isCountIn = false } = {}) {
  return {
    type: 'metronome',
    scoreTimeSeconds: beat.timeSeconds,
    measureNumber: beat.measureNumber,
    beat: beat.beat,
    accent: Boolean(accent),
    isSubdivision,
    isCountIn,
  }
}

/**
 * Expand performed quarter beats with eighth / triplet / sixteenth clicks.
 */
export function expandSubdivisionClicks(beats, subdivision = METRONOME_SUBDIVISION.QUARTER) {
  const divisions = subdivisionDivisions(subdivision)
  if (divisions <= 1 || !beats.length) {
    return beats.map((beat) =>
      beatEvent(beat, { accent: beat.beat === 1, isSubdivision: false }),
    )
  }

  const events = []
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index]
    const next = beats[index + 1]
    const previous = beats[index - 1]
    const span =
      next != null
        ? next.timeSeconds - beat.timeSeconds
        : previous != null
          ? beat.timeSeconds - previous.timeSeconds
          : 0.5

    for (let division = 0; division < divisions; division += 1) {
      const timeSeconds = beat.timeSeconds + (span * division) / divisions
      events.push({
        type: 'metronome',
        scoreTimeSeconds: timeSeconds,
        measureNumber: beat.measureNumber,
        beat: beat.beat,
        accent: division === 0 && beat.beat === 1,
        isSubdivision: division > 0,
        isCountIn: false,
      })
    }
  }

  return events.sort((left, right) => left.scoreTimeSeconds - right.scoreTimeSeconds)
}

/** Metronome click times on performed beats (with optional subdivisions). */
export function buildMetronomeSchedule(
  timingMap,
  { subdivision = METRONOME_SUBDIVISION.QUARTER } = {},
) {
  if (!timingMap) {
    return []
  }
  const beats = getTimeline(timingMap).performedBeats
  return expandSubdivisionClicks(beats, subdivision)
}

/** Duration in score seconds for N measures at the playhead. */
export function getCountInDurationSeconds(timingMap, scoreTimeSeconds, measureCount) {
  if (!timingMap || !measureCount || measureCount <= 0) {
    return 0
  }

  const entry = getPerformedEntryAtTime(timingMap, scoreTimeSeconds)
  if (entry) {
    const measureDuration = entry.endTimeSeconds - entry.startTimeSeconds
    return Math.max(0, measureDuration * measureCount)
  }

  const measure = getMeasureAtTime(timingMap, scoreTimeSeconds)
  if (!measure) {
    return 0
  }
  const measureDuration = measure.endTimeSeconds - measure.startTimeSeconds
  return Math.max(0, measureDuration * measureCount)
}

/**
 * Build count-in clicks ending at `scoreTimeSeconds` (playback start).
 * Times are virtual (may be negative before score zero).
 */
export function buildCountInSchedule(
  timingMap,
  scoreTimeSeconds,
  measureCount,
  { subdivision = METRONOME_SUBDIVISION.QUARTER } = {},
) {
  const duration = getCountInDurationSeconds(timingMap, scoreTimeSeconds, measureCount)
  if (duration <= 0) {
    return []
  }

  const entry = getPerformedEntryAtTime(timingMap, scoreTimeSeconds)
  const measure = getMeasureAtTime(timingMap, scoreTimeSeconds)
  const measureStart = entry?.startTimeSeconds ?? measure?.startTimeSeconds ?? 0
  const measureEnd = entry?.endTimeSeconds ?? measure?.endTimeSeconds ?? measureStart
  const measureDuration = Math.max(measureEnd - measureStart, 1e-6)

  const beats = getTimeline(timingMap).performedBeats
  const measureBeats = beats.filter(
    (beat) => beat.timeSeconds >= measureStart - 1e-6 && beat.timeSeconds < measureEnd - 1e-6,
  )
  if (!measureBeats.length) {
    return []
  }

  const pattern = expandSubdivisionClicks(measureBeats, subdivision).map((event) => ({
    ...event,
    offsetSeconds: event.scoreTimeSeconds - measureStart,
  }))

  const events = []
  const start = scoreTimeSeconds - duration
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const measureOffset = measureDuration * measureIndex
    for (const click of pattern) {
      events.push({
        ...click,
        scoreTimeSeconds: start + measureOffset + click.offsetSeconds,
        isCountIn: true,
      })
    }
  }

  return events.sort((left, right) => left.scoreTimeSeconds - right.scoreTimeSeconds)
}

/** UI beat indicator from score time (or count-in virtual time). */
export function getMetronomeDisplayState(
  timingMap,
  scoreTimeSeconds,
  {
    countInActive = false,
    countInDurationSeconds = 0,
    playbackStartScoreTime = 0,
    beatsPerMeasure = 4,
  } = {},
) {
  if (!timingMap) {
    return {
      phase: 'idle',
      beat: null,
      measureNumber: null,
      accent: false,
      countInActive: false,
      countInProgress: 0,
      beatsPerMeasure,
    }
  }

  if (countInActive && countInDurationSeconds > 0) {
    const progress = Math.min(
      1,
      Math.max(0, (scoreTimeSeconds + countInDurationSeconds) / countInDurationSeconds),
    )
    const lookupTime = playbackStartScoreTime + scoreTimeSeconds
    const beat = getBeatAtTime(timingMap, Math.max(0, lookupTime))
    return {
      phase: 'count-in',
      beat: beat?.beat ?? null,
      measureNumber: beat?.measureNumber ?? null,
      accent: beat?.beat === 1,
      countInActive: true,
      countInProgress: progress,
      beatsPerMeasure,
    }
  }

  const beat = getBeatAtTime(timingMap, scoreTimeSeconds)
  return {
    phase: 'playback',
    beat: beat?.beat ?? null,
    measureNumber: beat?.measureNumber ?? null,
    accent: beat?.beat === 1,
    countInActive: false,
    countInProgress: 0,
    beatsPerMeasure,
  }
}

export function isValidCountInMeasures(value) {
  return value === METRONOME_COUNT_IN.OFF ||
    value === METRONOME_COUNT_IN.ONE_MEASURE ||
    value === METRONOME_COUNT_IN.TWO_MEASURES
}
