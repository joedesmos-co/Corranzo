import {
  OMR_DEFAULT_BEATS,
  OMR_DEFAULT_BEAT_TYPE,
  OMR_DEFAULT_TEMPO,
} from './omrConstants.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import { OMR_DISCLAIMER } from './omrMusicalConstants.js'
import { TAB_APPROXIMATE_RHYTHM_WARNING } from './detectTabNotation.js'
import { shouldEmitKeySignature } from './detectOmrKeySignature.js'
import { shouldEmitRepeat, shouldEmitEnding, sanitizeOmrRepeatMarkings } from './detectOmrRepeatBarline.js'
import {
  shouldEmitTempo,
  shouldEmitTempoMarking,
} from './parseOmrTempoMarking.js'
import {
  shouldEmitDynamic,
  shouldEmitPedal,
  shouldEmitWedge,
} from './detectOmrExpression.js'
import { midiToWrittenPitch } from './pitchFromStaffPosition.js'
import { buildMeasureStructureUnits } from './measureStructureSemantics.js'

const TYPE_BY_DIVISIONS = {
  16: 'whole',
  8: 'half',
  4: 'quarter',
  2: 'eighth',
  1: 'sixteenth',
}

const BEAMABLE_DURATION_TYPES = new Set(['eighth', 'sixteenth', '32nd', '64th'])
const MAX_BEAM_LEVEL_BY_TYPE = {
  eighth: 1,
  sixteenth: 2,
  '32nd': 3,
  '64th': 4,
}

const STEP_SEMITONE = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

function midiForWrittenPitch(pitch) {
  const step = String(pitch?.step ?? '').toUpperCase()
  const octave = Number(pitch?.octave)
  const alter = Number(pitch?.alter ?? 0)
  if (!(step in STEP_SEMITONE) || !Number.isFinite(octave) || !Number.isFinite(alter)) {
    return null
  }
  return (octave + 1) * 12 + STEP_SEMITONE[step] + alter
}

function preserveSelectedMidi(note, pitch, shift) {
  const selectedMidi = Number(note?.midi) + shift
  if (
    !Number.isFinite(selectedMidi) ||
    midiForWrittenPitch(pitch) === selectedMidi
  ) {
    return pitch
  }
  // Staff-position spelling evidence can occasionally disagree with the
  // already-selected sounding event. Never let a notation-only improvement
  // retune playback; fall back to the exact MIDI spelling and keep the
  // conflicting evidence diagnostic-only.
  return midiToWrittenPitch(selectedMidi)
}

function durationTypeForDivisions(durationDivisions, dotted) {
  const base = dotted ? Math.round((durationDivisions * 2) / 3) : durationDivisions
  return TYPE_BY_DIVISIONS[base] ?? 'quarter'
}

function beamLevelFromValue(value) {
  if (Number.isFinite(value)) {
    return Math.max(0, Math.round(value))
  }
  if (!Array.isArray(value)) {
    return 0
  }
  return value.reduce((max, beam) => {
    if (Number.isFinite(beam)) {
      return Math.max(max, Math.round(beam))
    }
    return Math.max(max, Math.round(Number(beam?.number) || 0))
  }, 0)
}

function eventBeamLevel(event) {
  return Math.max(
    beamLevelFromValue(event?.beams),
    ...(event?.notes ?? []).map((note) => beamLevelFromValue(note?.beams)),
  )
}

function eventBeamDurationType(event) {
  if (event?.durationType) {
    return event.durationType
  }
  const rawDuration = event?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  return durationTypeForDivisions(rawDuration, Boolean(event?.dotted))
}

function eventBeamLane(event) {
  const evidenceNote = (event?.notes ?? []).find((note) => beamLevelFromValue(note?.beams) > 0)
  return evidenceNote?.clef ?? event?.notes?.[0]?.clef ?? event?.clef ?? 'treble'
}

