import {
  OMR_DEFAULT_BEATS,
  OMR_DEFAULT_BEAT_TYPE,
  OMR_DEFAULT_TEMPO,
} from './omrConstants.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import { OMR_DISCLAIMER } from './omrMusicalConstants.js'
import { TAB_APPROXIMATE_RHYTHM_WARNING } from './detectTabNotation.js'
import { shouldEmitKeySignature } from './detectOmrKeySignature.js'
import { shouldEmitTempo } from './parseOmrTempoMarking.js'
import { shouldEmitRepeat, shouldEmitEnding } from './detectOmrRepeatBarline.js'
import {
  shouldEmitArticulation,
  shouldEmitDynamic,
  shouldEmitPedal,
} from './detectOmrExpression.js'
import { midiToWrittenPitch } from './pitchFromStaffPosition.js'

const TYPE_BY_DIVISIONS = {
  16: 'whole',
  8: 'half',
  4: 'quarter',
  2: 'eighth',
  1: 'sixteenth',
}

function durationTypeForDivisions(durationDivisions, dotted) {
  const base = dotted ? Math.round((durationDivisions * 2) / 3) : durationDivisions
  return TYPE_BY_DIVISIONS[base] ?? 'quarter'
}

function pitchXml(note, octaveShiftSemitones = 0) {
  // Staff-position pitches are written pitch; instruments that sound an
  // octave below written (guitar) shift here so MusicXML carries sounding
  // pitch. Tab-derived notes are already sounding pitch — never shifted.
  const shift = note.soundingPitch ? 0 : octaveShiftSemitones
  const pitch = midiToWrittenPitch(note.midi + shift)
  const alterXml = pitch.alter != null ? `<alter>${pitch.alter}</alter>` : ''
  return `<pitch><step>${pitch.step}</step>${alterXml}<octave>${pitch.octave}</octave></pitch>`
}

/** <technical> string/fret for fretted instruments; empty when absent. */
function technicalXml(note) {
  if (note.string == null || note.fret == null) {
    return ''
  }
  return `<technical><string>${note.string}</string><fret>${note.fret}</fret></technical>`
}

/** Only join beam tags across events that share a promoted topology group. */
function eventsShareBeamTopology(left, right) {
  const leftGroup = left?.beamTopologyGroupId ?? null
  const rightGroup = right?.beamTopologyGroupId ?? null
  if (leftGroup == null || rightGroup == null) {
    return false
  }
  return leftGroup === rightGroup
}

function beamValueForEvent(sortedEvents, index) {
  const event = sortedEvents[index]
  if (!event || event.type === 'rest') {
    return null
  }
  const hasBeam =
    Number(event.beams ?? 0) > 0 || Boolean(event.beamTopologyGroupId)
  if (!hasBeam) {
    return null
  }
  const previous = sortedEvents
    .slice(0, index)
    .reverse()
    .find((entry) => entry.type === 'note')
  const next = sortedEvents.slice(index + 1).find((entry) => entry.type === 'note')
  const sharePrevious = previous && eventsShareBeamTopology(previous, event)
  const shareNext = next && eventsShareBeamTopology(event, next)
  if (sharePrevious && shareNext) {
    return 'continue'
  }
  if (sharePrevious) {
    return 'end'
  }
  if (shareNext) {
    return 'begin'
  }
  return null
}

