import {
  OMR_CHORD_MERGE_X,
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS,
} from './omrRhythmConstants.js'

const VALID_DIRECTIONS = new Set(['up', 'down'])
const STANDARD_GRID_UNITS = new Set([
  OMR_DURATION_DIVISIONS.sixteenth,
  OMR_DURATION_DIVISIONS.eighth,
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS.half,
  OMR_DURATION_DIVISIONS.whole,
])

const DURATION_LADDER = [
  { divisions: OMR_DURATION_DIVISIONS.whole, durationType: 'whole', dotted: false },
  {
    divisions: OMR_DURATION_DIVISIONS.half + OMR_DIVISIONS_PER_QUARTER,
    durationType: 'half',
    dotted: true,
  },
  { divisions: OMR_DURATION_DIVISIONS.half, durationType: 'half', dotted: false },
  {
    divisions: Math.round(OMR_DIVISIONS_PER_QUARTER * 1.5),
    durationType: 'quarter',
    dotted: true,
  },
  { divisions: OMR_DIVISIONS_PER_QUARTER, durationType: 'quarter', dotted: false },
  { divisions: OMR_DURATION_DIVISIONS.eighth, durationType: 'eighth', dotted: false },
  {
    divisions: OMR_DURATION_DIVISIONS.sixteenth,
    durationType: 'sixteenth',
    dotted: false,
  },
]

function average(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function durationMeta(durationDivisions, dottedEvidence = false) {
  let best = DURATION_LADDER.at(-1)
  let bestDistance = Infinity
  for (const candidate of DURATION_LADDER) {
    if (candidate.dotted && !dottedEvidence) continue
    const distance = Math.abs(candidate.divisions - durationDivisions)
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.divisions < best.divisions)
    ) {
      best = candidate
      bestDistance = distance
    }
  }
  return { durationType: best.durationType, dotted: best.dotted }
}

function eventClef(event) {
  return event?.clef ?? event?.notes?.[0]?.clef ?? 'treble'
}

function eventX(event) {
  if (Number.isFinite(event?.cx)) return event.cx
  return average((event?.notes ?? []).map((note) => note.cx))
}

function noteDirection(note) {
  const direction =
    note?.stemDirection ??
    (typeof note?.stem === 'string' ? note.stem : note?.stem?.direction)
  return VALID_DIRECTIONS.has(direction) ? direction : null
}

function eventDirections(event) {
  if (event?.type === 'rest') {
    const direction =
      event.rhythmVoice ?? event.voiceDirection ?? event.stemDirection
    return VALID_DIRECTIONS.has(direction) ? [direction] : []
  }
  return [
    ...new Set((event?.notes ?? []).map(noteDirection).filter(Boolean)),
  ]
}

function noteheadDuration(note) {
  if (note?.noteheadGlyph === 'whole') return OMR_DURATION_DIVISIONS.whole
  if (note?.noteheadGlyph === 'half') {
    return note.dotted
      ? OMR_DURATION_DIVISIONS.half + OMR_DIVISIONS_PER_QUARTER
      : OMR_DURATION_DIVISIONS.half
  }
  if (note?.dotted && Number.isFinite(note.durationDivisions)) {
    return note.durationDivisions
  }
  if ((note?.beams ?? 0) >= 2) return OMR_DURATION_DIVISIONS.sixteenth
  if ((note?.beams ?? 0) === 1) return OMR_DURATION_DIVISIONS.eighth
  if (
    note?.noteheadGlyph === 'black' &&
    noteDirection(note) &&
    (note?.confidence ?? 1) >= 0.7
  ) {
    return OMR_DIVISIONS_PER_QUARTER
  }
  return null
}

function authoritativeEventDuration(event) {
  if (
    event?.type === 'rest' &&
    Number.isFinite(event.durationDivisions) &&
    event.durationDivisions > 0
  ) {
    return event.durationDivisions
  }
  const values = (event?.notes ?? []).map(noteheadDuration)
  if (!values.length || values.some((value) => value == null)) return null
  return values.every((value) => value === values[0]) ? values[0] : null
}

function longWrittenEvent(event, totalDivisions) {
  const duration = authoritativeEventDuration(event)
  return duration != null && duration >= totalDivisions / 2
}

