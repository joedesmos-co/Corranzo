/** Deterministic OMR V3 IR → MusicXML shadow serializer. */

import {
  OMR_V3_DIAGNOSTIC_SEVERITY,
  OMR_V3_RELATIONSHIP_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
} from './omrV3Ir.js'

const DEFAULT_MEASURE_DIVISIONS = 16
const DIVISIONS_PER_QUARTER = 4
const DEFAULT_BEATS = 4
const DEFAULT_BEAT_TYPE = 4

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

const TYPE_BY_DURATION = new Map([
  [16, 'whole'],
  [8, 'half'],
  [6, 'quarter'],
  [4, 'quarter'],
  [3, 'eighth'],
  [2, 'eighth'],
  [1, '16th'],
])

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function diagnostic(code, message, data = {}, severity = OMR_V3_DIAGNOSTIC_SEVERITY.WARNING) {
  return { code, message, data, severity, stage: 'v3-musicxml-serialization' }
}

function allMeasures(document) {
  return (document.pages ?? []).flatMap((page) =>
    (page.systems ?? []).flatMap((system) =>
      (system.measureColumns ?? []).map((measure) => ({ page, system, measure })),
    ),
  )
}

function staffContext(system) {
  const group = system.staffGroups?.[0]
  const staves = (group?.staves ?? []).map((staff, index) => ({ staff, number: index + 1 }))
  return { group, staves, byId: new Map(staves.map((entry) => [entry.staff.staffId, entry])) }
}

function primaryVoices(measure) {
  return (measure.voices ?? []).filter((voice) => voice.candidateRank === 0)
}

function pitchData(event) {
  const pitch = event.pitch ?? {}
  if (pitch.step && Number.isFinite(pitch.octave)) {
    return {
      step: String(pitch.step).toUpperCase(),
      alter: Number(pitch.alter ?? 0),
      octave: Number(pitch.octave),
      midi: Number.isFinite(pitch.writtenMidi)
        ? pitch.writtenMidi
        : Number.isFinite(pitch.midi)
          ? pitch.midi
          : null,
    }
  }
  const midi = Number.isFinite(pitch.writtenMidi)
    ? Math.round(pitch.writtenMidi)
    : Number.isFinite(pitch.midi)
      ? Math.round(pitch.midi)
      : null
  if (!Number.isFinite(midi)) return null
  const [step, alter] = MIDI_STEPS[((midi % 12) + 12) % 12]
  return { step, alter, octave: Math.floor(midi / 12) - 1, midi }
}

function semanticEventKey(event) {
  const pitch = pitchData(event)
  return [
    event.measureId,
    event.staffId,
    event.onset,
    event.duration?.divisions,
    pitch?.midi ?? `${pitch?.step}:${pitch?.alter}:${pitch?.octave}`,
    event.string ?? '',
    event.fret ?? '',
    event.kind,
  ].join('|')
}

function intervalGroups(voice) {
  const groups = new Map()
  for (const event of voice.events ?? []) {
    const key = event.chordGroupId ?? event.eventId
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event)
  }
  return [...groups.values()].sort(
    (left, right) => left[0].onset - right[0].onset || left[0].eventId.localeCompare(right[0].eventId),
  )
}

function validateEvent(event, totalDivisions) {
  const errors = []
  if (!Number.isFinite(event.onset) || event.onset < 0) errors.push('invalid-onset')
  if (!Number.isFinite(event.duration?.divisions) || event.duration.divisions <= 0) {
    errors.push('invalid-duration')
  }
  if (
    event.duration?.exact &&
    (!Number.isInteger(event.onset) || !Number.isInteger(event.duration?.divisions))
  ) {
    errors.push('noninteger-exact-rhythm')
  }
  if (
    Number.isFinite(event.onset) &&
    Number.isFinite(event.duration?.divisions) &&
    event.onset + event.duration.divisions > totalDivisions + 1e-6
  ) {
    errors.push('event-exceeds-measure-duration')
  }
  if (event.kind !== 'rest' && !pitchData(event)) errors.push('invalid-pitch')
  if (event.string != null && (!Number.isInteger(event.string) || event.string < 1 || event.string > 12)) {
    errors.push('invalid-string')
  }
  if (event.fret != null && (!Number.isInteger(event.fret) || event.fret < 0)) {
    errors.push('invalid-fret')
  }
  return errors
}

