/** Constraint-based Piano voice candidates for the OMR V3 shadow IR. */

import {
  createOmrDocumentIR,
  createOmrMeasureColumnIR,
  createOmrRelationshipIR,
  createOmrV3Diagnostic,
  createOmrV3Id,
  createOmrVoiceIR,
  OMR_V3_DIAGNOSTIC_SEVERITY,
  OMR_V3_RELATIONSHIP_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
} from './omrV3Ir.js'

const DEFAULT_MEASURE_DIVISIONS = 16
const EPSILON = 1e-6

const MIDI_STEPS = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
]

function average(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0
}

function pitchFromSymbol(symbol) {
  if (symbol?.pitch && typeof symbol.pitch === 'object') return { ...symbol.pitch }
  if (!Number.isFinite(symbol?.midi)) return null
  const midi = Math.round(symbol.midi)
  const [step, alter] = MIDI_STEPS[((midi % 12) + 12) % 12]
  return { step, alter, octave: Math.floor(midi / 12) - 1, midi }
}

function durationFromSymbol(symbol) {
  const divisions = Number(symbol?.duration?.divisions ?? symbol?.durationDivisions)
  if (!Number.isFinite(divisions) || divisions <= 0) return null
  return {
    divisions,
    type: symbol?.duration?.type ?? null,
    dots: Number.isInteger(symbol?.duration?.dots) ? symbol.duration.dots : 0,
    exact: symbol?.duration?.exact !== false,
  }
}

function symbolOnset(symbol, column, totalDivisions) {
  if (Number.isFinite(symbol?.onsetDivisions) && symbol.onsetDivisions >= 0) {
    return { divisions: symbol.onsetDivisions, exact: true }
  }
  if (Number.isFinite(column.measureRelativePosition)) {
    return {
      divisions: column.measureRelativePosition * totalDivisions,
      exact: false,
    }
  }
  return { divisions: null, exact: false }
}

function durationKey(duration) {
  return duration ? `${duration.divisions}:${duration.type ?? ''}:${duration.dots}` : 'unresolved'
}

function itemKey(symbol) {
  const stemKey = symbol.stemGroupId ?? symbol.stemDirection ?? symbol.voiceHint ?? 'shared'
  return `${stemKey}:${durationKey(durationFromSymbol(symbol))}`
}

function preferredLane(symbols) {
  const voiceHint = symbols.find((symbol) => Number.isFinite(symbol.voiceHint))?.voiceHint
  if (Number.isFinite(voiceHint)) return Math.max(0, Math.round(voiceHint) - 1)
  const directions = new Set(symbols.map((symbol) => symbol.stemDirection).filter(Boolean))
  if (directions.size !== 1) return null
  return directions.has('up') ? 0 : directions.has('down') ? 1 : null
}

function symbolsInColumn(column, staffId, symbolLookup, collection) {
  return (column.symbols?.[collection] ?? [])
    .map((symbolId) => symbolLookup.get(symbolId))
    .filter((symbol) => symbol?.ownership?.staffId === staffId)
}

function makeNoteItem(symbols, column, totalDivisions) {
  const onset = symbolOnset(symbols[0], column, totalDivisions)
  const duration = durationFromSymbol(symbols[0])
  return {
    kind: 'note',
    symbols,
    column,
    onset,
    duration,
    preferredLane: preferredLane(symbols),
    stemDirection: symbols[0].stemDirection ?? null,
    stemGroupId: symbols[0].stemGroupId ?? null,
    beamGroupId: symbols[0].beamGroupId ?? null,
  }
}

function makeRestItem(symbol, column, totalDivisions) {
  return {
    kind: 'rest',
    symbols: [symbol],
    column,
    onset: symbolOnset(symbol, column, totalDivisions),
    duration: durationFromSymbol(symbol),
    preferredLane: preferredLane([symbol]),
    stemDirection: null,
    stemGroupId: null,
    beamGroupId: null,
  }
}

function itemsForStaff(measure, staffId, symbolLookup, totalDivisions) {
  const items = []
  for (const column of measure.onsetColumns ?? []) {
    const noteheads = symbolsInColumn(column, staffId, symbolLookup, 'noteheads')
    const noteGroups = new Map()
    for (const symbol of noteheads) {
      const key = itemKey(symbol)
      if (!noteGroups.has(key)) noteGroups.set(key, [])
      noteGroups.get(key).push(symbol)
    }
    for (const symbols of noteGroups.values()) {
      items.push(makeNoteItem(symbols, column, totalDivisions))
    }
    for (const rest of symbolsInColumn(column, staffId, symbolLookup, 'rests')) {
      items.push(makeRestItem(rest, column, totalDivisions))
    }
  }
  return items.sort(
    (left, right) =>
      (left.onset.divisions ?? Number.POSITIVE_INFINITY) -
        (right.onset.divisions ?? Number.POSITIVE_INFINITY) ||
      (left.preferredLane ?? 99) - (right.preferredLane ?? 99),
  )
}

