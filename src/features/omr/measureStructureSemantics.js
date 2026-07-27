/**
 * Conservative measure-structure semantics for runtime MusicXML emission.
 *
 * Sprint 1 promotes two detector-owned facts:
 *  - same-staff events whose written durations visibly overlap need independent
 *    timing cursors/voices only when one event has long-value notation evidence;
 *  - one merged chord column may split only when strong opposing stems have
 *    continuity elsewhere in the same staff.
 *
 * Pitch, onset, duration, and note count are never changed.
 */

const MIN_STEM_OWNERSHIP_CONFIDENCE = 0.7
const MIN_DIRECTION_CONTINUITY_EVENTS = 2
const VALID_STEM_DIRECTIONS = new Set(['up', 'down'])

function clefForEvent(event) {
  return event?.clef ?? event?.notes?.[0]?.clef ?? 'treble'
}

function staffLaneForClef(clef) {
  return clef === 'bass' ? 'bass' : 'treble'
}

function defaultVoiceForStaff(staffLane) {
  return staffLane === 'bass' ? 2 : 1
}

function alternateVoiceForStaff(staffLane) {
  return staffLane === 'bass' ? 4 : 3
}

function voiceForLaneDirection(staffLane, direction) {
  if (staffLane === 'bass') {
    return direction === 'down' ? 4 : 2
  }
  return direction === 'down' ? 3 : 1
}

function ownershipDirection(ownership) {
  const direction = ownership?.stemDirection
  if (!VALID_STEM_DIRECTIONS.has(direction)) {
    return null
  }
  const confidence = Number.isFinite(ownership?.stemConfidence)
    ? ownership.stemConfidence
    : ownership?.confidence
  if (
    !Number.isFinite(confidence) ||
    confidence < MIN_STEM_OWNERSHIP_CONFIDENCE ||
    !ownership?.attachedStemId
  ) {
    return null
  }
  return direction
}

function ownershipByEvent(measure) {
  return new Map(
    (measure?.beamStemGraph?.eventOwnership ?? [])
      .filter((entry) => Number.isInteger(entry?.eventIndex))
      .map((entry) => [entry.eventIndex, entry]),
  )
}

function baseUnit(event, eventIndex) {
  const clef = clefForEvent(event)
  return {
    kind: event?.type === 'rest' ? 'rest' : 'note',
    event,
    eventIndex,
    startDivision: event?.startDivision ?? 0,
    durationDivisions: event?.durationDivisions,
    durationType: event?.durationType,
    dotted: Boolean(event?.dotted),
    clef,
    staffLane: staffLaneForClef(clef),
    notes: event?.type === 'rest' ? [] : event?.notes ?? [],
    ownerships: [],
    stemDirection: null,
    structureSplit: false,
  }
}

function analyzeNoteUnit(event, eventIndex, ownershipEvent) {
  const unit = baseUnit(event, eventIndex)
  const ownerships = ownershipEvent?.ownerships ?? []
  const notes = unit.notes
  if (!notes.length || ownerships.length !== notes.length) {
    return {
      unit,
      directions: [],
      mixedStemCandidate: false,
      rejectedReason: notes.length ? 'note-ownership-count-mismatch' : 'empty-note-event',
    }
  }
  const directions = ownerships.map(ownershipDirection)
  const strongDirections = new Set(directions.filter(Boolean))
  unit.ownerships = ownerships
  if (strongDirections.size === 1 && directions.every(Boolean)) {
    unit.stemDirection = [...strongDirections][0]
  }
  return {
    unit,
    directions,
    mixedStemCandidate:
      strongDirections.size === 2 && directions.every(Boolean),
    rejectedReason:
      strongDirections.size === 0
        ? 'no-strong-stem-ownership'
        : directions.some((direction) => direction == null)
          ? 'partial-stem-ownership'
          : null,
  }
}