function eventsAreContiguous(left, right) {
  if (!left || !right) {
    return false
  }
  const leftStart = Number(left.startDivision)
  const leftDuration = Number(left.durationDivisions)
  const rightStart = Number(right.startDivision)
  return (
    Number.isFinite(leftStart) &&
    Number.isFinite(leftDuration) &&
    Number.isFinite(rightStart) &&
    Math.abs(leftStart + leftDuration - rightStart) < 1e-6
  )
}

function eventsShareBeamTopology(left, right) {
  const leftGroup = left?.beamTopologyGroupId ?? null
  const rightGroup = right?.beamTopologyGroupId ?? null
  if (!leftGroup && !rightGroup) {
    return true
  }
  return Boolean(leftGroup && rightGroup && leftGroup === rightGroup)
}

/**
 * Convert detector-owned beam evidence into conservative MusicXML beam states.
 *
 * Vector recognition stores beam counts on noteheads while raster chord
 * assembly historically copied them to the event. Keep both representations
 * on one serialization path. A beam is emitted only for a short written value
 * with a contiguous, beam-evidenced neighbour in the same staff lane; isolated
 * or quarter-note noise remains a flag/no-mark diagnostic rather than unsafe
 * MusicXML.
 */
export function buildMeasureBeamValues(events = []) {
  const byEvent = new Map()
  const lanes = new Map()
  for (const event of sortMeasureEvents(events)) {
    if (event?.type !== 'note') {
      continue
    }
    const lane = eventBeamLane(event)
    const entries = lanes.get(lane) ?? []
    const durationType = eventBeamDurationType(event)
    entries.push({
      event,
      level: BEAMABLE_DURATION_TYPES.has(durationType)
        ? Math.min(eventBeamLevel(event), MAX_BEAM_LEVEL_BY_TYPE[durationType] ?? 0)
        : 0,
    })
    lanes.set(lane, entries)
  }

  for (const entries of lanes.values()) {
    for (let index = 0; index < entries.length; index += 1) {
      const current = entries[index]
      if (current.level <= 0) {
        continue
      }
      const values = []
      for (let number = 1; number <= current.level; number += 1) {
        const previous = entries[index - 1] ?? null
        const next = entries[index + 1] ?? null
        const joinsPrevious =
          previous?.level >= number &&
          eventsAreContiguous(previous.event, current.event) &&
          eventsShareBeamTopology(previous.event, current.event)
        const joinsNext =
          next?.level >= number &&
          eventsAreContiguous(current.event, next.event) &&
          eventsShareBeamTopology(current.event, next.event)

        let value = null
        if (joinsPrevious && joinsNext) {
          value = 'continue'
        } else if (joinsNext) {
          value = 'begin'
        } else if (joinsPrevious) {
          value = 'end'
        } else if (number > 1) {
          const hasPrimaryPrevious =
            previous?.level >= 1 &&
            eventsAreContiguous(previous.event, current.event) &&
            eventsShareBeamTopology(previous.event, current.event)
          const hasPrimaryNext =
            next?.level >= 1 &&
            eventsAreContiguous(current.event, next.event) &&
            eventsShareBeamTopology(current.event, next.event)
          if (hasPrimaryNext) {
            value = 'forward hook'
          } else if (hasPrimaryPrevious) {
            value = 'backward hook'
          }
        }

        if (value) {
          values.push({ number, value })
        }
      }
      if (values.length) {
        byEvent.set(current.event, values)
      }
    }
  }
  return byEvent
}

