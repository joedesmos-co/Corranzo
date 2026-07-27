import { VISUAL_LANE_DEFAULTS } from './visualLaneConstants.js'
import {
  VISUAL_MARKING_KIND,
  buildVisualSpanMarkings,
} from './visualNotationMarkings.js'
import { isFiniteMidi, sanitizeVisualDurationSeconds } from './visualNoteSanitize.js'

/**
 * Staff-lane layout for Visual practice mode.
 *
 * Pure geometry: maps the existing visual lane groups (built from Wait For
 * You note checkpoints) onto standard notation staves — treble and/or bass —
 * with noteheads on lines/spaces, ledger lines, and sharps. All x positions
 * are deterministic functions of note time (seconds × pixelsPerSecond); the
 * scrolling offset is applied elsewhere as a single transform.
 *
 * No timing logic lives here: times come straight from the checkpoint data.
 */

export const STAFF_KIND = {
  TREBLE: 'treble',
  BASS: 'bass',
}

/** Vertical distance between adjacent staff lines, in SVG units. */
export const STAFF_LINE_GAP = 12
const HALF_STEP = STAFF_LINE_GAP / 2

/** Diatonic reference indices (octave × 7 + letter, C=0 … B=6). */
const TREBLE_TOP_LINE_DIATONIC = 38 // F5
const TREBLE_BOTTOM_LINE_DIATONIC = 30 // E4
const BASS_TOP_LINE_DIATONIC = 26 // A3
const BASS_BOTTOM_LINE_DIATONIC = 18 // G2

/** Margins for ledger-line room above/below each staff, in line gaps. */
const STAFF_MARGIN_GAPS = 3
/** Space between treble and bass staves in a grand staff, in line gaps.
    Generous so middle-C ledger notes read clearly between the staves. */
const GRAND_STAFF_GAP_GAPS = 6

const PITCH_CLASS_TO_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
const PITCH_CLASS_IS_SHARP = [
  false,
  true,
  false,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  false,
]
const STEP_TO_DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const ACCIDENTAL_GLYPHS = {
  sharp: '♯',
  flat: '♭',
  natural: '♮',
  'double-sharp': '𝄪',
  'sharp-sharp': '𝄪',
  'double-flat': '𝄫',
  'flat-flat': '𝄫',
}

export function accidentalGlyph(type) {
  return ACCIDENTAL_GLYPHS[String(type ?? '').toLowerCase()] ?? null
}

export function decoratedAccidentalGlyph(glyph, accidental) {
  if (!glyph) {
    return null
  }
  if (accidental?.bracket) {
    return `[${glyph}]`
  }
  if (accidental?.parentheses) {
    return `(${glyph})`
  }
  return glyph
}

export function writtenPitchToDiatonic(writtenPitch) {
  const step = String(writtenPitch?.step ?? '').toUpperCase()
  const octave = Number(writtenPitch?.octave)
  if (!(step in STEP_TO_DIATONIC) || !Number.isFinite(octave)) {
    return null
  }
  return octave * 7 + STEP_TO_DIATONIC[step]
}

/**
 * MIDI note → diatonic staff step (C0 = 0, each letter = 1) plus whether it
 * is notated with a sharp. Simple standard mapping — accidentals are always
 * sharps (no key-signature spelling; fine for a beginner lane).
 */
export function midiToDiatonic(midi) {
  const pitchClass = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return {
    diatonic: octave * 7 + PITCH_CLASS_TO_LETTER[pitchClass],
    sharp: PITCH_CLASS_IS_SHARP[pitchClass],
  }
}

