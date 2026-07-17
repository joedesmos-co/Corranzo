/** Structure-aware Guitar notation/TAB fusion for the OMR V3 shadow IR. */

import {
  createOmrDocumentIR,
  createOmrMeasureColumnIR,
  createOmrOnsetColumnIR,
  createOmrRelationshipIR,
  createOmrV3Diagnostic,
  createOmrV3Id,
  createOmrVoiceIR,
  OMR_V3_DIAGNOSTIC_SEVERITY,
  OMR_V3_NOTATION_TYPE,
  OMR_V3_RELATIONSHIP_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
} from './omrV3Ir.js'

const DEFAULT_MEASURE_DIVISIONS = 16
const GUITAR_OPEN_STRING_MIDI = Object.freeze({ 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 })
const CONTROL_WARNING_KINDS = new Set(['capo', 'repeat', 'coda', 'segno', 'volta'])
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

function midiPitch(midi, extras = {}) {
  if (!Number.isFinite(midi)) return null
  const rounded = Math.round(midi)
  const [step, alter] = MIDI_STEPS[((rounded % 12) + 12) % 12]
  return { step, alter, octave: Math.floor(rounded / 12) - 1, midi: rounded, ...extras }
}

function midiFromPitch(pitch) {
  if (Number.isFinite(pitch?.midi)) return pitch.midi
  if (!pitch?.step || !Number.isFinite(pitch.octave)) return null
  const stepIndex = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.step]
  return Number.isFinite(stepIndex)
    ? (pitch.octave + 1) * 12 + stepIndex + Number(pitch.alter ?? 0)
    : null
}

function notationPitch(symbol) {
  const original = symbol.pitch && typeof symbol.pitch === 'object' ? symbol.pitch : {}
  const writtenMidi = Number.isFinite(original.writtenMidi)
    ? original.writtenMidi
    : midiFromPitch(original) ?? symbol.midi
  const soundingMidi = Number.isFinite(original.soundingMidi)
    ? original.soundingMidi
    : Number.isFinite(writtenMidi)
      ? writtenMidi - 12
      : null
  const written = midiPitch(writtenMidi)
  return written
    ? {
        ...original,
        ...written,
        writtenMidi,
        soundingMidi,
        transpositionSemitones: Number.isFinite(original.transpositionSemitones)
          ? original.transpositionSemitones
          : soundingMidi - writtenMidi,
      }
    : null
}

function tabFret(symbol) {
  const value = symbol.fret ?? symbol.value ?? symbol.text
  const fret = Number(value)
  return Number.isInteger(fret) && fret >= 0 ? fret : null
}

function tabSoundingMidi(symbol) {
  if (Number.isFinite(symbol?.pitch?.soundingMidi)) return symbol.pitch.soundingMidi
  const open = GUITAR_OPEN_STRING_MIDI[symbol.string]
  const fret = tabFret(symbol)
  return Number.isFinite(open) && Number.isFinite(fret) ? open + fret : null
}

function tabPitch(symbol) {
  const original = symbol.pitch && typeof symbol.pitch === 'object' ? symbol.pitch : null
  const explicitWrittenMidi = Number.isFinite(original?.writtenMidi)
    ? original.writtenMidi
    : midiFromPitch(original) ?? symbol.midi
  if (Number.isFinite(explicitWrittenMidi)) {
    const explicitSoundingMidi = Number.isFinite(original?.soundingMidi)
      ? original.soundingMidi
      : explicitWrittenMidi
    return midiPitch(explicitWrittenMidi, {
      ...original,
      writtenMidi: explicitWrittenMidi,
      soundingMidi: explicitSoundingMidi,
      transpositionSemitones: Number.isFinite(original?.transpositionSemitones)
        ? original.transpositionSemitones
        : explicitSoundingMidi - explicitWrittenMidi,
    })
  }
  const soundingMidi = tabSoundingMidi(symbol)
  if (!Number.isFinite(soundingMidi)) return null
  const writtenMidi = soundingMidi + 12
  return midiPitch(writtenMidi, {
    writtenMidi,
    soundingMidi,
    transpositionSemitones: -12,
  })
}

function duration(symbol) {
  const divisions = Number(symbol?.duration?.divisions ?? symbol?.durationDivisions)
  if (!Number.isFinite(divisions) || divisions <= 0) return null
  return {
    divisions,
    type: symbol?.duration?.type ?? null,
    dots: Number.isInteger(symbol?.duration?.dots) ? symbol.duration.dots : 0,
    exact: symbol?.duration?.exact !== false,
  }
}

