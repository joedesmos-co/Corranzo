import {
  OMR_CHORD_MERGE_X,
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS,
} from './omrRhythmConstants.js'

const SPLIT_CHORD_TONE_MAX_X = OMR_CHORD_MERGE_X + 2
const SAME_STAFF_INNER_VOICE_REASON = 'same-staff-inner-voice-split'

const DURATION_LADDER = [
  { divisions: OMR_DIVISIONS_PER_QUARTER * 4, durationType: 'whole', dotted: false },
  { divisions: OMR_DIVISIONS_PER_QUARTER * 3, durationType: 'half', dotted: true },
  { divisions: OMR_DIVISIONS_PER_QUARTER * 2, durationType: 'half', dotted: false },
  { divisions: Math.round(OMR_DIVISIONS_PER_QUARTER * 1.5), durationType: 'quarter', dotted: true },
  { divisions: OMR_DIVISIONS_PER_QUARTER, durationType: 'quarter', dotted: false },
  { divisions: Math.round(OMR_DIVISIONS_PER_QUARTER * 0.75), durationType: 'eighth', dotted: true },
  { divisions: Math.round(OMR_DIVISIONS_PER_QUARTER / 2), durationType: 'eighth', dotted: false },
  { divisions: Math.max(1, Math.round(OMR_DIVISIONS_PER_QUARTER / 4)), durationType: 'sixteenth', dotted: false },
]

function average(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) {
    return 0
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function durationMeta(durationDivisions) {
  let best = DURATION_LADDER[DURATION_LADDER.length - 1]
  let bestDiff = Infinity
  for (const candidate of DURATION_LADDER) {
    const diff = Math.abs(candidate.divisions - durationDivisions)
    if (diff < bestDiff || (diff === bestDiff && candidate.divisions < best.divisions)) {
      bestDiff = diff
      best = candidate
    }
  }
  return { durationType: best.durationType, dotted: best.dotted }
}

function eventClef(event) {
  return event?.notes?.[0]?.clef ?? 'treble'
}

function eventCx(event) {
  return average((event?.notes ?? []).map((note) => note.cx))
}

function noteStemDirection(note) {
  if (typeof note?.stem === 'string') {
    return note.stem
  }
  return note?.stem?.direction ?? null
}

function hasBeamEvidence(event) {
  return (event?.notes ?? []).some(
    (note) => (note.beams ?? 0) > 0 || (note.beamStrength ?? 0) >= 8,
  )
}

function hasNoteBeamEvidence(note) {
  return (note?.beams ?? 0) > 0 || (note?.beamStrength ?? 0) >= 8
}

function noteInsideChordSpan(note, chordNotes) {
  const midi = note?.midi
  const midis = chordNotes.map((entry) => entry.midi).filter(Number.isFinite)
  if (!Number.isFinite(midi) || midis.length < 2) {
    return false
  }
  return midi >= Math.min(...midis) && midi <= Math.max(...midis)
}

function nextSameClefStart(events, anchor, totalDivisions) {
  const anchorStart = anchor.startDivision ?? 0
  const clef = eventClef(anchor)
  let nextStart = totalDivisions
  for (const event of events) {
    if (event === anchor || event.type !== 'note') {
      continue
    }
    const start = event.startDivision ?? 0
    if (start > anchorStart && eventClef(event) === clef) {
      nextStart = Math.min(nextStart, start)
    }
  }
  return nextStart
}

function sortEvents(events) {
  return [...events].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (eventClef(left) === 'bass' ? -1 : 1) - (eventClef(right) === 'bass' ? -1 : 1) ||
      eventCx(left) - eventCx(right),
  )
}

function sortChordNotes(notes) {
  return [...notes].sort((left, right) => (right.midi ?? 0) - (left.midi ?? 0))
}

function splitChordToneCandidate(anchor, follower) {
  if (anchor?.type !== 'note' || follower?.type !== 'note') {
    return false
  }
  if ((anchor.notes?.length ?? 0) < 3 || (follower.notes?.length ?? 0) !== 1) {
    return false
  }
  if (eventClef(anchor) !== eventClef(follower)) {
    return false
  }
  if ((follower.startDivision ?? 0) - (anchor.startDivision ?? 0) !== 1) {
    return false
  }
  if ((anchor.durationDivisions ?? OMR_DURATION_DIVISIONS.quarter) > OMR_DURATION_DIVISIONS.sixteenth) {
    return false
  }
  if ((follower.durationDivisions ?? 0) <= (anchor.durationDivisions ?? 0)) {
    return false
  }
  if (Math.abs(eventCx(anchor) - eventCx(follower)) > SPLIT_CHORD_TONE_MAX_X) {
    return false
  }
  if (hasBeamEvidence(anchor) || hasBeamEvidence(follower)) {
    return false
  }
  return noteInsideChordSpan(follower.notes[0], anchor.notes ?? [])
}