export function resolveVisualWrittenPitch(note) {
  const writtenDiatonic = writtenPitchToDiatonic(note?.writtenPitch)
  if (writtenDiatonic != null) {
    const type = note?.accidental?.type ?? null
    return {
      diatonic: writtenDiatonic,
      accidentalType: type,
      accidentalGlyph: accidentalGlyph(type),
      source: 'musicxml-written-pitch',
    }
  }
  const fallback = midiToDiatonic(note?.midi)
  return {
    diatonic: fallback.diatonic,
    accidentalType: fallback.sharp ? 'sharp' : null,
    accidentalGlyph: fallback.sharp ? accidentalGlyph('sharp') : null,
    source: 'midi-fallback',
  }
}

/**
 * Which staff a note belongs on. Explicit MusicXML staff numbers win
 * (1 = upper/treble, 2+ = lower/bass); otherwise split at middle C.
 */
export function resolveStaffKind(note) {
  if (note?.staff === 2) {
    return STAFF_KIND.BASS
  }
  if (note?.staff === 1) {
    return STAFF_KIND.TREBLE
  }
  return (note?.midi ?? 60) >= 60 ? STAFF_KIND.TREBLE : STAFF_KIND.BASS
}

/** Detect which staves the piece needs (after per-note resolution). */
export function detectStaves(groups) {
  let hasTreble = false
  let hasBass = false
  for (const group of groups ?? []) {
    for (const note of group.notes ?? []) {
      if (resolveStaffKind(note) === STAFF_KIND.TREBLE) {
        hasTreble = true
      } else {
        hasBass = true
      }
      if (hasTreble && hasBass) {
        return { hasTreble, hasBass, grandStaff: true }
      }
    }
  }
  if (!hasTreble && !hasBass) {
    hasTreble = true // sensible default for an empty lane
  }
  return { hasTreble, hasBass, grandStaff: hasTreble && hasBass }
}

/**
 * Build staff geometry: line y positions per staff and overall height.
 * Grand staff = treble above bass; single staff = just the one in use.
 */
export function buildStaffGeometry(staves) {
  const margin = STAFF_MARGIN_GAPS * STAFF_LINE_GAP
  const useTreble = staves.hasTreble || !staves.hasBass
  const useBass = staves.hasBass

  const result = {
    grandStaff: Boolean(useTreble && useBass),
    staves: {},
    lines: [],
    height: 0,
  }

  let y = margin
  if (useTreble) {
    const lines = [0, 1, 2, 3, 4].map((i) => y + i * STAFF_LINE_GAP)
    result.staves[STAFF_KIND.TREBLE] = {
      kind: STAFF_KIND.TREBLE,
      topLineY: lines[0],
      topLineDiatonic: TREBLE_TOP_LINE_DIATONIC,
      bottomLineDiatonic: TREBLE_BOTTOM_LINE_DIATONIC,
      lines,
    }
    result.lines.push(...lines)
    y = lines[4]
  }
  if (useBass) {
    if (useTreble) {
      y += GRAND_STAFF_GAP_GAPS * STAFF_LINE_GAP
    }
    const lines = [0, 1, 2, 3, 4].map((i) => y + i * STAFF_LINE_GAP)
    result.staves[STAFF_KIND.BASS] = {
      kind: STAFF_KIND.BASS,
      topLineY: lines[0],
      topLineDiatonic: BASS_TOP_LINE_DIATONIC,
      bottomLineDiatonic: BASS_BOTTOM_LINE_DIATONIC,
      lines,
    }
    result.lines.push(...lines)
    y = lines[4]
  }

  result.height = y + margin
  return result
}

/**
 * Vertical position (and ledger lines) for a note on its staff.
 * Ledger lines sit on line-parity diatonic steps between the staff and the
 * note, inclusive of the note's own position when it falls on one.
 */
export function staffYForNote(midi, staffKind, geometry) {
  const { diatonic, sharp } = midiToDiatonic(midi)
  return {
    ...staffYForDiatonic(diatonic, staffKind, geometry),
    sharp,
  }
}