function directionColumns(events, clef) {
  const columns = { up: new Set(), down: new Set() }
  for (const event of events) {
    if (event.type !== 'note' || eventClef(event) !== clef) continue
    const x = eventX(event)
    if (!Number.isFinite(x)) continue
    for (const direction of eventDirections(event)) {
      columns[direction].add(Math.round(x))
    }
  }
  return columns
}

function sameStaffVoiceEvidence(events, clef, totalDivisions) {
  const columns = directionColumns(events, clef)
  if (columns.up.size >= 2 && columns.down.size >= 2) return true

  for (const direction of VALID_DIRECTIONS) {
    const other = direction === 'up' ? 'down' : 'up'
    if (columns[direction].size < 4 || columns[other].size !== 1) continue
    const sustained = events.some(
      (event) =>
        event.type === 'note' &&
        eventClef(event) === clef &&
        eventDirections(event).includes(other) &&
        longWrittenEvent(event, totalDivisions),
    )
    if (sustained) return true
  }
  return false
}

function mixedStemChordIsIndependentVoices(byDirection) {
  const durations = []
  for (const notes of byDirection.values()) {
    const values = notes.map(noteheadDuration)
    if (!values.length || values.some((value) => value == null)) return false
    if (!values.every((value) => value === values[0])) return false
    durations.push(values[0])
  }
  // Only peel a same-column mixed-stem stack when one direction is sustained
  // (half/whole) and differs from the other. Guitar chord engraving routinely
  // flips the top tone's stem without creating an independent voice.
  return (
    durations.length >= 2 &&
    new Set(durations).size > 1 &&
    durations.some((value) => value >= OMR_DURATION_DIVISIONS.half)
  )
}

function splitEventByDirection(event, splitClefs) {
  if (
    event?.type !== 'note' ||
    !splitClefs.has(eventClef(event)) ||
    eventDirections(event).length < 2
  ) {
    return [event]
  }
  const byDirection = new Map()
  for (const note of event.notes ?? []) {
    const direction = noteDirection(note)
    if (!direction) return [event]
    const notes = byDirection.get(direction) ?? []
    notes.push(note)
    byDirection.set(direction, notes)
  }
  if (byDirection.size < 2) return [event]
  const xs = (event.notes ?? []).map((note) => note.cx).filter(Number.isFinite)
  const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  if (spread <= OMR_CHORD_MERGE_X && !mixedStemChordIsIndependentVoices(byDirection)) {
    return [event]
  }
  return [...byDirection.entries()].map(([direction, notes]) => ({
    ...event,
    notes,
    cx: average(notes.map((note) => note.cx)) ?? event.cx,
    rhythmVoiceKey: `${eventClef(event)}:${direction}`,
    jointPolyphonicVoiceSplit: true,
  }))
}

function laneKey(event, splitClefs) {
  const clef = eventClef(event)
  if (!splitClefs.has(clef)) return `${clef}:staff`
  const directions = eventDirections(event)
  return directions.length === 1 ? `${clef}:${directions[0]}` : null
}

function directionsConflict(left, right) {
  const leftDirections = eventDirections(left)
  const rightDirections = eventDirections(right)
  return (
    leftDirections.length === 1 &&
    rightDirections.length === 1 &&
    leftDirections[0] !== rightDirections[0]
  )
}

function coalesceLaneColumns(events, splitClefs) {
  const merged = []
  for (const event of sortedEvents(events)) {
    if (event.type !== 'note') {
      merged.push({ ...event })
      continue
    }
    const key = laneKey(event, splitClefs)
    const x = eventX(event)
    const match = merged.find(
      (candidate) =>
        candidate.type === 'note' &&
        laneKey(candidate, splitClefs) === key &&
        Number.isFinite(x) &&
        Number.isFinite(eventX(candidate)) &&
        Math.abs(eventX(candidate) - x) <= 5 &&
        !directionsConflict(candidate, event),
    )
    if (!match) {
      merged.push({ ...event, notes: [...(event.notes ?? [])] })
      continue
    }
    match.notes = [...(match.notes ?? []), ...(event.notes ?? [])]
    match.cx = average(match.notes.map((note) => note.cx)) ?? match.cx
    match.durationDivisions = Math.max(
      match.durationDivisions ?? 1,
      event.durationDivisions ?? 1,
    )
    match.dotted = Boolean(match.dotted || event.dotted)
    match.jointPolyphonicChordCoalesced = true
  }
  return merged
}

