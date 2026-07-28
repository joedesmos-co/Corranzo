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
import { applyTieSustainToNotes } from './mergeTiedNotesForPlayback.js'
import {
  analyzeChordSheetScore,
  buildChordSheetNoteEvents,
} from './chordSymbolSheet.js'
import { DEFAULT_MUSICXML_VELOCITY, dynamicsFromDirection, wedgeFromDirection, staffFromDirection } from './dynamicsMap.js'
import { WEDGE_ENDPOINT_FALLBACK_DELTA } from '../playback/playbackExpressionPolicy.js'

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

function readWrittenPitch(pitchNode) {
  if (!pitchNode) {
    return null
  }
  const step = childText(pitchNode, 'step')
  const octave = numberOf(childText(pitchNode, 'octave'), NaN)
  if (!step || !Number.isFinite(octave) || !(step in STEP_TO_SEMITONE)) {
    return null
  }
  const alterNode = findChild(pitchNode, 'alter')
  const alter = alterNode ? numberOf(textOf(alterNode), 0) : null
  return {
    step: String(step).toUpperCase(),
    alter: Number.isFinite(alter) ? alter : null,
    octave,
  }
}

function readPrintedAccidental(noteNode) {
  const accidental = findChild(noteNode, 'accidental')
  if (!accidental) {
    return null
  }
  const type = String(textOf(accidental) ?? '').trim().toLowerCase()
  if (!type) {
    return null
  }
  return {
    type: type === 'flat-flat' ? 'double-flat' : type,
    printed: true,
    cautionary: attr(accidental, 'cautionary') === 'yes',
    editorial: attr(accidental, 'editorial') === 'yes',
    parentheses: attr(accidental, 'parentheses') === 'yes',
    bracket: attr(accidental, 'bracket') === 'yes',
    smufl: attr(accidental, 'smufl') ?? null,
  }
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

/** Number of staves a part uses (max <staves> across its measures; default 1). */
function countPartStaves(partNode) {
  let staves = 1
  for (const measureNode of findChildren(partNode, 'measure')) {
    for (const attributes of findChildren(measureNode, 'attributes')) {
      const value = numberOf(childText(attributes, 'staves'), NaN)
      if (Number.isFinite(value) && value > staves) {
        staves = value
      }
    }
  }
  return staves
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
function readTieFlags(noteNode) {
  const tieNodes = findChildren(noteNode, 'tie')
  let tieStart = tieNodes.some((tie) => attr(tie, 'type') === 'start')
  let tieStop = tieNodes.some((tie) => attr(tie, 'type') === 'stop')
  let tiePlacement = null
  const notations = findChild(noteNode, 'notations')
  if (notations) {
    for (const tied of findChildren(notations, 'tied')) {
      if (attr(tied, 'type') === 'start') {
        tieStart = true
      }
      if (attr(tied, 'type') === 'stop') {
        tieStop = true
      }
      tiePlacement ??= attr(tied, 'placement') ?? null
    }
  }
  return { tieStart, tieStop, tiePlacement }
}

function readHarmonySymbol(harmonyNode) {
  const root = findChild(harmonyNode, 'root')
  if (!root) {
    return null
  }
  const rootStep = childText(root, 'root-step')
  if (!rootStep) {
    return null
  }
  const rootAlter = numberOf(childText(root, 'root-alter'), 0)
  const kindNode = findChild(harmonyNode, 'kind')
  const kindText = kindNode
    ? String(attr(kindNode, 'text') ?? childText(kindNode, '') ?? '').trim()
    : ''
  const bass = findChild(harmonyNode, 'bass')
  const bassStep = bass ? childText(bass, 'bass-step') : null
  let symbol = String(rootStep)
  if (rootAlter === 1) {
    symbol += '#'
  } else if (rootAlter === -1) {
    symbol += 'b'
  }
  if (kindText) {
    symbol += kindText.replace(/\s+/g, '')
  }
  if (bassStep) {
    symbol += `/${bassStep}`
  }
  return symbol
}

function emptyArticulations() {
  return {
    staccato: false,
    accent: false,
    tenuto: false,
    marcato: false,
    fermata: false,
    articulationPlacements: {},
  }
}

function notationPlacement(node, { orientation = false } = {}) {
  if (!node) {
    return null
  }
  const placement = String(attr(node, 'placement') ?? '').toLowerCase()
  if (placement === 'above' || placement === 'below') {
    return placement
  }
  if (orientation) {
    const type = String(attr(node, 'type') ?? '').toLowerCase()
    if (type === 'inverted' || type === 'down') {
      return 'below'
    }
    if (type === 'upright' || type === 'up') {
      return 'above'
    }
  }
  return null
}

function readArticulations(noteNode) {
  const notations = findChild(noteNode, 'notations')
  if (!notations) {
    return emptyArticulations()
  }
  const articulations = findChild(notations, 'articulations')
  const fermataNode = findChild(notations, 'fermata')
  const fermata = fermataNode != null
  if (!articulations) {
    return {
      ...emptyArticulations(),
      fermata,
      articulationPlacements: fermata
        ? { fermata: notationPlacement(fermataNode, { orientation: true }) }
        : {},
    }
  }
  const staccatoNode = findChild(articulations, 'staccato')
  const accentNode = findChild(articulations, 'accent')
  const tenutoNode = findChild(articulations, 'tenuto')
  const marcatoNode =
    findChild(articulations, 'strong-accent') ??
    findChild(articulations, 'marcato')
  const articulationPlacements = {}
  for (const [type, node, orientation] of [
    ['staccato', staccatoNode, false],
    ['accent', accentNode, false],
    ['tenuto', tenutoNode, false],
    ['marcato', marcatoNode, true],
    ['fermata', fermataNode, true],
  ]) {
    const placement = notationPlacement(node, { orientation })
    if (placement) {
      articulationPlacements[type] = placement
    }
  }
  return {
    staccato: staccatoNode != null,
    accent: accentNode != null,
    tenuto: tenutoNode != null,
    marcato: marcatoNode != null,
    fermata,
    articulationPlacements,
  }
}

function resolveNoteVelocity(activeVelocity, velocityByStaff, staff) {
  if (staff != null && velocityByStaff.has(staff)) {
    return velocityByStaff.get(staff)
  }
  return activeVelocity
}

/**
 * Apply crescendo/diminuendo spans onto note velocities (performed property only).
 */
export function applyWedgeVelocitiesToNotes(notes, wedgeSpans = []) {
  if (!wedgeSpans.length) {
    return notes
  }
  for (const note of notes) {
    if (note.isRest || note.midi == null) {
      continue
    }
    for (const span of wedgeSpans) {
      if (span.partId && note.partId && span.partId !== note.partId) {
        continue
      }
      if (span.staff != null && note.staff != null && span.staff !== note.staff) {
        continue
      }
      if (note.quarterTime < span.startQuarter - 1e-9 || note.quarterTime > span.endQuarter + 1e-9) {
        continue
      }
      const spanLen = Math.max(1e-9, span.endQuarter - span.startQuarter)
      const t = Math.min(1, Math.max(0, (note.quarterTime - span.startQuarter) / spanLen))
      note.velocity = span.startVelocity + (span.endVelocity - span.startVelocity) * t
      note.activeDynamic = note.activeDynamic ?? 'wedge'
      note.wedgeType = span.type
    }
  }
  return notes
}

function clampVelocity(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MUSICXML_VELOCITY
  }
  return Math.min(1, Math.max(0.05, value))
}

function readTimeModification(noteNode) {
  const node = findChild(noteNode, 'time-modification')
  if (!node) {
    return null
  }
  const actualNotes = numberOf(childText(node, 'actual-notes'), NaN)
  const normalNotes = numberOf(childText(node, 'normal-notes'), NaN)
  if (!Number.isFinite(actualNotes) || !Number.isFinite(normalNotes)) {
    return null
  }
  return { actualNotes, normalNotes }
}

function readSlurs(noteNode) {
  const notations = findChild(noteNode, 'notations')
  if (!notations) {
    return []
  }
  return findChildren(notations, 'slur')
    .map((slurNode, index) => {
      const type = attr(slurNode, 'type')
      if (type !== 'start' && type !== 'stop') {
        return null
      }
      return {
        type,
        number: attr(slurNode, 'number') ?? '1',
        placement: attr(slurNode, 'placement') ?? null,
        index,
      }
    })
    .filter(Boolean)
}

function techniqueMarking(kind, node, index) {
  return {
    kind,
    type: attr(node, 'type') ?? null,
    number: attr(node, 'number') ?? '1',
    text: textOf(node) ?? null,
    index,
  }
}

function readGuitarTechniques(noteNode) {
  const notations = findChild(noteNode, 'notations')
  if (!notations) {
    return []
  }
  const technical = findChild(notations, 'technical')
  const techniques = []

  if (technical) {
    findChildren(technical, 'hammer-on').forEach((node, index) => {
      techniques.push(techniqueMarking('hammer-on', node, index))
    })
    findChildren(technical, 'pull-off').forEach((node, index) => {
      techniques.push(techniqueMarking('pull-off', node, index))
    })
    if (findChild(technical, 'bend')) {
      techniques.push({ kind: 'bend', type: null, number: '1', text: null, index: 0 })
    }
    findChildren(technical, 'other-technical').forEach((node, index) => {
      const text = textOf(node)
      if (text && /vib(?:rato)?/i.test(text)) {
        techniques.push({ kind: 'vibrato', type: null, number: '1', text, index })
      }
    })
  }

  findChildren(notations, 'slide').forEach((node, index) => {
    techniques.push(techniqueMarking('slide', node, index))
  })

  const ornaments = findChild(notations, 'ornaments')
  if (ornaments && findChild(ornaments, 'wavy-line')) {
    techniques.push({ kind: 'vibrato', type: null, number: '1', text: null, index: 0 })
  }

  return techniques
}

/**
 * Fretted-instrument position from <notations><technical><string>/<fret>.
 * Returns null when absent so plain (piano) notes keep their exact shape.
 */
function readTechnicalPosition(noteNode) {
  const notations = findChild(noteNode, 'notations')
  if (!notations) {
    return null
  }
  const technical = findChild(notations, 'technical')
  if (!technical) {
    return null
  }
  const string = numberOf(childText(technical, 'string'), NaN)
  const fret = numberOf(childText(technical, 'fret'), NaN)
  if (!Number.isFinite(string) && !Number.isFinite(fret)) {
    return null
  }
  return {
    ...(Number.isFinite(string) && string > 0 ? { string } : {}),
    ...(Number.isFinite(fret) && fret >= 0 ? { fret } : {}),
  }
}

/** Clef declarations from an <attributes> node, keyed by staff number. */
function readClefDeclarations(attributesNode, clefsByStaff) {
  for (const clefNode of findChildren(attributesNode, 'clef')) {
    const staffNumber = numberOf(attr(clefNode, 'number'), 1)
    const sign = childText(clefNode, 'sign')
    if (!sign) {
      continue
    }
    const line = numberOf(childText(clefNode, 'line'), NaN)
    const octaveChange = numberOf(childText(clefNode, 'clef-octave-change'), 0)
    clefsByStaff.set(staffNumber, {
      staff: staffNumber,
      sign: String(sign).toUpperCase(),
      line: Number.isFinite(line) ? line : null,
      octaveChange: Number.isFinite(octaveChange) ? octaveChange : 0,
    })
  }
}

/** <staff-details> (line count + string tuning) keyed by staff number. */
function readStaffDetails(attributesNode, staffDetailsByStaff) {
  for (const detailsNode of findChildren(attributesNode, 'staff-details')) {
    const staffNumber = numberOf(attr(detailsNode, 'number'), 1)
    const staffLines = numberOf(childText(detailsNode, 'staff-lines'), NaN)
    const tunings = findChildren(detailsNode, 'staff-tuning')
      .map((tuningNode) => {
        const line = numberOf(attr(tuningNode, 'line'), NaN)
        const step = childText(tuningNode, 'tuning-step')
        const octave = numberOf(childText(tuningNode, 'tuning-octave'), NaN)
        const alter = numberOf(childText(tuningNode, 'tuning-alter'), 0)
        if (!Number.isFinite(line) || !step || !Number.isFinite(octave) || !(step in STEP_TO_SEMITONE)) {
          return null
        }
        return {
          line,
          midi: Math.round((octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter),
        }
      })
      .filter(Boolean)

    const existing = staffDetailsByStaff.get(staffNumber) ?? { staff: staffNumber }
    if (Number.isFinite(staffLines) && staffLines > 0) {
      existing.staffLines = staffLines
    }
    if (tunings.length > 0) {
      // staff-tuning line 1 = bottom line = lowest string; string numbering is
      // the reverse (string 1 = highest). Emit tuning indexed by string number.
      const byLineDesc = [...tunings].sort((left, right) => right.line - left.line)
      existing.tuning = byLineDesc.map((entry) => entry.midi)
    }
    staffDetailsByStaff.set(staffNumber, existing)
  }
}

function readKeyDeclarations(
  attributesNode,
  activeKeySignatures,
  {
    keySignatureEvents = null,
    isPrimary = false,
    partId = null,
    quarterTime = 0,
    measureNumber = null,
  } = {},
) {
  for (const keyNode of findChildren(attributesNode, 'key')) {
    const fifths = numberOf(childText(keyNode, 'fifths'), NaN)
    if (!Number.isFinite(fifths)) {
      continue
    }
    const staffNumber = numberOf(attr(keyNode, 'number'), NaN)
    const staff = Number.isFinite(staffNumber) && staffNumber > 0 ? staffNumber : null
    const cancelNode = findChild(keyNode, 'cancel')
    const cancelFifths = cancelNode ? numberOf(textOf(cancelNode), NaN) : null
    const keySignature = {
      fifths: Math.max(-7, Math.min(7, Math.round(fifths))),
      mode: childText(keyNode, 'mode') ?? null,
      cancelFifths: Number.isFinite(cancelFifths)
        ? Math.max(-7, Math.min(7, Math.round(cancelFifths)))
        : null,
      staff,
    }
    activeKeySignatures.set(staff, keySignature)
    if (isPrimary && Array.isArray(keySignatureEvents)) {
      keySignatureEvents.push({
        ...keySignature,
        partId,
        quarterTime,
        measureNumber,
      })
    }
  }
}

function activeKeySignatureForStaff(activeKeySignatures, staff) {
  return (
    activeKeySignatures.get(staff ?? null) ??
    activeKeySignatures.get(null) ??
    { fifths: 0, mode: null, cancelFifths: null, staff: staff ?? null }
  )
}

/**
 * Mixed notation+TAB parts engrave every note twice (once per staff). Mark the
 * TAB-staff copies as mirrors — playback and checkpoints skip them — and copy
 * their string/fret onto the matching standard-staff note. Parts without a TAB
 * staff (every piano score) are untouched.
 */
function reconcileTabMirrorNotes(notes, partNotationById) {
  for (const [partId, info] of partNotationById) {
    const clefs = [...info.clefs.values()]
    const tabStaves = new Set(clefs.filter((clef) => clef.sign === 'TAB').map((clef) => clef.staff))
    const standardStaves = new Set(
      clefs.filter((clef) => clef.sign !== 'TAB').map((clef) => clef.staff),
    )
    if (tabStaves.size === 0 || standardStaves.size === 0) {
      continue
    }

    const partNotes = notes.filter(
      (note) => note.partId === partId && !note.isRest && note.midi != null,
    )
    const standardByKey = new Map()
    for (const note of partNotes) {
      if (!tabStaves.has(note.staff ?? 1)) {
        const key = `${note.quarterTime.toFixed(6)}|${note.midi}`
        const bucket = standardByKey.get(key)
        if (bucket) {
          bucket.push(note)
        } else {
          standardByKey.set(key, [note])
        }
      }
    }

    const consumed = new Set()
    for (const note of partNotes) {
      if (!tabStaves.has(note.staff ?? 1)) {
        continue
      }
      const key = `${note.quarterTime.toFixed(6)}|${note.midi}`
      const matches = standardByKey.get(key)
      const match = matches?.find((candidate) => !consumed.has(candidate))
      if (match) {
        consumed.add(match)
        note.isTabMirror = true
        // The TAB staff supplies positions the notation staff lacks; explicit
        // notation-staff <technical> always wins.
        if (note.string != null && match.string == null) {
          match.string = note.string
        }
        if (note.fret != null && match.fret == null) {
          match.fret = note.fret
        }
      }
    }
  }
}

function walkPart({
  partNode,
  partId,
  isPrimary,
  measureBoundaries,
  tempoEvents,
  timeSignatureEvents,
  keySignatureEvents,
  notes,
  rawTimingEvents,
  harmonyEvents,
  partNotation = null,
  wedgeSpans = null,
}) {
  const measureNodes = findChildren(partNode, 'measure')
  let divisions = DEFAULT_DIVISIONS
  let beats = DEFAULT_BEATS
  let beatType = DEFAULT_BEAT_TYPE
  const boundaries = []

  let measureStartQuarters = 0
  // Sticky across measures until a later direction changes them.
  let activeVelocity = DEFAULT_MUSICXML_VELOCITY
  const velocityByStaff = new Map()
  const openWedges = []
  const activeKeySignatures = new Map()

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
          if (partNotation) {
            readClefDeclarations(child, partNotation.clefs)
            readStaffDetails(child, partNotation.staffDetails)
          }
          readKeyDeclarations(child, activeKeySignatures, {
            keySignatureEvents,
            isPrimary,
            partId,
            quarterTime: measureStartQuarters + cursorDivisions / divisions,
            measureNumber,
          })
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
          const helpers = { findChildren, childNodes, childText, attr }
          const directionStaff = staffFromDirection(child, helpers)
          const dynamicsVelocity = dynamicsFromDirection(child, helpers)
          const quarterTime = measureStartQuarters + cursorDivisions / divisions
          if (dynamicsVelocity != null) {
            if (directionStaff != null) {
              velocityByStaff.set(directionStaff, dynamicsVelocity)
            } else {
              activeVelocity = dynamicsVelocity
              velocityByStaff.clear()
            }
          }

          const wedge = wedgeFromDirection(child, helpers)
          if (wedge && Array.isArray(wedgeSpans)) {
            if (wedge.stage === 'start' && wedge.type) {
              const startVelocity = resolveNoteVelocity(
                activeVelocity,
                velocityByStaff,
                directionStaff,
              )
              openWedges.push({
                type: wedge.type,
                startQuarter: quarterTime,
                startVelocity,
                staff: directionStaff,
                partId,
                velocityAtOpen: startVelocity,
              })
            } else if (wedge.stage === 'stop' && openWedges.length) {
              const open = openWedges.pop()
              let endVelocity = resolveNoteVelocity(
                activeVelocity,
                velocityByStaff,
                open.staff ?? directionStaff,
              )
              if (Math.abs(endVelocity - open.velocityAtOpen) < 1e-6) {
                endVelocity =
                  open.type === 'crescendo'
                    ? clampVelocity(open.startVelocity + WEDGE_ENDPOINT_FALLBACK_DELTA)
                    : clampVelocity(open.startVelocity - WEDGE_ENDPOINT_FALLBACK_DELTA)
              }
              wedgeSpans.push({
                type: open.type,
                startQuarter: open.startQuarter,
                endQuarter: quarterTime,
                startVelocity: open.startVelocity,
                endVelocity,
                staff: open.staff,
                partId: open.partId,
              })
            }
          }

          if (!isPrimary) {
            break
          }
          const bpm = tempoFromDirection(child)
          if (bpm != null && bpm > 0) {
            tempoEvents.push({
              quarterTime,
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

        case 'harmony': {
          const symbol = readHarmonySymbol(child)
          if (symbol) {
            harmonyEvents.push({
              partId,
              measureNumber,
              quarterTime: measureStartQuarters + cursorDivisions / divisions,
              symbol,
            })
          }
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
            const pitchNode = isRest ? null : findChild(child, 'pitch')
            const midi = isRest ? null : pitchNodeToMidi(pitchNode)
            const writtenPitch = isRest ? null : readWrittenPitch(pitchNode)
            const accidental = isRest ? null : readPrintedAccidental(child)
            const keySignature = isRest
              ? null
              : activeKeySignatureForStaff(activeKeySignatures, layout.staff)
            const { tieStart, tieStop, tiePlacement } = readTieFlags(child)
            const {
              staccato,
              accent,
              tenuto,
              marcato,
              fermata,
              articulationPlacements,
            } = readArticulations(child)
            const slurs = readSlurs(child)
            const guitarTechniques = isRest ? [] : readGuitarTechniques(child)
            const technicalPosition = isRest ? null : readTechnicalPosition(child)
            const timeModification = readTimeModification(child)
            const dots = findChildren(child, 'dot').length
            const noteType = childText(child, 'type') ?? null
            const rawStemDirection = String(childText(child, 'stem') ?? '').toLowerCase()
            const stemDirection =
              rawStemDirection === 'up' || rawStemDirection === 'down'
                ? rawStemDirection
                : null
            const beams = findChildren(child, 'beam')
              .map((beam) => ({
                number: Math.max(1, Math.round(numberOf(attr(beam, 'number'), 1))),
                value: String(textOf(beam) ?? '').trim().toLowerCase(),
              }))
              .filter((beam) => beam.value)
            notes.push({
              ...(technicalPosition ?? {}),
              ...(slurs.length ? { slurs } : {}),
              ...(guitarTechniques.length ? { guitarTechniques } : {}),
              ...(timeModification ? { timeModification } : {}),
              id: `${partId}-m${measureNumber}-n${notes.length}`,
              partId,
              measureNumber,
              quarterTime,
              durationQuarters,
              durationDivisions: duration,
              midi,
              label: midiToLabel(midi),
              writtenPitch,
              accidental,
              keySignature,
              isRest,
              isChord,
              isGrace,
              tieStart,
              tieStop,
              tiePlacement,
              staccato,
              accent,
              tenuto,
              marcato,
              fermata,
              articulationPlacements,
              dots,
              noteType,
              stemDirection,
              beams,
              voice: Number.isFinite(voice) && voice > 0 ? voice : 1,
              velocity: resolveNoteVelocity(activeVelocity, velocityByStaff, layout.staff),
              ...layout,
            })

            if (!isRest && midi != null) {
              rawTimingEvents.push({
                type: 'note-on',
                quarterTime,
                measureNumber,
                midi,
                label: midiToLabel(midi),
                voice: Number.isFinite(voice) && voice > 0 ? voice : 1,
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
      const engravedWidth = numberOf(attr(measureNode, 'width'), NaN)
      // MusicXML marks pickup/anacrusis (and some courtesy) measures with
      // implicit="yes". Preserve it as honest metadata for pickup detection.
      const implicit = attr(measureNode, 'implicit') === 'yes'

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
        implicit,
        // True notated length before time-signature padding — lets pickup
        // detection see a short first bar even when implicit is absent. Does NOT
        // affect timing (lengthQuarters is unchanged).
        notatedLengthQuarters,
        // Engraved measure width in tenths (<measure width>), if present — used
        // to map MusicXML horizontal layout onto detected PDF barline spans.
        engravedWidth: Number.isFinite(engravedWidth) && engravedWidth > 0 ? engravedWidth : null,
        marking: extractMarkings(measureNode),
      })
      measureStartQuarters += lengthQuarters
    }
  })

  if (Array.isArray(wedgeSpans) && openWedges.length) {
    const endQuarter = boundaries.length
      ? boundaries[boundaries.length - 1].endQuarters
      : measureStartQuarters
    while (openWedges.length) {
      const open = openWedges.pop()
      const endVelocity =
        open.type === 'crescendo'
          ? clampVelocity(open.startVelocity + WEDGE_ENDPOINT_FALLBACK_DELTA)
          : clampVelocity(open.startVelocity - WEDGE_ENDPOINT_FALLBACK_DELTA)
      wedgeSpans.push({
        type: open.type,
        startQuarter: open.startQuarter,
        endQuarter,
        startVelocity: open.startVelocity,
        endVelocity,
        staff: open.staff,
        partId: open.partId,
      })
    }
  }

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
  const keySignatureEvents = []
  const notes = []
  const rawTimingEvents = []
  const harmonyEvents = []
  const wedgeSpans = []
  const partNotationById = new Map()

  const notationForPart = (partId) => {
    let info = partNotationById.get(partId)
    if (!info) {
      info = { clefs: new Map(), staffDetails: new Map() }
      partNotationById.set(partId, info)
    }
    return info
  }

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
    keySignatureEvents,
    notes,
    rawTimingEvents,
    harmonyEvents,
    partNotation: notationForPart(primaryId),
    wedgeSpans,
  })

  partNodes.slice(1).forEach((partNode, index) => {
    const partId = attr(partNode, 'id') ?? `P${index + 2}`
    walkPart({
      partNode,
      partId,
      isPrimary: false,
      measureBoundaries,
      tempoEvents,
      timeSignatureEvents,
      keySignatureEvents,
      notes,
      rawTimingEvents,
      harmonyEvents,
      partNotation: notationForPart(partId),
      wedgeSpans,
    })
  })

  // Mixed notation+TAB parts: tag TAB-staff duplicates before playback events
  // are derived. No-op for scores without a TAB staff.
  reconcileTabMirrorNotes(notes, partNotationById)

  applyWedgeVelocitiesToNotes(notes, wedgeSpans)
  applyTieSustainToNotes(notes)
  rawTimingEvents.length = 0
  for (const note of notes) {
    if (note.isRest || note.midi == null || note.suppressPlaybackAttack || note.isTabMirror) {
      continue
    }
    rawTimingEvents.push({
      type: 'note-on',
      quarterTime: note.quarterTime,
      measureNumber: note.measureNumber,
      midi: note.midi,
      label: note.label,
      voice: note.voice,
    })
  }

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

  const keySignatures = []
  for (const event of keySignatureEvents.sort(
    (left, right) => left.quarterTime - right.quarterTime,
  )) {
    const previous = keySignatures[keySignatures.length - 1]
    const sameTime =
      previous && Math.abs(previous.quarterTime - event.quarterTime) < 1e-9
    const sameStaff = previous?.staff === event.staff
    if (sameTime && sameStaff) {
      keySignatures[keySignatures.length - 1] = {
        ...event,
        timeSeconds: toSeconds(event.quarterTime),
      }
      continue
    }
    if (
      previous &&
      previous.fifths === event.fifths &&
      previous.mode === event.mode &&
      previous.staff === event.staff &&
      event.cancelFifths == null
    ) {
      continue
    }
    keySignatures.push({
      ...event,
      timeSeconds: toSeconds(event.quarterTime),
    })
  }

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
    index: boundary.index,
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
    implicit: boundary.implicit,
    notatedLengthQuarters: boundary.notatedLengthQuarters,
    engravedWidth: boundary.engravedWidth,
    // Repeat / volta markings for written-score evaluation (not playback expansion).
    marking: boundary.marking ?? null,
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

  for (const event of harmonyEvents) {
    event.timeSeconds = toSeconds(event.quarterTime)
  }

  const chordSheetAnalysis = analyzeChordSheetScore({
    harmonyEvents,
    notes,
    measures,
  })
  if (chordSheetAnalysis.isChordSheet) {
    const pitchedCount = notes.filter(
      (note) => !note.isRest && note.midi != null && !note.isTabMirror && !note.isChordSheetEvent,
    ).length
    const chordNotes = buildChordSheetNoteEvents({
      harmonyEvents,
      measures,
      defaultBpm: tempoChanges[0]?.bpm ?? DEFAULT_BPM,
    })
    if (chordNotes.length > 0 && pitchedCount <= chordNotes.length) {
      notes.push(...chordNotes)
      for (const note of chordNotes) {
        rawTimingEvents.push({
          type: 'note-on',
          quarterTime: note.quarterTime,
          measureNumber: note.measureNumber,
          midi: note.midi,
          label: note.label,
          voice: note.voice,
        })
      }
    }
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

  // Prefer written duration when repeat expansion was aborted or not used —
  // never ship a pathological performed clock as the score duration.
  const durationSeconds = performedMeasureTimeline.diagnostics?.usesPerformedTimeline
    ? performedMeasureTimeline.performedDurationSeconds || writtenDurationSeconds
    : writtenDurationSeconds || performedMeasureTimeline.performedDurationSeconds

  const pitchNotes = notes.filter(
    (note) => !note.isRest && note.midi != null && !note.isTabMirror,
  )

  // Instrument-relevant notation facts (clefs, TAB staves, string tuning).
  const allClefs = [...partNotationById.values()].flatMap((info) => [...info.clefs.values()])
  const hasTabStaff = allClefs.some((clef) => clef.sign === 'TAB')
  const hasStandardStaff = allClefs.some((clef) => clef.sign !== 'TAB')
  const partNameSuggestsGuitar = [...partNames.values()].some((name) =>
    /guitar/i.test(name),
  )
  const notation = {
    hasTabStaff,
    hasStandardStaff: hasStandardStaff || !hasTabStaff,
    suggestedInstrumentId: hasTabStaff || partNameSuggestsGuitar ? 'guitar' : null,
  }

  return {
    version: 2,
    fileName,
    title: getWorkTitle(score),
    notation,
    durationSeconds,
    writtenDurationSeconds,
    noteCount: pitchNotes.length,
    divisions: measures.length > 0 ? measures[measures.length - 1].divisions : DEFAULT_DIVISIONS,
    measures,
    beats,
    performedMeasureTimeline,
    tempoChanges,
    timeSignatures,
    keySignatures,
    notes,
    timingEvents,
    harmonyEvents,
    wedgeSpans,
    chordSheet: chordSheetAnalysis.isChordSheet
      ? {
          isChordSheet: true,
          warnings: chordSheetAnalysis.warnings,
        }
      : null,
    parts: partNodes.map((partNode, index) => {
      const id = attr(partNode, 'id') ?? `P${index + 1}`
      const info = partNotationById.get(id)
      const clefs = info ? [...info.clefs.values()] : []
      const tabStaves = clefs
        .filter((clef) => clef.sign === 'TAB')
        .map((clef) => clef.staff)
      const tuning =
        info && tabStaves.length > 0
          ? ([...info.staffDetails.values()].find((details) => details.tuning)?.tuning ?? null)
          : null
      return {
        id,
        name: partNames.get(id) ?? id,
        measureCount: findChildren(partNode, 'measure').length,
        noteCount: pitchNotes.filter((note) => note.partId === id).length,
        staves: countPartStaves(partNode),
        clefs,
        tabStaves,
        tuning,
      }
    }),
    // Total staves drawn per system (e.g. 2 for a piano grand staff). Used to
    // group detected PDF staff lines into systems during auto score-follow.
    stavesPerSystem: partNodes.reduce((sum, partNode) => sum + countPartStaves(partNode), 0),
  }
}