export function staffYForDiatonic(diatonic, staffKind, geometry) {
  const staff = geometry.staves[staffKind] ?? Object.values(geometry.staves)[0]
  const y = staff.topLineY + (staff.topLineDiatonic - diatonic) * HALF_STEP

  const ledgerLines = []
  if (diatonic > staff.topLineDiatonic) {
    for (let d = staff.topLineDiatonic + 2; d <= diatonic; d += 2) {
      ledgerLines.push(staff.topLineY + (staff.topLineDiatonic - d) * HALF_STEP)
    }
  } else if (diatonic < staff.bottomLineDiatonic) {
    for (let d = staff.bottomLineDiatonic - 2; d >= diatonic; d -= 2) {
      ledgerLines.push(staff.topLineY + (staff.topLineDiatonic - d) * HALF_STEP)
    }
  }

  return { y, ledgerLines }
}

const KEY_SIGNATURE_DIATONICS = {
  [STAFF_KIND.TREBLE]: {
    sharp: [38, 35, 39, 36, 33, 37, 34],
    flat: [34, 37, 33, 36, 32, 35, 31],
  },
  [STAFF_KIND.BASS]: {
    sharp: [24, 21, 25, 22, 19, 23, 20],
    flat: [20, 23, 19, 22, 18, 21, 17],
  },
}

function keySignatureType(fifths) {
  if (fifths > 0) {
    return 'sharp'
  }
  if (fifths < 0) {
    return 'flat'
  }
  return null
}

export function buildKeySignatureMarks(keySignature, geometry) {
  const fifths = Math.max(-7, Math.min(7, Math.round(Number(keySignature?.fifths) || 0)))
  const cancelFifths = Math.max(
    -7,
    Math.min(7, Math.round(Number(keySignature?.cancelFifths) || 0)),
  )
  const marks = []
  const cancelType = keySignatureType(cancelFifths)
  const type = keySignatureType(fifths)
  for (const staff of Object.values(geometry.staves)) {
    let column = 0
    if (cancelType) {
      const cancelOrder = KEY_SIGNATURE_DIATONICS[staff.kind][cancelType]
      for (let index = 0; index < Math.abs(cancelFifths); index += 1) {
        const position = staffYForDiatonic(cancelOrder[index], staff.kind, geometry)
        marks.push({
          id: `key-cancel-${staff.kind}-${index}`,
          staffKind: staff.kind,
          type: 'natural',
          glyph: accidentalGlyph('natural'),
          column,
          y: position.y,
          cancellation: true,
        })
        column += 1
      }
    }
    if (type) {
      const order = KEY_SIGNATURE_DIATONICS[staff.kind][type]
      for (let index = 0; index < Math.abs(fifths); index += 1) {
        const position = staffYForDiatonic(order[index], staff.kind, geometry)
        marks.push({
          id: `key-${staff.kind}-${index}`,
          staffKind: staff.kind,
          type,
          glyph: accidentalGlyph(type),
          column,
          y: position.y,
          cancellation: false,
        })
        column += 1
      }
    }
  }
  return marks
}

/** Notes with duration at or above this render hollow (half/whole-style). */
export const HOLLOW_NOTE_MIN_SECONDS = 1.0
const HOLLOW_NOTE_TYPES = new Set(['whole', 'half', 'breve', 'long'])
const STEMLESS_NOTE_TYPES = new Set(['whole', 'breve', 'long'])
const FLAG_COUNT_BY_NOTE_TYPE = {
  eighth: 1,
  '8th': 1,
  sixteenth: 2,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
}

/** Notehead ellipse radii, in SVG units (shared with the renderer so stems
    attach exactly at the notehead edge). */
export const NOTEHEAD_RX = 7
export const NOTEHEAD_RY = 5.2

/** Stem length, in staff line gaps (≈ one octave, standard engraving). */
export const STEM_LENGTH_GAPS = 3.2
/** Whole-note-style durations render without a stem. */
export const STEMLESS_MIN_SECONDS = 2.0
const ARTICULATION_OFFSET_Y = STAFF_LINE_GAP * 1.15
const ARTICULATION_STACK_GAP = STAFF_LINE_GAP * 0.62
const TIE_VERTICAL_OFFSET = STAFF_LINE_GAP * 0.88
const SLUR_VERTICAL_OFFSET = STAFF_LINE_GAP * 1.35