function classifyItems(items, totalDivisions) {
  const valid = []
  const unresolved = []
  const rejected = []
  for (const item of items) {
    if (!Number.isFinite(item.onset.divisions) || !item.duration) {
      unresolved.push(item)
      continue
    }
    if (item.onset.divisions + item.duration.divisions > totalDivisions + EPSILON) {
      rejected.push({ item, reason: 'event-exceeds-measure-duration' })
      continue
    }
    valid.push(item)
  }
  return { valid, unresolved, rejected }
}

function recoverApproximateMeasureEnd(items, totalDivisions) {
  let recoveredCount = 0
  const recovered = items.map((item) => {
    if (
      item.duration?.exact !== false ||
      !Number.isFinite(item.onset?.divisions) ||
      item.onset.divisions < 0 ||
      item.onset.divisions >= totalDivisions ||
      item.onset.divisions + item.duration.divisions <= totalDivisions + EPSILON
    ) {
      return item
    }
    const available = totalDivisions - item.onset.divisions
    if (available <= EPSILON) return item
    recoveredCount += 1
    return {
      ...item,
      duration: {
        divisions: available,
        type: null,
        dots: 0,
        exact: false,
        recovery: 'clip-approximate-to-measure-end',
      },
    }
  })
  return { items: recovered, recoveredCount }
}

function assignLanes(items) {
  const lanes = []
  let ambiguous = false
  for (const item of items) {
    const onset = item.onset.divisions
    const available = lanes
      .map((lane, index) => ({ index, end: lane.end }))
      .filter((entry) => entry.end <= onset + EPSILON)
      .map((entry) => entry.index)
    const overlapping = lanes.some((lane) => lane.end > onset + EPSILON)
    let laneIndex = item.preferredLane
    if (Number.isInteger(laneIndex) && lanes[laneIndex]?.end > onset + EPSILON) {
      laneIndex = available[0] ?? lanes.length
      ambiguous = true
    } else if (!Number.isInteger(laneIndex)) {
      laneIndex = available[0] ?? lanes.length
      if (overlapping) ambiguous = true
    }
    while (lanes.length <= laneIndex) lanes.push({ end: 0, items: [] })
    lanes[laneIndex].items.push(item)
    lanes[laneIndex].end = Math.max(
      lanes[laneIndex].end,
      onset + item.duration.divisions,
    )
  }
  return { lanes: lanes.filter((lane) => lane.items.length > 0), ambiguous }
}

function eventTechnical(symbol) {
  return {
    ...(symbol.technical ?? {}),
    stemDirection: symbol.stemDirection ?? null,
    tieStart: Boolean(symbol.tieStart),
    tieStop: Boolean(symbol.tieStop),
    tieId: symbol.tieId ?? null,
    slurStart: Boolean(symbol.slurStart),
    slurStop: Boolean(symbol.slurStop),
    slurId: symbol.slurId ?? null,
    crossStaffTargetStaffId: symbol.crossStaffTargetStaffId ?? null,
  }
}

function eventsForItem(item, staffId, measureId, voiceId, candidateRank, laneIndex) {
  const chordGroupId =
    item.kind === 'note' && item.symbols.length > 1
      ? createOmrV3Id('chord', measureId, item.column.onsetColumnId, staffId, candidateRank, laneIndex)
      : null
  return item.symbols.map((symbol, symbolIndex) => ({
    eventId: createOmrV3Id(
      'event',
      measureId,
      staffId,
      candidateRank,
      laneIndex,
      symbol.symbolId,
      symbolIndex,
    ),
    staffId,
    measureId,
    voiceId,
    onsetColumnId: item.column.onsetColumnId,
    kind: item.kind,
    onset: item.onset.divisions,
    duration: item.duration ?? { divisions: null, type: null, dots: 0, exact: false },
    pitch: item.kind === 'note' ? pitchFromSymbol(symbol) : null,
    chordGroupId,
    stemGroupId: item.stemGroupId,
    beamGroupId: item.beamGroupId,
    string: symbol.string,
    fret: symbol.fret,
    technical: eventTechnical(symbol),
    geometry: symbol.geometry,
    confidenceBreakdown: {
      symbol: symbol.confidence?.overall ?? null,
      onset: item.onset.exact ? 1 : 0.45,
      duration: item.duration?.exact ? 1 : item.duration ? 0.55 : 0,
    },
    confidence: {
      overall: average([
        symbol.confidence?.overall ?? 0.5,
        item.onset.exact ? 1 : 0.45,
        item.duration?.exact ? 1 : item.duration ? 0.55 : 0,
      ]),
      stages: {
        'piano-voice-assignment': item.duration && Number.isFinite(item.onset.divisions) ? 0.8 : 0.2,
      },
    },
    sourceRefs: symbol.sourceRefs,
  }))
}

