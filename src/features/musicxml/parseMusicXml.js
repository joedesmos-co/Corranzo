import { XMLParser } from 'fast-xml-parser'
import { extractTempoFromDirection } from './extractTempo.js'
import { noteLabel, pitchToMidi } from './parsePitch.js'
import { quartersToSeconds } from './timingMath.js'
import {
  buildPerformedMeasureTimeline,
  extractMeasureRepeatMarkings,
} from './parseMeasureRepeats.js'
import { readNoteLayout } from './readNoteLayout.js'
import {
  asNumber,
  divisionsToSeconds,
  ensureArray,
  getMeasureNumber,
} from './xmlUtils.js'

const DEFAULT_BPM = 120
const DEFAULT_DIVISIONS = 1
const DEFAULT_BEATS = 4
const DEFAULT_BEAT_TYPE = 4

/** MusicXML measure child order (attributes before notes). Object key order is not reliable. */
const MEASURE_ELEMENT_ORDER = [
  'attributes',
  'barline',
  'direction',
  'figured-bass',
  'harmony',
  'grouping',
  'link',
  'print',
  'sound',
  'forward',
  'backup',
  'note',
]

function measureLengthQuarters(beats, beatType) {
  return beats * (4 / beatType)
}

function measureStartsNewSystem(measureNode) {
  const prints = ensureArray(measureNode?.print)
  return prints.some((printNode) => {
    const value = printNode?.['@_new-system']
    return value === 'yes' || value === 'true' || value === '1'
  })
}

function getWorkTitle(score) {
  const identification = score.identification
  const work = score.work
  const title =
    work?.['work-title'] ??
    identification?.['work-title'] ??
    identification?.encoding?.['software']
  return title ? String(title) : null
}

function getParts(score) {
  return ensureArray(score.part).map((part, index) => ({
    id: part['@_id'] ?? `P${index + 1}`,
    measures: ensureArray(part.measure),
  }))
}

function readAttributes(attributesNode, state) {
  if (!attributesNode) {
    return state
  }

  const nodes = ensureArray(attributesNode)
  let next = { ...state }

  for (const attributes of nodes) {
    const divisions = asNumber(attributes.divisions, NaN)
    if (Number.isFinite(divisions) && divisions > 0) {
      next.divisions = divisions
    }

    const time = attributes.time
    if (time) {
      next.beats = asNumber(time.beats, next.beats)
      next.beatType = asNumber(time['beat-type'], next.beatType)
    }
  }

  return next
}

function readNoteDuration(noteNode) {
  return asNumber(noteNode.duration, 0)
}

function readNoteVoice(noteNode) {
  const voice = asNumber(noteNode.voice, NaN)
  return Number.isFinite(voice) && voice > 0 ? voice : 1
}

/** Per-voice cursors — parallel voices must not advance the same timeline sequentially. */
function createVoiceCursors() {
  const voices = new Map()

  function get(voiceId) {
    const id = voiceId > 0 ? voiceId : 1
    if (!voices.has(id)) {
      voices.set(id, { cursor: 0, chordStart: 0 })
    }
    return voices.get(id)
  }

  function withLargestCursor() {
    let bestId = 1
    let bestCursor = -1
    for (const [id, state] of voices) {
      if (state.cursor > bestCursor) {
        bestCursor = state.cursor
        bestId = id
      }
    }
    return get(bestId)
  }

  function maxCursor() {
    let max = 0
    for (const state of voices.values()) {
      max = Math.max(max, state.cursor)
    }
    return max
  }

  return { get, withLargestCursor, maxCursor }
}

function isChordNote(noteNode) {
  return noteNode.chord != null
}

function isGraceNote(noteNode) {
  return noteNode.grace != null
}

function isRestNote(noteNode) {
  return noteNode.rest != null
}

