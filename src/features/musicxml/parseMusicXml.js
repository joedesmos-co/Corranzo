import {
  attr,
  childNodes,
  childText,
  findChild,
  findChildren,
  numberOf,
  parseXmlOrdered,
  rootElement,
  textOf,
} from './xmlTree.js'
import { quartersToSeconds } from './timingMath.js'
import { buildPerformedMeasureTimeline } from './parseMeasureRepeats.js'

const DEFAULT_BPM = 120
const DEFAULT_DIVISIONS = 1
const DEFAULT_BEATS = 4
const DEFAULT_BEAT_TYPE = 4

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Quarters represented by one beat-unit (per-minute marks scale to quarter BPM). */
const BEAT_UNIT_QUARTERS = {
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '8th': 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
}

function measureLengthQuarters(beats, beatType) {
  return beats * (4 / beatType)
}

function pitchNodeToMidi(pitchNode) {
  if (!pitchNode) {
    return null
  }
  const step = childText(pitchNode, 'step')
  const octave = numberOf(childText(pitchNode, 'octave'), NaN)
  if (!step || !Number.isFinite(octave) || !(step in STEP_TO_SEMITONE)) {
    return null
  }
  const alter = numberOf(childText(pitchNode, 'alter'), 0)
  return Math.round((octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter)
}

function midiToLabel(midi) {
  if (midi == null) {
    return 'rest'
  }
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

function readNoteLayoutOrdered(noteNode) {
  const defaultX = numberOf(attr(noteNode, 'default-x'), NaN)
  const defaultY = numberOf(attr(noteNode, 'default-y'), NaN)
  const relativeX = numberOf(attr(noteNode, 'relative-x'), NaN)
  const relativeY = numberOf(attr(noteNode, 'relative-y'), NaN)
  const staff = numberOf(childText(noteNode, 'staff'), NaN)
  return {
    defaultX: Number.isFinite(defaultX) ? defaultX : null,
    defaultY: Number.isFinite(defaultY) ? defaultY : null,
    relativeX: Number.isFinite(relativeX) ? relativeX : null,
    relativeY: Number.isFinite(relativeY) ? relativeY : null,
    staff: Number.isFinite(staff) && staff > 0 ? staff : null,
  }
}

/** Tempo (quarter BPM) from a <direction> node — <sound tempo> wins, else scaled metronome. */
function tempoFromDirection(directionNode) {
  const sound = findChild(directionNode, 'sound')
  const soundTempo = numberOf(attr(sound, 'tempo'), NaN)
  if (Number.isFinite(soundTempo) && soundTempo > 0) {
    return soundTempo
  }

  for (const directionType of findChildren(directionNode, 'direction-type')) {
    const metronome = findChild(directionType, 'metronome')
    if (!metronome) {
      continue
    }
    const perMinute = numberOf(childText(metronome, 'per-minute'), NaN)
    if (!Number.isFinite(perMinute) || perMinute <= 0) {
      continue
    }
    const beatUnit = childText(metronome, 'beat-unit') ?? 'quarter'
    const baseQuarters = BEAT_UNIT_QUARTERS[beatUnit] ?? 1
    const dots = findChildren(metronome, 'beat-unit-dot').length
    const unitQuarters = dots > 0 ? baseQuarters * (2 - 1 / 2 ** dots) : baseQuarters
    return perMinute * unitQuarters
  }

  return null
}

function parseEndingNumbers(value) {
  if (value == null || value === '') {
    return []
  }
  return String(value)
    .split(/[, ]+/)
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number) && number > 0)
}

/** Repeat / ending markings from a measure's barline children (document order). */
function extractMarkings(measureNode) {
  const marking = {
    forwardRepeat: false,
    backwardRepeat: false,
    backwardRepeatTimes: null,
    endingStartNumbers: null,
    endingStop: false,
    endingDiscontinue: false,
  }

  for (const barline of findChildren(measureNode, 'barline')) {
    const location = attr(barline, 'location') ?? 'right'
    const repeat = findChild(barline, 'repeat')
    if (repeat) {
      const direction = attr(repeat, 'direction')
      if (direction === 'forward' && (location === 'left' || location === 'both')) {
        marking.forwardRepeat = true
      }
      if (direction === 'backward' && (location === 'right' || location === 'both')) {
        marking.backwardRepeat = true
        const times = numberOf(attr(repeat, 'times'), NaN)
        if (Number.isFinite(times) && times > 1) {
          marking.backwardRepeatTimes = times
        }
      }
    }

    const ending = findChild(barline, 'ending')
    if (ending) {
      const type = attr(ending, 'type')
      const numbers = parseEndingNumbers(attr(ending, 'number'))
      if (type === 'start' && numbers.length > 0) {
        marking.endingStartNumbers = numbers
      }
      if (type === 'stop') {
        marking.endingStop = true
      }
      if (type === 'discontinue') {
        marking.endingDiscontinue = true
      }
    }
  }

  return marking
}

