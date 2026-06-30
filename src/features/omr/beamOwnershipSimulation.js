const DURATION_TYPE_BY_DIVISIONS = {
  16: 'whole',
  8: 'half',
  4: 'quarter',
  2: 'eighth',
  1: 'sixteenth',
}

function durationTypeForDivisions(divisions) {
  return DURATION_TYPE_BY_DIVISIONS[divisions] ?? 'quarter'
}

function mergeReason(target, reason) {
  target[reason] = (target[reason] ?? 0) + 1
}

function cloneEvent(event) {
  return {
    ...event,
    notes: [...(event.notes ?? [])],
  }
}

function cloneMeasure(measure) {
  return {
    ...measure,
    events: (measure.events ?? []).map(cloneEvent),
  }
}

function noteCountInMeasures(measures = []) {
  return measures.reduce(
    (total, measure) =>
      total +
      (measure.events ?? []).reduce(
        (eventTotal, event) => eventTotal + (event.type === 'note' ? event.notes?.length ?? 0 : 0),
        0,
      ),
    0,
  )
}

function isStemmedSustainOwnership(ownership) {
  return (
    (ownership?.beamCount ?? 0) === 0 &&
    ownership?.likelyVoiceRole === 'stemmed-sustain-or-quarter-voice'
  )
}

function eligibleSplitPlan(event, ownershipEvent) {
  if (!ownershipEvent?.splitCandidate) {
    return { ok: false, reason: 'not-split-candidate' }
  }
  if (event?.type !== 'note') {
    return { ok: false, reason: 'not-note-event' }
  }
  if (event.tieStart || event.tieStop) {
    return { ok: false, reason: 'tie-event' }
  }
  if (!Number.isFinite(event.durationDivisions)) {
    return { ok: false, reason: 'missing-event-duration' }
  }
  if (!Number.isFinite(ownershipEvent.beamedExpectedDivisions)) {
    return { ok: false, reason: 'missing-beam-duration' }
  }
  if (event.durationDivisions <= ownershipEvent.beamedExpectedDivisions) {
    return { ok: false, reason: 'event-not-longer-than-beam' }
  }

  const notes = event.notes ?? []
  const ownerships = ownershipEvent.ownerships ?? []
  if (!notes.length || notes.length !== ownerships.length) {
    return { ok: false, reason: 'note-ownership-count-mismatch' }
  }

  const beamed = []
  const sustained = []
  for (let index = 0; index < ownerships.length; index += 1) {
    const ownership = ownerships[index]
    if ((ownership.beamCount ?? 0) > 0) {
      beamed.push({ note: notes[index], ownership })
      continue
    }
    sustained.push({ note: notes[index], ownership })
  }

  if (!beamed.length || !sustained.length) {
    return { ok: false, reason: 'missing-beamed-or-sustain-note' }
  }
  if (!sustained.some(({ ownership }) => isStemmedSustainOwnership(ownership))) {
    return { ok: false, reason: 'no-stemmed-sustain-note' }
  }
  if (sustained.some(({ ownership }) => !isStemmedSustainOwnership(ownership))) {
    return { ok: false, reason: 'ambiguous-sustain-ownership' }
  }

  const beamedGroups = new Set(beamed.map(({ ownership }) => ownership.beamGroupId).filter(Boolean))
  if (beamedGroups.size !== 1) {
    return { ok: false, reason: 'ambiguous-beam-group' }
  }
  if (beamed.some(({ ownership }) => !ownership.attachedBeamIds?.length)) {
    return { ok: false, reason: 'missing-attached-beam-id' }
  }
  const beamedExpectedValues = new Set(
    beamed.map(({ ownership }) => ownership.expectedDivisions).filter(Number.isFinite),
  )
  if (beamedExpectedValues.size > 1) {
    return { ok: false, reason: 'mixed-beam-durations' }
  }

  return {
    ok: true,
    beamGroupId: [...beamedGroups][0],
    beamedExpectedDivisions: ownershipEvent.beamedExpectedDivisions,
    beamedNotes: beamed.map(({ note }) => note),
    sustainedNotes: sustained.map(({ note }) => note),
    beamedOwnerships: beamed.map(({ ownership }) => ownership),
    sustainedOwnerships: sustained.map(({ ownership }) => ownership),
  }
}