/**
 * Flatten visual lane groups into positioned staff notes.
 * x = timeSeconds × pixelsPerSecond — deterministic, no incremental state.
 */
export function buildStaffLaneNotes(
  groups,
  geometry,
  { pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond } = {},
) {
  const notes = []
  const groupByTime = new Map(
    (groups ?? []).map((group) => [
      Number(group.timeSeconds ?? 0).toFixed(6),
      group,
    ]),
  )
  for (const group of groups ?? []) {
    const notationEntries = []
    for (const note of group.notes ?? []) {
      notationEntries.push({
        note,
        timeSeconds: group.timeSeconds,
        renderGroup: group,
      })
      for (const continuation of note.tiedContinuations ?? []) {
        const timeSeconds = continuation.timeSeconds ?? group.timeSeconds
        const destinationGroup = groupByTime.get(Number(timeSeconds).toFixed(6))
        notationEntries.push({
          note: continuation,
          timeSeconds,
          renderGroup:
            destinationGroup ?? {
              id: `${group.id}-tie-${continuation.visualNoteId ?? continuation.id ?? timeSeconds}`,
              status: group.status ?? null,
              laneOutcome: group.laneOutcome ?? null,
            },
        })
      }
    }

    for (let entryIndex = 0; entryIndex < notationEntries.length; entryIndex += 1) {
      const entry = notationEntries[entryIndex]
      const note = entry.note
      if (!isFiniteMidi(note.midi)) {
        continue
      }
      const renderGroup = entry.renderGroup
      const x = Number(entry.timeSeconds ?? 0) * pixelsPerSecond
      const staffKind = resolveStaffKind(note)
      const written = resolveVisualWrittenPitch(note)
      const { y, ledgerLines } = staffYForDiatonic(
        written.diatonic,
        staffKind,
        geometry,
      )
      const durationSeconds = sanitizeVisualDurationSeconds(note.durationSeconds, 0)
      const noteType = note.noteType ?? null
      notes.push({
        id: `${renderGroup.id}-${note.midi}-${entryIndex}`,
        groupId: renderGroup.id,
        status: renderGroup.status ?? null,
        laneOutcome: renderGroup.laneOutcome ?? null,
        x,
        xOffset: 0,
        y,
        staffKind,
        sharp: written.accidentalType === 'sharp',
        accidentalType: written.accidentalType,
        accidentalGlyph: written.accidentalGlyph,
        accidentalDisplayGlyph: decoratedAccidentalGlyph(
          written.accidentalGlyph,
          note.accidental,
        ),
        accidentalColumn: 0,
        ledgerLines,
        diatonic: written.diatonic,
        hollow: noteType
          ? HOLLOW_NOTE_TYPES.has(noteType)
          : durationSeconds >= HOLLOW_NOTE_MIN_SECONDS,
        stemless: noteType
          ? STEMLESS_NOTE_TYPES.has(noteType)
          : durationSeconds >= STEMLESS_MIN_SECONDS,
        durationSeconds,
        durationQuarters: note.durationQuarters ?? null,
        noteType,
        stemDirection: note.stemDirection ?? null,
        dots: Math.max(0, Math.round(Number(note.dots) || 0)),
        beams: note.beams ?? [],
        midi: note.midi,
        label: note.label,
        writtenPitch: note.writtenPitch ?? null,
        accidental: note.accidental ?? null,
        keySignature: note.keySignature ?? null,
        measureNumber: note.measureNumber ?? null,
        partId: note.partId ?? null,
        voice: note.voice ?? 1,
        visualNoteId:
          note.visualNoteId ?? note.id ?? `${group.id}-${entryIndex}`,
        sourceNoteId: note.sourceNoteId ?? note.id ?? null,
        markings: note.markings ?? [],
      })
    }
  }

  // Chord seconds (adjacent letter steps on the same staff) collide head-on;
  // standard notation shifts the upper note to the right of the stem line.
  const chordGroups = new Map()
  for (const note of notes) {
    const key = `${note.groupId}:${note.staffKind}:${note.voice ?? 1}`
    const chord = chordGroups.get(key) ?? []
    chord.push(note)
    chordGroups.set(key, chord)
  }
  for (const laid of chordGroups.values()) {
    laid.sort((a, b) => a.diatonic - b.diatonic)
    for (let i = 1; i < laid.length; i += 1) {
      const prev = laid[i - 1]
      const curr = laid[i]
      if (
        curr.staffKind === prev.staffKind &&
        curr.diatonic - prev.diatonic === 1 &&
        prev.xOffset === 0
      ) {
        curr.xOffset = NOTEHEAD_SECOND_OFFSET
      }
    }
    const accidentalNotes = laid
      .filter((note) => note.accidentalGlyph)
      .sort((left, right) => left.y - right.y)
    const columnLastY = []
    for (const note of accidentalNotes) {
      let column = 0
      while (
        column < columnLastY.length &&
        Math.abs(note.y - columnLastY[column]) < STAFF_LINE_GAP * 1.65
      ) {
        column += 1
      }
      note.accidentalColumn = column
      columnLastY[column] = note.y
    }
  }
  return notes
}