/** Preflight makes every omission visible before XML generation. */
export function validateOmrV3DocumentForSerialization(
  document,
  { measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS } = {},
) {
  const diagnostics = []
  const validEventIds = new Set()
  const seenEventIds = new Set()
  const semanticKeys = new Map()
  let primaryEventCount = 0
  let invalidEventCount = 0
  let duplicateEventCount = 0
  let voiceOverlapViolations = 0

  for (const { measure } of allMeasures(document)) {
    for (const voice of primaryVoices(measure)) {
      const validGroups = []
      for (const group of intervalGroups(voice)) {
        const groupErrors = group.flatMap((event) => validateEvent(event, measureDurationDivisions))
        primaryEventCount += group.length
        if (groupErrors.length > 0) {
          invalidEventCount += group.length
          diagnostics.push(
            diagnostic(
              'v3-event-not-serializable',
              `Skipped ${group.length} event(s): ${[...new Set(groupErrors)].join(', ')}.`,
              { eventIds: group.map((event) => event.eventId), measureId: measure.measureId },
            ),
          )
          continue
        }
        const uniqueGroup = []
        for (const event of group) {
          const semanticKey = semanticEventKey(event)
          const sourceKey = [...(event.sourceRefs ?? [])].sort().join('|')
          const duplicate =
            seenEventIds.has(event.eventId) ||
            (semanticKeys.has(semanticKey) && sourceKey && semanticKeys.get(semanticKey) === sourceKey)
          if (duplicate) {
            duplicateEventCount += 1
            diagnostics.push(
              diagnostic('v3-duplicate-event-rejected', 'Rejected a duplicate primary event.', {
                eventId: event.eventId,
                measureId: measure.measureId,
              }),
            )
            continue
          }
          seenEventIds.add(event.eventId)
          semanticKeys.set(semanticKey, sourceKey)
          validEventIds.add(event.eventId)
          uniqueGroup.push(event)
        }
        if (uniqueGroup.length > 0) validGroups.push(uniqueGroup)
      }
      for (let index = 1; index < validGroups.length; index += 1) {
        const previous = validGroups[index - 1][0]
        const current = validGroups[index][0]
        if (previous.onset + previous.duration.divisions > current.onset + 1e-6) {
          voiceOverlapViolations += 1
          validGroups[index].forEach((event) => validEventIds.delete(event.eventId))
          diagnostics.push(
            diagnostic('v3-voice-overlap-rejected', 'Rejected an overlapping monophonic event group.', {
              voiceId: voice.voiceId,
              eventIds: validGroups[index].map((event) => event.eventId),
            }),
          )
        }
      }
    }
  }
  return {
    validEventIds,
    diagnostics,
    summary: {
      measureCount: allMeasures(document).length,
      primaryEventCount,
      serializableEventCount: validEventIds.size,
      invalidEventCount,
      invalidEventRate: primaryEventCount ? invalidEventCount / primaryEventCount : 0,
      duplicateEventCount,
      duplicateEventRate: primaryEventCount ? duplicateEventCount / primaryEventCount : 0,
      voiceOverlapViolations,
    },
  }
}

function relationshipRole(eventId, relationships, type) {
  const relationship = relationships.find(
    (candidate) => candidate.type === type && candidate.members.includes(eventId),
  )
  if (!relationship) return null
  const index = relationship.members.indexOf(eventId)
  return index === 0 ? 'start' : index === relationship.members.length - 1 ? 'stop' : 'continue'
}

function techniqueXml(event) {
  const technical = event.technical ?? {}
  const parts = []
  if (Number.isInteger(event.string) && Number.isInteger(event.fret)) {
    parts.push(`<string>${event.string}</string><fret>${event.fret}</fret>`)
  }
  if (technical.hammerOn) parts.push('<hammer-on type="start">H</hammer-on>')
  if (technical.pullOff) parts.push('<pull-off type="start">P</pull-off>')
  const preserved = Object.entries(technical)
    .filter(
      ([key, value]) =>
        value != null &&
        ![
          'hammerOn',
          'pullOff',
          'stemDirection',
          'tieStart',
          'tieStop',
          'tieId',
          'slurStart',
          'slurStop',
          'slurId',
          'notationSymbolId',
          'tabSymbolId',
          'guitarWrittenOctave',
        ].includes(key),
    )
  if (preserved.length > 0) {
    parts.push(`<other-technical>${escapeXml(JSON.stringify(Object.fromEntries(preserved)))}</other-technical>`)
  }
  return parts.length > 0 ? `<technical>${parts.join('')}</technical>` : ''
}

