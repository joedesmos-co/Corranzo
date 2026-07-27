/**
 * Guitar mapping quality metrics — independent of the semantic OMR evaluator.
 *
 * Evaluates sounding-MIDI → string/fret assignments for validity, playability,
 * and continuity. Does not inspect or modify recognized pitches.
 */

import { DEFAULT_MAX_CHORD_SPAN, midiForStringFret } from './fretboard.js'
import { NOTE_TIME_GROUP_SECONDS } from '../practice/noteTimeGrouping.js'

export { DEFAULT_MAX_CHORD_SPAN }

export const GUITAR_MAPPING_FAILURE = {
  SAME_STRING_CONFLICT: 'same-string-conflict',
  IMPOSSIBLE_CHORD: 'impossible-chord',
  EXCESSIVE_SPAN: 'excessive-fret-span',
  EXCESSIVE_JUMP: 'unnecessary-position-jump',
  OVER_MAX_FRET: 'pitch-outside-fret-range',
  INVALID_ASSIGNMENT: 'invalid-assignment',
  MISSING_ASSIGNMENT: 'missing-assignment',
  MIDI_FRET_MISMATCH: 'midi-fret-mismatch',
}

/** Position jump treated as excessive between consecutive events. */
export const DEFAULT_EXCESSIVE_JUMP = 5

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value))
  if (!nums.length) {
    return null
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) {
    return null
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[index]
}

export function groupNotesIntoOnsetEvents(
  notes,
  { chordEpsilonSeconds = NOTE_TIME_GROUP_SECONDS } = {},
) {
  const sounding = (notes ?? []).filter((note) => !note.isRest && note.midi != null)
  const events = []
  let index = 0
  while (index < sounding.length) {
    const time = sounding[index].timeSeconds ?? 0
    const group = [sounding[index]]
    let next = index + 1
    while (
      next < sounding.length &&
      Math.abs((sounding[next].timeSeconds ?? 0) - time) <= chordEpsilonSeconds
    ) {
      group.push(sounding[next])
      next += 1
    }
    events.push({ timeSeconds: time, notes: group })
    index = next
  }
  return events
}

export function chordFrettedSpan(positions) {
  const frets = (positions ?? [])
    .map((position) => position?.fret)
    .filter((fret) => Number.isFinite(fret) && fret > 0)
  if (frets.length < 2) {
    return 0
  }
  return Math.max(...frets) - Math.min(...frets)
}

export function eventHandFret(notes) {
  const frets = (notes ?? [])
    .map((note) => note.fret)
    .filter((fret) => Number.isFinite(fret) && fret > 0)
  if (!frets.length) {
    return null
  }
  frets.sort((a, b) => a - b)
  return frets[Math.floor(frets.length / 2)]
}

/**
 * Score one mapped note list. MIDI pitches are treated as ground truth.
 */
export function evaluateGuitarMapping(
  notes,
  strings,
  {
    chordEpsilonSeconds = NOTE_TIME_GROUP_SECONDS,
    maxChordSpan = DEFAULT_MAX_CHORD_SPAN,
    excessiveJump = DEFAULT_EXCESSIVE_JUMP,
  } = {},
) {
  const events = groupNotesIntoOnsetEvents(notes, { chordEpsilonSeconds })
  const failureCounts = Object.fromEntries(
    Object.values(GUITAR_MAPPING_FAILURE).map((code) => [code, 0]),
  )
  const jumps = []
  const spans = []
  let repeatedTotal = 0
  let repeatedSameString = 0
  let invalidAssignments = 0
  let sameStringConflicts = 0
  let impossibleChords = 0
  let overMaxFret = 0
  let prevHand = null
  const prevByMidi = new Map()

  const eventReports = []
  for (const event of events) {
    const used = new Map()
    let missing = 0
    let eventInvalid = 0
    const positions = []
    for (const note of event.notes) {
      if (note.string == null || note.fret == null) {
        missing += 1
        eventInvalid += 1
        failureCounts[GUITAR_MAPPING_FAILURE.MISSING_ASSIGNMENT] += 1
        continue
      }
      positions.push({ string: note.string, fret: note.fret, midi: note.midi })
      if (note.fret < 0 || note.fret > strings.fretCount) {
        overMaxFret += 1
        eventInvalid += 1
        failureCounts[GUITAR_MAPPING_FAILURE.OVER_MAX_FRET] += 1
      }
      const expected = midiForStringFret(strings, note.string, note.fret)
      if (expected !== note.midi) {
        eventInvalid += 1
        failureCounts[GUITAR_MAPPING_FAILURE.MIDI_FRET_MISMATCH] += 1
      }
      if (used.has(note.string)) {
        sameStringConflicts += 1
        failureCounts[GUITAR_MAPPING_FAILURE.SAME_STRING_CONFLICT] += 1
      }
      used.set(note.string, note)
      const previous = prevByMidi.get(note.midi)
      if (previous) {
        repeatedTotal += 1
        if (previous.string === note.string) {
          repeatedSameString += 1
        }
      }
    }

    const span = chordFrettedSpan(positions)
    if (event.notes.length >= 2) {
      spans.push(span)
      if (span > maxChordSpan) {
        failureCounts[GUITAR_MAPPING_FAILURE.EXCESSIVE_SPAN] += 1
      }
      const fullyAssigned =
        missing === 0 && new Set(positions.map((position) => position.string)).size === positions.length
      if (!fullyAssigned) {
        impossibleChords += 1
        failureCounts[GUITAR_MAPPING_FAILURE.IMPOSSIBLE_CHORD] += 1
      }
    }

    const hand = eventHandFret(event.notes)
    let jump = null
    if (prevHand != null && hand != null) {
      jump = Math.abs(hand - prevHand)
      jumps.push(jump)
      if (jump >= excessiveJump) {
        failureCounts[GUITAR_MAPPING_FAILURE.EXCESSIVE_JUMP] += 1
      }
    }
    if (hand != null) {
      prevHand = hand
    }
    for (const note of event.notes) {
      if (note.string != null) {
        prevByMidi.set(note.midi, { string: note.string, fret: note.fret })
      }
    }

    invalidAssignments += eventInvalid
    eventReports.push({
      timeSeconds: event.timeSeconds,
      midis: event.notes.map((note) => note.midi),
      positions,
      span,
      jump,
      handFret: hand,
      playable: event.notes.length < 2 || (missing === 0 && sameStringConflicts === 0 && eventInvalid === 0),
    })
  }

  return {
    eventCount: events.length,
    noteCount: events.reduce((sum, event) => sum + event.notes.length, 0),
    invalidAssignments,
    sameStringConflicts,
    impossibleChords,
    overMaxFret,
    avgJump: average(jumps),
    p95Jump: percentile(jumps, 0.95),
    maxJump: jumps.length ? Math.max(...jumps) : null,
    avgSpan: average(spans),
    maxSpan: spans.length ? Math.max(...spans) : null,
    repeatedNoteSameStringPct:
      repeatedTotal > 0 ? (100 * repeatedSameString) / repeatedTotal : null,
    repeatedTotal,
    failureCounts,
    events: eventReports,
  }
}