function writtenPitchForNote(note, octaveShiftSemitones = 0) {
  // `note.midi` is already the MusicXML sounding pitch for both staff-mapped
  // heads (`midiFromStaffPosition` concert treble) and TAB digits. An extra
  // instrument writtenOctaveOffset shift double-applies guitar's 8vb and drops
  // pitches an octave below truth. Keep octaveShiftSemitones for callers that
  // still pass an explicit written→sounding delta; default production path
  // uses 0. Tab-paired notes set soundingPitch and never shift.
  const shift = note.soundingPitch ? 0 : octaveShiftSemitones
  if (
    note.writtenPitch?.step &&
    Number.isFinite(Number(note.writtenPitch.octave))
  ) {
    return preserveSelectedMidi(note, {
      step: String(note.writtenPitch.step).toUpperCase(),
      alter:
        note.writtenPitch.alter == null
          ? null
          : Number(note.writtenPitch.alter),
      octave: Number(note.writtenPitch.octave),
    }, shift)
  }
  if (
    Number.isFinite(note.naturalMidi) &&
    (note.pitchAlteration || note.accidental || note.alter != null)
  ) {
    const natural = midiToWrittenPitch(note.naturalMidi + shift)
    return preserveSelectedMidi(note, {
      step: natural.step,
      alter: note.alter == null ? null : Number(note.alter),
      octave: natural.octave,
    }, shift)
  }
  return midiToWrittenPitch(note.midi + shift)
}

function pitchXml(note, octaveShiftSemitones = 0) {
  const pitch = writtenPitchForNote(note, octaveShiftSemitones)
  const alterXml = pitch.alter != null ? `<alter>${pitch.alter}</alter>` : ''
  return `<pitch><step>${pitch.step}</step>${alterXml}<octave>${pitch.octave}</octave></pitch>`
}

const MUSICXML_ACCIDENTAL_TYPE = {
  sharp: 'sharp',
  flat: 'flat',
  natural: 'natural',
  'double-sharp': 'double-sharp',
  'sharp-sharp': 'double-sharp',
  'double-flat': 'flat-flat',
  'flat-flat': 'flat-flat',
}

function accidentalXml(note) {
  const accidental = note?.accidental
  const type = MUSICXML_ACCIDENTAL_TYPE[accidental?.type]
  if (!type) {
    return ''
  }
  const attributes = []
  if (accidental.cautionary || accidental.courtesy) {
    attributes.push('cautionary="yes"')
  }
  if (accidental.editorial) {
    attributes.push('editorial="yes"')
  }
  if (accidental.parentheses) {
    attributes.push('parentheses="yes"')
  }
  if (accidental.bracket) {
    attributes.push('bracket="yes"')
  }
  return `<accidental${attributes.length ? ` ${attributes.join(' ')}` : ''}>${type}</accidental>`
}

/** <technical> string/fret for fretted instruments; empty when absent. */
function technicalXml(note) {
  if (note.string == null || note.fret == null) {
    return ''
  }
  return `<technical><string>${note.string}</string><fret>${note.fret}</fret></technical>`
}

function staffNumberForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

function defaultVoiceForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

/**
 * True when recognized events span both treble and bass — emit MusicXML grand
 * staff so evaluator staff pairing (and playback lanes) match recognition.
 */
export function measuresUseGrandStaff(measures = []) {
  let hasTreble = false
  let hasBass = false
  for (const measure of measures) {
    for (const event of measure.events ?? []) {
      const eventClef = event.clef
      if (eventClef === 'treble') hasTreble = true
      if (eventClef === 'bass') hasBass = true
      for (const note of event.notes ?? []) {
        if (note.clef === 'treble') hasTreble = true
        if (note.clef === 'bass') hasBass = true
      }
      if (hasTreble && hasBass) {
        return true
      }
    }
  }
  return false
}

/**
 * Vector glyph notes carry reliable clef labels. Raster pages often recognize
 * correct upper/lower roles but historically omitted MusicXML `<staff>` tags
 * because a single miscleffed head could force a false grand staff. Require
 * balanced dual-clef content before promoting raster to grand-staff emission.
 */
export function measuresHaveVectorClefEvidence(measures = []) {
  let vector = 0
  let total = 0
  for (const measure of measures) {
    for (const event of measure.events ?? []) {
      for (const note of event.notes ?? []) {
        total += 1
        if (String(note.source ?? '').includes('vector')) {
          vector += 1
        }
      }
    }
  }
  return total > 0 && vector / total >= 0.5
}