/** Map each note event to MusicXML beam values, gated by topology group ids. */
export function buildMeasureBeamValues(events = []) {
  const sorted = [...events].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (left.clef === 'bass' ? 1 : 0) - (right.clef === 'bass' ? 1 : 0),
  )
  const values = new Map()
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]
    const value = beamValueForEvent(sorted, index)
    values.set(event, value ? [{ number: 1, value }] : [])
  }
  return values
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
    beamValue = null,
    articulation = null,
    accentArticulation = null,
    voice = 1,
    octaveShiftSemitones = 0,
  } = {},
) {
  const dotXml = dotted ? '<dot/>' : ''
  const tieXml =
    (tieStart ? '<tie type="start"/>' : '') + (tieStop ? '<tie type="stop"/>' : '')
  // Chord members never carry <beam>; only the first note of the event does.
  const resolvedBeam =
    chord || note?.isChord
      ? null
      : beamValue ?? (beams > 0 ? 'begin' : null)
  const beamXml = resolvedBeam ? `<beam number="1">${resolvedBeam}</beam>` : ''
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
  const fretXml = technicalXml(note)
  const notationsXml =
    articulationXml || tiedXml || fretXml
      ? `<notations>${articulationXml}${tiedXml}${fretXml}</notations>`
      : ''
  return (
    `<note>${chord ? '<chord/>' : ''}` +
    `${pitchXml(note, octaveShiftSemitones)}` +
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

  const partName = instrument?.omr?.partName ?? 'Piano'
  // Instruments that sound an octave below written treble (guitar) emit the
  // octave-marked clef and sounding pitches; piano's 0 keeps output identical.
  const writtenOctaveOffset = instrument?.notation?.writtenOctaveOffset ?? 0
  const octaveShiftSemitones = writtenOctaveOffset * 12
  const clefOctaveXml = writtenOctaveOffset
    ? `<clef-octave-change>${writtenOctaveOffset}</clef-octave-change>`
    : ''

  let measuresXml = ''
  let emittedTabApproximateWarning = false
  for (const measure of sortedMeasures) {
    let inner = ''
    if (measure.measureNumber === sortedMeasures[0].measureNumber) {
      inner += `<attributes><divisions>${OMR_DIVISIONS_PER_QUARTER}</divisions>`
      if (emitKey) {
        inner += `<key><fifths>${keySignature.fifths}</fifths><mode>${keySignature.mode ?? 'major'}</mode></key>`
      }
      inner +=
        `<time><beats>${timeSignature.beats}</beats><beat-type>${timeSignature.beatType}</beat-type></time>` +
        `<clef><sign>G</sign><line>2</line>${clefOctaveXml}</clef></attributes>`
      if (includeDisclaimer) {
        inner += `<direction><words>${escapeXml(OMR_DISCLAIMER)}</words></direction>`
      }
      if (measure.rhythmApproximate && !emittedTabApproximateWarning) {
        inner += `<direction><words>${escapeXml(TAB_APPROXIMATE_RHYTHM_WARNING)}</words></direction>`
        emittedTabApproximateWarning = true
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

    let cursor = 0
    const sortedEvents = sortMeasureEvents(measure.events)

    for (let eventIndex = 0; eventIndex < sortedEvents.length; eventIndex += 1) {
      const event = sortedEvents[eventIndex]
      const duration = event.durationDivisions
      const type = event.durationType ?? durationTypeForDivisions(
        event.dotted ? Math.round((duration * 2) / 3) : duration,
        event.dotted,
      )
      const eventStart = Number.isFinite(event.startDivision)
        ? Math.max(0, event.startDivision)
        : 0
      const moved = cursorXml(cursor, eventStart)
      inner += moved.xml
      cursor = moved.cursor

      if (event.type === 'rest') {
        const voice = event.clef === 'bass' ? 2 : 1
        inner += restXml(duration, type, voice)
        cursor += duration
        continue
      }

      const beamValue = beamValueForEvent(sortedEvents, eventIndex)
      const notes = event.notes ?? []
      notes.forEach((note, index) => {
        const voice = note.clef === 'bass' ? 2 : 1
        inner += noteXml(note, {
          chord: index > 0,
          duration,
          type,
          dotted: event.dotted,
          tieStart: event.tieStart,
          tieStop: event.tieStop,
          beams: event.beams,
          beamValue,
          articulation: note.articulation,
          accentArticulation: note.accentArticulation,
          voice,
          octaveShiftSemitones,
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