function onset(symbol, column, totalDivisions) {
  if (Number.isFinite(symbol?.onsetDivisions)) {
    return { divisions: symbol.onsetDivisions, exact: true }
  }
  return {
    divisions: Number.isFinite(column.measureRelativePosition)
      ? column.measureRelativePosition * totalDivisions
      : null,
    exact: false,
  }
}

function symbolsForColumn(column, collection, lookup, staffId) {
  return (column.symbols?.[collection] ?? [])
    .map((symbolId) => lookup.get(symbolId))
    .filter((symbol) => symbol?.ownership?.staffId === staffId)
}

function notationSoundingCandidates(symbol) {
  const pitch = notationPitch(symbol)
  const written = pitch?.writtenMidi ?? symbol.midi
  const sounding = pitch?.soundingMidi
  const candidates = [sounding, written, written - 12, written + 12, symbol.midi, symbol.midi - 12, symbol.midi + 12]
  return [...new Set(candidates.filter(Number.isFinite))]
}

function pitchPairDistance(notation, tab) {
  const tabMidi = tabSoundingMidi(tab)
  if (!Number.isFinite(tabMidi)) return Number.POSITIVE_INFINITY
  const distances = notationSoundingCandidates(notation).map((midi) => Math.abs(midi - tabMidi))
  return distances.length ? Math.min(...distances) : Number.POSITIVE_INFINITY
}

/**
 * Pair notation noteheads with TAB digits inside one shared onset column.
 * Prefer pitch compatibility (including octave/written-sounding ambiguity), then
 * fall back to vertical rank only for notes that have no pitch-compatible TAB.
 */
function pairNotationWithTab(notation, tabs) {
  const notesOrdered = [...notation].sort(
    (left, right) =>
      (left.geometry?.y ?? 0) - (right.geometry?.y ?? 0) ||
      String(left.symbolId).localeCompare(String(right.symbolId)),
  )
  const tabsOrdered = [...tabs].sort(
    (left, right) =>
      (Number(left.string) || 99) - (Number(right.string) || 99) ||
      (left.geometry?.y ?? 0) - (right.geometry?.y ?? 0) ||
      String(left.symbolId).localeCompare(String(right.symbolId)),
  )
  const noteRank = new Map(notesOrdered.map((note, index) => [note, index]))
  const tabRank = new Map(tabsOrdered.map((tab, index) => [tab, index]))

  const bestPitchByNote = notation.map((note) =>
    Math.min(...tabs.map((tab) => pitchPairDistance(note, tab)), Number.POSITIVE_INFINITY),
  )

  const candidates = []
  notation.forEach((note, noteIndex) => {
    tabs.forEach((tab, tabIndex) => {
      const pitchDistance = pitchPairDistance(note, tab)
      const rankDistance = Math.abs((noteRank.get(note) ?? 0) - (tabRank.get(tab) ?? 0))
      const xDistance = Math.abs((note.geometry?.x ?? 0) - (tab.geometry?.x ?? 0))
      let cost = Number.POSITIVE_INFINITY
      if (pitchDistance <= 2) {
        cost = pitchDistance + rankDistance * 0.05 + xDistance * 2
      } else if (
        bestPitchByNote[noteIndex] > 2 &&
        rankDistance === 0 &&
        notation.length <= 6 &&
        tabs.length <= 6 &&
        pitchDistance < Number.POSITIVE_INFINITY
      ) {
        // Shared onset + identical vertical rank, only when this note has no
        // pitch-compatible TAB partner in the column.
        cost = 2.5 + Math.min(24, pitchDistance) * 0.05 + xDistance * 2
      }
      if (!Number.isFinite(cost) || cost > 8) return
      candidates.push({ noteIndex, tabIndex, cost })
    })
  })
  candidates.sort(
    (left, right) =>
      left.cost - right.cost ||
      left.noteIndex - right.noteIndex ||
      left.tabIndex - right.tabIndex,
  )
  const noteMatches = new Map()
  const usedTabs = new Set()
  for (const candidate of candidates) {
    if (noteMatches.has(candidate.noteIndex) || usedTabs.has(candidate.tabIndex)) continue
    noteMatches.set(candidate.noteIndex, candidate.tabIndex)
    usedTabs.add(candidate.tabIndex)
  }
  return {
    pairs: notation.map((note, noteIndex) => ({
      notation: note,
      tab: noteMatches.has(noteIndex) ? tabs[noteMatches.get(noteIndex)] : null,
    })),
    unpairedTabs: tabs.filter((_, tabIndex) => !usedTabs.has(tabIndex)),
  }
}

