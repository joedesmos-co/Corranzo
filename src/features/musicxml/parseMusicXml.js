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
import { mineTextDirection } from './guitarTextMarks.js'
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
 * Work title, creators and rights statements, verbatim.
 * Dataset licensing gates cite these as per-file evidence; an absent rights
 * statement is itself a signal (unclear licensing quarantines).
 */
function readAttribution(scoreNode) {
  const identification = findChild(scoreNode, 'identification')
  const creators = identification
    ? findChildren(identification, 'creator').map((node) => ({
      type: attr(node, 'type') ?? null,
      name: String(textOf(node) ?? '').trim(),
    })).filter((c) => c.name)
    : []
  const rights = identification
    ? findChildren(identification, 'rights')
      .map((node) => String(textOf(node) ?? '').trim())
      .filter(Boolean)
    : []
  const encoding = identification ? findChild(identification, 'encoding') : null
  const software = encoding ? childText(encoding, 'software') : null
  return {
    workTitle: getWorkTitle(scoreNode),
    creators,
    rights,
    ...(software ? { encodingSoftware: String(software) } : {}),
  }
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
    staccatissimo: false,
    breathMark: false,
    otherArticulations: [],
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
  const staccatissimoNode = findChild(articulations, 'staccatissimo')
  const breathMarkNode = findChild(articulations, 'breath-mark')
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
    ['staccatissimo', staccatissimoNode, false],
    ['breath-mark', breathMarkNode, false],
  ]) {
    const placement = notationPlacement(node, { orientation })
    if (placement) {
      articulationPlacements[type] = placement
    }
  }
  // Structured preservation for remaining articulations (spiccato, legato,
  // detached-legato, scoop, falloff, ...): kept with kind so truth can type
  // or quarantine. Nothing here may be silently dropped.
  const knownArticulations = new Set(['staccato', 'accent', 'tenuto', 'strong-accent', 'marcato', 'staccatissimo', 'breath-mark'])
  const otherArticulations = []
  for (const child of childNodes(articulations)) {
    if (!child.tag || knownArticulations.has(child.tag)) continue
    otherArticulations.push({ kind: child.tag, placement: notationPlacement(child, {}) ?? null })
  }
  return {
    staccato: staccatoNode != null,
    accent: accentNode != null,
    tenuto: tenutoNode != null,
    marcato: marcatoNode != null,
    fermata,
    staccatissimo: staccatissimoNode != null,
    breathMark: breathMarkNode != null,
    otherArticulations,
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

/** Attributes snapshot: structured preservation for elements whose full
 * semantics the truth layer resolves later (or quarantines explicitly). */
function attrsOf(node, names) {
  const out = {}
  for (const name of names) {
    const value = attr(node, name)
    if (value != null) out[name] = value
  }
  return out
}

/** Parameterized bend: amount, pre-bend and release, never presence-only. */
function readBend(technical) {
  const node = findChild(technical, 'bend')
  if (!node) return null
  const alterText = childText(node, 'bend-alter')
  const alter = alterText != null ? Number(alterText) : NaN
  return {
    alterSemitones: Number.isFinite(alter) ? alter : null,
    alterRaw: alterText ?? null,
    prebend: findChild(node, 'pre-bend') != null,
    release: findChild(node, 'release') != null,
    ...attrsOf(node, ['shape', 'accelerate', 'beats', 'first-beat', 'last-beat']),
  }
}

/** Harmonic semantics: kind + the notated pitch triple when present. */
function readHarmonic(technical, noteNode) {
  const node = findChild(technical, 'harmonic')
  if (!node) return null
  const naturalAttr = attr(node, 'natural')
  const readTechPitch = (tag) => {
    const pitchNode = findChild(node, tag)
    if (!pitchNode) return null
    return {
      step: childText(pitchNode, 'step') ?? null,
      alter: numberOf(childText(pitchNode, 'alter'), 0),
      octave: numberOf(childText(pitchNode, 'octave'), NaN),
    }
  }
  void noteNode
  return {
    artificial: findChild(node, 'artificial') != null,
    natural: findChild(node, 'natural') != null || naturalAttr === 'yes',
    naturalAttr: naturalAttr ?? null,
    basePitch: readTechPitch('base-pitch'),
    touchingPitch: readTechPitch('touching-pitch'),
    soundingPitch: readTechPitch('sounding-pitch'),
    ...attrsOf(node, ['print-object', 'placement']),
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
    const bend = readBend(technical)
    if (bend || findChild(technical, 'bend')) {
      techniques.push({ kind: 'bend', type: null, number: '1', text: null, index: 0, bend })
    }
    const harmonic = readHarmonic(technical, noteNode)
    if (harmonic) {
      techniques.push({ kind: 'harmonic', type: null, number: '1', text: null, index: 0, harmonic })
    }
    for (const [tag, kind] of [['tapped', 'tapping'], ['palm-mute', 'palm-mute'], ['let-ring', 'let-ring'], ['golpe', 'golpe']]) {
      findChildren(technical, tag).forEach((node, index) => {
        techniques.push({ ...techniqueMarking(kind, node, index), ...attrsOf(node, ['hand', 'placement']) })
      })
    }
    findChildren(technical, 'tap').forEach((node, index) => {
      techniques.push({ kind: 'tapping', type: null, number: '1', text: textOf(node) ?? null, index, tap: { fret: childText(node, 'fret') ?? null, ...attrsOf(node, ['hand']) } })
    })
    findChildren(technical, 'other-technical').forEach((node, index) => {
      const text = textOf(node)
      if (text && /vib(?:rato)?/i.test(text)) {
        techniques.push({ kind: 'vibrato', type: null, number: '1', text, index })
      } else {
        techniques.push({ kind: 'other-technical', type: null, number: '1', text, index, smufl: attr(node, 'smufl') ?? null })
      }
    })
    // Structured preservation for every remaining technical child: the parser
    // keeps kind + attrs + text so the truth layer can type or quarantine it
    // instead of dropping it.
    const interpreted = new Set(['hammer-on', 'pull-off', 'bend', 'harmonic', 'tapped', 'palm-mute', 'let-ring', 'golpe', 'tap', 'other-technical', 'string', 'fret', 'fingering', 'pluck', 'up-bow', 'down-bow', 'open-string', 'stopped'])
    for (const child of childNodes(technical)) {
      if (!child.tag || interpreted.has(child.tag)) continue
      techniques.push({ kind: `technical:${child.tag}`, type: attr(child, 'type') ?? null, number: attr(child, 'number') ?? '1', text: textOf(child) ?? null, index: 0 })
    }
  }

  findChildren(notations, 'slide').forEach((node, index) => {
    techniques.push({ ...techniqueMarking('slide', node, index), lineType: attr(node, 'line-type') ?? null })
  })
  findChildren(notations, 'glissando').forEach((node, index) => {
    techniques.push({ ...techniqueMarking('glissando', node, index), lineType: attr(node, 'line-type') ?? null })
  })

  const ornaments = findChild(notations, 'ornaments')
  if (ornaments) {
    if (findChild(ornaments, 'wavy-line')) {
      techniques.push({ kind: 'vibrato', type: attr(findChild(ornaments, 'wavy-line'), 'type') ?? null, number: '1', text: null, index: 0 })
    }
    for (const [tag, kind] of [['trill-mark', 'trill'], ['mordent', 'mordent'], ['inverted-mordent', 'mordent'], ['turn', 'turn'], ['inverted-turn', 'turn'], ['shake', 'shake']]) {
      findChildren(ornaments, tag).forEach((node, index) => {
        techniques.push({ kind, type: null, number: '1', text: null, index })
      })
    }
  }

  // Single-note tremolo subdivision (<tremolo type="single">N</tremolo> under
  // <notations>) is how tremolo picking is encoded on guitar staves.
  for (const tremolo of findChildren(notations, 'tremolo')) {
    techniques.push({ kind: 'tremolo-picking', type: attr(tremolo, 'type') ?? null, number: '1', text: textOf(tremolo) ?? null, index: 0, marks: Number(textOf(tremolo)) || null })
  }

  if (findChild(notations, 'arpeggiate')) {
    techniques.push({ kind: 'arpeggio', type: null, number: '1', text: null, index: 0, direction: attr(findChild(notations, 'arpeggiate'), 'direction') ?? null })
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

/** Notehead shape: diamond/x/triangle carry harmonic/dead-note semantics. */
function readNotehead(noteNode) {
  const node = findChild(noteNode, 'notehead')
  if (!node) return null
  return {
    value: String(textOf(node) ?? '').trim().toLowerCase() || 'normal',
    filled: attr(node, 'filled') ?? null,
    parentheses: attr(node, 'parentheses') ?? null,
  }
}

/** Left-hand fingering, right-hand pluck (p-i-m-a), bow/pick direction. */
function readHandMarks(noteNode) {
  const notations = findChild(noteNode, 'notations')
  if (!notations) return null
  const technical = findChild(notations, 'technical')
  if (!technical) return null
  const out = {}
  const fingerings = findChildren(technical, 'fingering').map((node) => ({
    value: String(textOf(node) ?? '').trim(),
    substitution: attr(node, 'substitution') ?? null,
    alternate: attr(node, 'alternate') ?? null,
  })).filter((f) => f.value)
  if (fingerings.length) out.fingering = fingerings
  const pluck = childText(technical, 'pluck')
  if (pluck) out.pluck = String(pluck).trim().toLowerCase()
  if (findChild(technical, 'up-bow')) out.pickDirection = 'up'
  if (findChild(technical, 'down-bow')) out.pickDirection = 'down'
  if (findChild(technical, 'open-string')) out.openString = true
  if (findChild(technical, 'stopped')) out.stopped = true
  return Object.keys(out).length ? out : null
}

/** Lyric underlay attached to a note. */
function readLyric(noteNode) {
  const node = findChild(noteNode, 'lyric')
  if (!node) return null
  return {
    number: attr(node, 'number') ?? '1',
    syllabic: childText(node, 'syllabic') ?? null,
    text: childText(node, 'text') ?? null,
  }
}

/** Chord-diagram frame attached to a <harmony> element (NIFF-based). */
function readFrame(harmonyNode) {
  const frame = findChild(harmonyNode, 'frame')
  if (!frame) return null
  const notes = findChildren(frame, 'frame-note').map((frameNote) => {
    const entry = {
      string: numberOf(childText(frameNote, 'string'), NaN),
      fret: numberOf(childText(frameNote, 'fret'), NaN),
    }
    const fingering = numberOf(childText(frameNote, 'fingering'), NaN)
    if (Number.isFinite(fingering)) entry.fingering = fingering
    const barre = findChild(frameNote, 'barre')
    if (barre) entry.barre = attr(barre, 'type') ?? 'start'
    return entry
  })
  const firstFret = numberOf(childText(frame, 'first-fret'), NaN)
  return {
    strings: numberOf(childText(frame, 'frame-strings'), NaN),
    frets: numberOf(childText(frame, 'frame-frets'), NaN),
    ...(Number.isFinite(firstFret) ? { firstFret } : {}),
    notes,
  }
}

/**
 * Score-level marks from a <direction>: segno/coda/rehearsal/octave-shift
 * plus mined free text (capo, positions, barre, navigation words).
 * Purely additive: dynamics/tempo/wedge handling is untouched.
 */
function readScoreMarks(directionNode, { measureNumber, quarterTime, partId, staff }) {
  const marks = []
  for (const directionType of findChildren(directionNode, 'direction-type')) {
    if (findChild(directionType, 'segno')) {
      marks.push({ kind: 'segno', measureNumber, quarterTime, partId, staff })
    }
    if (findChild(directionType, 'coda')) {
      marks.push({ kind: 'coda', measureNumber, quarterTime, partId, staff })
    }
    const rehearsal = childText(directionType, 'rehearsal')
    if (rehearsal != null) {
      marks.push({ kind: 'rehearsal', text: String(rehearsal), measureNumber, quarterTime, partId, staff })
    }
    for (const shift of findChildren(directionType, 'octave-shift')) {
      marks.push({ kind: 'octave-shift', shiftType: attr(shift, 'type') ?? null, size: numberOf(attr(shift, 'size'), 8), measureNumber, quarterTime, partId, staff })
    }
    for (const words of findChildren(directionType, 'words')) {
      const text = textOf(words)
      if (text == null || !String(text).trim()) continue
      const mined = mineTextDirection(text)
      if (mined) {
        marks.push({ ...mined, measureNumber, quarterTime, partId, staff })
      } else {
        marks.push({ kind: 'unresolved-text', sourceText: String(text).trim(), confidence: 'unresolved', measureNumber, quarterTime, partId, staff })
      }
    }
  }
  return marks
}

/** Jump semantics from a bare <sound> element (da capo / dal segno / fine…). */
function readSoundJumps(soundNode, { measureNumber, quarterTime, partId }) {
  if (!soundNode) return null
  const jumps = attrsOf(soundNode, ['dacapo', 'dalsegno', 'tocoda', 'fine', 'segno', 'coda'])
  if (!Object.keys(jumps).length) return null
  return { kind: 'sound-jump', jumps, measureNumber, quarterTime, partId }
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

/** <staff-details> (line count + string tuning + structured capo) keyed by staff number. */
function readStaffDetails(attributesNode, staffDetailsByStaff) {
  for (const detailsNode of findChildren(attributesNode, 'staff-details')) {
    const staffNumber = numberOf(attr(detailsNode, 'number'), 1)
    const staffLines = numberOf(childText(detailsNode, 'staff-lines'), NaN)
    const capoFret = numberOf(childText(detailsNode, 'capo'), NaN)
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
    // Structured capo (MusicXML staff-details/capo): fret number, 0 = no capo.
    // This outranks text-mined capo directions, which keep a confidence tag.
    if (Number.isFinite(capoFret) && capoFret >= 0) {
      existing.capoFret = Math.round(capoFret)
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
  scoreMarks = null,
  frames = null,
  options = {},
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
          // Score-level marks (segno/coda/rehearsal/octave-shift/mined text)
          // ride on the primary part's timeline; other parts contribute notes only.
          if (Array.isArray(scoreMarks)) {
            scoreMarks.push(
              ...readScoreMarks(child, { measureNumber, quarterTime, partId, staff: directionStaff }),
            )
          }
          break
        }

        case 'sound': {
          if (Array.isArray(scoreMarks)) {
            const jumps = readSoundJumps(child, {
              measureNumber,
              quarterTime: measureStartQuarters + cursorDivisions / divisions,
              partId,
            })
            if (jumps) scoreMarks.push(jumps)
          }
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
          const quarterTime = measureStartQuarters + cursorDivisions / divisions
          if (symbol) {
            harmonyEvents.push({
              partId,
              measureNumber,
              quarterTime,
              symbol,
            })
          }
          const frame = readFrame(child)
          if (frame && Array.isArray(frames)) {
            frames.push({ partId, measureNumber, quarterTime, symbol, frame })
          }
          break
        }

        case 'note': {
          const isChord = findChild(child, 'chord') != null
          const isGrace = findChild(child, 'grace') != null
          const isCue = findChild(child, 'cue') != null
          const isRest = findChild(child, 'rest') != null
          const duration = numberOf(childText(child, 'duration'), 0)
          const voice = numberOf(childText(child, 'voice'), NaN)
          const startDivisions = isChord ? lastNoteStartDivisions : cursorDivisions
          const quarterTime = measureStartQuarters + startDivisions / divisions
          // Grace notes carry no <duration>: they steal no time.
          const durationQuarters = isGrace ? 0 : duration / divisions

          // Grace notes are dropped by default (historical behavior: every
          // downstream consumer assumes sounded notes only). Opt in with
          // includeNonSoundingNotes to receive them as zero-duration events.
          if (!isGrace || options.includeNonSoundingNotes) {
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
              staccatissimo,
              breathMark,
              otherArticulations,
              articulationPlacements,
            } = readArticulations(child)
            const slurs = readSlurs(child)
            const guitarTechniques = isRest ? [] : readGuitarTechniques(child)
            const technicalPosition = isRest ? null : readTechnicalPosition(child)
            const notehead = isRest ? null : readNotehead(child)
            const handMarks = isRest ? null : readHandMarks(child)
            const lyric = readLyric(child)
            const graceNode = findChild(child, 'grace')
            const slash = graceNode ? attr(graceNode, 'slash') ?? null : null
            const restNode = isRest ? findChild(child, 'rest') : null
            const isMeasureRest = restNode ? attr(restNode, 'measure') === 'yes' : false
            const serializedSourceNoteheadId = attr(child, 'id')
            const sourceNoteheadId =
              typeof serializedSourceNoteheadId === 'string' &&
              serializedSourceNoteheadId.startsWith('sfnh-')
                ? serializedSourceNoteheadId
                : null
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
              ...(notehead ? { notehead } : {}),
              ...(handMarks ?? {}),
              ...(lyric ? { lyric } : {}),
              id: `${partId}-m${measureNumber}-n${notes.length}`,
              ...(sourceNoteheadId ? { sourceNoteheadId } : {}),
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
              ...(isCue ? { isCue: true } : {}),
              ...(slash ? { slash } : {}),
              ...(isMeasureRest ? { isMeasureRest: true } : {}),
              tieStart,
              tieStop,
              tiePlacement,
              staccato,
              accent,
              tenuto,
              marcato,
              fermata,
              ...(staccatissimo ? { staccatissimo: true } : {}),
              ...(breathMark ? { breathMark: true } : {}),
              ...(otherArticulations.length ? { otherArticulations } : {}),
              articulationPlacements,
              dots,
              noteType,
              stemDirection,
              beams,
              voice: Number.isFinite(voice) && voice > 0 ? voice : 1,
              velocity: resolveNoteVelocity(activeVelocity, velocityByStaff, layout.staff),
              ...layout,
            })

            // Grace and cue notes never attack: they are guides, not onsets.
            if (!isRest && !isGrace && !isCue && midi != null) {
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
      // Multi-measure rests: <measure-style><multiple-rest>N</multiple-rest>.
      // The count is semantics (how many bars the rest spans), not layout.
      let multipleRest = null
      for (const style of findChildren(measureNode, 'measure-style')) {
        const count = numberOf(childText(style, 'multiple-rest'), NaN)
        if (Number.isFinite(count) && count >= 1) multipleRest = Math.round(count)
      }
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
        ...(multipleRest != null ? { multipleRest } : {}),
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

/**
 * Parse score-partwise MusicXML into the app's note/timeline model.
 *
 * Additive options (all default off/empty, so existing callers see
 * byte-identical behavior):
 * - includeNonSoundingNotes: keep <grace/> notes as zero-duration events
 *   (and mark <cue/> notes). Default false: grace notes are dropped.
 */
export function parseMusicXml(xmlString, fileName = 'score.musicxml', options = {}) {
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

  // Attribution and license evidence (D2): work title, creators, rights.
  // Recorded verbatim so dataset manifests can cite per-file evidence.
  const attribution = readAttribution(score)

  const tempoEvents = []
  const timeSignatureEvents = []
  const keySignatureEvents = []
  const notes = []
  const rawTimingEvents = []
  const harmonyEvents = []
  const wedgeSpans = []
  const scoreMarks = []
  const frames = []
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
    scoreMarks,
    frames,
    options,
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
      scoreMarks,
      frames,
      options,
    })
  })

  // Mixed notation+TAB parts: tag TAB-staff duplicates before playback events
  // are derived. No-op for scores without a TAB staff.
  reconcileTabMirrorNotes(notes, partNotationById)

  applyWedgeVelocitiesToNotes(notes, wedgeSpans)
  applyTieSustainToNotes(notes)
  rawTimingEvents.length = 0
  for (const note of notes) {
    if (note.isRest || note.isGrace || note.isCue || note.midi == null || note.suppressPlaybackAttack || note.isTabMirror) {
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
    ...(boundary.multipleRest != null ? { multipleRest: boundary.multipleRest } : {}),
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

  // First capo declaration wins for pitch math; structured staff-details
  // capo outranks text-mined directions. Every mark retains source text or
  // structured provenance so confidence never masquerades as structure.
  const structuredCapo = (() => {
    for (const info of partNotationById.values()) {
      for (const details of info.staffDetails.values()) {
        if (Number.isInteger(details.capoFret) && details.capoFret > 0) {
          return { fret: details.capoFret, staff: details.staff ?? null, confidence: 'structured' }
        }
      }
    }
    return null
  })()
  const capoMark = scoreMarks.find((mark) => mark.kind === 'capo')
  const capo = structuredCapo
    ?? (capoMark
      ? { fret: capoMark.fret, partial: capoMark.partial ?? false, sourceText: capoMark.sourceText, confidence: capoMark.confidence, measureNumber: capoMark.measureNumber, quarterTime: capoMark.quarterTime }
      : null)

  return {
    version: 2,
    fileName,
    title: getWorkTitle(score),
    attribution,
    notation,
    capo,
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
    frames,
    scoreMarks,
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
