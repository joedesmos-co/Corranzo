import { getTimeline } from '../musicxml/timeline.js'
import { CHECKPOINT_KIND } from './waitForYouCheckpoints.js'
import {
  filterNotesForPracticeScope,
  normalizePracticeScope,
} from './practiceScope.js'

const ONSET_EPSILON_SECONDS = 0.001
const TIME_EPSILON_SECONDS = 0.000001
const ZERO_DURATION_VISUAL_LIFETIME_SECONDS = 0.12
const visualEventCache = new WeakMap()

function buildVisualEvents(timingMap, practiceScope) {
  const performed = getTimeline(timingMap).performedNotes()
  const source = performed
    .filter((note) => !note.isTabMirror)
    .map((note) => ({
      ...note,
      timeSeconds: Number.isFinite(note.performedSeconds)
        ? note.performedSeconds
        : note.timeSeconds,
    }))
  const scoped = filterNotesForPracticeScope(source, practiceScope, timingMap)
    .sort(
      (left, right) =>
        left.timeSeconds - right.timeSeconds ||
        (left.measureNumber ?? 0) - (right.measureNumber ?? 0) ||
        (left.voice ?? 1) - (right.voice ?? 1) ||
        (left.midi ?? -1) - (right.midi ?? -1),
    )

  const groups = []
  for (const note of scoped) {
    const previous = groups[groups.length - 1]
    const sameWrittenOccurrence =
      previous &&
      previous.measureNumber === note.measureNumber &&
      previous.repeatPass === (note.repeatPass ?? 1)
    if (
      !previous ||
      !sameWrittenOccurrence ||
      Math.abs(note.timeSeconds - previous.timeSeconds) > ONSET_EPSILON_SECONDS
    ) {
      groups.push({
        timeSeconds: note.timeSeconds,
        measureNumber: note.measureNumber,
        repeatPass: note.repeatPass ?? 1,
        notes: [note],
      })
    } else {
      previous.notes.push(note)
    }
  }

  const events = groups.map((group, index) => {
    const playable = group.notes.filter((note) => !note.isRest && Number.isFinite(note.midi))
    const displayedNotes = playable.length ? playable : []
    const durationNotes = displayedNotes.length ? displayedNotes : group.notes
    const sourceIds = displayedNotes.map((note) => note.sourceNoteheadId).filter(Boolean)
    const isRest = displayedNotes.length === 0
    return {
      id: `play-along-m${group.measureNumber}-p${group.repeatPass}-t${group.timeSeconds.toFixed(4)}-${index}`,
      kind: isRest
        ? 'rest'
        : displayedNotes.length > 2
          ? CHECKPOINT_KIND.CHORD
          : displayedNotes.length === 2
            ? CHECKPOINT_KIND.DOUBLE_STOP
            : CHECKPOINT_KIND.NOTE,
      measureNumber: group.measureNumber,
      repeatPass: group.repeatPass,
      timeSeconds: group.timeSeconds,
      endTimeSeconds: durationNotes.reduce((latest, note) => {
        const duration = Number.isFinite(note.durationSeconds)
          ? Math.max(0, note.durationSeconds)
          : 0
        return Math.max(latest, group.timeSeconds + duration)
      }, group.timeSeconds),
      expectedMidis: [...new Set(displayedNotes.map((note) => note.midi))],
      notes: displayedNotes,
      isChord: displayedNotes.length > 1,
      isRest,
      isTiedContinuation:
        displayedNotes.length > 0 &&
        displayedNotes.every(
          (note) => note.suppressPlaybackAttack || (note.tieStop && !note.tieStart),
        ),
      sourceNoteheadIds: sourceIds,
    }
  })

  return events.map((event, index) => {
    if (event.endTimeSeconds > event.timeSeconds) {
      return event
    }
    const nextOnset = events[index + 1]?.timeSeconds
    return {
      ...event,
      endTimeSeconds: Number.isFinite(nextOnset)
        ? nextOnset
        : event.timeSeconds + ZERO_DURATION_VISUAL_LIFETIME_SECONDS,
    }
  })
}

export function getPlayAlongVisualEvents(timingMap, practiceScope) {
  if (!timingMap || typeof timingMap !== 'object') return []
  const scope = normalizePracticeScope(practiceScope)
  let byScope = visualEventCache.get(timingMap)
  if (!byScope) {
    byScope = new Map()
    visualEventCache.set(timingMap, byScope)
  }
  if (!byScope.has(scope)) {
    byScope.set(scope, buildVisualEvents(timingMap, scope))
  }
  return byScope.get(scope)
}

/**
 * Resolve the printed onset at the authoritative score time. This is derived
 * from absolute state, so seek and loop wrap never depend on animation history.
 */
export function resolvePlayAlongVisualCheckpoint(
  timingMap,
  practiceTime,
  practiceScope,
) {
  const events = getPlayAlongVisualEvents(timingMap, practiceScope)
  if (!events.length) return null
  const time = Number.isFinite(Number(practiceTime)) ? Number(practiceTime) : 0

  let low = 0
  let high = events.length - 1
  let index = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (events[middle].timeSeconds <= time + TIME_EPSILON_SECONDS) {
      index = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (index < 0) return null
  const event = events[index]
  if (
    event.endTimeSeconds > event.timeSeconds &&
    time > event.endTimeSeconds + TIME_EPSILON_SECONDS &&
    index + 1 < events.length
  ) {
    return null
  }
  if (
    index === events.length - 1 &&
    event.endTimeSeconds > event.timeSeconds &&
    time > event.endTimeSeconds + TIME_EPSILON_SECONDS
  ) {
    return null
  }
  return event
}