function eventFromPair({ notation, tab }, context) {
  let eventDuration = duration(notation)
  const eventOnset = onset(notation, context.column, context.totalDivisions)
  let durationRecovery = null
  if (
    context.allowApproximateMeasureEndRecovery === true &&
    eventDuration?.exact === false &&
    Number.isFinite(eventOnset.divisions) &&
    eventOnset.divisions >= 0 &&
    eventOnset.divisions < context.totalDivisions &&
    eventOnset.divisions + eventDuration.divisions > context.totalDivisions
  ) {
    eventDuration = {
      divisions: context.totalDivisions - eventOnset.divisions,
      type: null,
      dots: 0,
      exact: false,
      recovery: 'clip-approximate-to-measure-end',
    }
    durationRecovery = eventDuration.recovery
  }
  if (
    !eventDuration ||
    !Number.isFinite(eventOnset.divisions) ||
    eventOnset.divisions + eventDuration.divisions > context.totalDivisions
  ) {
    return null
  }
  const eventId = createOmrV3Id(
    'event',
    'guitar-fusion',
    context.measure.measureId,
    context.column.onsetColumnId,
    notation.symbolId,
  )
  const string = tab?.string ?? notation.string
  const fret = tab ? tabFret(tab) : notation.fret
  return {
    eventId,
    staffId: context.notationStaff.staffId,
    measureId: context.measure.measureId,
    onsetColumnId: context.column.onsetColumnId,
    kind: 'note',
    onset: eventOnset.divisions,
    duration: eventDuration,
    pitch: notationPitch(notation),
    sourceEventGroupId: notation.sourceEventGroupId ?? null,
    string,
    fret,
    technical: {
      ...(notation.technical ?? {}),
      ...(tab?.technical ?? {}),
      guitarWrittenOctave: true,
      durationRecovery,
      notationSymbolId: notation.symbolId,
      tabSymbolId: tab?.symbolId ?? null,
    },
    geometry: notation.geometry,
    confidenceBreakdown: {
      notation: notation.confidence?.overall ?? null,
      tab: tab?.confidence?.overall ?? null,
      rhythmSource: 'notation',
      paired: Boolean(tab),
    },
    confidence: {
      overall: average([
        notation.confidence?.overall ?? 0.5,
        ...(tab ? [tab.confidence?.overall ?? 0.5] : []),
      ]),
      stages: {
        'guitar-notation-tab-fusion': tab ? 0.86 : 0.55,
      },
    },
    sourceRefs: [...notation.sourceRefs, ...(tab?.sourceRefs ?? [])],
  }
}

function notationOnlyEvent(symbol, context) {
  return eventFromPair(
    { notation: symbol, tab: null },
    {
      ...context,
      notationStaff: context.staff,
      allowApproximateMeasureEndRecovery: true,
    },
  )
}

function chordGroups(events, measureId, onsetColumnId) {
  const bySourceEvent = new Map()
  for (const event of events) {
    const voice = Number.isFinite(event.voiceHint) ? event.voiceHint : 1
    const key = event.sourceEventGroupId
      ? `source:${event.sourceEventGroupId}`
      : `voice:${voice}`
    if (!bySourceEvent.has(key)) bySourceEvent.set(key, [])
    bySourceEvent.get(key).push(event)
  }
  for (const [sourceEvent, members] of bySourceEvent) {
    if (members.length < 2) continue
    const chordGroupId = createOmrV3Id(
      'chord',
      'guitar',
      measureId,
      onsetColumnId,
      sourceEvent,
    )
    members.forEach((event) => {
      event.chordGroupId = chordGroupId
    })
  }
  return events
}

