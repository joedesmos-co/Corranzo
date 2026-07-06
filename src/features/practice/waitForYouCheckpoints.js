import { getBeatAtTime } from '../musicxml/timingQuery.js'
import { getTimeline } from '../musicxml/timeline.js'
import { usesPerformedTimeline } from '../musicxml/performedTimeline.js'
import { alignChordScoreTime } from '../playback/pianoVoiceMix.js'
import { filterNotesForPracticeScope } from './practiceScope.js'
import { resolveGroupChordSymbol } from './guitarChordShapeCheckpoint.js'

export const CHECKPOINT_KIND = {
  BEAT: 'beat',
  NOTE: 'note',
}

/** Notes within this window (seconds) form one checkpoint — hands may be slightly apart. */
export const NOTE_TIME_GROUP_SECONDS = 0.18

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
    const candidates =
      note.expectedMidis?.length > 0
        ? note.expectedMidis
        : note.midi != null
          ? [note.midi]
          : []
    for (const midi of candidates) {
      if (seen.has(midi)) {
        continue
      }
      seen.add(midi)
      midis.push(midi)
    }
  }
  return midis
}

function noteCheckpointLabel(note) {
  if (note.chordSymbol) {
    return note.chordSymbol
  }
  return note.label
}

function sameTieVoice(left, right) {
  return (
    left.partId === right.partId &&
    left.voice === right.voice &&
    left.midi === right.midi
  )
}

/** Fold tied continuations into their attack note so WFY/visual keep one target. */
function mergeTiedContinuations(notes) {
  const sorted = [...notes].sort(
    (left, right) =>
      left.timeSeconds - right.timeSeconds ||
      left.quarterTime - right.quarterTime ||
      left.voice - right.voice,
  )
  const merged = []

  for (const note of sorted) {
    if (note.suppressPlaybackAttack) {
      const head = [...merged]
        .reverse()
        .find(
          (candidate) =>
            candidate.tieStart &&
            sameTieVoice(candidate, note) &&
            !candidate.suppressPlaybackAttack,
        )
      if (head) {
        head.durationQuarters += note.durationQuarters
        if (Number.isFinite(head.durationSeconds) && Number.isFinite(note.durationSeconds)) {
          head.durationSeconds += note.durationSeconds
        }
        head.tieStop = Boolean(head.tieStop || note.tieStop)
        continue
      }
    }
    merged.push({ ...note })
  }

  return merged
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
export function buildNoteCheckpoints(timingMap, loopRegion = null, options = {}) {
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

  // TAB-staff mirrors duplicate standard-staff notes in mixed guitar scores;
  // one played note must count once. Piano scores never set this flag.
  let notes = sourceNotes.filter(
    (note) => !note.isRest && note.midi != null && !note.isTabMirror,
  )
  notes = filterNotesForPracticeScope(notes, options.practiceScope, timingMap)
  notes = filterByLoopRegion(notes, loopRegion)

  notes = mergeTiedContinuations(notes)

  const groups = groupNotesByTime(notes)
  const harmonyEvents = options.harmonyEvents ?? timingMap?.harmonyEvents ?? []

  return groups.map((group, index) => {
    const midis = uniqueMidis(group.notes)
    const chordSymbol = resolveGroupChordSymbol(group, harmonyEvents)
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
      label: chordSymbol && midis.length > 1 ? chordSymbol : group.notes.map((note) => noteCheckpointLabel(note)).join(' + '),
      chordSymbol,
      expectedMidi: midis[0],
      expectedMidis: midis,
      isChord: midis.length > 1,
      notes: group.notes,
    }
  })
}

export function buildCheckpoints(timingMap, loopRegion, mode, options = {}) {
  if (mode === 'note') {
    return buildNoteCheckpoints(timingMap, loopRegion, options)
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
