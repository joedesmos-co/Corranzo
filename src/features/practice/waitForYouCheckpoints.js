import { getBeatAtTime } from '../musicxml/timingQuery.js'
import { getTimeline } from '../musicxml/timeline.js'
import { usesPerformedTimeline } from '../musicxml/performedTimeline.js'
import { alignChordScoreTime } from '../playback/pianoVoiceMix.js'

export const CHECKPOINT_KIND = {
  BEAT: 'beat',
  NOTE: 'note',
}

/** Notes within this window (seconds) form one checkpoint — hands may be slightly apart. */
export const NOTE_TIME_GROUP_SECONDS = 0.15

const LOOP_TIME_EPSILON = 0.001
const TIME_GROUP_EPSILON = NOTE_TIME_GROUP_SECONDS

function filterByLoopRegion(items, loopRegion, timeKey = 'timeSeconds') {
  if (!loopRegion?.isValid) {
    return items
  }
  return items.filter(
    (item) =>
      item[timeKey] >= loopRegion.startTimeSeconds - LOOP_TIME_EPSILON &&
      item[timeKey] < loopRegion.endTimeSeconds,
  )
}

function groupNotesByTime(notes) {
  const groups = []

  for (const note of notes) {
    const alignedTime = alignChordScoreTime(note.timeSeconds)
    const last = groups[groups.length - 1]
    if (
      !last ||
      Math.abs(alignedTime - last.timeSeconds) > TIME_GROUP_EPSILON
    ) {
      groups.push({ timeSeconds: alignedTime, notes: [note] })
    } else {
      last.notes.push(note)
    }
  }

  return groups
}

function uniqueMidis(notes) {
  const seen = new Set()
  const midis = []
  for (const note of notes) {
    if (note.midi == null || seen.has(note.midi)) {
      continue
    }
    seen.add(note.midi)
    midis.push(note.midi)
  }
  return midis
}

/**
 * Build ordered practice checkpoints from MusicXML beat timing.
 */
export function buildBeatCheckpoints(timingMap, loopRegion = null) {
  const sourceBeats = usesPerformedTimeline(timingMap)
    ? getTimeline(timingMap).performedBeats
    : timingMap?.beats

  if (!sourceBeats?.length) {
    return []
  }

  const beats = filterByLoopRegion(sourceBeats, loopRegion)

  return beats.map((beat, index) => ({
    id: `beat-m${beat.measureNumber}-b${beat.beat}-p${beat.repeatPass ?? 1}-i${beat.performedMeasureIndex ?? index}`,
    kind: CHECKPOINT_KIND.BEAT,
    index,
    measureNumber: beat.measureNumber,
    beat: beat.beat,
    timeSeconds: beat.timeSeconds,
    quarterTime: beat.quarterTime,
    repeatPass: beat.repeatPass ?? 1,
    performedIndex: beat.performedMeasureIndex ?? null,
    label: `Measure ${beat.measureNumber}, beat ${beat.beat}`,
    expectedMidi: null,
    expectedMidis: [],
    isChord: false,
  }))
}

/**
 * Build note-level checkpoints; chords at the same time become one checkpoint.
 */
export function buildNoteCheckpoints(timingMap, loopRegion = null) {
  if (!timingMap?.notes?.length) {
    return []
  }

  const sourceNotes = usesPerformedTimeline(timingMap)
    ? getTimeline(timingMap)
        .performedNotes()
        .map((note) => ({
          ...note,
          timeSeconds: note.performedSeconds,
        }))
    : timingMap.notes.filter((note) => !note.isRest && note.midi != null)

  let notes = sourceNotes.filter((note) => !note.isRest && note.midi != null)
  notes = filterByLoopRegion(notes, loopRegion)

  const groups = groupNotesByTime(notes)

  return groups.map((group, index) => {
    const midis = uniqueMidis(group.notes)
    const labels = group.notes.map((note) => note.label).join(' + ')
    const beatAtTime = timingMap ? getBeatAtTime(timingMap, group.timeSeconds) : null
    const measureNumber = group.notes[0].measureNumber

    return {
      id: `note-m${measureNumber}-t${group.timeSeconds.toFixed(3)}-${index}`,
      kind: CHECKPOINT_KIND.NOTE,
      index,
      measureNumber,
      beat: beatAtTime?.beat ?? null,
      timeSeconds: group.timeSeconds,
      quarterTime: group.notes[0].quarterTime,
      repeatPass: group.notes[0].repeatPass ?? beatAtTime?.repeatPass ?? 1,
      label: labels,
      expectedMidi: midis[0],
      expectedMidis: midis,
      isChord: midis.length > 1,
      notes: group.notes,
    }
  })
}

export function buildCheckpoints(timingMap, loopRegion, mode) {
  if (mode === 'note') {
    return buildNoteCheckpoints(timingMap, loopRegion)
  }
  return buildBeatCheckpoints(timingMap, loopRegion)
}

export function findCheckpointIndexAtTime(checkpoints, timeSeconds) {
  if (!checkpoints.length) {
    return 0
  }

  let closestIndex = 0
  let closestDistance = Infinity

  checkpoints.forEach((checkpoint, index) => {
    const distance = Math.abs(checkpoint.timeSeconds - timeSeconds)
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  })

  return closestIndex
}