function pushTempoChange(tempoChanges, quarterTime, bpm) {
  const last = tempoChanges[tempoChanges.length - 1]
  if (last && last.bpm === bpm && Math.abs(last.quarterTime - quarterTime) < 1e-6) {
    return
  }
  tempoChanges.push({ quarterTime, bpm })
}

function pushTimeSignature(timeSignatures, quarterTime, beats, beatType) {
  const last = timeSignatures[timeSignatures.length - 1]
  if (
    last &&
    last.beats === beats &&
    last.beatType === beatType &&
    Math.abs(last.quarterTime - quarterTime) < 1e-6
  ) {
    return
  }
  timeSignatures.push({ quarterTime, beats, beatType })
}

function measureElementSortIndex(kind) {
  const index = MEASURE_ELEMENT_ORDER.indexOf(kind)
  return index >= 0 ? index : MEASURE_ELEMENT_ORDER.length + 1
}

function getOrderedMeasureChildren(measureNode) {
  const skipKeys = new Set(['@_number', '@_width', '@_id'])
  const children = []

  for (const [key, value] of Object.entries(measureNode)) {
    if (skipKeys.has(key)) {
      continue
    }
    for (const item of ensureArray(value)) {
      children.push({ kind: key, node: item })
    }
  }

  children.sort((a, b) => measureElementSortIndex(a.kind) - measureElementSortIndex(b.kind))
  return children
}