/**
 * Raster (and mixed) pages: both clefs must carry a real share of notes so a
 * lone miscleffed head cannot open a phantom second staff.
 */
export function measuresHaveBalancedDualClefEvidence(measures = []) {
  let treble = 0
  let bass = 0
  for (const measure of measures) {
    for (const event of measure.events ?? []) {
      const eventClef = event.clef
      for (const note of event.notes ?? []) {
        const clef = note.clef ?? eventClef
        if (clef === 'treble') treble += 1
        if (clef === 'bass') bass += 1
      }
    }
  }
  const total = treble + bass
  if (total < 10) {
    return false
  }
  return treble >= 3 && bass >= 3 && treble / total >= 0.2 && bass / total >= 0.2
}

export function measuresHaveClefStaffEmissionEvidence(measures = []) {
  return (
    measuresHaveVectorClefEvidence(measures) ||
    measuresHaveBalancedDualClefEvidence(measures)
  )
}

function shouldEmitGrandStaffMusicXml(measures, instrument) {
  // Guitar / single-staff instruments must not inherit piano grand-staff emission
  // from occasional mis-cleffed heads.
  if (instrument?.notation && instrument.notation.grandStaff === false) {
    return false
  }
  return measuresUseGrandStaff(measures) && measuresHaveClefStaffEmissionEvidence(measures)
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
    tiePlacement = null,
    slurStart = false,
    slurStop = false,
    slurNumber = '1',
    slurPlacement = null,
    beamValues = [],
    articulation = null,
    accentArticulation = null,
    notationArticulations = [],
    voice = 1,
    staff = null,
    stemDirection = null,
    octaveShiftSemitones = 0,
    timeModification = null,
  } = {},
) {
  const dotXml = dotted ? '<dot/>' : ''
  const tieXml =
    (tieStart ? '<tie type="start"/>' : '') + (tieStop ? '<tie type="stop"/>' : '')
  const beamXml = chord
    ? ''
    : beamValues
        .map((beam) => `<beam number="${beam.number}">${beam.value}</beam>`)
        .join('')
  const timeModXml =
    timeModification?.actualNotes && timeModification?.normalNotes
      ? `<time-modification><actual-notes>${timeModification.actualNotes}</actual-notes><normal-notes>${timeModification.normalNotes}</normal-notes></time-modification>`
      : ''
  const tupletNotationParts = []
  if (!chord && timeModification?.tupletStart) {
    tupletNotationParts.push('<tuplet type="start"/>')
  }
  if (!chord && timeModification?.tupletStop) {
    tupletNotationParts.push('<tuplet type="stop"/>')
  }
  const articulationParts = []
  const standaloneNotationParts = []
  standaloneNotationParts.push(...tupletNotationParts)
  const articulationByType = new Map()
  for (const candidate of [
    ...(notationArticulations ?? []),
    articulation,
    accentArticulation,
  ]) {
    if (!candidate?.type || articulationByType.has(candidate.type)) {
      continue
    }
    articulationByType.set(candidate.type, candidate)
  }
  // Do not emit staccato on a sustained tie start — that combination is almost
  // always a false positive from scan noise near the head.
  for (const [type, candidate] of articulationByType) {
    const placement =
      candidate.placement === 'above' || candidate.placement === 'below'
        ? ` placement="${candidate.placement}"`
        : ''
    if (type === 'staccato' && !tieStart && !tieStop) {
      articulationParts.push(`<staccato${placement}/>`)
    } else if (type === 'accent') {
      articulationParts.push(`<accent${placement}/>`)
    } else if (type === 'tenuto') {
      articulationParts.push(`<tenuto${placement}/>`)
    } else if (type === 'marcato') {
      const direction = candidate.placement === 'below' ? 'down' : 'up'
      articulationParts.push(
        `<strong-accent type="${direction}"${placement}/>`,
      )
    } else if (type === 'fermata') {
      const orientation =
        candidate.placement === 'below' ? 'inverted' : 'upright'
      standaloneNotationParts.push(
        `<fermata type="${orientation}"${placement}/>`,
      )
    }
  }
  const articulationXml = articulationParts.length
    ? `<articulations>${articulationParts.join('')}</articulations>`
    : ''
  const standaloneNotationXml = standaloneNotationParts.join('')
  const tiedXml =
    tieStart || tieStop
      ? `${tieStart ? `<tied type="start"${tiePlacement ? ` placement="${tiePlacement}"` : ''}/>` : ''}${
          tieStop ? `<tied type="stop"${tiePlacement ? ` placement="${tiePlacement}"` : ''}/>` : ''
        }`
      : ''
  const slurNumberAttr = slurNumber ?? '1'
  const slurPlacementAttr = slurPlacement ? ` placement="${slurPlacement}"` : ''
  const slurXml =
    slurStart || slurStop
      ? `${slurStart ? `<slur type="start" number="${slurNumberAttr}"${slurPlacementAttr}/>` : ''}${
          slurStop ? `<slur type="stop" number="${slurNumberAttr}"${slurPlacementAttr}/>` : ''
        }`
      : ''
  const fretXml = technicalXml(note)
  const notationsXml =
    articulationXml || standaloneNotationXml || tiedXml || slurXml || fretXml
      ? `<notations>${articulationXml}${standaloneNotationXml}${tiedXml}${slurXml}${fretXml}</notations>`
      : ''
  const staffXml = staff != null ? `<staff>${staff}</staff>` : ''
  const stemXml =
    stemDirection === 'up' || stemDirection === 'down'
      ? `<stem>${stemDirection}</stem>`
      : ''
  return (
    `<note>${chord ? '<chord/>' : ''}` +
    `${pitchXml(note, octaveShiftSemitones)}` +
    `${accidentalXml(note)}<duration>${duration}</duration>${tieXml}<voice>${voice}</voice>` +
    `<type>${type}</type>${dotXml}${timeModXml}${staffXml}${stemXml}${beamXml}${notationsXml}</note>`
  )
}