function makeVoices(events, measure, staffId, { approximate = false } = {}) {
  const groupsByVoice = new Map()
  const eventGroups = new Map()
  for (const event of events) {
    const groupId = event.chordGroupId ?? event.eventId
    if (!eventGroups.has(groupId)) eventGroups.set(groupId, [])
    eventGroups.get(groupId).push(event)
  }
  for (const groupEvents of eventGroups.values()) {
    const event = groupEvents[0]
    const voiceNumber = Number.isFinite(event.voiceHint) ? event.voiceHint : 1
    if (!groupsByVoice.has(voiceNumber)) groupsByVoice.set(voiceNumber, [])
    groupsByVoice.get(voiceNumber).push(groupEvents)
  }
  const voices = []
  for (const [voiceNumber, temporalGroups] of [...groupsByVoice.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const lanes = []
    for (const groupEvents of temporalGroups.sort(
      (left, right) =>
        left[0].onset - right[0].onset || left[0].eventId.localeCompare(right[0].eventId),
    )) {
      const event = groupEvents[0]
      let laneIndex = lanes.findIndex((lane) => lane.end <= event.onset)
      if (laneIndex < 0) {
        laneIndex = lanes.length
        lanes.push({ end: 0, groups: [] })
      }
      lanes[laneIndex].groups.push(groupEvents)
      lanes[laneIndex].end = Math.max(
        lanes[laneIndex].end,
        event.onset + event.duration.divisions,
      )
    }
    lanes.forEach((lane, laneIndex) => {
      const voiceEvents = lane.groups.flat()
      const splitOverlap = lanes.length > 1
      const voiceId = createOmrV3Id(
        'voice',
        'guitar',
        measure.measureId,
        staffId,
        voiceNumber,
        laneIndex,
      )
      voices.push(createOmrVoiceIR({
        voiceId,
        staffId,
        candidateRank: 0,
        events: voiceEvents
          .sort((left, right) => left.onset - right.onset || left.eventId.localeCompare(right.eventId))
          .map((event) => ({ ...event, voiceId })),
        onsetColumnIds: [...new Set(voiceEvents.map((event) => event.onsetColumnId))],
        overlapConstraints: [
          {
            kind: approximate ? 'approximate-tab-spacing' : 'notation-voice-no-overlap',
            satisfied: true,
          },
        ],
        ambiguous: approximate || splitOverlap,
        confidence: {
          overall: approximate ? 0.4 : splitOverlap ? 0.64 : 0.82,
          stages: {
            'guitar-notation-tab-fusion': approximate ? 0.4 : splitOverlap ? 0.64 : 0.82,
          },
        },
        sourceRefs: voiceEvents.flatMap((event) => event.sourceRefs),
        index: voices.length,
      }))
    })
  }
  return voices
}

function assignMonotonicTabSlots(entries, slotCount) {
  let previousSlot = -1
  return entries.map((entry, index) => {
    const remainingAfter = entries.length - index - 1
    const desired = Math.round(entry.column.measureRelativePosition * (slotCount - 1))
    const minSlot = previousSlot + 1
    const maxSlot = Math.max(minSlot, slotCount - 1 - remainingAfter)
    const slot = Math.min(maxSlot, Math.max(minSlot, desired))
    previousSlot = slot
    return slot
  })
}

/**
 * Joint onset timing for guitar-notation-tab measures.
 *
 * Paired raw noteheads almost never carry exact onsetDivisions, so shared
 * columns inherit drifted geometric measureRelativePosition values. Remap by
 * column order onto a joint grid without requiring geometric gap regularity
 * (rejected for irregular guitar).
 *
 * Only columns that own notation noteheads participate: tab-only clusters must
 * not consume early beat slots. Fewer-than-beat active columns pack onto the
 * first N beats; beats+1 compresses onto the beat grid; singletons snap to the
 * downbeat. Exact detector onsets abstain.
 */
function quantizeJointGuitarNotationTabOnsetColumns(measure, totalDivisions, beats, lookup) {
  if (!Number.isInteger(beats) || beats < 2 || beats > 12) {
    return { measure, recoveredCount: 0 }
  }
  if (!Number.isFinite(totalDivisions) || totalDivisions < 2) {
    return { measure, recoveredCount: 0 }
  }
  const graceColumns = (measure.onsetColumns ?? []).filter((column) => column.grace)
  const columns = (measure.onsetColumns ?? []).filter((column) => !column.grace)
  if (columns.length < 1 || columns.length > Math.min(beats * 2, totalDivisions)) {
    return { measure, recoveredCount: 0 }
  }
  if (columns.some((column) => !Number.isFinite(column.measureRelativePosition))) {
    return { measure, recoveredCount: 0 }
  }
  const ordered = [...columns].sort(
    (left, right) => left.measureRelativePosition - right.measureRelativePosition,
  )
  const hasExactOnset = ordered.some((column) =>
    (column.symbols?.noteheads ?? [])
      .map((symbolId) => lookup.get(symbolId))
      .some((symbol) => Number.isFinite(symbol?.onsetDivisions) && symbol.onsetDivisions >= 0),
  )
  if (hasExactOnset) return { measure, recoveredCount: 0 }

  const columnHasNotation = (column) =>
    (column.symbols?.noteheads ?? []).some((symbolId) => lookup.get(symbolId))
  const active = ordered.filter(columnHasNotation)
  if (active.length < 1) return { measure, recoveredCount: 0 }

  let slotIndexes
  let slotCount
  if (active.length === 1) {
    slotCount = beats
    slotIndexes = [0]
  } else if (active.length === beats + 1) {
    slotCount = beats
    slotIndexes = assignMonotonicTabSlots(
      active.map((column) => ({ column })),
      beats,
    )
  } else if (active.length < beats) {
    // Prefer early beats over equal packing across the whole measure.
    slotCount = beats
    slotIndexes = active.map((_, index) => index)
  } else {
    slotCount = active.length
    slotIndexes = active.map((_, index) => index)
  }

  const positionById = new Map(
    active.map((column, index) => [column.onsetColumnId, slotIndexes[index] / slotCount]),
  )
  const quantized = ordered.map((column) => {
    if (!positionById.has(column.onsetColumnId)) return column
    const slotIndex = Math.round(positionById.get(column.onsetColumnId) * slotCount)
    return createOmrOnsetColumnIR({
      ...column,
      measureRelativePosition: positionById.get(column.onsetColumnId),
      diagnostics: [
        ...(column.diagnostics ?? []),
        createOmrV3Diagnostic({
          code: 'joint-guitar-notation-tab-onset-grid',
          severity: OMR_V3_DIAGNOSTIC_SEVERITY.INFO,
          stage: 'guitar-notation-tab-fusion',
          message:
            'Snapped a shared notation/TAB onset column onto a joint measure grid by column order.',
          data: {
            slotIndex,
            slotCount,
            activeColumnCount: active.length,
            beats,
          },
        }),
      ],
    })
  })
  return {
    measure: {
      ...measure,
      onsetColumns: [...quantized, ...graceColumns],
    },
    recoveredCount: active.length,
  }
}

/**
 * After joint onset remapping, approximate notation durations are detector
 * leftovers. Prefer a beat-length fill when the onset sits on the measure beat
 * grid (so a 3-column measure does not turn the last beat into a half note);
 * otherwise assign the gap to the next joint onset. Exact detector durations
 * are left untouched.
 */
function refineApproximatePairedDurations(events, totalDivisions, beats) {
  if (!events.length) return events
  const orderedOnsets = [
    ...new Set(
      events
        .map((event) => event.onset)
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right),
    ),
  ]
  if (orderedOnsets.length < 1) return events
  const nextOnsetByOnset = new Map()
  orderedOnsets.forEach((onsetValue, index) => {
    nextOnsetByOnset.set(
      onsetValue,
      index + 1 < orderedOnsets.length ? orderedOnsets[index + 1] : totalDivisions,
    )
  })
  const beatDuration =
    Number.isInteger(beats) && beats >= 2 ? totalDivisions / beats : null
  return events.map((event) => {
    if (event.duration?.exact !== false) return event
    if (!Number.isFinite(event.onset) || !Number.isFinite(event.duration?.divisions)) return event
    const nextOnset = nextOnsetByOnset.get(event.onset)
    if (!Number.isFinite(nextOnset)) return event
    let available = Math.max(EPSILON, nextOnset - event.onset)
    let recovery = 'assign-approximate-to-joint-onset-gap'
    if (
      Number.isFinite(beatDuration) &&
      beatDuration > EPSILON &&
      event.onset + beatDuration <= totalDivisions + EPSILON &&
      Math.abs(event.onset / beatDuration - Math.round(event.onset / beatDuration)) <= 1e-6
    ) {
      available = beatDuration
      recovery = 'assign-approximate-to-beat-duration'
    }
    if (Math.abs(event.duration.divisions - available) <= EPSILON) return event
    return {
      ...event,
      duration: {
        divisions: available,
        type: null,
        dots: 0,
        exact: false,
        recovery,
      },
      technical: {
        ...(event.technical ?? {}),
        durationRecovery: recovery,
      },
    }
  })
}