function noteXml(event, options) {
  const pitch = pitchData(event)
  const alter = pitch.alter ? `<alter>${pitch.alter}</alter>` : ''
  const chord = options.chord ? '<chord/>' : ''
  const staff = options.staffNumber > 1 || options.multiStaff ? `<staff>${options.staffNumber}</staff>` : ''
  const tieRole = relationshipRole(event.eventId, options.relationships, OMR_V3_RELATIONSHIP_TYPE.TIE)
  const slurRole = relationshipRole(event.eventId, options.relationships, OMR_V3_RELATIONSHIP_TYPE.SLUR)
  const tieStart = tieRole === 'start' || event.technical?.tieStart
  const tieStop = tieRole === 'stop' || event.technical?.tieStop
  const tieXml = `${tieStart ? '<tie type="start"/>' : ''}${tieStop ? '<tie type="stop"/>' : ''}`
  const tied = `${tieStart ? '<tied type="start"/>' : ''}${tieStop ? '<tied type="stop"/>' : ''}`
  const slur = slurRole ? `<slur type="${slurRole}" number="1"/>` : ''
  const technical = techniqueXml(event)
  const notations = tied || slur || technical ? `<notations>${tied}${slur}${technical}</notations>` : ''
  const dots = '<dot/>'.repeat(event.duration.dots ?? 0)
  return (
    `<note>${chord}<pitch><step>${pitch.step}</step>${alter}<octave>${pitch.octave}</octave></pitch>` +
    `<duration>${options.duration}</duration>${tieXml}<voice>${options.voiceNumber}</voice>` +
    `<type>${escapeXml(options.type)}</type>${dots}${staff}${notations}</note>`
  )
}

function restXml(event, options) {
  const staff = options.staffNumber > 1 || options.multiStaff ? `<staff>${options.staffNumber}</staff>` : ''
  return (
    `<note><rest/><duration>${options.duration}</duration><voice>${options.voiceNumber}</voice>` +
    `<type>${escapeXml(options.type)}</type>${staff}</note>`
  )
}

function durationType(event, duration) {
  return event.duration.type ?? TYPE_BY_DURATION.get(duration) ?? 'quarter'
}

function quantizedTiming(event, totalDivisions, diagnostics) {
  let onset = event.onset
  let duration = event.duration.divisions
  if (!Number.isInteger(onset) || !Number.isInteger(duration)) {
    if (event.duration.exact) {
      return null
    }
    const original = { onset, duration }
    onset = Math.max(0, Math.min(totalDivisions - 1, Math.round(onset)))
    duration = Math.max(1, Math.min(totalDivisions - onset, Math.round(duration)))
    diagnostics.push(
      diagnostic(
        'v3-approximate-rhythm-quantized',
        'Quantized explicitly approximate TAB-only spacing for MusicXML.',
        { eventId: event.eventId, original, quantized: { onset, duration } },
        OMR_V3_DIAGNOSTIC_SEVERITY.INFO,
      ),
    )
  }
  return { onset, duration }
}

function voiceNumberMap(voices, context) {
  const byStaff = new Map()
  for (const voice of voices) {
    if (!byStaff.has(voice.staffId)) byStaff.set(voice.staffId, [])
    byStaff.get(voice.staffId).push(voice)
  }
  const result = new Map()
  for (const [staffId, staffVoices] of byStaff) {
    const staffNumber = context.byId.get(staffId)?.number ?? 1
    staffVoices
      .sort((left, right) => left.voiceId.localeCompare(right.voiceId))
      .forEach((voice, index) => result.set(voice.voiceId, (staffNumber - 1) * 4 + index + 1))
  }
  return result
}

function warningDirections(nodes) {
  const messages = []
  for (const node of nodes) {
    for (const entry of node?.diagnostics ?? []) {
      if (entry.severity === OMR_V3_DIAGNOSTIC_SEVERITY.WARNING && entry.message) {
        messages.push(entry.message)
      }
    }
  }
  return [...new Set(messages)]
    .slice(0, 8)
    .map((message) => `<direction placement="above"><direction-type><words>${escapeXml(message)}</words></direction-type></direction>`)
    .join('')
}