function directionContinuity(analyses) {
  const counts = new Map()
  for (const analysis of analyses) {
    if (
      analysis.unit.kind !== 'note' ||
      analysis.unit.notes.length !== 1 ||
      !analysis.unit.stemDirection
    ) {
      continue
    }
    const key = analysis.unit.staffLane
    const current = counts.get(key) ?? { up: 0, down: 0 }
    current[analysis.unit.stemDirection] += 1
    counts.set(key, current)
  }
  return counts
}

function splitHasContinuity(analysis, continuity) {
  if (!analysis.mixedStemCandidate) return false
  const counts = continuity.get(analysis.unit.staffLane) ?? { up: 0, down: 0 }
  return (
    counts.up >= MIN_DIRECTION_CONTINUITY_EVENTS &&
    counts.down >= MIN_DIRECTION_CONTINUITY_EVENTS
  )
}

function splitAnalysis(analysis) {
  const byDirection = new Map()
  for (let index = 0; index < analysis.unit.notes.length; index += 1) {
    const direction = analysis.directions[index]
    const entry = byDirection.get(direction) ?? { notes: [], ownerships: [] }
    entry.notes.push(analysis.unit.notes[index])
    entry.ownerships.push(analysis.unit.ownerships[index])
    byDirection.set(direction, entry)
  }
  return [...byDirection.entries()].map(([direction, entry]) => ({
    ...analysis.unit,
    notes: entry.notes,
    ownerships: entry.ownerships,
    stemDirection: direction,
    structureSplit: true,
  }))
}

function unitHasBeamOwnership(unit) {
  return (unit.ownerships ?? []).some(
    (ownership) =>
      (ownership?.beamCount ?? 0) > 0 ||
      (ownership?.attachedBeamIds?.length ?? 0) > 0,
  )
}

function assignBeamOwner(units) {
  if (units.length <= 1) {
    return units.map((unit) => ({ ...unit, emitEventBeams: true }))
  }
  const beamed = units.filter(unitHasBeamOwnership)
  if (beamed.length === 1) {
    return units.map((unit) => ({
      ...unit,
      emitEventBeams: unit === beamed[0],
    }))
  }
  return units.map((unit, index) => ({
    ...unit,
    // One event-level beam cannot safely be broadcast across voice units.
    emitEventBeams: beamed.length === 0 ? index === 0 : false,
  }))
}

function intervalsOverlap(left, right) {
  const leftStart = left.startDivision ?? 0
  const rightStart = right.startDivision ?? 0
  const leftEnd = leftStart + Math.max(0, left.durationDivisions ?? 0)
  const rightEnd = rightStart + Math.max(0, right.durationDivisions ?? 0)
  return leftStart < rightEnd && rightStart < leftEnd
}

function hasWrittenSustainEvidence(unit) {
  if (unit.kind !== 'note' || (unit.durationDivisions ?? 0) < 8) {
    return false
  }
  if (unit.dotted && (unit.durationDivisions ?? 0) >= 12) {
    return true
  }
  if (unit.durationType === 'whole') {
    return true
  }
  return (
    unit.durationType === 'half' &&
    unit.notes.some(
      (note) =>
        note?.hollowGlyph === true ||
        note?.hollow === true ||
        note?.noteheadType === 'hollow',
    )
  )
}

function staffHasIndependentOverlap(units) {
  for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
    const left = units[leftIndex]
    if (left.kind !== 'note') continue
    for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
      const right = units[rightIndex]
      if (
        right.kind === 'note' &&
        left.staffLane === right.staffLane &&
        left.eventIndex !== right.eventIndex &&
        intervalsOverlap(left, right) &&
        (hasWrittenSustainEvidence(left) || hasWrittenSustainEvidence(right))
      ) {
        return true
      }
    }
  }
  return false
}