function spacingWeight(ratio) {
  if (ratio >= 0.72 && ratio <= 1.28) return 1
  if (ratio >= 1.45 && ratio <= 2.3) return 2
  if (ratio >= 2.55 && ratio <= 3.4) return 3
  if (ratio >= 3.55 && ratio <= 4.45) return 4
  return null
}

function proposalFromWrittenDurations(events, totalDivisions) {
  const durations = events.map(authoritativeEventDuration)
  if (durations.some((duration) => duration == null)) return null
  if (durations.reduce((sum, duration) => sum + duration, 0) !== totalDivisions) {
    return null
  }
  let cursor = 0
  return events.map((event, index) => {
    const proposal = {
      event,
      startDivision: cursor,
      durationDivisions: durations[index],
      source: 'written-duration-sequence',
    }
    cursor += durations[index]
    return proposal
  })
}

function proposalFromGeometry(events, totalDivisions) {
  if (events.length === 1) {
    const duration = authoritativeEventDuration(events[0])
    if (duration !== totalDivisions) return null
    return [
      {
        event: events[0],
        startDivision: 0,
        durationDivisions: totalDivisions,
        source: 'written-whole-lane',
      },
    ]
  }

  const gaps = []
  for (let index = 1; index < events.length; index += 1) {
    const gap = eventX(events[index]) - eventX(events[index - 1])
    if (!Number.isFinite(gap) || gap <= 2) return null
    gaps.push(gap)
  }
  const shortestHalf = [...gaps]
    .sort((left, right) => left - right)
    .slice(0, Math.ceil(gaps.length / 2))
  const baseGap = median(shortestHalf)
  if (!(baseGap > 0)) return null
  const weights = gaps.map((gap) => spacingWeight(gap / baseGap))
  if (weights.some((weight) => weight == null)) return null
  const terminalWeight = Math.round(
    median(weights.slice(-Math.min(3, weights.length))),
  )
  const totalWeight =
    weights.reduce((sum, weight) => sum + weight, 0) + terminalWeight
  const unit = totalDivisions / totalWeight
  if (!Number.isInteger(unit) || !STANDARD_GRID_UNITS.has(unit)) return null

  const starts = [0]
  for (const weight of weights) {
    starts.push(starts.at(-1) + weight * unit)
  }
  return events.map((event, index) => ({
    event,
    startDivision: starts[index],
    durationDivisions:
      (index < weights.length ? weights[index] : terminalWeight) * unit,
    source: 'relative-column-spacing',
  }))
}

function proposeLane(events, totalDivisions) {
  const sorted = [...events].sort(
    (left, right) =>
      eventX(left) - eventX(right) ||
      (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )
  return (
    proposalFromWrittenDurations(sorted, totalDivisions) ??
    proposalFromGeometry(sorted, totalDivisions)
  )
}

function laneOpeningsAlign(lanes) {
  const firstXs = lanes
    .map((events) => eventX(events[0]))
    .filter(Number.isFinite)
  const allXs = lanes.flatMap((events) => events.map(eventX)).filter(Number.isFinite)
  if (firstXs.length !== lanes.length || !allXs.length) return false
  const span = Math.max(...allXs) - Math.min(...allXs)
  const tolerance = Math.max(8, span * 0.08)
  return Math.max(...firstXs) - Math.min(...firstXs) <= tolerance
}

function noteCount(events) {
  return events.reduce(
    (sum, event) =>
      sum + (event.type === 'note' ? event.notes?.length ?? 0 : 0),
    0,
  )
}

function restCount(events) {
  return events.filter((event) => event.type === 'rest').length
}

function sortedEvents(events) {
  return [...events].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      eventX(left) - eventX(right),
  )
}

/**
 * Reconstruct independent, meter-complete timelines only when geometry proves
 * distinct staff lanes or sustained opposing-stem lanes. Ambiguous measures are
 * returned byte-for-byte untouched.
 */