function tabOnlyEvents(measure, tabStaff, lookup, totalDivisions, beats) {
  const onsetEntries = (measure.onsetColumns ?? [])
    .map((column) => ({
      column,
      tabs: symbolsForColumn(column, 'tabDigits', lookup, tabStaff.staffId),
    }))
    .filter((entry) => entry.tabs.length > 0)
  const maxOnsets = Math.max(1, Math.min(Math.round(beats * 4), 16, totalDivisions))
  const compressed = onsetEntries.length > maxOnsets
  const slotCount = onsetEntries.length <= beats ? beats : maxOnsets
  const slots = compressed
    ? onsetEntries.map((entry) =>
        Math.min(
          slotCount - 1,
          Math.max(0, Math.round(entry.column.measureRelativePosition * (slotCount - 1))),
        ),
      )
    : assignMonotonicTabSlots(onsetEntries, slotCount)
  const slotDuration = Math.max(1, Math.round(totalDivisions / slotCount))
  const slotStarts = slots.map((slot) => Math.min(totalDivisions - 1, slot * slotDuration))
  const events = []
  onsetEntries.forEach((entry, index) => {
    const fallbackStart = slotStarts[index]
    const nextStart = slotStarts[index + 1] ?? totalDivisions
    const fallbackDuration = Math.max(0.25, nextStart - fallbackStart)
    const chordGroupId =
      entry.tabs.length > 1
        ? createOmrV3Id('chord', 'tab-only', measure.measureId, entry.column.onsetColumnId)
        : null
    for (const tab of entry.tabs) {
      const observedOnset = onset(tab, entry.column, totalDivisions)
      const observedDuration = duration(tab)
      const eventStart =
        observedOnset.exact &&
        Number.isFinite(observedOnset.divisions) &&
        observedOnset.divisions >= 0 &&
        observedOnset.divisions < totalDivisions
          ? observedOnset.divisions
          : fallbackStart
      const eventDuration =
        observedDuration && eventStart + observedDuration.divisions <= totalDivisions
          ? observedDuration
          : { divisions: fallbackDuration, type: null, dots: 0, exact: false }
      events.push({
        eventId: createOmrV3Id('event', 'tab-only', measure.measureId, tab.symbolId),
        staffId: tabStaff.staffId,
        measureId: measure.measureId,
        onsetColumnId: entry.column.onsetColumnId,
        kind: 'note',
        onset: eventStart,
        duration: eventDuration,
        pitch: tabPitch(tab),
        sourceEventGroupId: tab.sourceEventGroupId ?? null,
        chordGroupId,
        string: tab.string,
        fret: tabFret(tab),
        technical: {
          ...(tab.technical ?? {}),
          approximateRhythm: eventDuration.exact === false,
        },
        geometry: tab.geometry,
        confidenceBreakdown: {
          rhythmSource: observedDuration ? 'detector-observation' : 'tab-spacing',
          rhythmExact: eventDuration.exact,
        },
        confidence: {
          overall: 0.4,
          stages: { 'guitar-tab-only-spacing': 0.4 },
        },
        sourceRefs: tab.sourceRefs,
      })
    }
  })
  return events
}