function voiceForLane(staffId, measure, lane, laneIndex, candidateRank, ambiguous) {
  const voiceId = createOmrV3Id(
    'voice',
    measure.measureId,
    staffId,
    candidateRank,
    laneIndex,
  )
  return createOmrVoiceIR({
    voiceId,
    staffId,
    candidateRank,
    events: lane.items.flatMap((item) =>
      eventsForItem(item, staffId, measure.measureId, voiceId, candidateRank, laneIndex),
    ),
    onsetColumnIds: [...new Set(lane.items.map((item) => item.column.onsetColumnId))],
    overlapConstraints: [
      {
        kind: 'monophonic-no-overlap',
        measureDurationDivisions: measure.totalDivisions,
        satisfied: true,
      },
    ],
    ambiguous,
    confidence: {
      overall: ambiguous ? 0.52 : 0.82,
      stages: { 'piano-voice-assignment': ambiguous ? 0.52 : 0.82 },
    },
  })
}

function unresolvedVoice(staffId, measure, items) {
  if (items.length === 0) return null
  const candidateRank = 2
  const laneIndex = 'unresolved'
  const voiceId = createOmrV3Id('voice', measure.measureId, staffId, candidateRank, laneIndex)
  return createOmrVoiceIR({
    voiceId,
    staffId,
    candidateRank,
    events: items.flatMap((item) =>
      eventsForItem(item, staffId, measure.measureId, voiceId, candidateRank, laneIndex),
    ),
    onsetColumnIds: [...new Set(items.map((item) => item.column.onsetColumnId))],
    overlapConstraints: [{ kind: 'unresolved-rhythm', satisfied: false }],
    ambiguous: true,
    diagnostics: [
      createOmrV3Diagnostic({
        code: 'unresolved-voice-rhythm',
        severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
        stage: 'piano-voice-assignment',
        message: 'Candidate retained without a confident duration/onset; it is not serializable.',
      }),
    ],
    confidence: { overall: 0.2, stages: { 'piano-voice-assignment': 0.2 } },
  })
}

function solveStaffMeasure(measure, staff, totalDivisions) {
  const symbolLookup = new Map((staff.symbols ?? []).map((symbol) => [symbol.symbolId, symbol]))
  const items = itemsForStaff(measure, staff.staffId, symbolLookup, totalDivisions)
  const recovery = recoverApproximateMeasureEnd(items, totalDivisions)
  const classified = classifyItems(recovery.items, totalDivisions)
  const assignment = assignLanes(classified.valid)
  const measureContext = { ...measure, totalDivisions }
  const primary = assignment.lanes.map((lane, laneIndex) =>
    voiceForLane(staff.staffId, measureContext, lane, laneIndex, 0, assignment.ambiguous),
  )
  const alternate =
    assignment.ambiguous && assignment.lanes.length > 1
      ? [...assignment.lanes]
          .reverse()
          .map((lane, laneIndex) =>
            voiceForLane(staff.staffId, measureContext, lane, laneIndex, 1, true),
          )
      : []
  const unresolved = unresolvedVoice(staff.staffId, measureContext, classified.unresolved)
  return {
    voices: [...primary, ...alternate, ...(unresolved ? [unresolved] : [])],
    ambiguous: assignment.ambiguous || classified.unresolved.length > 0,
    unresolvedCount: classified.unresolved.length,
    recoveredMeasureEndCount: recovery.recoveredCount,
    rejected: classified.rejected,
  }
}

function pianoStaves(system) {
  return (system.staffGroups ?? [])
    .filter(
      (group) =>
        group.type === OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF ||
        group.type === OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION,
    )
    .flatMap((group) => group.staves ?? [])
}

