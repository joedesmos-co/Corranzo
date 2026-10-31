import {
  getPerformedEntryAtTime,
  getPlaybackDurationSeconds,
  usesPerformedTimeline,
} from './performedTimeline.js'
import { getBeatAtTime, getMeasureAtTime } from './timingQuery.js'

const timelineCache = new WeakMap()

function buildPerformedBeats(timingMap) {
  if (usesPerformedTimeline(timingMap)) {
    return timingMap.performedMeasureTimeline.performedBeats ?? []
  }
  return (timingMap.beats ?? []).map((beat, index) => ({
    ...beat,
    performedMeasureIndex: index,
    repeatPass: 1,
  }))
}

function expandPerformedNotes(timingMap, performedBeats) {
  if (!usesPerformedTimeline(timingMap)) {
    return (timingMap.notes ?? []).map((note) => ({
      ...note,
      performedSeconds: note.timeSeconds,
      repeatPass: 1,
      performedIndex: null,
    }))
  }

  const entries = timingMap.performedMeasureTimeline.entries ?? []
  const notes = timingMap.notes ?? []
  const expanded = []

  // Group once instead of filtering the whole score for every performed
  // measure. Repeats make the same written measure appear several times, so
  // the old O(entries × notes) scan was the hot path during first Play.
  const notesByMeasure = new Map()
  for (const note of notes) {
    const bucket = notesByMeasure.get(note.measureNumber)
    if (bucket) {
      bucket.push(note)
    } else {
      notesByMeasure.set(note.measureNumber, [note])
    }
  }

  for (const entry of entries) {
    const measure = timingMap.measures[entry.writtenMeasureIndex]
    if (!measure) {
      continue
    }
    const writtenDuration = measure.endTimeSeconds - measure.startTimeSeconds
    if (writtenDuration <= 0) {
      continue
    }

    const measureNotes = notesByMeasure.get(entry.writtenMeasureNumber) ?? []

    for (const note of measureNotes) {
      const offset = (note.timeSeconds - measure.startTimeSeconds) / writtenDuration
      const span = entry.endTimeSeconds - entry.startTimeSeconds
      expanded.push({
        ...note,
        performedSeconds: entry.startTimeSeconds + offset * span,
        repeatPass: entry.repeatPass,
        performedIndex: entry.performedIndex,
      })
    }
  }

  expanded.sort(
    (a, b) => a.performedSeconds - b.performedSeconds || a.quarterTime - b.quarterTime,
  )
  return expanded
}

function createTimeline(timingMap) {
  const entries = timingMap.performedMeasureTimeline?.entries ?? []
  const performedBeats = buildPerformedBeats(timingMap)
  const performedDurationSeconds = getPlaybackDurationSeconds(timingMap)
  let performedNotesCache = null

  return {
    entries,
    performedBeats,
    performedDurationSeconds,
    usesPerformedTimeline: usesPerformedTimeline(timingMap),

    performedStartForMeasure(measureNumber, { pass = null } = {}) {
      const matches = entries.filter((entry) => entry.writtenMeasureNumber === measureNumber)
      if (!matches.length) {
        return null
      }
      if (pass != null) {
        const entry = matches.find((candidate) => candidate.repeatPass === pass)
        return entry?.startTimeSeconds ?? null
      }
      return matches[0].startTimeSeconds
    },

    windowsForMeasure(measureNumber) {
      return entries
        .filter((entry) => entry.writtenMeasureNumber === measureNumber)
        .map((entry) => ({
          startTimeSeconds: entry.startTimeSeconds,
          endTimeSeconds: entry.endTimeSeconds,
          repeatPass: entry.repeatPass,
          performedIndex: entry.performedIndex,
        }))
    },

    performedNotes() {
      // The expanded list is immutable for a parsed timing map, but callers
      // (motion timeline, note targets, checkpoints, playback schedule) ask
      // for it repeatedly. Cache it so first Play does not re-expand the whole
      // score once per measure.
      if (performedNotesCache == null) {
        performedNotesCache = expandPerformedNotes(timingMap, performedBeats)
      }
      return performedNotesCache
    },

    locate(timeSeconds) {
      const clamped = Math.max(
        0,
        Math.min(timeSeconds, performedDurationSeconds || Number.MAX_SAFE_INTEGER),
      )

      const entry = getPerformedEntryAtTime(timingMap, clamped)
      const measure = getMeasureAtTime(timingMap, clamped)
      const beat = getBeatAtTime(timingMap, clamped)

      let measureProgress = 0
      if (entry && entry.endTimeSeconds > entry.startTimeSeconds) {
        measureProgress =
          (clamped - entry.startTimeSeconds) / (entry.endTimeSeconds - entry.startTimeSeconds)
      } else if (measure) {
        const span = measure.endTimeSeconds - measure.startTimeSeconds
        if (span > 0) {
          measureProgress = (clamped - measure.startTimeSeconds) / span
        }
      }

      return {
        timeSeconds: clamped,
        measureNumber: measure?.number ?? entry?.writtenMeasureNumber ?? null,
        beat: beat?.beat ?? null,
        measureProgress,
        occurrenceIndex: entry?.performedIndex ?? null,
        repeatPass: entry?.repeatPass ?? 1,
      }
    },
  }
}

/** Cached written/performed timeline API for a parsed timing map. */
export function getTimeline(timingMap) {
  if (!timingMap) {
    return createTimeline({
      measures: [],
      beats: [],
      performedMeasureTimeline: { entries: [], performedBeats: [], diagnostics: {} },
    })
  }

  let timeline = timelineCache.get(timingMap)
  if (!timeline) {
    timeline = createTimeline(timingMap)
    timelineCache.set(timingMap, timeline)
  }
  return timeline
}

/** @deprecated Use getTimeline(timingMap).performedStartForMeasure */
export function performedFromWritten(timingMap, measureNumber, options) {
  return getTimeline(timingMap).performedStartForMeasure(measureNumber, options)
}

/** @deprecated Use getTimeline(timingMap).locate */
export function writtenFromPerformed(timingMap, timeSeconds) {
  return getTimeline(timingMap).locate(timeSeconds)
}

/** @deprecated Use getTimeline(timingMap).windowsForMeasure */
export function performedWindowsForMeasure(timingMap, measureNumber) {
  return getTimeline(timingMap).windowsForMeasure(measureNumber)
}

/** @deprecated Use getTimeline(timingMap).performedBeats */
export function performedBeats(timingMap) {
  return getTimeline(timingMap).performedBeats
}