function controlDiagnostics(group) {
  return (group.staves ?? [])
    .flatMap((staff) => staff.symbols ?? [])
    .filter((symbol) => CONTROL_WARNING_KINDS.has(symbol.kind) || symbol.warning)
    .map((symbol) =>
      createOmrV3Diagnostic({
        code: 'guitar-control-warning-preserved',
        severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
        stage: 'guitar-notation-tab-fusion',
        message: String(symbol.warning ?? `Preserved ${symbol.kind} control for downstream review.`),
        sourceRefs: symbol.sourceRefs,
        data: { kind: symbol.kind, text: symbol.text },
      }),
    )
}

function solveNotationTabMeasure(measure, group, totalDivisions, beats) {
  const notationStaff = group.staves.find(
    (staff) => staff.notationType === OMR_V3_NOTATION_TYPE.NOTATION,
  )
  const tabStaff = group.staves.find((staff) => staff.notationType === OMR_V3_NOTATION_TYPE.TAB)
  const lookup = new Map(
    group.staves.flatMap((staff) => staff.symbols ?? []).map((symbol) => [symbol.symbolId, symbol]),
  )
  const onsetGrid = quantizeJointGuitarNotationTabOnsetColumns(
    measure,
    totalDivisions,
    beats,
    lookup,
  )
  const timedMeasure = onsetGrid.measure
  const events = []
  const diagnostics = []
  const mirrorPairs = []
  for (const column of timedMeasure.onsetColumns ?? []) {
    const notation = symbolsForColumn(column, 'noteheads', lookup, notationStaff.staffId)
    const tabs = symbolsForColumn(column, 'tabDigits', lookup, tabStaff.staffId)
    const paired = pairNotationWithTab(notation, tabs)
    const columnEvents = []
    for (const pair of paired.pairs) {
      const event = eventFromPair(pair, {
        measure: timedMeasure,
        column,
        notationStaff,
        totalDivisions,
        allowApproximateMeasureEndRecovery: true,
      })
      if (!event) {
        diagnostics.push(
          createOmrV3Diagnostic({
            code: 'guitar-notation-rhythm-unresolved',
            severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
            stage: 'guitar-notation-tab-fusion',
            message: 'Notation event lacked a safe onset or duration and was not emitted.',
            sourceRefs: pair.notation.sourceRefs,
          }),
        )
        continue
      }
      event.voiceHint = pair.notation.voiceHint ?? 1
      columnEvents.push(event)
      if (pair.tab) mirrorPairs.push({ eventId: event.eventId, columnId: column.onsetColumnId, pair })
      else {
        diagnostics.push(
          createOmrV3Diagnostic({
            code: 'guitar-notation-event-unpaired-tab',
            severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
            stage: 'guitar-notation-tab-fusion',
            message: 'Notation event was retained without matching TAB evidence.',
            sourceRefs: pair.notation.sourceRefs,
          }),
        )
      }
    }
    chordGroups(columnEvents, timedMeasure.measureId, column.onsetColumnId)
    events.push(...columnEvents)
    if (paired.unpairedTabs.length > 0) {
      diagnostics.push(
        createOmrV3Diagnostic({
          code: 'guitar-tab-evidence-unpaired',
          severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
          stage: 'guitar-notation-tab-fusion',
          message: `${paired.unpairedTabs.length} TAB position(s) were not emitted as duplicate events.`,
          sourceRefs: paired.unpairedTabs.flatMap((tab) => tab.sourceRefs),
        }),
      )
    }
  }
  const refinedEvents = refineApproximatePairedDurations(events, totalDivisions, beats)
  if (onsetGrid.recoveredCount > 0) {
    diagnostics.push(
      createOmrV3Diagnostic({
        code: 'joint-guitar-notation-tab-onset-grid',
        severity: OMR_V3_DIAGNOSTIC_SEVERITY.INFO,
        stage: 'guitar-notation-tab-fusion',
        message: `Recovered ${onsetGrid.recoveredCount} shared notation/TAB onset column(s) onto a joint measure grid.`,
        data: { recoveredCount: onsetGrid.recoveredCount },
      }),
    )
  }
  return {
    voices: makeVoices(refinedEvents, timedMeasure, notationStaff.staffId),
    diagnostics,
    mirrorPairs,
    eventCount: refinedEvents.length,
    pairedCount: mirrorPairs.length,
    duplicateEventCount: 0,
  }
}