function attributesXml(context, metadata) {
  const piano = context.group?.type === OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF
  const guitar =
    context.group?.type === OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB ||
    context.group?.type === OMR_V3_STAFF_GROUP_TYPE.TAB_ONLY ||
    metadata?.instrumentId === 'guitar'
  const staves = piano ? '<staves>2</staves>' : ''
  const clefs = piano
    ? '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>'
    : guitar
      ? '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
      : '<clef><sign>G</sign><line>2</line></clef>'
  const musical = metadata?.musical ?? {}
  const fifths = Number(musical.keySignature?.fifths ?? metadata?.fifths ?? 0)
  const beats = Number(musical.timeSignature?.beats ?? metadata?.beats ?? DEFAULT_BEATS)
  const beatType = Number(
    musical.timeSignature?.beatType ?? metadata?.beatType ?? DEFAULT_BEAT_TYPE,
  )
  return (
    `<attributes><divisions>${DIVISIONS_PER_QUARTER}</divisions>` +
    `<key><fifths>${fifths}</fifths></key>` +
    `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
    `${staves}${clefs}</attributes>`
  )
}

function tempoXml(metadata) {
  const bpm = Number(metadata?.musical?.tempo?.bpm ?? metadata?.tempo?.bpm ?? 120)
  return Number.isFinite(bpm) && bpm > 0 ? `<direction><sound tempo="${bpm}"/></direction>` : ''
}

function emptyMeasureXml(totalDivisions, multiStaff) {
  return (
    `<note><rest measure="yes"/><duration>${totalDivisions}</duration><voice>1</voice>` +
    `<type>whole</type>${multiStaff ? '<staff>1</staff>' : ''}</note>`
  )
}

function measureXml(entry, index, preflight, options, diagnostics) {
  const { system, measure } = entry
  const context = staffContext(system)
  const voices = primaryVoices(measure).filter((voice) =>
    (voice.events ?? []).some((event) => preflight.validEventIds.has(event.eventId)),
  )
  const voiceNumbers = voiceNumberMap(voices, context)
  const relationships = options.document.relationships ?? []
  const totalDivisions = options.measureDurationDivisions
  const multiStaff = context.staves.length > 1
  let inner =
    index === 0
      ? attributesXml(context, options.document.metadata) + tempoXml(options.document.metadata)
      : ''
  inner += warningDirections([options.document, entry.page, system, measure])

  if (voices.length === 0) {
    inner += emptyMeasureXml(totalDivisions, multiStaff)
  } else {
    voices.forEach((voice, voiceIndex) => {
      if (voiceIndex > 0) inner += `<backup><duration>${totalDivisions}</duration></backup>`
      let cursor = 0
      const staffNumber = context.byId.get(voice.staffId)?.number ?? 1
      for (const group of intervalGroups(voice)) {
        const valid = group.filter((event) => preflight.validEventIds.has(event.eventId))
        if (valid.length === 0) continue
        const timing = quantizedTiming(valid[0], totalDivisions, diagnostics)
        if (!timing) {
          diagnostics.push(
            diagnostic('v3-noninteger-exact-rhythm-rejected', 'Exact rhythm was not integral.', {
              eventIds: valid.map((event) => event.eventId),
            }),
          )
          continue
        }
        if (timing.onset > cursor) inner += `<forward><duration>${timing.onset - cursor}</duration></forward>`
        valid.forEach((event, eventIndex) => {
          const common = {
            duration: timing.duration,
            type: durationType(event, timing.duration),
            voiceNumber: voiceNumbers.get(voice.voiceId),
            staffNumber,
            multiStaff,
            relationships,
            chord: eventIndex > 0,
          }
          inner += event.kind === 'rest' ? restXml(event, common) : noteXml(event, common)
        })
        cursor = timing.onset + timing.duration
      }
      if (cursor < totalDivisions) inner += `<forward><duration>${totalDivisions - cursor}</duration></forward>`
    })
  }
  const measureNumber = Number.isInteger(measure.measureNumber) ? measure.measureNumber : index + 1
  return `<measure number="${measureNumber}">${inner}</measure>`
}

/** Serialize beside production output. This function never mutates or promotes runtime data. */
export function serializeOmrV3MusicXml(
  document,
  {
    title = document?.metadata?.title ?? 'Corranzo OMR V3 shadow',
    measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS,
  } = {},
) {
  const entries = allMeasures(document)
  const preflight = validateOmrV3DocumentForSerialization(document, {
    measureDurationDivisions,
  })
  const diagnostics = [...preflight.diagnostics]
  const measures = entries.map((entry, index) =>
    measureXml(
      entry,
      index,
      preflight,
      { document, measureDurationDivisions },
      diagnostics,
    ),
  )
  const partName = document?.metadata?.instrumentId === 'guitar' ? 'Guitar' : 'Piano'
  const musicXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="3.1">' +
    `<work><work-title>${escapeXml(title)}</work-title></work>` +
    `<identification><encoding><software>Corranzo OMR V3 shadow</software></encoding></identification>` +
    `<part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>` +
    `<part id="P1">${measures.join('')}</part></score-partwise>`
  return {
    musicXml,
    diagnostics,
    summary: {
      ...preflight.summary,
      emittedMeasureCount: measures.length,
      warningCount: diagnostics.filter(
        (entry) => entry.severity === OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
      ).length,
      approximateQuantizationCount: diagnostics.filter(
        (entry) => entry.code === 'v3-approximate-rhythm-quantized',
      ).length,
      deterministic: true,
      promotedToRuntime: false,
    },
  }
}