function mergeSplitChordTone(events, anchor, follower, totalDivisions) {
  const retained = events.filter((event) => event !== follower)
  const notes = sortChordNotes([...(anchor.notes ?? []), ...(follower.notes ?? [])])
  const durationDivisions = Math.max(
    1,
    nextSameClefStart(retained, anchor, totalDivisions) - (anchor.startDivision ?? 0),
  )
  return retained.map((event) => {
    if (event !== anchor) {
      return event
    }
    return {
      ...event,
      notes,
      cx: average(notes.map((note) => note.cx)),
      durationDivisions,
      ...durationMeta(durationDivisions),
      musicalEventReconstructionAdjusted: true,
      musicalEventReconstructionReasons: [
        ...new Set([
          ...(event.musicalEventReconstructionReasons ?? []),
          'split-chord-tone',
        ]),
      ],
    }
  })
}

function middleBassChordNote(event) {
  const notes = event?.notes ?? []
  if (notes.length !== 3 || notes.some((note) => note.clef !== 'bass')) {
    return null
  }
  const byPitch = [...notes].sort((left, right) => (left.midi ?? 0) - (right.midi ?? 0))
  if (byPitch.some((note) => !Number.isFinite(note.midi))) {
    return null
  }
  if (byPitch[0].midi === byPitch[1].midi || byPitch[1].midi === byPitch[2].midi) {
    return null
  }
  return byPitch[1]
}

function hasDuplicateAtStart(events, startDivision, note) {
  return events.some(
    (event) =>
      event.type === 'note' &&
      (event.startDivision ?? 0) === startDivision &&
      (event.notes ?? []).some(
        (candidate) => candidate.clef === note.clef && candidate.midi === note.midi,
      ),
  )
}

function sameStaffInnerVoiceSplitCandidate(events, event, totalDivisions) {
  if (event?.type !== 'note') {
    return null
  }
  const start = event.startDivision ?? 0
  const duration = event.durationDivisions ?? OMR_DURATION_DIVISIONS.quarter
  if (duration !== OMR_DURATION_DIVISIONS.eighth) {
    return null
  }

  const note = middleBassChordNote(event)
  if (!note) {
    return null
  }
  if ((note.durationDivisions ?? 0) !== OMR_DURATION_DIVISIONS.eighth) {
    return null
  }
  if (!note.dotted || noteStemDirection(note) !== 'down' || hasNoteBeamEvidence(note)) {
    return null
  }

  const targetStart = start + duration
  if (targetStart <= start || targetStart >= totalDivisions) {
    return null
  }
  if (hasDuplicateAtStart(events, targetStart, note)) {
    return null
  }

  return { note, targetStart }
}

function splitSameStaffInnerVoice(events, event, note, targetStart, totalDivisions) {
  const durationDivisions = Math.max(1, note.durationDivisions ?? OMR_DURATION_DIVISIONS.eighth)
  const retainedNotes = sortChordNotes((event.notes ?? []).filter((candidate) => candidate !== note))
  return sortEvents([
    ...events.map((candidate) => {
      if (candidate !== event) {
        return candidate
      }
      return {
        ...candidate,
        notes: retainedNotes,
        cx: average(retainedNotes.map((entry) => entry.cx)),
        musicalEventReconstructionAdjusted: true,
      }
    }),
    {
      ...event,
      startDivision: targetStart,
      durationDivisions,
      ...durationMeta(durationDivisions),
      notes: [note],
      cx: note.cx ?? eventCx(event),
      positionInMeasure: targetStart / totalDivisions,
      musicalEventReconstructionAdjusted: true,
      musicalEventReconstructionReasons: [
        ...new Set([
          ...(event.musicalEventReconstructionReasons ?? []),
          SAME_STAFF_INNER_VOICE_REASON,
        ]),
      ],
    },
  ])
}

export function reconstructMusicalEvents(events = [], { totalDivisions = 16 } = {}) {
  let reconstructed = [...events]
  let changed = true

  while (changed) {
    changed = false
    const noteEvents = sortEvents(reconstructed.filter((event) => event.type === 'note'))
    for (const event of noteEvents) {
      const split = sameStaffInnerVoiceSplitCandidate(reconstructed, event, totalDivisions)
      if (!split) {
        continue
      }
      reconstructed = splitSameStaffInnerVoice(
        reconstructed,
        event,
        split.note,
        split.targetStart,
        totalDivisions,
      )
      changed = true
      break
    }
    if (changed) {
      continue
    }
    for (const anchor of noteEvents) {
      const follower = noteEvents.find((event) => splitChordToneCandidate(anchor, event))
      if (!follower) {
        continue
      }
      reconstructed = mergeSplitChordTone(reconstructed, anchor, follower, totalDivisions)
      changed = true
      break
    }
  }

  return sortEvents(reconstructed)
}

export function summarizeMusicalEventReconstruction(events = []) {
  const adjustedEvents = events.filter((event) => event.musicalEventReconstructionAdjusted)
  const reasons = new Map()
  for (const event of adjustedEvents) {
    for (const reason of event.musicalEventReconstructionReasons ?? []) {
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
  }
  return {
    adjustedEventCount: adjustedEvents.length,
    adjustedNoteCount: adjustedEvents.reduce((sum, event) => sum + (event.notes?.length ?? 0), 0),
    reasons: Object.fromEntries([...reasons.entries()].sort()),
  }
}