function solveTabOnlyMeasure(measure, group, totalDivisions, beats) {
  const tabStaff = group.staves[0]
  const lookup = new Map((tabStaff.symbols ?? []).map((symbol) => [symbol.symbolId, symbol]))
  const events = tabOnlyEvents(measure, tabStaff, lookup, totalDivisions, beats)
  return {
    voices: makeVoices(events, measure, tabStaff.staffId, { approximate: true }),
    diagnostics: events.length
      ? [
          createOmrV3Diagnostic({
            code: 'tab-only-approximate-rhythm',
            severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
            stage: 'guitar-tab-only-spacing',
            message: 'TAB-only durations are approximate spacing evidence, not exact rhythm.',
          }),
        ]
      : [],
    mirrorPairs: [],
    eventCount: events.length,
    pairedCount: 0,
    duplicateEventCount: 0,
  }
}

function solveNotationOnlyMeasure(measure, group, totalDivisions) {
  const staff = group.staves[0]
  const lookup = new Map((staff.symbols ?? []).map((symbol) => [symbol.symbolId, symbol]))
  const events = []
  const diagnostics = []
  for (const column of measure.onsetColumns ?? []) {
    const notes = symbolsForColumn(column, 'noteheads', lookup, staff.staffId)
    const columnEvents = notes
      .map((symbol) => {
        const event = notationOnlyEvent(symbol, { measure, column, staff, totalDivisions })
        if (event) event.voiceHint = symbol.voiceHint ?? 1
        return event
      })
      .filter(Boolean)
    chordGroups(columnEvents, measure.measureId, column.onsetColumnId)
    events.push(...columnEvents)
    if (columnEvents.length !== notes.length) {
      diagnostics.push(
        createOmrV3Diagnostic({
          code: 'guitar-notation-rhythm-unresolved',
          severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
          stage: 'guitar-notation-tab-fusion',
          message: 'Standard-notation Guitar event lacked safe rhythm evidence.',
        }),
      )
    }
  }
  return {
    voices: makeVoices(events, measure, staff.staffId),
    diagnostics,
    mirrorPairs: [],
    eventCount: events.length,
    pairedCount: 0,
    duplicateEventCount: 0,
  }
}