/** Horizontal shift for the upper note of a chord "second", in SVG units. */
export const NOTEHEAD_SECOND_OFFSET = 12

/**
 * One stem per group, staff, and written voice (chords share a stem). Explicit
 * MusicXML stem direction wins; otherwise the notehead farthest from the
 * staff's middle line supplies the conventional fallback.
 * Whole-note-style durations get no stem. Stems attach at the notehead edge
 * and span the full chord, extending a standard length past the outer note.
 */
export function buildStaffLaneStems(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    noteheadRx = NOTEHEAD_RX,
    notes: prebuiltNotes = null,
  } = {},
) {
  const notes = prebuiltNotes ?? buildStaffLaneNotes(groups, geometry, { pixelsPerSecond })

  const chords = new Map()
  for (const note of notes) {
    const key = `${note.groupId}:${note.staffKind}:${note.voice ?? 1}`
    const list = chords.get(key)
    if (list) {
      list.push(note)
    } else {
      chords.set(key, [note])
    }
  }

  const stems = []
  for (const chord of chords.values()) {
    if (chord.every((note) => note.stemless)) {
      continue // whole-note style: no stem
    }
    const staff =
      geometry.staves[chord[0].staffKind] ?? Object.values(geometry.staves)[0]
    const middle = (staff.topLineDiatonic + staff.bottomLineDiatonic) / 2

    let farthest = chord[0]
    for (const note of chord) {
      if (Math.abs(note.diatonic - middle) > Math.abs(farthest.diatonic - middle)) {
        farthest = note
      }
    }
    const explicitDirections = [
      ...new Set(
        chord
          .map((note) => note.stemDirection)
          .filter((direction) => direction === 'up' || direction === 'down'),
      ),
    ]
    const stemDown =
      explicitDirections.length === 1
        ? explicitDirections[0] === 'down'
        : farthest.diatonic >= middle

    const ys = chord.map((note) => note.y)
    const topY = Math.min(...ys)
    const bottomY = Math.max(...ys)
    const length = STEM_LENGTH_GAPS * STAFF_LINE_GAP

    stems.push({
      id: `stem-${chord[0].groupId}-${chord[0].staffKind}`,
      groupId: chord[0].groupId,
      staffKind: chord[0].staffKind,
      voice: chord[0].voice ?? 1,
      status: chord[0].status ?? null,
      stemDown,
      x: chord[0].x + (stemDown ? -noteheadRx : noteheadRx),
      y1: stemDown ? topY : bottomY,
      y2: stemDown ? bottomY + length : topY - length,
    })
  }
  return stems
}