function measurePrintFlags(measureNode) {
  let newSystem = false
  let newPage = false
  for (const printNode of findChildren(measureNode, 'print')) {
    const systemValue = attr(printNode, 'new-system')
    const pageValue = attr(printNode, 'new-page')
    if (systemValue === 'yes' || systemValue === 'true' || systemValue === '1') {
      newSystem = true
    }
    if (pageValue === 'yes' || pageValue === 'true' || pageValue === '1') {
      newPage = true
    }
  }
  return { newSystem, newPage }
}

function getMeasureNumberOrdered(measureNode, fallbackIndex) {
  const raw = attr(measureNode, 'number')
  if (raw == null) {
    return fallbackIndex + 1
  }
  const parsed = Number(String(raw).split('.')[0])
  return Number.isFinite(parsed) ? parsed : fallbackIndex + 1
}

function getWorkTitle(scoreNode) {
  const work = findChild(scoreNode, 'work')
  const title = work ? childText(work, 'work-title') : null
  if (title) {
    return String(title)
  }
  const movementTitle = childText(scoreNode, 'movement-title')
  return movementTitle ? String(movementTitle) : null
}

/**
 * Walk one part's measures in document order.
 * Primary part defines measure boundaries, tempo map, and time signatures.
 * Secondary parts contribute notes only, with their own divisions/attributes.
 */
function walkPart({
  partNode,
  partId,
  isPrimary,
  measureBoundaries,
  tempoEvents,
  timeSignatureEvents,
  notes,
  rawTimingEvents,
}) {
  const measureNodes = findChildren(partNode, 'measure')
  let divisions = DEFAULT_DIVISIONS
  let beats = DEFAULT_BEATS
  let beatType = DEFAULT_BEAT_TYPE
  const boundaries = []

  let measureStartQuarters = 0

  measureNodes.forEach((measureNode, index) => {
    const measureNumber = getMeasureNumberOrdered(measureNode, index)
    if (!isPrimary) {
      const boundary = measureBoundaries[index]
      if (!boundary) {
        return
      }
      measureStartQuarters = boundary.startQuarters
    }

    // One running cursor per part (true MusicXML model); chords reuse the last onset.
    let cursorDivisions = 0
    let lastNoteStartDivisions = 0
    let maxCursorDivisions = 0
    let measureBeats = beats
    let measureBeatType = beatType

    for (const child of childNodes(measureNode)) {
      switch (child.tag) {
        case 'attributes': {
          const newDivisions = numberOf(childText(child, 'divisions'), NaN)
          if (Number.isFinite(newDivisions) && newDivisions > 0) {
            divisions = newDivisions
          }
          const timeNode = findChild(child, 'time')
          if (timeNode) {
            const newBeats = numberOf(childText(timeNode, 'beats'), NaN)
            const newBeatType = numberOf(childText(timeNode, 'beat-type'), NaN)
            if (Number.isFinite(newBeats) && newBeats > 0) {
              beats = newBeats
              measureBeats = newBeats
            }
            if (Number.isFinite(newBeatType) && newBeatType > 0) {
              beatType = newBeatType
              measureBeatType = newBeatType
            }
            if (isPrimary) {
              timeSignatureEvents.push({
                quarterTime: measureStartQuarters + cursorDivisions / divisions,
                beats,
                beatType,
                measureNumber,
              })
            }
          }
          break
        }

        case 'direction': {
          if (!isPrimary) {
            break
          }
          const bpm = tempoFromDirection(child)
          if (bpm != null && bpm > 0) {
            tempoEvents.push({
              quarterTime: measureStartQuarters + cursorDivisions / divisions,
              bpm,
              measureNumber,
            })
          }
          break
        }

        case 'sound': {
          if (!isPrimary) {
            break
          }
          const bpm = numberOf(attr(child, 'tempo'), NaN)
          if (Number.isFinite(bpm) && bpm > 0) {
            tempoEvents.push({
              quarterTime: measureStartQuarters + cursorDivisions / divisions,
              bpm,
              measureNumber,
            })
          }
          break
        }

        case 'backup': {
          const duration = numberOf(childText(child, 'duration'), 0)
          cursorDivisions = Math.max(0, cursorDivisions - duration)
          lastNoteStartDivisions = cursorDivisions
          break
        }

        case 'forward': {
          const duration = numberOf(childText(child, 'duration'), 0)
          cursorDivisions += duration
          maxCursorDivisions = Math.max(maxCursorDivisions, cursorDivisions)
          lastNoteStartDivisions = cursorDivisions
          break
        }

        case 'note': {
          const isChord = findChild(child, 'chord') != null
          const isGrace = findChild(child, 'grace') != null
          const isRest = findChild(child, 'rest') != null
          const duration = numberOf(childText(child, 'duration'), 0)
          const voice = numberOf(childText(child, 'voice'), NaN)
          const startDivisions = isChord ? lastNoteStartDivisions : cursorDivisions
          const quarterTime = measureStartQuarters + startDivisions / divisions
          const durationQuarters = duration / divisions

          if (!isGrace) {
            const layout = readNoteLayoutOrdered(child)
            const midi = isRest ? null : pitchNodeToMidi(findChild(child, 'pitch'))
            const tieNodes = findChildren(child, 'tie')
            const tieStart = tieNodes.some((tie) => attr(tie, 'type') === 'start')
            const tieStop = tieNodes.some((tie) => attr(tie, 'type') === 'stop')
            notes.push({
              id: `${partId}-m${measureNumber}-n${notes.length}`,
              partId,
              measureNumber,
              quarterTime,
              durationQuarters,
              durationDivisions: duration,
              midi,
              label: midiToLabel(midi),
              isRest,
              isChord,
              isGrace,
              tieStart,
              tieStop,
              voice: Number.isFinite(voice) && voice > 0 ? voice : 1,
              ...layout,
            })

            if (!isRest && midi != null) {
              rawTimingEvents.push({
                type: 'note-on',
                quarterTime,
                measureNumber,
                midi,
                label: midiToLabel(midi),
              })
            }
          }

          if (!isChord && !isGrace) {
            lastNoteStartDivisions = cursorDivisions
            cursorDivisions += duration
            maxCursorDivisions = Math.max(maxCursorDivisions, cursorDivisions)
          }
          break
        }

        default:
          break
      }
    }

    if (isPrimary) {
      const lengthFromTimeSignature = measureLengthQuarters(measureBeats, measureBeatType)
      const notatedLengthQuarters = maxCursorDivisions / divisions
      const lengthQuarters =
        lengthFromTimeSignature > 0 ? lengthFromTimeSignature : notatedLengthQuarters
      const { newSystem, newPage } = measurePrintFlags(measureNode)

      boundaries.push({
        number: measureNumber,
        index,
        startQuarters: measureStartQuarters,
        endQuarters: measureStartQuarters + lengthQuarters,
        lengthQuarters,
        beats: measureBeats,
        beatType: measureBeatType,
        divisions,
        systemBreakBefore: index === 0 || newSystem || newPage,
        pageBreakBefore: newPage,
        marking: extractMarkings(measureNode),
      })
      measureStartQuarters += lengthQuarters
    }
  })

  return boundaries
}