function isGuitarNotationOnly(group, document) {
  return (
    group.type === OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION &&
    document.metadata?.instrumentId === 'guitar'
  )
}

function solveDocument(document, totalDivisions, beats) {
  const summaries = []
  const mirrorPairs = []
  const pages = (document.pages ?? []).map((page) => ({
    ...page,
    systems: (page.systems ?? []).map((system) => {
      const group = (system.staffGroups ?? []).find(
        (candidate) =>
          candidate.type === OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB ||
          candidate.type === OMR_V3_STAFF_GROUP_TYPE.TAB_ONLY ||
          isGuitarNotationOnly(candidate, document),
      )
      if (!group) return system
      const controls = controlDiagnostics(group)
      const measureColumns = (system.measureColumns ?? []).map((measure) => {
        const solved =
          group.type === OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB
            ? solveNotationTabMeasure(measure, group, totalDivisions, beats)
            : group.type === OMR_V3_STAFF_GROUP_TYPE.TAB_ONLY
              ? solveTabOnlyMeasure(measure, group, totalDivisions, beats)
              : solveNotationOnlyMeasure(measure, group, totalDivisions)
        mirrorPairs.push(...solved.mirrorPairs)
        summaries.push({
          systemId: system.systemId,
          measureId: measure.measureId,
          measureNumber: measure.measureNumber,
          groupType: group.type,
          eventCount: solved.eventCount,
          pairedCount: solved.pairedCount,
          duplicateEventCount: solved.duplicateEventCount,
          diagnosticCount: solved.diagnostics.length,
        })
        return createOmrMeasureColumnIR({
          ...measure,
          voices: solved.voices,
          diagnostics: [...(measure.diagnostics ?? []), ...solved.diagnostics],
        })
      })
      return {
        ...system,
        measureColumns,
        diagnostics: [...(system.diagnostics ?? []), ...controls],
      }
    }),
  }))
  return { document: createOmrDocumentIR({ ...document, pages }), summaries, mirrorPairs }
}

function linkMirrorRelationships(document, mirrorPairs) {
  const relationships = mirrorPairs.map(({ eventId, columnId, pair }) =>
    createOmrRelationshipIR({
      relationshipId: createOmrV3Id('relationship', 'notation-tab-mirror', eventId),
      type: OMR_V3_RELATIONSHIP_TYPE.NOTATION_TAB_MIRROR,
      members: [eventId, columnId],
      directed: true,
      metadata: {
        notationSymbolId: pair.notation.symbolId,
        tabSymbolId: pair.tab.symbolId,
      },
      sourceRefs: [...pair.notation.sourceRefs, ...pair.tab.sourceRefs],
    }),
  )
  const relationByEvent = new Map(
    relationships.map((relationship) => [relationship.members[0], relationship.relationshipId]),
  )
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
            relationships: relationByEvent.has(event.eventId)
              ? [...(event.relationships ?? []), relationByEvent.get(event.eventId)]
              : event.relationships,
          })),
        })),
      })),
    })),
  }))
  return {
    document: createOmrDocumentIR({
      ...document,
      pages,
      relationships: [...(document.relationships ?? []), ...relationships],
    }),
    relationships,
  }
}

/** Fuse Guitar evidence in shadow mode; notation and TAB never become two timelines. */
export function buildOmrV3GuitarFusion(
  document,
  { measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS } = {},
) {
  const before = JSON.stringify(document)
  const beats = Number(document.metadata?.musical?.timeSignature?.beats ?? 4)
  const solved = solveDocument(document, measureDurationDivisions, beats)
  const linked = linkMirrorRelationships(solved.document, solved.mirrorPairs)
  return {
    document: linked.document,
    measures: solved.summaries,
    relationships: linked.relationships,
    totals: {
      guitarMeasureCount: solved.summaries.length,
      eventCount: solved.summaries.reduce((sum, summary) => sum + summary.eventCount, 0),
      pairedCount: solved.summaries.reduce((sum, summary) => sum + summary.pairedCount, 0),
      duplicateEventCount: solved.summaries.reduce(
        (sum, summary) => sum + summary.duplicateEventCount,
        0,
      ),
      unpairedDiagnosticCount: solved.summaries.reduce(
        (sum, summary) => sum + summary.diagnosticCount,
        0,
      ),
      inputMutated: JSON.stringify(document) !== before,
    },
  }
}
