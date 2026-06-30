import {
  OMR_DEFAULT_BEATS,
  OMR_DEFAULT_BEAT_TYPE,
  OMR_DEFAULT_TEMPO,
} from './omrConstants.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import { OMR_DISCLAIMER } from './omrMusicalConstants.js'
import { shouldEmitKeySignature } from './detectOmrKeySignature.js'
import { shouldEmitTempo } from './parseOmrTempoMarking.js'
import { shouldEmitRepeat, shouldEmitEnding } from './detectOmrRepeatBarline.js'
import {
  shouldEmitArticulation,
  shouldEmitDynamic,
  shouldEmitPedal,
} from './detectOmrExpression.js'
import { midiToWrittenPitch } from './pitchFromStaffPosition.js'

const MIN_STRONG_OWNERSHIP_CONFIDENCE = 0.72

const TYPE_BY_DIVISIONS = {
  16: 'whole',
  8: 'half',
  4: 'quarter',
  2: 'eighth',
  1: 'sixteenth',
}

function durationTypeForDivisions(durationDivisions, dotted = false) {
  const base = dotted ? Math.round((durationDivisions * 2) / 3) : durationDivisions
  return TYPE_BY_DIVISIONS[base] ?? 'quarter'
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

function staffRoleFor({ note, ownership }) {
  return (
    ownership?.staffRole ??
    note?.pitchMapping?.staffRole ??
    (note?.clef === 'bass' ? 'lower' : 'upper')
  )
}

function clefFor({ note, ownership }) {
  return ownership?.clef ?? note?.clef ?? 'treble'
}

function voiceKeyForOwnership({ note, ownership, role }) {
  const staffRole = staffRoleFor({ note, ownership })
  const clef = clefFor({ note, ownership })
  const stemDirection = ownership?.stemDirection ?? 'unknown-stem'
  const beamGroup = ownership?.beamGroupId ? `beam:${ownership.beamGroupId}` : 'no-beam'
  return `${staffRole}:${clef}:${stemDirection}:${role}:${beamGroup}`
}

function defaultVoiceKeyForNote(note) {
  const staffRole = note?.pitchMapping?.staffRole ?? (note?.clef === 'bass' ? 'lower' : 'upper')
  const clef = note?.clef ?? 'treble'
  return `${staffRole}:${clef}:default`
}

function voiceKeyRank(key) {
  const text = String(key)
  const lower = text.includes('lower') || text.includes(':bass:')
  const sustain = text.includes(':sustain:')
  const defaultVoice = text.endsWith(':default')
  const down = text.includes(':down:')
  return [
    lower ? 10 : 0,
    defaultVoice ? 0 : 1,
    sustain ? 2 : 1,
    down ? 1 : 0,
    text,
  ]
}

function compareVoiceKeys(left, right) {
  const leftRank = voiceKeyRank(left)
  const rightRank = voiceKeyRank(right)
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] < rightRank[index]) {
      return -1
    }
    if (leftRank[index] > rightRank[index]) {
      return 1
    }
  }
  return 0
}

function isStemmedSustainOwnership(ownership) {
  return (
    (ownership?.beamCount ?? 0) === 0 &&
    ownership?.likelyVoiceRole === 'stemmed-sustain-or-quarter-voice'
  )
}

function strongOwnership(ownership) {
  return (ownership?.confidence ?? 0) >= MIN_STRONG_OWNERSHIP_CONFIDENCE
}