export function flagCountForNoteType(noteType) {
  return FLAG_COUNT_BY_NOTE_TYPE[noteType] ?? 0
}

function rhythmStatus(left, right = null) {
  if (left?.status === 'current' || right?.status === 'current') {
    return 'current'
  }
  if (left?.status === 'past' && (!right || right.status === 'past')) {
    return 'past'
  }
  return right?.status ?? left?.status ?? null
}

function beamKey(note, number) {
  return [
    note.partId ?? '',
    note.voice ?? 1,
    note.staffKind ?? '',
    number,
  ].join('|')
}

function notesByStemKey(notes = []) {
  const byKey = new Map()
  for (const note of notes) {
    const key = `${note.groupId}:${note.staffKind}:${note.voice ?? 1}`
    const chord = byKey.get(key) ?? []
    chord.push(note)
    byKey.set(key, chord)
  }
  return byKey
}

/**
 * Visual-only rhythm geometry derived from parsed MusicXML. It never changes
 * playback timing or checkpoint grouping.
 */
export function buildStaffLaneRhythmMarks(notes = [], stems = []) {
  const chordNotes = notesByStemKey(notes)
  const stemByKey = new Map(
    stems.map((stem) => [`${stem.groupId}:${stem.staffKind}:${stem.voice ?? 1}`, stem]),
  )
  const records = [...chordNotes.entries()]
    .map(([key, chord]) => {
      const stem = stemByKey.get(key) ?? null
      const beamOwner = chord.find((note) => (note.beams?.length ?? 0) > 0) ?? chord[0]
      return {
        key,
        chord,
        stem,
        beamOwner,
        marks: beamOwner?.beams ?? [],
        x: chord[0]?.x ?? 0,
      }
    })
    .sort((left, right) => left.x - right.x)

  const beamMarks = []
  const open = new Map()
  for (const record of records) {
    if (!record.stem || !record.beamOwner) {
      continue
    }
    for (const mark of record.marks) {
      const number = Math.max(1, Math.round(Number(mark.number) || 1))
      const value = String(mark.value ?? '').toLowerCase()
      const key = beamKey(record.beamOwner, number)
      if (value === 'begin') {
        open.set(key, record)
        continue
      }
      if (value === 'end') {
        const start = open.get(key)
        open.delete(key)
        if (!start?.stem || start === record) {
          continue
        }
        const offsetDirection = start.stem.stemDown ? -1 : 1
        const offset = offsetDirection * (number - 1) * (STAFF_LINE_GAP * 0.46)
        beamMarks.push({
          id: `beam-${key}-${start.key}-${record.key}`,
          number,
          x1: start.stem.x,
          y1: start.stem.y2 + offset,
          x2: record.stem.x,
          y2: record.stem.y2 + offset,
          status: rhythmStatus(start.chord[0], record.chord[0]),
        })
        continue
      }
      if (value === 'forward hook' || value === 'backward hook') {
        const direction = value === 'forward hook' ? 1 : -1
        const offsetDirection = record.stem.stemDown ? -1 : 1
        const offset = offsetDirection * (number - 1) * (STAFF_LINE_GAP * 0.46)
        beamMarks.push({
          id: `beam-hook-${key}-${record.key}`,
          number,
          x1: record.stem.x,
          y1: record.stem.y2 + offset,
          x2: record.stem.x + direction * STAFF_LINE_GAP,
          y2: record.stem.y2 + offset,
          status: record.chord[0]?.status ?? null,
          hook: true,
        })
      }
    }
  }

  const flags = []
  for (const record of records) {
    if (!record.stem || record.marks.length > 0) {
      continue
    }
    const count = Math.max(
      0,
      ...record.chord.map((note) => flagCountForNoteType(note.noteType)),
    )
    for (let number = 1; number <= count; number += 1) {
      const towardHead = record.stem.stemDown ? -1 : 1
      const side = record.stem.stemDown ? -1 : 1
      const startY =
        record.stem.y2 + towardHead * (number - 1) * (STAFF_LINE_GAP * 0.5)
      const endY = startY + towardHead * STAFF_LINE_GAP
      const controlY = startY + towardHead * (STAFF_LINE_GAP * 0.28)
      flags.push({
        id: `flag-${record.key}-${number}`,
        number,
        path: `M ${record.stem.x} ${startY} Q ${
          record.stem.x + side * STAFF_LINE_GAP * 0.9
        } ${controlY} ${record.stem.x + side * STAFF_LINE_GAP * 0.62} ${endY}`,
        status: record.chord[0]?.status ?? null,
      })
    }
  }

  const dots = []
  for (const note of notes) {
    for (let index = 0; index < note.dots; index += 1) {
      dots.push({
        id: `dot-${note.id}-${index + 1}`,
        cx: note.x + note.xOffset + NOTEHEAD_RX + 4 + index * 5,
        cy: note.y - NOTEHEAD_RY * 0.25,
        r: 1.8,
        status: note.status ?? null,
      })
    }
  }

  return { beams: beamMarks, flags, dots }
}