function parseMeasureElements({
  children,
  partId,
  measureNumber,
  measureStartQuarters,
  state,
  tempoChanges,
  timeSignatures,
  notes,
  timingEvents,
  notesOnly = false,
}) {
  let { divisions, bpm, beats, beatType } = state
  let measureBeats = beats
  let measureBeatType = beatType
  const voiceCursors = createVoiceCursors()

  const measureLengthDivisions = measureLengthQuarters(beats, beatType) * divisions

  function quarterAtDivision(divisionOffset) {
    return measureStartQuarters + divisionOffset / divisions
  }

  function emitTempo(newBpm, divisionOffset) {
    if (!Number.isFinite(newBpm) || newBpm <= 0 || newBpm === bpm) {
      return
    }
    bpm = newBpm
    const quarterTime = quarterAtDivision(divisionOffset)
    pushTempoChange(tempoChanges, quarterTime, bpm)
    timingEvents.push({
      type: 'tempo-change',
      quarterTime,
      timeSeconds: quartersToSeconds(quarterTime, tempoChanges),
      bpm,
      measureNumber,
    })
  }

  for (const child of children) {
    if (notesOnly && child.kind !== 'note' && child.kind !== 'backup' && child.kind !== 'forward') {
      continue
    }

    if (child.kind === 'attributes') {
      const next = readAttributes(child.node, { divisions, bpm, beats, beatType })
      if (next.divisions !== divisions) {
        divisions = next.divisions
      }
      if (next.beats !== beats || next.beatType !== beatType) {
        beats = next.beats
        beatType = next.beatType
        measureBeats = beats
        measureBeatType = beatType
        pushTimeSignature(
          timeSignatures,
          quarterAtDivision(voiceCursors.maxCursor()),
          beats,
          beatType,
        )
        timingEvents.push({
          type: 'time-signature',
          quarterTime: quarterAtDivision(voiceCursors.maxCursor()),
          timeSeconds: quartersToSeconds(
            quarterAtDivision(voiceCursors.maxCursor()),
            tempoChanges,
          ),
          beats,
          beatType,
          measureNumber,
        })
      }
    }

    if (child.kind === 'direction') {
      const newBpm = extractTempoFromDirection(child.node)
      if (newBpm) {
        emitTempo(newBpm, voiceCursors.maxCursor())
      }
    }

    if (child.kind === 'sound') {
      const tempo = asNumber(child.node['@_tempo'], NaN)
      if (Number.isFinite(tempo) && tempo > 0) {
        emitTempo(tempo, voiceCursors.maxCursor())
      }
    }

    if (child.kind === 'backup') {
      const backupDuration = asNumber(child.node.duration, 0)
      const state = voiceCursors.withLargestCursor()
      state.cursor = Math.max(0, state.cursor - backupDuration)
      state.chordStart = state.cursor
    }

    if (child.kind === 'forward') {
      const forwardDuration = asNumber(child.node.duration, 0)
      const state = voiceCursors.withLargestCursor()
      state.cursor += forwardDuration
      state.chordStart = state.cursor
    }

    if (child.kind === 'note') {
      const noteNode = child.node
      const duration = readNoteDuration(noteNode)
      const chord = isChordNote(noteNode)
      const grace = isGraceNote(noteNode)
      const rest = isRestNote(noteNode)
      const voiceState = voiceCursors.get(readNoteVoice(noteNode))

      const startDivisions = chord ? voiceState.chordStart : voiceState.cursor
      const quarterTime = quarterAtDivision(startDivisions)
      const timeSeconds = quartersToSeconds(quarterTime, tempoChanges)

      if (!grace) {
        const layout = readNoteLayout(noteNode)
        const voice = readNoteVoice(noteNode)
        notes.push({
          id: `${partId}-m${measureNumber}-n${notes.length}`,
          partId,
          measureNumber,
          quarterTime,
          timeSeconds,
          durationDivisions: duration,
          durationSeconds: divisionsToSeconds(duration, divisions, bpm),
          midi: rest ? null : pitchToMidi(noteNode.pitch),
          label: rest ? 'rest' : noteLabel(noteNode.pitch),
          isRest: rest,
          isChord: chord,
          isGrace: grace,
          voice,
          ...layout,
        })

        if (!rest) {
          timingEvents.push({
            type: 'note-on',
            quarterTime,
            timeSeconds,
            measureNumber,
            midi: pitchToMidi(noteNode.pitch),
            label: noteLabel(noteNode.pitch),
          })
        }
      }

      if (!chord && !grace) {
        voiceState.cursor += duration
        voiceState.chordStart = voiceState.cursor
      } else if (!chord) {
        voiceState.chordStart = voiceState.cursor
      }
    }
  }

  // Bar length comes from the time signature, not the sum of all voices in document order.
  // Summing voices without backup inflated measures (e.g. 3/8 showing beats 1–2 fast, 3 slow).
  const notatedMaxCursor = voiceCursors.maxCursor()
  const effectiveMeasureDivisions =
    measureLengthDivisions > 0
      ? measureLengthDivisions
      : notatedMaxCursor
  const measureEndQuarters = measureStartQuarters + effectiveMeasureDivisions / divisions

  return {
    endState: { divisions, bpm, beats, beatType },
    measureBeats,
    measureBeatType,
    measureEndQuarters,
    measureLengthQuarters: effectiveMeasureDivisions / divisions,
  }
}

function buildBeatsForMeasure(measure, tempoChanges) {
  const { startQuarters, beats, beatType, number: measureNumber } = measure
  const beatLengthQuarters = 4 / beatType

  const beatList = []
  for (let index = 0; index < beats; index += 1) {
    const quarterTime = startQuarters + index * beatLengthQuarters
    beatList.push({
      measureNumber,
      beat: index + 1,
      quarterTime,
      timeSeconds: quartersToSeconds(quarterTime, tempoChanges),
    })
  }
  return beatList
}