function addVoiceCandidates(document, totalDivisions) {
  const summaries = []
  const pages = (document.pages ?? []).map((page) => ({
    ...page,
    systems: (page.systems ?? []).map((system) => {
      const staves = pianoStaves(system)
      if (staves.length === 0) return system
      const measureColumns = (system.measureColumns ?? []).map((measure) => {
        const solved = staves.map((staff) => solveStaffMeasure(measure, staff, totalDivisions))
        const voices = solved.flatMap((entry) => entry.voices)
        const rejected = solved.flatMap((entry) => entry.rejected)
        const unresolvedCount = solved.reduce((sum, entry) => sum + entry.unresolvedCount, 0)
        const recoveredMeasureEndCount = solved.reduce(
          (sum, entry) => sum + entry.recoveredMeasureEndCount,
          0,
        )
        const ambiguous = solved.some((entry) => entry.ambiguous)
        summaries.push({
          systemId: system.systemId,
          measureId: measure.measureId,
          measureNumber: measure.measureNumber,
          primaryVoiceCount: voices.filter((voice) => voice.candidateRank === 0).length,
          alternateVoiceCount: voices.filter((voice) => voice.candidateRank > 0).length,
          rejectedEventGroupCount: rejected.length,
          unresolvedEventGroupCount: unresolvedCount,
          recoveredMeasureEndCount,
          ambiguous,
        })
        return createOmrMeasureColumnIR({
          ...measure,
          voices,
          diagnostics: [
            ...(measure.diagnostics ?? []),
            ...rejected.map(({ item, reason }) =>
              createOmrV3Diagnostic({
                code: reason,
                severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
                stage: 'piano-voice-assignment',
                message: 'Rejected an event group that would extend beyond the measure.',
                sourceRefs: item.symbols.flatMap((symbol) => symbol.sourceRefs),
              }),
            ),
            ...(ambiguous
              ? [
                  createOmrV3Diagnostic({
                    code: 'ambiguous-piano-voice-assignment',
                    severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
                    stage: 'piano-voice-assignment',
                    message: 'Multiple voice candidates were retained; only rank 0 is primary.',
                  }),
                ]
              : []),
          ],
        })
      })
      return { ...system, measureColumns }
    }),
  }))
  return { document: createOmrDocumentIR({ ...document, pages }), summaries }
}

function primaryEvents(document) {
  const entries = []
  for (const page of document.pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measureColumns ?? []) {
        for (const voice of measure.voices ?? []) {
          if (voice.candidateRank !== 0) continue
          for (const event of voice.events ?? []) {
            entries.push({ event, measureNumber: measure.measureNumber })
          }
        }
      }
    }
  }
  return entries.sort(
    (left, right) =>
      left.measureNumber - right.measureNumber || left.event.onset - right.event.onset,
  )
}

function pitchKey(event) {
  const pitch = event.pitch ?? {}
  return Number.isFinite(pitch.midi)
    ? `midi:${pitch.midi}`
    : `${pitch.step ?? '?'}:${pitch.alter ?? 0}:${pitch.octave ?? '?'}`
}

function buildRelationships(document) {
  const entries = primaryEvents(document)
  const relationships = []
  const groups = new Map()
  for (const type of [
    { field: 'beamGroupId', relationshipType: OMR_V3_RELATIONSHIP_TYPE.BEAM },
    { field: 'stemGroupId', relationshipType: OMR_V3_RELATIONSHIP_TYPE.STEM_GROUP },
  ]) {
    for (const { event } of entries) {
      const groupId = event[type.field]
      if (!groupId) continue
      const key = `${type.relationshipType}:${event.measureId}:${groupId}`
      if (!groups.has(key)) {
        groups.set(key, { ...type, groupId, measureId: event.measureId, members: [] })
      }
      groups.get(key).members.push(event.eventId)
    }
  }
  for (const group of groups.values()) {
    if (group.members.length < 2) continue
    relationships.push(
      createOmrRelationshipIR({
        relationshipId: createOmrV3Id(
          'relationship',
          group.relationshipType,
          group.measureId,
          group.groupId,
        ),
        type: group.relationshipType,
        members: group.members,
        metadata: { detectorGroupId: group.groupId },
      }),
    )
  }

  entries.forEach(({ event }, index) => {
    if (!event.technical?.tieStart) return
    const target = entries
      .slice(index + 1)
      .map((entry) => entry.event)
      .find(
        (candidate) =>
          candidate.staffId === event.staffId &&
          pitchKey(candidate) === pitchKey(event) &&
          candidate.technical?.tieStop &&
          (!event.technical.tieId || candidate.technical.tieId === event.technical.tieId),
      )
    if (!target) return
    relationships.push(
      createOmrRelationshipIR({
        relationshipId: createOmrV3Id('relationship', 'tie', event.eventId, target.eventId),
        type: OMR_V3_RELATIONSHIP_TYPE.TIE,
        members: [event.eventId, target.eventId],
        directed: true,
        metadata: { tieId: event.technical.tieId },
      }),
    )
  })

  for (const { event } of entries) {
    const targetStaffId = event.technical?.crossStaffTargetStaffId
    if (!targetStaffId) continue
    const target = entries
      .map((entry) => entry.event)
      .find(
        (candidate) =>
          candidate.measureId === event.measureId &&
          candidate.staffId === targetStaffId &&
          Math.abs(candidate.onset - event.onset) <= EPSILON,
      )
    if (!target) continue
    relationships.push(
      createOmrRelationshipIR({
        relationshipId: createOmrV3Id('relationship', 'cross-staff', event.eventId, target.eventId),
        type: OMR_V3_RELATIONSHIP_TYPE.CROSS_STAFF,
        members: [event.eventId, target.eventId],
        directed: true,
      }),
    )
  }

  const slurGroups = new Map()
  for (const { event } of entries) {
    if (!event.technical?.slurId) continue
    if (!slurGroups.has(event.technical.slurId)) slurGroups.set(event.technical.slurId, [])
    slurGroups.get(event.technical.slurId).push(event.eventId)
  }
  for (const [slurId, members] of slurGroups) {
    if (members.length < 2) continue
    relationships.push(
      createOmrRelationshipIR({
        relationshipId: createOmrV3Id('relationship', 'slur', slurId),
        type: OMR_V3_RELATIONSHIP_TYPE.SLUR,
        members,
        directed: true,
        metadata: { slurId },
      }),
    )
  }
  return relationships
}