export function packJointPolyphonicRhythm(
  events = [],
  { totalDivisions = OMR_DIVISIONS_PER_QUARTER * 4 } = {},
) {
  if (!events.length || !(totalDivisions > 0)) {
    return { events, applied: false, reason: 'empty-or-invalid-measure' }
  }
  if (
    events.some(
      (event) =>
        !Number.isFinite(event.startDivision) ||
        event.startDivision < 0 ||
        event.startDivision >= totalDivisions,
    )
  ) {
    return { events, applied: false, reason: 'event-outside-meter' }
  }

  const noteEvents = events.filter((event) => event.type === 'note')
  const clefs = [...new Set(noteEvents.map(eventClef))]
  const pairedStaffEvidence = clefs.length >= 2
  const splitClefs = new Set(
    pairedStaffEvidence
      ? []
      : clefs.filter((clef) =>
          sameStaffVoiceEvidence(noteEvents, clef, totalDivisions),
        ),
  )
  if (!pairedStaffEvidence && splitClefs.size === 0) {
    return { events, applied: false, reason: 'ambiguous-voice-assignment' }
  }

  const expanded = events.flatMap((event) =>
    splitEventByDirection(event, splitClefs),
  )
  const coalesced = coalesceLaneColumns(expanded, splitClefs)
  const lanesByKey = new Map()
  for (const event of coalesced) {
    const key = laneKey(event, splitClefs)
    if (!key) {
      return { events, applied: false, reason: 'ambiguous-voice-assignment' }
    }
    const lane = lanesByKey.get(key) ?? []
    lane.push(event)
    lanesByKey.set(key, lane)
  }
  if (lanesByKey.size < 2) {
    return { events, applied: false, reason: 'ambiguous-voice-assignment' }
  }

  const lanes = [...lanesByKey.values()].map((lane) =>
    [...lane].sort((left, right) => eventX(left) - eventX(right)),
  )
  if (!laneOpeningsAlign(lanes)) {
    return { events, applied: false, reason: 'lane-openings-not-aligned' }
  }

  const proposals = new Map()
  const sources = {}
  for (const [key, lane] of lanesByKey) {
    const proposal = proposeLane(lane, totalDivisions)
    if (!proposal) {
      return { events, applied: false, reason: 'incomplete-lane-evidence' }
    }
    sources[key] = [...new Set(proposal.map((entry) => entry.source))]
    for (const entry of proposal) proposals.set(entry.event, { ...entry, key })
  }

  const beforeNotes = noteCount(events)
  const beforeRests = restCount(events)
  let changed = coalesced.length !== events.length
  const packed = coalesced.map((event) => {
    const proposal = proposals.get(event)
    if (!proposal) return event
    if (
      proposal.startDivision !== event.startDivision ||
      proposal.durationDivisions !== event.durationDivisions
    ) {
      changed = true
    }
    const dottedEvidence =
      Boolean(event.dotted) ||
      (event.notes ?? []).some((note) => note.dotted === true)
    return {
      ...event,
      startDivision: proposal.startDivision,
      durationDivisions: proposal.durationDivisions,
      ...durationMeta(proposal.durationDivisions, dottedEvidence),
      rhythmVoiceKey: proposal.key,
      jointPolyphonicRhythmAdjusted: true,
      jointPolyphonicRhythmSource: proposal.source,
    }
  })

  if (
    noteCount(packed) !== beforeNotes ||
    restCount(packed) !== beforeRests ||
    packed.some(
      (event) =>
        event.startDivision < 0 ||
        event.startDivision + Math.max(1, event.durationDivisions ?? 0) >
          totalDivisions,
    )
  ) {
    return { events, applied: false, reason: 'preservation-check-failed' }
  }
  if (!changed) {
    return { events, applied: false, reason: 'already-consistent' }
  }
  return {
    events: sortedEvents(packed),
    applied: true,
    reason: 'joint-lanes-meter-complete',
    diagnostics: {
      laneCount: lanesByKey.size,
      laneKeys: [...lanesByKey.keys()],
      sources,
      splitEventCount: expanded.length - events.length,
      coalescedEventCount: expanded.length - coalesced.length,
      noteCountBefore: beforeNotes,
      noteCountAfter: noteCount(packed),
      restCountBefore: beforeRests,
      restCountAfter: restCount(packed),
    },
  }
}