function makeSimulatedSplitEvents(event, plan) {
  const beamedDuration = plan.beamedExpectedDivisions
  const beamedEvent = {
    ...event,
    durationDivisions: beamedDuration,
    durationType: durationTypeForDivisions(beamedDuration),
    dotted: false,
    notes: plan.beamedNotes,
    beams: Math.max(1, ...plan.beamedOwnerships.map((ownership) => ownership.beamLevel ?? 1)),
    beamOwnershipSimulation: {
      role: 'beamed-moving-note-event',
      beamGroupId: plan.beamGroupId,
      originalDurationDivisions: event.durationDivisions,
    },
  }
  const sustainedEvent = {
    ...event,
    notes: plan.sustainedNotes,
    beams: 0,
    beamOwnershipSimulation: {
      role: 'sustained-unbeamed-voice-event',
      beamGroupId: null,
      originalDurationDivisions: event.durationDivisions,
    },
  }
  return [beamedEvent, sustainedEvent]
}

export function simulateBeamOwnershipSplits(measures = []) {
  const beforeNoteCount = noteCountInMeasures(measures)
  const simulatedMeasures = []
  const summary = {
    candidateEvents: 0,
    appliedEvents: 0,
    appliedMovingNotes: 0,
    appliedSustainedNotes: 0,
    skippedReasons: {},
    samples: [],
    measureCountBefore: measures.length,
    measureCountAfter: measures.length,
    noteCountBefore: beforeNoteCount,
    noteCountAfter: beforeNoteCount,
    noteCountChanged: false,
    measureCountChanged: false,
  }

  for (const measure of measures) {
    const cloned = cloneMeasure(measure)
    const ownershipByEventIndex = new Map(
      (measure.beamStemGraph?.eventOwnership ?? []).map((event) => [event.eventIndex, event]),
    )
    const nextEvents = []
    for (let eventIndex = 0; eventIndex < (cloned.events ?? []).length; eventIndex += 1) {
      const event = cloned.events[eventIndex]
      const ownershipEvent = ownershipByEventIndex.get(eventIndex)
      if (ownershipEvent?.splitCandidate) {
        summary.candidateEvents += 1
      }
      const plan = eligibleSplitPlan(event, ownershipEvent)
      if (!plan.ok) {
        if (ownershipEvent?.splitCandidate) {
          mergeReason(summary.skippedReasons, plan.reason)
        }
        nextEvents.push(event)
        continue
      }

      const splitEvents = makeSimulatedSplitEvents(event, plan)
      nextEvents.push(...splitEvents)
      summary.appliedEvents += 1
      summary.appliedMovingNotes += plan.beamedNotes.length
      summary.appliedSustainedNotes += plan.sustainedNotes.length
      if (summary.samples.length < 32) {
        summary.samples.push({
          measureNumber: measure.measureNumber,
          eventIndex,
          startDivision: event.startDivision,
          originalDurationDivisions: event.durationDivisions,
          beamedDurationDivisions: plan.beamedExpectedDivisions,
          beamGroupId: plan.beamGroupId,
          movingNoteCount: plan.beamedNotes.length,
          sustainedNoteCount: plan.sustainedNotes.length,
          stemDirections: [...new Set((ownershipEvent.ownerships ?? []).map((o) => o.stemDirection).filter(Boolean))],
          reasons: ownershipEvent.reasons ?? [],
        })
      }
    }
    simulatedMeasures.push({
      ...cloned,
      events: nextEvents,
    })
  }

  const afterNoteCount = noteCountInMeasures(simulatedMeasures)
  summary.measureCountAfter = simulatedMeasures.length
  summary.noteCountAfter = afterNoteCount
  summary.noteCountChanged = afterNoteCount !== beforeNoteCount
  summary.measureCountChanged = simulatedMeasures.length !== measures.length

  return {
    measures: simulatedMeasures,
    summary,
  }
}