export function parseMusicXml(xmlString, fileName = 'score.musicxml') {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
  })

  const document = parser.parse(xmlString)
  const score = document['score-partwise'] ?? document['score-timewise']

  if (!score) {
    throw new Error('Unsupported MusicXML: expected score-partwise or score-timewise.')
  }

  if (document['score-timewise']) {
    throw new Error('score-timewise files are not supported yet. Export as score-partwise.')
  }

  const parts = getParts(score)
  if (parts.length === 0) {
    throw new Error('MusicXML contains no parts.')
  }

  const title = getWorkTitle(score)
  const tempoChanges = [{ quarterTime: 0, bpm: DEFAULT_BPM }]
  const timeSignatures = [
    { quarterTime: 0, beats: DEFAULT_BEATS, beatType: DEFAULT_BEAT_TYPE },
  ]
  const notes = []
  const timingEvents = []
  const measures = []
  const beats = []

  let state = {
    divisions: DEFAULT_DIVISIONS,
    bpm: DEFAULT_BPM,
    beats: DEFAULT_BEATS,
    beatType: DEFAULT_BEAT_TYPE,
  }

  let measureStartQuarters = 0
  const primaryMeasures = parts[0].measures

  primaryMeasures.forEach((measureNode, index) => {
    const measureNumber = getMeasureNumber(measureNode, index)
    const measureStartTime = quartersToSeconds(measureStartQuarters, tempoChanges)

    timingEvents.push({
      type: 'measure-start',
      measureNumber,
      quarterTime: measureStartQuarters,
      timeSeconds: measureStartTime,
    })

    const children = getOrderedMeasureChildren(measureNode)
    const result = parseMeasureElements({
      children,
      partId: parts[0].id,
      measureNumber,
      measureStartQuarters,
      state,
      tempoChanges,
      timeSignatures,
      notes,
      timingEvents,
    })

    state = result.endState

    const measureRecord = {
      number: measureNumber,
      startQuarters: measureStartQuarters,
      endQuarters: result.measureEndQuarters,
      startTimeSeconds: measureStartTime,
      endTimeSeconds: quartersToSeconds(result.measureEndQuarters, tempoChanges),
      lengthQuarters: result.measureLengthQuarters,
      beats: result.measureBeats,
      beatType: result.measureBeatType,
      divisions: state.divisions,
      systemBreakBefore: index === 0 || measureStartsNewSystem(measureNode),
    }

    measures.push(measureRecord)
    beats.push(...buildBeatsForMeasure(measureRecord, tempoChanges))

    for (const part of parts.slice(1)) {
      const partMeasure = part.measures[index]
      if (!partMeasure) {
        continue
      }
      parseMeasureElements({
        children: getOrderedMeasureChildren(partMeasure),
        partId: part.id,
        measureNumber,
        measureStartQuarters,
        state: {
          divisions: measureRecord.divisions,
          bpm: state.bpm,
          beats: measureRecord.beats,
          beatType: measureRecord.beatType,
        },
        tempoChanges,
        timeSignatures,
        notes,
        timingEvents,
        notesOnly: true,
      })
    }

    measureStartQuarters = result.measureEndQuarters
  })

  const writtenDurationSeconds =
    measures.length > 0
      ? measures[measures.length - 1].endTimeSeconds
      : 0

  const measureMarkings = primaryMeasures.map((measureNode) =>
    extractMeasureRepeatMarkings(measureNode),
  )
  const performedMeasureTimeline = buildPerformedMeasureTimeline(
    measures,
    measureMarkings,
    beats,
  )

  const durationSeconds = performedMeasureTimeline.diagnostics.usesPerformedTimeline
    ? performedMeasureTimeline.performedDurationSeconds
    : writtenDurationSeconds

  notes.sort((a, b) => a.timeSeconds - b.timeSeconds || a.quarterTime - b.quarterTime)
  timingEvents.sort((a, b) => a.timeSeconds - b.timeSeconds || a.quarterTime - b.quarterTime)

  const pitchNotes = notes.filter((note) => !note.isRest && note.midi != null)

  return {
    version: 1,
    fileName,
    title,
    durationSeconds,
    writtenDurationSeconds,
    noteCount: pitchNotes.length,
    divisions: state.divisions,
    measures,
    beats,
    performedMeasureTimeline,
    tempoChanges,
    timeSignatures,
    notes,
    timingEvents,
    parts: parts.map((part) => ({ id: part.id, measureCount: part.measures.length })),
  }
}