function restXml(
  duration,
  type = 'quarter',
  voice = 1,
  staff = null,
  dotted = false,
  notationArticulations = [],
) {
  const staffXml = staff != null ? `<staff>${staff}</staff>` : ''
  const dotXml = dotted ? '<dot/>' : ''
  const fermata = (notationArticulations ?? []).find(
    (entry) => entry?.type === 'fermata',
  )
  const fermataXml = fermata
    ? `<notations><fermata type="${fermata.placement === 'below' ? 'inverted' : 'upright'}"${
        fermata.placement ? ` placement="${fermata.placement}"` : ''
      }/></notations>`
    : ''
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${dotXml}${staffXml}${fermataXml}</note>`
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
    const numberAttr = marking.endingStartNumbers?.length
      ? ` number="${marking.endingStartNumbers.join(',')}"`
      : ''
    xml += `<barline location="right"><ending${numberAttr} type="stop"/></barline>`
  }
  return xml
}

function staffXml(staff) {
  return Number.isFinite(staff) ? `<staff>${staff}</staff>` : ''
}

function offsetXml(onsetDivision) {
  const offset = Math.round(Number(onsetDivision) || 0)
  return offset > 0 ? `<offset>${offset}</offset>` : ''
}

function tempoMarkingXml(marking) {
  if (!shouldEmitTempoMarking(marking)) {
    return ''
  }
  let body = ''
  if (marking.words) {
    body += `<direction-type><words>${escapeXml(marking.words)}</words></direction-type>`
  }
  if (marking.beatUnit && Number.isFinite(marking.markBpm)) {
    const dots = Math.max(0, Math.round(Number(marking.dots) || 0))
    const dotXml = '<beat-unit-dot/>'.repeat(dots)
    body += `<direction-type><metronome><beat-unit>${marking.beatUnit}</beat-unit>${dotXml}<per-minute>${Math.round(marking.markBpm)}</per-minute></metronome></direction-type>`
  }
  const quarter = marking.quarterBpm ?? marking.bpm
  if (Number.isFinite(quarter) && quarter > 0) {
    body += `<sound tempo="${Math.round(quarter)}"/>`
  }
  if (!body) {
    return ''
  }
  const offset =
    Number.isFinite(marking.onsetDivision) && marking.onsetDivision > 0
      ? `<offset>${Math.round(marking.onsetDivision)}</offset>`
      : ''
  return `<direction>${body}${offset}</direction>`
}

function legacyInitialTempoXml(tempo, emitTempo) {
  if (emitTempo) {
    return tempoMarkingXml({
      beatUnit: tempo.beatUnit ?? 'quarter',
      dots: tempo.dots ?? 0,
      markBpm: tempo.markBpm ?? tempo.bpm,
      quarterBpm: tempo.bpm,
      words: tempo.words,
      confidence: tempo.confidence ?? 1,
      onsetDivision: 0,
    })
  }
  // Do not invent a printed tempo when none was recognized.
  return ''
}

function dynamicXml(mark, { staff = null, onsetDivision = 0 } = {}) {
  if (!mark) {
    return ''
  }
  return `<direction><direction-type><dynamics><${mark}/></dynamics></direction-type>${offsetXml(onsetDivision)}${staffXml(staff)}</direction>`
}

function wedgeXml(wedge) {
  if (!shouldEmitWedge(wedge)) {
    return ''
  }
  const type = wedge.stage === 'stop' ? 'stop' : wedge.type
  return `<direction><direction-type><wedge type="${type}"/></direction-type>${offsetXml(wedge.onsetDivision)}${staffXml(wedge.staff)}</direction>`
}

function pedalXml() {
  return '<direction><direction-type><pedal type="start" line="yes"/></direction-type></direction>'
}

function collectMeasureDynamics(measure) {
  if (Array.isArray(measure.dynamics) && measure.dynamics.length) {
    return measure.dynamics.filter((entry) => shouldEmitDynamic(entry))
  }
  if (measure.dynamic && shouldEmitDynamic(measure.dynamic)) {
    return [measure.dynamic]
  }
  return []
}

function sortMeasureEvents(events) {
  return [...events].sort((a, b) => a.startDivision - b.startDivision)
}

/**
 * Build MusicXML from validated rhythmic measure events and musical metadata.
 */
export function buildOmrMusicXml({
  title = 'PDF OMR',
  measures = [],
  musical = {},
  includeDisclaimer = true,
  /** Instrument definition; null keeps the long-standing piano emission. */
  instrument = null,
} = {}) {
  const sortedMeasuresRaw = [...measures].sort((a, b) => a.measureNumber - b.measureNumber)
  const repeatSanitize = sanitizeOmrRepeatMarkings(sortedMeasuresRaw)
  const sortedMeasures = repeatSanitize.measures
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

  const partName = instrument?.omr?.partName ?? 'Piano'
  // Guitar keeps the transposed-treble clef marker for display, but staff-
  // derived note.midi is already sounding (matches TAB / CC0 truth). Do not
  // subtract writtenOctaveOffset again when emitting <pitch>.
  const writtenOctaveOffset = instrument?.notation?.writtenOctaveOffset ?? 0
  const octaveShiftSemitones = 0
  const clefOctaveXml = writtenOctaveOffset
    ? `<clef-octave-change>${writtenOctaveOffset}</clef-octave-change>`
    : ''

  const hasTuplets = sortedMeasures.some((measure) =>
    (measure.events ?? []).some(
      (event) =>
        event.timeModification?.actualNotes &&
        event.timeModification?.normalNotes,
    ),
  )
  // Triplet eighths need integer sounding durations (truth uses divisions=12,
  // duration=4). Scale the internal divisions=4 grid by 3 when tuplets appear.
  const divisionScale = hasTuplets ? 3 : 1
  const xmlDivisions = OMR_DIVISIONS_PER_QUARTER * divisionScale
  const grandStaff = shouldEmitGrandStaffMusicXml(sortedMeasures, instrument)
  const clefXml = grandStaff
    ? '<staves>2</staves>' +
      '<clef number="1"><sign>G</sign><line>2</line></clef>' +
      `<clef number="2"><sign>F</sign><line>4</line></clef>`
    : `<clef><sign>G</sign><line>2</line>${clefOctaveXml}</clef>`

  let measuresXml = ''
  let emittedTabApproximateWarning = false
  for (const measure of sortedMeasures) {
    let inner = ''
    if (measure.measureNumber === sortedMeasures[0].measureNumber) {
      inner += `<attributes><divisions>${xmlDivisions}</divisions>`
      if (emitKey) {
        inner += `<key><fifths>${keySignature.fifths}</fifths><mode>${keySignature.mode ?? 'major'}</mode></key>`
      }
      inner +=
        `<time><beats>${timeSignature.beats}</beats><beat-type>${timeSignature.beatType}</beat-type></time>` +
        `${clefXml}</attributes>`
      if (includeDisclaimer) {
        inner += `<direction><words>${escapeXml(OMR_DISCLAIMER)}</words></direction>`
      }
      if (measure.rhythmApproximate && !emittedTabApproximateWarning) {
        inner += `<direction><words>${escapeXml(TAB_APPROXIMATE_RHYTHM_WARNING)}</words></direction>`
        emittedTabApproximateWarning = true
      }
      const hasMeasureTempos = (measure.tempoMarkings ?? []).some((mark) =>
        shouldEmitTempoMarking(mark),
      )
      if (!hasMeasureTempos) {
        inner += legacyInitialTempoXml(tempo, emitTempo)
      }
    }

    for (const marking of measure.tempoMarkings ?? []) {
      inner += tempoMarkingXml(marking)
    }

    if (measure.repeatMarking && shouldEmitRepeat(measure.repeatMarking)) {
      inner += barlineXml(measure.repeatMarking)
    }
    if (measure.endingMarking && shouldEmitEnding(measure.endingMarking)) {
      inner += barlineXml({
        endingStartNumbers: measure.endingMarking.endingStartNumbers,
        endingStop: measure.endingMarking.endingStop,
        endingDiscontinue: measure.endingMarking.endingDiscontinue,
      })
    }

    if (measure.uncertain) {
      inner += '<direction><words>OMR rhythm uncertain</words></direction>'
    }

    for (const dynamic of collectMeasureDynamics(measure)) {
      inner += dynamicXml(dynamic.mark, {
        staff: dynamic.staff,
        onsetDivision: dynamic.onsetDivision,
      })
    }
    for (const wedge of measure.wedges ?? []) {
      inner += wedgeXml(wedge)
    }
    if (measure.pedal && shouldEmitPedal(measure.pedal)) {
      inner += pedalXml()
    }

    let cursor = 0
    const sortedEvents = sortMeasureEvents(measure.events)
    const beamValuesByEvent = buildMeasureBeamValues(sortedEvents)
    const structure = buildMeasureStructureUnits(measure)
    const hasParallelVoices = structure.diagnostics.polyphonicStaffs.length > 0
    const structureUnits = structure.units.sort(
      hasParallelVoices
        ? (left, right) =>
            left.voice - right.voice ||
            left.startDivision - right.startDivision ||
            left.order - right.order
        : (left, right) =>
            left.startDivision - right.startDivision ||
            left.order - right.order,
    )

    for (const unit of structureUnits) {
      const event = unit.event
      const rawDuration = event.durationDivisions
      const duration = Math.max(1, Math.round(rawDuration * divisionScale))
      const type =
        event.durationType ?? durationTypeForDivisions(rawDuration, Boolean(event.dotted))
      const eventStart = Number.isFinite(event.startDivision)
        ? Math.max(0, Math.round(event.startDivision * divisionScale))
        : 0
      const moved = cursorXml(cursor, eventStart)
      inner += moved.xml
      cursor = moved.cursor

      if (event.type === 'rest') {
        const voice = unit.voice
        const staff = grandStaff ? staffNumberForClef(event.clef) : null
        inner += restXml(
          duration,
          type,
          voice,
          staff,
          Boolean(event.dotted),
          event.notationArticulations,
        )
        cursor += duration
        continue
      }

      const notes = unit.notes ?? []
      notes.forEach((note, index) => {
        const noteClef = note.clef ?? event.clef
        const noteStaff = staffNumberForClef(noteClef)
        const unitStaff = staffNumberForClef(unit.clef)
        // A legacy event can contain notes from both staves. Keep its
        // established per-note voice unless this unit owns that staff; this
        // avoids turning mixed-staff chord evidence into a cross-staff voice.
        const voice =
          noteStaff === unitStaff
            ? unit.voice
            : defaultVoiceForClef(noteClef)
        const staff = grandStaff ? noteStaff : null
        const timeModification =
          event.timeModification ?? note.timeModification ?? null
        // Preserve written note type under tuplets (eighth runs and quarter+eighth).
        const writtenType =
          timeModification != null
            ? event.durationType ?? note.durationType ?? type
            : type
        inner += noteXml(note, {
          chord: index > 0,
          duration,
          type: writtenType,
          dotted: event.dotted,
          tieStart: Boolean(note.tieStart ?? (notes.length === 1 && event.tieStart)),
          tieStop: Boolean(note.tieStop ?? (notes.length === 1 && event.tieStop)),
          tiePlacement: note.tiePlacement ?? event.tiePlacement ?? null,
          slurStart: Boolean(note.slurStart ?? (notes.length === 1 && event.slurStart)),
          slurStop: Boolean(note.slurStop ?? (notes.length === 1 && event.slurStop)),
          slurNumber: note.slurNumber ?? event.slurNumber ?? '1',
          slurPlacement: note.slurPlacement ?? event.slurPlacement ?? null,
          beamValues: unit.emitEventBeams
            ? beamValuesByEvent.get(event) ?? []
            : [],
          articulation: note.articulation,
          accentArticulation: note.accentArticulation,
          notationArticulations: note.notationArticulations,
          voice,
          staff,
          stemDirection: unit.stemDirection,
          octaveShiftSemitones,
          timeModification,
        })
      })
      cursor += duration
    }

    measuresXml += `<measure number="${measure.measureNumber}">${inner}</measure>`
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<score-partwise version="3.1">` +
    `<work><work-title>${escapeXml(title)}</work-title></work>` +
    `<part-list><score-part id="P1"><part-name>${escapeXml(partName)}</part-name></score-part></part-list>` +
    `<part id="P1">${measuresXml}</part>` +
    `</score-partwise>`
  )
}

/** Back-compat helper for tests that still pass flat note lists. */
export function buildOmrMusicXmlFromNotes({ title = 'PDF OMR', notes = [] } = {}) {
  const byMeasure = new Map()
  for (const note of notes) {
    if (!byMeasure.has(note.measureNumber)) {
      byMeasure.set(note.measureNumber, [])
    }
    byMeasure.get(note.measureNumber).push(note)
  }

  const measures = [...byMeasure.keys()].sort((a, b) => a - b).map((measureNumber) => {
    const measureNotes = byMeasure.get(measureNumber)
    const events = measureNotes.map((note, index) => ({
      type: 'note',
      startDivision: Math.min(
        OMR_DEFAULT_BEATS * OMR_DIVISIONS_PER_QUARTER - 1,
        Math.floor(note.positionInMeasure * OMR_DEFAULT_BEATS * OMR_DIVISIONS_PER_QUARTER),
      ),
      durationDivisions: OMR_DIVISIONS_PER_QUARTER,
      durationType: 'quarter',
      dotted: false,
      notes: [note],
      cx: note.cx ?? index,
    }))
    return { measureNumber, events, uncertain: false, confidence: 0.75 }
  })

  return buildOmrMusicXml({ title, measures, includeDisclaimer: false })
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