export function parseMusicXml(xmlString, fileName = 'score.musicxml') {
  const parsed = parseXmlOrdered(xmlString)

  if (rootElement(parsed, 'score-timewise')) {
    throw new Error('score-timewise files are not supported yet. Export as score-partwise.')
  }

  const score = rootElement(parsed, 'score-partwise')
  if (!score) {
    throw new Error('Unsupported MusicXML: expected score-partwise or score-timewise.')
  }

  const partNodes = findChildren(score, 'part')
  if (partNodes.length === 0) {
    throw new Error('MusicXML contains no parts.')
  }

  const partListNode = findChild(score, 'part-list')
  const partNames = new Map()
  if (partListNode) {
    for (const scorePart of findChildren(partListNode, 'score-part')) {
      const id = attr(scorePart, 'id')
      const name = childText(scorePart, 'part-name')
      if (id && name) {
        partNames.set(id, String(name))
      }
    }
  }

  const tempoEvents = []
  const timeSignatureEvents = []
  const notes = []
  const rawTimingEvents = []

  // Primary part defines measure boundaries and the tempo map.
  const primaryNode = partNodes[0]
  const primaryId = attr(primaryNode, 'id') ?? 'P1'
  const measureBoundaries = walkPart({
    partNode: primaryNode,
    partId: primaryId,
    isPrimary: true,
    measureBoundaries: null,
    tempoEvents,
    timeSignatureEvents,
    notes,
    rawTimingEvents,
  })

  partNodes.slice(1).forEach((partNode, index) => {
    walkPart({
      partNode,
      partId: attr(partNode, 'id') ?? `P${index + 2}`,
      isPrimary: false,
      measureBoundaries,
      tempoEvents,
      timeSignatureEvents,
      notes,
      rawTimingEvents,
    })
  })

  // --- Tempo map (quarter-time first, seconds afterwards) ---
  tempoEvents.sort((a, b) => a.quarterTime - b.quarterTime)
  const tempoChanges = [{ quarterTime: 0, bpm: DEFAULT_BPM }]
  for (const event of tempoEvents) {
    const last = tempoChanges[tempoChanges.length - 1]
    if (Math.abs(last.quarterTime - event.quarterTime) < 1e-9) {
      last.bpm = event.bpm
      if (last.quarterTime === 0 && tempoChanges.length === 1) {
        continue
      }
      continue
    }
    if (last.bpm !== event.bpm) {
      tempoChanges.push({ quarterTime: event.quarterTime, bpm: event.bpm })
    }
  }

  const toSeconds = (quarterTime) => quartersToSeconds(quarterTime, tempoChanges)

  // --- Time signatures ---
  const timeSignatures = [{ quarterTime: 0, beats: DEFAULT_BEATS, beatType: DEFAULT_BEAT_TYPE }]
  for (const event of timeSignatureEvents) {
    const last = timeSignatures[timeSignatures.length - 1]
    if (Math.abs(last.quarterTime - event.quarterTime) < 1e-9) {
      last.beats = event.beats
      last.beatType = event.beatType
      continue
    }
    if (last.beats !== event.beats || last.beatType !== event.beatType) {
      timeSignatures.push({
        quarterTime: event.quarterTime,
        beats: event.beats,
        beatType: event.beatType,
      })
    }
  }

  // --- Measures and beats in seconds ---
  const measures = measureBoundaries.map((boundary) => ({
    number: boundary.number,
    startQuarters: boundary.startQuarters,
    endQuarters: boundary.endQuarters,
    startTimeSeconds: toSeconds(boundary.startQuarters),
    endTimeSeconds: toSeconds(boundary.endQuarters),
    lengthQuarters: boundary.lengthQuarters,
    beats: boundary.beats,
    beatType: boundary.beatType,
    divisions: boundary.divisions,
    systemBreakBefore: boundary.systemBreakBefore,
    pageBreakBefore: boundary.pageBreakBefore,
  }))

  const beats = []
  for (const measure of measures) {
    const beatLengthQuarters = 4 / measure.beatType
    for (let index = 0; index < measure.beats; index += 1) {
      const quarterTime = measure.startQuarters + index * beatLengthQuarters
      beats.push({
        measureNumber: measure.number,
        beat: index + 1,
        quarterTime,
        timeSeconds: toSeconds(quarterTime),
      })
    }
  }

  // --- Notes in seconds ---
  for (const note of notes) {
    note.timeSeconds = toSeconds(note.quarterTime)
    note.durationSeconds = toSeconds(note.quarterTime + note.durationQuarters) - note.timeSeconds
  }
  notes.sort((a, b) => a.timeSeconds - b.timeSeconds || a.quarterTime - b.quarterTime)

  // --- Timing events (debug/diagnostics stream) ---
  const timingEvents = []
  for (const measure of measures) {
    timingEvents.push({
      type: 'measure-start',
      measureNumber: measure.number,
      quarterTime: measure.startQuarters,
      timeSeconds: measure.startTimeSeconds,
    })
  }
  for (const event of tempoEvents) {
    timingEvents.push({
      type: 'tempo-change',
      quarterTime: event.quarterTime,
      timeSeconds: toSeconds(event.quarterTime),
      bpm: event.bpm,
      measureNumber: event.measureNumber,
    })
  }
  for (const event of timeSignatureEvents) {
    timingEvents.push({
      type: 'time-signature',
      quarterTime: event.quarterTime,
      timeSeconds: toSeconds(event.quarterTime),
      beats: event.beats,
      beatType: event.beatType,
      measureNumber: event.measureNumber,
    })
  }
  for (const event of rawTimingEvents) {
    timingEvents.push({
      ...event,
      timeSeconds: toSeconds(event.quarterTime),
    })
  }
  timingEvents.sort((a, b) => a.timeSeconds - b.timeSeconds || a.quarterTime - b.quarterTime)

  const writtenDurationSeconds =
    measures.length > 0 ? measures[measures.length - 1].endTimeSeconds : 0

  const markings = measureBoundaries.map((boundary) => boundary.marking)
  const performedMeasureTimeline = buildPerformedMeasureTimeline(measures, markings, beats)

  const durationSeconds = performedMeasureTimeline.performedDurationSeconds || writtenDurationSeconds

  const pitchNotes = notes.filter((note) => !note.isRest && note.midi != null)

  return {
    version: 2,
    fileName,
    title: getWorkTitle(score),
    durationSeconds,
    writtenDurationSeconds,
    noteCount: pitchNotes.length,
    divisions: measures.length > 0 ? measures[measures.length - 1].divisions : DEFAULT_DIVISIONS,
    measures,
    beats,
    performedMeasureTimeline,
    tempoChanges,
    timeSignatures,
    notes,
    timingEvents,
    parts: partNodes.map((partNode, index) => {
      const id = attr(partNode, 'id') ?? `P${index + 1}`
      return {
        id,
        name: partNames.get(id) ?? id,
        measureCount: findChildren(partNode, 'measure').length,
        noteCount: pitchNotes.filter((note) => note.partId === id).length,
      }
    }),
  }
}