function attachRelationships(document, relationships) {
  const refs = new Map()
  for (const relationship of relationships) {
    for (const eventId of relationship.members) {
      if (!refs.has(eventId)) refs.set(eventId, [])
      refs.get(eventId).push(relationship.relationshipId)
    }
  }
  const pages = (document.pages ?? []).map((page) => ({
    ...page,
    systems: (page.systems ?? []).map((system) => ({
      ...system,
      measureColumns: (system.measureColumns ?? []).map((measure) => ({
        ...measure,
        voices: (measure.voices ?? []).map((voice) => ({
          ...voice,
          events: (voice.events ?? []).map((event) => ({
            ...event,
            relationships: refs.get(event.eventId) ?? [],
          })),
        })),
      })),
    })),
  }))
  return createOmrDocumentIR({
    ...document,
    pages,
    relationships: [...(document.relationships ?? []), ...relationships],
  })
}

export function countOmrV3VoiceOverlapViolations(document) {
  let violations = 0
  for (const page of document.pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measureColumns ?? []) {
        for (const voice of measure.voices ?? []) {
          if (voice.candidateRank !== 0) continue
          const groups = new Map()
          for (const event of voice.events ?? []) {
            const key = event.chordGroupId ?? event.eventId
            if (!groups.has(key)) groups.set(key, event)
          }
          const intervals = [...groups.values()].sort((left, right) => left.onset - right.onset)
          for (let index = 1; index < intervals.length; index += 1) {
            const previous = intervals[index - 1]
            if (previous.onset + previous.duration.divisions > intervals[index].onset + EPSILON) {
              violations += 1
            }
          }
        }
      }
    }
  }
  return violations
}

/** Build Piano voices in shadow only; rank > 0 candidates are never production output. */
export function buildOmrV3PianoVoiceCandidates(
  document,
  { measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS } = {},
) {
  const before = JSON.stringify(document)
  const voiced = addVoiceCandidates(document, measureDurationDivisions)
  const relationships = buildRelationships(voiced.document)
  const linked = attachRelationships(voiced.document, relationships)
  const overlapViolations = countOmrV3VoiceOverlapViolations(linked)
  return {
    document: linked,
    measures: voiced.summaries,
    relationships,
    totals: {
      pianoMeasureCount: voiced.summaries.length,
      ambiguousMeasureCount: voiced.summaries.filter((summary) => summary.ambiguous).length,
      rejectedEventGroupCount: voiced.summaries.reduce(
        (sum, summary) => sum + summary.rejectedEventGroupCount,
        0,
      ),
      unresolvedEventGroupCount: voiced.summaries.reduce(
        (sum, summary) => sum + summary.unresolvedEventGroupCount,
        0,
      ),
      recoveredMeasureEndCount: voiced.summaries.reduce(
        (sum, summary) => sum + summary.recoveredMeasureEndCount,
        0,
      ),
      voiceOverlapViolations: overlapViolations,
      inputMutated: JSON.stringify(document) !== before,
    },
  }
}