function assignStaffVoices(units, polyphonicStaffs) {
  const byStaff = new Map()
  units.forEach((unit) => {
    const entries = byStaff.get(unit.staffLane) ?? []
    entries.push(unit)
    byStaff.set(unit.staffLane, entries)
  })

  for (const [staffLane, entries] of byStaff) {
    const polyphonic = polyphonicStaffs.has(staffLane)
    const assigned = []
    entries.sort(
      (left, right) =>
        left.startDivision - right.startDivision ||
        left.eventIndex - right.eventIndex ||
        Number(left.stemDirection === 'down') - Number(right.stemDirection === 'down'),
    )
    for (const unit of entries) {
      if (unit.kind === 'rest' || !polyphonic) {
        unit.voice = defaultVoiceForStaff(staffLane)
        assigned.push(unit)
        continue
      }
      let preferred = unit.stemDirection
        ? voiceForLaneDirection(staffLane, unit.stemDirection)
        : defaultVoiceForStaff(staffLane)
      const conflicts = assigned.filter(
        (entry) =>
          entry.kind === 'note' &&
          entry.eventIndex !== unit.eventIndex &&
          intervalsOverlap(entry, unit),
      )
      if (conflicts.some((entry) => entry.voice === preferred)) {
        preferred =
          preferred === defaultVoiceForStaff(staffLane)
            ? alternateVoiceForStaff(staffLane)
            : defaultVoiceForStaff(staffLane)
      }
      unit.voice = preferred
      assigned.push(unit)
    }
  }
}

/**
 * Build immutable serialization units for one measure.
 */
export function buildMeasureStructureUnits(measure = {}) {
  const byEvent = ownershipByEvent(measure)
  const analyses = (measure.events ?? []).map((event, eventIndex) =>
    event?.type === 'rest'
      ? {
          unit: baseUnit(event, eventIndex),
          directions: [],
          mixedStemCandidate: false,
          rejectedReason: null,
        }
      : analyzeNoteUnit(event, eventIndex, byEvent.get(eventIndex) ?? null),
  )
  const continuity = directionContinuity(analyses)
  const rejectedReasons = {}
  const provisional = []
  let splitEventCount = 0
  let splitNoteCount = 0

  for (const analysis of analyses) {
    if (analysis.rejectedReason) {
      rejectedReasons[analysis.rejectedReason] =
        (rejectedReasons[analysis.rejectedReason] ?? 0) + 1
    }
    if (analysis.mixedStemCandidate && !splitHasContinuity(analysis, continuity)) {
      rejectedReasons['opposing-stems-without-voice-continuity'] =
        (rejectedReasons['opposing-stems-without-voice-continuity'] ?? 0) + 1
    }
    const units = splitHasContinuity(analysis, continuity)
      ? splitAnalysis(analysis)
      : [analysis.unit]
    if (units.length > 1) {
      splitEventCount += 1
      splitNoteCount += units.reduce((sum, unit) => sum + unit.notes.length, 0)
    }
    provisional.push(...assignBeamOwner(units))
  }

  const polyphonicStaffs = new Set(
    ['treble', 'bass'].filter((staffLane) => {
      const staffUnits = provisional.filter((unit) => unit.staffLane === staffLane)
      return (
        staffUnits.some((unit) => unit.structureSplit) ||
        staffHasIndependentOverlap(staffUnits)
      )
    }),
  )
  assignStaffVoices(provisional, polyphonicStaffs)
  const units = provisional.map((unit, order) => ({ ...unit, order }))
  const defaultVoiceReassignments = units.filter(
    (unit) =>
      unit.kind === 'note' &&
      unit.voice !== defaultVoiceForStaff(unit.staffLane),
  ).length

  return {
    units,
    diagnostics: {
      eventCount: measure.events?.length ?? 0,
      serializationUnitCount: units.length,
      splitEventCount,
      splitNoteCount,
      overlappingVoiceEventCount: defaultVoiceReassignments,
      polyphonicStaffs: [...polyphonicStaffs].sort(),
      rejectedReasons,
      changedPitchCount: 0,
      changedOnsetCount: 0,
      changedDurationCount: 0,
      changedNoteCount: 0,
    },
  }
}

export {
  MIN_DIRECTION_CONTINUITY_EVENTS,
  MIN_STEM_OWNERSHIP_CONFIDENCE,
}
