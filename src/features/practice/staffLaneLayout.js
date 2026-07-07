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
  const staff = geometry.staves[staffKind] ?? Object.values(geometry.staves)[0]
  const { diatonic, sharp } = midiToDiatonic(midi)
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

  return { y, sharp, ledgerLines }
}

/** Notes with duration at or above this render hollow (half/whole-style). */
export const HOLLOW_NOTE_MIN_SECONDS = 1.0

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
  for (const group of groups ?? []) {
    const x = group.timeSeconds * pixelsPerSecond

    const laid = (group.notes ?? [])
      .filter((note) => isFiniteMidi(note.midi))
      .map((note, i) => {
        const staffKind = resolveStaffKind(note)
        const { y, sharp, ledgerLines } = staffYForNote(note.midi, staffKind, geometry)
        const durationSeconds = sanitizeVisualDurationSeconds(note.durationSeconds, 0)
        return {
          id: `${group.id}-${note.midi}-${i}`,
          groupId: group.id,
          status: group.status ?? null,
          laneOutcome: group.laneOutcome ?? null,
          x,
          xOffset: 0,
          y,
          staffKind,
          sharp,
          ledgerLines,
          diatonic: midiToDiatonic(note.midi).diatonic,
          hollow: durationSeconds >= HOLLOW_NOTE_MIN_SECONDS,
          durationSeconds,
          midi: note.midi,
          label: note.label,
          visualNoteId: note.visualNoteId ?? note.id ?? `${group.id}-${i}`,
          sourceNoteId: note.sourceNoteId ?? note.id ?? null,
          markings: note.markings ?? [],
        }
      })

    // Chord seconds (adjacent letter steps on the same staff) collide head-on;
    // standard notation shifts the upper note to the right of the stem line.
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

    notes.push(...laid)
  }
  return notes
}

/** Horizontal shift for the upper note of a chord "second", in SVG units. */
export const NOTEHEAD_SECOND_OFFSET = 12

/**
 * One stem per group-and-staff (chords share a stem). Direction follows the
 * standard rule: the notehead farthest from the staff's middle line decides —
 * at or above the middle line points the stem down, below points it up.
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
    const key = `${note.groupId}:${note.staffKind}`
    const list = chords.get(key)
    if (list) {
      list.push(note)
    } else {
      chords.set(key, [note])
    }
  }

  const stems = []
  for (const chord of chords.values()) {
    if (chord.every((note) => note.durationSeconds >= STEMLESS_MIN_SECONDS)) {
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
    const stemDown = farthest.diatonic >= middle

    const ys = chord.map((note) => note.y)
    const topY = Math.min(...ys)
    const bottomY = Math.max(...ys)
    const length = STEM_LENGTH_GAPS * STAFF_LINE_GAP

    stems.push({
      id: `stem-${chord[0].groupId}-${chord[0].staffKind}`,
      groupId: chord[0].groupId,
      staffKind: chord[0].staffKind,
      status: chord[0].status ?? null,
      stemDown,
      x: chord[0].x + (stemDown ? -noteheadRx : noteheadRx),
      y1: stemDown ? topY : bottomY,
      y2: stemDown ? bottomY + length : topY - length,
    })
  }
  return stems
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

function staffSpanPath(start, end, kind) {
  const x1 = start.x + start.xOffset + NOTEHEAD_RX * 0.9
  const x2 = Math.max(x1 + STAFF_LINE_GAP, end.x + end.xOffset - NOTEHEAD_RX * 0.9)
  const midX = (x1 + x2) / 2
  const span = Math.max(STAFF_LINE_GAP, x2 - x1)
  const arch = Math.max(STAFF_LINE_GAP * 0.9, Math.min(STAFF_LINE_GAP * 2.4, span * 0.16))

  if (kind === VISUAL_MARKING_KIND.SLUR) {
    const y1 = Math.min(start.y, end.y) - SLUR_VERTICAL_OFFSET
    const y2 = Math.min(start.y, end.y) - SLUR_VERTICAL_OFFSET
    return `M ${x1} ${y1} Q ${midX} ${Math.min(y1, y2) - arch} ${x2} ${y2}`
  }

  const y1 = Math.max(start.y, end.y) + TIE_VERTICAL_OFFSET
  const y2 = Math.max(start.y, end.y) + TIE_VERTICAL_OFFSET
  return `M ${x1} ${y1} Q ${midX} ${Math.max(y1, y2) + arch} ${x2} ${y2}`
}

function buildStaffNoteMarkingGeometry(notes) {
  const markings = []
  for (const note of notes ?? []) {
    const visualMarkings = (note.markings ?? []).filter((marking) =>
      [
        VISUAL_MARKING_KIND.STACCATO,
        VISUAL_MARKING_KIND.ACCENT,
        VISUAL_MARKING_KIND.TENUTO,
      ].includes(marking.kind),
    )
    visualMarkings.forEach((marking, index) => {
      const y = note.y - ARTICULATION_OFFSET_Y - index * ARTICULATION_STACK_GAP
      const x = note.x + note.xOffset
      if (marking.kind === VISUAL_MARKING_KIND.STACCATO) {
        markings.push({
          ...marking,
          id: `${marking.id}-staff-dot`,
          shape: 'dot',
          x,
          y,
          r: 2.2,
          status: note.status,
        })
      } else if (marking.kind === VISUAL_MARKING_KIND.ACCENT) {
        markings.push({
          ...marking,
          id: `${marking.id}-staff-accent`,
          shape: 'text',
          text: '>',
          x,
          y,
          fontSize: STAFF_LINE_GAP * 1.35,
          status: note.status,
        })
      } else if (marking.kind === VISUAL_MARKING_KIND.TENUTO) {
        markings.push({
          ...marking,
          id: `${marking.id}-staff-tenuto`,
          shape: 'line',
          x1: x - NOTEHEAD_RX * 0.8,
          x2: x + NOTEHEAD_RX * 0.8,
          y1: y,
          y2: y,
          status: note.status,
        })
      }
    })
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
        path: staffSpanPath(start, end, marking.kind),
        status: marking.status ?? staffSpanStatus(start, end),
      }
    })
    .filter(Boolean)

  return {
    noteMarkings: buildStaffNoteMarkingGeometry(notes),
    spanMarkings,
  }
}