function staffSpanStatus(start, end) {
  if (start.status === 'current' || end.status === 'current') {
    return 'current'
  }
  if (start.status === 'past' && end.status === 'past') {
    return 'past'
  }
  return end.status ?? start.status ?? null
}

function staffSpanPath(start, end, marking) {
  const x1 = start.x + start.xOffset + NOTEHEAD_RX * 0.9
  const x2 = Math.max(x1 + STAFF_LINE_GAP, end.x + end.xOffset - NOTEHEAD_RX * 0.9)
  const midX = (x1 + x2) / 2
  const span = Math.max(STAFF_LINE_GAP, x2 - x1)
  const arch = Math.max(STAFF_LINE_GAP * 0.9, Math.min(STAFF_LINE_GAP * 2.4, span * 0.16))
  const placement = marking.placement ?? (
    marking.kind === VISUAL_MARKING_KIND.SLUR ? 'above' : 'below'
  )
  const verticalOffset =
    marking.kind === VISUAL_MARKING_KIND.SLUR
      ? SLUR_VERTICAL_OFFSET
      : TIE_VERTICAL_OFFSET

  if (placement === 'above') {
    const y1 = Math.min(start.y, end.y) - verticalOffset
    const y2 = Math.min(start.y, end.y) - verticalOffset
    return `M ${x1} ${y1} Q ${midX} ${Math.min(y1, y2) - arch} ${x2} ${y2}`
  }

  const y1 = Math.max(start.y, end.y) + verticalOffset
  const y2 = Math.max(start.y, end.y) + verticalOffset
  return `M ${x1} ${y1} Q ${midX} ${Math.max(y1, y2) + arch} ${x2} ${y2}`
}