function eligibleVoiceSplitPlan(event, ownershipEvent) {
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
  if (ownerships.some((ownership) => !strongOwnership(ownership))) {
    return { ok: false, reason: 'low-ownership-confidence' }
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
  if (beamedExpectedValues.size !== 1) {
    return { ok: false, reason: 'ambiguous-beam-duration' }
  }
  if ([...beamedExpectedValues][0] !== ownershipEvent.beamedExpectedDivisions) {
    return { ok: false, reason: 'beam-duration-disagreement' }
  }

  const beamedVoiceKey = voiceKeyForOwnership({
    note: beamed[0].note,
    ownership: beamed[0].ownership,
    role: 'beamed-moving',
  })
  const sustainedVoiceKey = voiceKeyForOwnership({
    note: sustained[0].note,
    ownership: sustained[0].ownership,
    role: 'sustain',
  })
  if (beamedVoiceKey === sustainedVoiceKey) {
    return { ok: false, reason: 'voice-key-collision' }
  }

  return {
    ok: true,
    beamGroupId: [...beamedGroups][0],
    beamedExpectedDivisions: ownershipEvent.beamedExpectedDivisions,
    beamedVoiceKey,
    sustainedVoiceKey,
    beamedNotes: beamed.map(({ note }) => note),
    sustainedNotes: sustained.map(({ note }) => note),
    beamedOwnerships: beamed.map(({ ownership }) => ownership),
    sustainedOwnerships: sustained.map(({ ownership }) => ownership),
  }
}

function makeVoiceSplitEvents(event, plan) {
  const beamedDuration = plan.beamedExpectedDivisions
  const beamedEvent = {
    ...event,
    durationDivisions: beamedDuration,
    durationType: durationTypeForDivisions(beamedDuration),
    dotted: false,
    notes: plan.beamedNotes,
    beams: Math.max(1, ...plan.beamedOwnerships.map((ownership) => ownership.beamLevel ?? 1)),
    beamOwnershipVoiceSimulation: {
      role: 'beamed-moving-note-voice',
      voiceKey: plan.beamedVoiceKey,
      beamGroupId: plan.beamGroupId,
      originalDurationDivisions: event.durationDivisions,
      adjustedDurationDivisions: beamedDuration,
    },
  }
  const sustainedEvent = {
    ...event,
    notes: plan.sustainedNotes,
    beams: 0,
    beamOwnershipVoiceSimulation: {
      role: 'sustained-unbeamed-voice',
      voiceKey: plan.sustainedVoiceKey,
      beamGroupId: null,
      originalDurationDivisions: event.durationDivisions,
      adjustedDurationDivisions: event.durationDivisions,
    },
  }
  return [beamedEvent, sustainedEvent]
}

export function simulateBeamOwnershipVoices(measures = []) {
  const beforeNoteCount = noteCountInMeasures(measures)
  const simulatedMeasures = []
  const summary = {
    candidateEvents: 0,
    appliedEvents: 0,
    appliedMovingNotes: 0,
    appliedSustainedNotes: 0,
    adjustedDurationEvents: 0,
    skippedReasons: {},
    samples: [],
    voiceKeys: {},
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
      const plan = eligibleVoiceSplitPlan(event, ownershipEvent)
      if (!plan.ok) {
        if (ownershipEvent?.splitCandidate) {
          mergeReason(summary.skippedReasons, plan.reason)
        }
        nextEvents.push(event)
        continue
      }

      const splitEvents = makeVoiceSplitEvents(event, plan)
      nextEvents.push(...splitEvents)
      summary.appliedEvents += 1
      summary.appliedMovingNotes += plan.beamedNotes.length
      summary.appliedSustainedNotes += plan.sustainedNotes.length
      summary.adjustedDurationEvents += 1
      mergeReason(summary.voiceKeys, plan.beamedVoiceKey)
      mergeReason(summary.voiceKeys, plan.sustainedVoiceKey)
      if (summary.samples.length < 32) {
        summary.samples.push({
          measureNumber: measure.measureNumber,
          eventIndex,
          startDivision: event.startDivision,
          originalDurationDivisions: event.durationDivisions,
          beamedDurationDivisions: plan.beamedExpectedDivisions,
          beamGroupId: plan.beamGroupId,
          beamedVoiceKey: plan.beamedVoiceKey,
          sustainedVoiceKey: plan.sustainedVoiceKey,
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

function pitchXml(note) {
  const pitch = midiToWrittenPitch(note.midi)
  const alterXml = pitch.alter != null ? `<alter>${pitch.alter}</alter>` : ''
  return `<pitch><step>${pitch.step}</step>${alterXml}<octave>${pitch.octave}</octave></pitch>`
}

function noteXml(
  note,
  {
    chord = false,
    duration,
    type,
    dotted = false,
    tieStart = false,
    tieStop = false,
    beams = 0,
    articulation = null,
    accentArticulation = null,
    voice = 1,
  } = {},
) {
  const dotXml = dotted ? '<dot/>' : ''
  const tieXml =
    (tieStart ? '<tie type="start"/>' : '') + (tieStop ? '<tie type="stop"/>' : '')
  const beamXml =
    beams > 0
      ? `<beam number="1">${chord ? 'continue' : 'begin'}</beam>`
      : ''
  const articulationParts = []
  if (articulation?.type === 'staccato') {
    articulationParts.push('<staccato/>')
  }
  if (articulation?.type === 'accent') {
    articulationParts.push('<accent/>')
  }
  if (accentArticulation?.type === 'accent' && articulation?.type !== 'accent') {
    articulationParts.push('<accent/>')
  }
  const articulationXml = articulationParts.length
    ? `<articulations>${articulationParts.join('')}</articulations>`
    : ''
  const tiedXml =
    tieStart || tieStop
      ? `${tieStart ? '<tied type="start"/>' : ''}${tieStop ? '<tied type="stop"/>' : ''}`
      : ''
  const notationsXml =
    articulationXml || tiedXml
      ? `<notations>${articulationXml}${tiedXml}</notations>`
      : ''
  return (
    `<note>${chord ? '<chord/>' : ''}` +
    `${pitchXml(note)}` +
    `${dotXml}<duration>${duration}</duration><voice>${voice}</voice>` +
    `<type>${type}</type>${beamXml}${tieXml}${notationsXml}</note>`
  )
}

function restXml(duration, type = 'quarter', voice = 1) {
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type></note>`
}

function cursorXml(cursor, target) {
  if (target > cursor) {
    return {
      xml: `<forward><duration>${target - cursor}</duration></forward>`,
      cursor: target,
    }
  }
  if (target < cursor) {
    return {
      xml: `<backup><duration>${cursor - target}</duration></backup>`,
      cursor: target,
    }
  }
  return { xml: '', cursor }
}

function barlineXml(marking) {
  let xml = ''
  if (marking?.forwardRepeat) {
    xml += '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>'
  }
  if (marking?.backwardRepeat) {
    xml += '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>'
  }
  if (marking?.endingStartNumbers?.length) {
    xml += `<barline location="left"><ending number="${marking.endingStartNumbers.join(',')}" type="start"/></barline>`
  }
  if (marking?.endingStop) {
    xml += '<barline location="right"><ending type="stop"/></barline>'
  }
  return xml
}

function dynamicXml(mark) {
  if (!mark) {
    return ''
  }
  return `<direction><direction-type><dynamics><${mark}/></dynamics></direction-type></direction>`
}

function pedalXml() {
  return '<direction><direction-type><pedal type="start" line="yes"/></direction-type></direction>'
}

function collectVoiceKeys(measure) {
  const keys = new Set()
  for (const event of measure.events ?? []) {
    if (event.type === 'rest') {
      keys.add(event.beamOwnershipVoiceSimulation?.voiceKey ?? defaultVoiceKeyForNote({ clef: event.clef }))
      continue
    }
    for (const unit of eventVoiceUnits(event)) {
      keys.add(unit.voiceKey)
    }
  }
  return [...keys].sort(compareVoiceKeys)
}

function voiceNumberMapForMeasure(measure) {
  return new Map(collectVoiceKeys(measure).map((key, index) => [key, index + 1]))
}

function eventVoiceUnits(event) {
  const startDivision = Number.isFinite(event.startDivision) ? Math.max(0, event.startDivision) : 0
  const durationDivisions = event.durationDivisions
  const type = event.durationType ?? durationTypeForDivisions(
    event.dotted ? Math.round((durationDivisions * 2) / 3) : durationDivisions,
    event.dotted,
  )

  if (event.type === 'rest') {
    const voiceKey = event.beamOwnershipVoiceSimulation?.voiceKey ?? defaultVoiceKeyForNote({ clef: event.clef })
    return [{
      kind: 'rest',
      voiceKey,
      startDivision,
      durationDivisions,
      type,
      dotted: event.dotted,
      event,
    }]
  }

  const explicitVoiceKey = event.beamOwnershipVoiceSimulation?.voiceKey
  if (explicitVoiceKey) {
    return [{
      kind: 'note',
      voiceKey: explicitVoiceKey,
      startDivision,
      durationDivisions,
      type,
      dotted: event.dotted,
      notes: event.notes ?? [],
      event,
    }]
  }

  const byVoice = new Map()
  for (const note of event.notes ?? []) {
    const voiceKey = defaultVoiceKeyForNote(note)
    if (!byVoice.has(voiceKey)) {
      byVoice.set(voiceKey, [])
    }
    byVoice.get(voiceKey).push(note)
  }
  return [...byVoice.entries()].map(([voiceKey, notes]) => ({
    kind: 'note',
    voiceKey,
    startDivision,
    durationDivisions,
    type,
    dotted: event.dotted,
    notes,
    event,
  }))
}

function serializeMeasureByVoice(measure) {
  const voiceMap = voiceNumberMapForMeasure(measure)
  const units = (measure.events ?? [])
    .flatMap(eventVoiceUnits)
    .map((unit, order) => ({
      ...unit,
      order,
      voice: voiceMap.get(unit.voiceKey) ?? 1,
    }))
    .sort(
      (left, right) =>
        left.voice - right.voice ||
        left.startDivision - right.startDivision ||
        left.order - right.order,
    )

  let cursor = 0
  let xml = ''
  for (const unit of units) {
    const moved = cursorXml(cursor, unit.startDivision)
    xml += moved.xml
    cursor = moved.cursor

    if (unit.kind === 'rest') {
      xml += restXml(unit.durationDivisions, unit.type, unit.voice)
      cursor += unit.durationDivisions
      continue
    }

    unit.notes.forEach((note, index) => {
      xml += noteXml(note, {
        chord: index > 0,
        duration: unit.durationDivisions,
        type: unit.type,
        dotted: unit.dotted,
        tieStart: unit.event.tieStart,
        tieStop: unit.event.tieStop,
        beams: unit.event.beams,
        articulation: note.articulation,
        accentArticulation: note.accentArticulation,
        voice: unit.voice,
      })
    })
    cursor += unit.durationDivisions
  }

  return xml
}

/**
 * Offline-only MusicXML writer for Phase 3 voice serialization experiments.
 * Production OMR output still uses buildOmrMusicXml.
 */
export function buildVoiceSerializedOmrMusicXml({
  title = 'PDF OMR voice simulation',
  measures = [],
  musical = {},
  includeDisclaimer = true,
} = {}) {
  const sortedMeasures = [...measures].sort((a, b) => a.measureNumber - b.measureNumber)
  if (!sortedMeasures.length) {
    throw new Error('No notes detected for experimental playback.')
  }

  const keySignature = musical.keySignature ?? { fifths: 0, mode: 'major' }
  const tempo = musical.tempo ?? { bpm: OMR_DEFAULT_TEMPO, fromDefault: true }
  const timeSignature = musical.timeSignature ?? {
    beats: OMR_DEFAULT_BEATS,
    beatType: OMR_DEFAULT_BEAT_TYPE,
  }
  const emitKey = shouldEmitKeySignature(keySignature)
  const emitTempo = shouldEmitTempo(tempo)

  let measuresXml = ''
  for (const measure of sortedMeasures) {
    let inner = ''
    if (measure.measureNumber === sortedMeasures[0].measureNumber) {
      inner += `<attributes><divisions>${OMR_DIVISIONS_PER_QUARTER}</divisions>`
      if (emitKey) {
        inner += `<key><fifths>${keySignature.fifths}</fifths><mode>${keySignature.mode ?? 'major'}</mode></key>`
      }
      inner +=
        `<time><beats>${timeSignature.beats}</beats><beat-type>${timeSignature.beatType}</beat-type></time>` +
        `<clef><sign>G</sign><line>2</line></clef></attributes>`
      if (includeDisclaimer) {
        inner += `<direction><words>${escapeXml(OMR_DISCLAIMER)}</words></direction>`
      }
      if (emitTempo) {
        inner += `<direction><sound tempo="${tempo.bpm}"/></direction>`
      } else {
        inner += `<direction><sound tempo="${OMR_DEFAULT_TEMPO}"/></direction>`
      }
    }

    if (measure.repeatMarking && shouldEmitRepeat(measure.repeatMarking)) {
      inner += barlineXml(measure.repeatMarking)
    }
    if (measure.endingMarking && shouldEmitEnding(measure.endingMarking)) {
      inner += barlineXml({
        endingStartNumbers: measure.endingMarking.endingStartNumbers,
      })
    }

    if (measure.uncertain) {
      inner += '<direction><words>OMR rhythm uncertain</words></direction>'
    }
    if (measure.dynamic && shouldEmitDynamic(measure.dynamic)) {
      inner += dynamicXml(measure.dynamic.mark)
    }
    if (measure.pedal && shouldEmitPedal(measure.pedal)) {
      inner += pedalXml()
    }

    inner += serializeMeasureByVoice(measure)
    measuresXml += `<measure number="${measure.measureNumber}">${inner}</measure>`
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<score-partwise version="3.1">` +
    `<work><work-title>${escapeXml(title)}</work-title></work>` +
    `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` +
    `<part id="P1">${measuresXml}</part>` +
    `</score-partwise>`
  )
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