function buildStaffNoteMarkingGeometry(notes) {
  const supportedKinds = new Set([
    VISUAL_MARKING_KIND.STACCATO,
    VISUAL_MARKING_KIND.ACCENT,
    VISUAL_MARKING_KIND.TENUTO,
    VISUAL_MARKING_KIND.MARCATO,
    VISUAL_MARKING_KIND.FERMATA,
  ])
  const grouped = new Map()
  for (const note of notes ?? []) {
    for (const marking of note.markings ?? []) {
      if (!supportedKinds.has(marking.kind)) {
        continue
      }
      const placement = marking.placement === 'below' ? 'below' : 'above'
      const key = [
        marking.groupId ?? note.visualNoteId,
        marking.kind,
        placement,
      ].join('|')
      const current = grouped.get(key) ?? {
        marking,
        placement,
        notes: [],
      }
      current.notes.push(note)
      grouped.set(key, current)
    }
  }

  const markings = []
  const stackCounts = new Map()
  for (const { marking, placement, notes: chordNotes } of grouped.values()) {
    const anchor =
      placement === 'below'
        ? chordNotes.reduce((best, note) => (note.y > best.y ? note : best))
        : chordNotes.reduce((best, note) => (note.y < best.y ? note : best))
    const stackKey = `${marking.groupId ?? anchor.visualNoteId}|${placement}`
    const stackIndex = stackCounts.get(stackKey) ?? 0
    stackCounts.set(stackKey, stackIndex + 1)
    const direction = placement === 'below' ? 1 : -1
    const extraOffset =
      marking.kind === VISUAL_MARKING_KIND.FERMATA
        ? STAFF_LINE_GAP * 0.45
        : 0
    const y =
      anchor.y +
      direction *
        (ARTICULATION_OFFSET_Y +
          extraOffset +
          stackIndex * ARTICULATION_STACK_GAP)
    const x =
      chordNotes.reduce(
        (sum, note) => sum + note.x + note.xOffset,
        0,
      ) / Math.max(1, chordNotes.length)
    const common = {
      ...marking,
      placement,
      chordNoteIds: chordNotes.map((note) => note.visualNoteId),
      status: anchor.status,
    }
      if (marking.kind === VISUAL_MARKING_KIND.STACCATO) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-dot`,
          shape: 'dot',
          x,
          y,
          r: 2.2,
        })
      } else if (marking.kind === VISUAL_MARKING_KIND.ACCENT) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-accent`,
          shape: 'text',
          text: '>',
          x,
          y,
          fontSize: STAFF_LINE_GAP * 1.35,
        })
      } else if (marking.kind === VISUAL_MARKING_KIND.TENUTO) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-tenuto`,
          shape: 'line',
          x1: x - NOTEHEAD_RX * 0.8,
          x2: x + NOTEHEAD_RX * 0.8,
          y1: y,
          y2: y,
        })
      } else if (marking.kind === VISUAL_MARKING_KIND.MARCATO) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-marcato`,
          shape: 'text',
          text: placement === 'below' ? '⌄' : '⌃',
          x,
          y,
          fontSize: STAFF_LINE_GAP * 1.5,
        })
      } else if (marking.kind === VISUAL_MARKING_KIND.FERMATA) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-fermata`,
          shape: 'text',
          text: placement === 'below' ? '𝄑' : '𝄐',
          x,
          y,
          fontSize: STAFF_LINE_GAP * 1.8,
        })
      }
  }
  return markings
}

export function buildStaffLaneNotationMarkings(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    notes: prebuiltNotes = null,
  } = {},
) {
  const notes = prebuiltNotes ?? buildStaffLaneNotes(groups, geometry, { pixelsPerSecond })
  const notesById = new Map(notes.map((note) => [note.visualNoteId, note]))

  const spanMarkings = buildVisualSpanMarkings(groups)
    .filter((marking) =>
      marking.kind === VISUAL_MARKING_KIND.TIE || marking.kind === VISUAL_MARKING_KIND.SLUR,
    )
    .map((marking) => {
      const start = notesById.get(marking.fromNoteId)
      let end = notesById.get(marking.toNoteId)
      if (start && !end && marking.toTimeSeconds > marking.fromTimeSeconds) {
        end = {
          ...start,
          x: start.x + (marking.toTimeSeconds - marking.fromTimeSeconds) * pixelsPerSecond,
        }
      }
      if (!start || !end) {
        return null
      }
      return {
        ...marking,
        path: staffSpanPath(start, end, marking),
        status: marking.status ?? staffSpanStatus(start, end),
      }
    })
    .filter(Boolean)

  return {
    noteMarkings: buildStaffNoteMarkingGeometry(notes),
    spanMarkings,
  }
}
