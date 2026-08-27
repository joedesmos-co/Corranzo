import { VISUAL_LANE_DEFAULTS } from './visualLaneConstants.js'
import {
  VISUAL_MARKING_KIND,
  buildVisualSpanMarkings,
} from './visualNotationMarkings.js'
import { isFiniteMidi, sanitizeVisualDurationSeconds } from './visualNoteSanitize.js'
import {
  VISUAL_LAYOUT_SOURCE,
  resolveSourceFidelityLaneX,
  resolveSourceFidelityObjectX,
  resolveSourceFidelitySystem,
} from './sourceFidelityLayout.js'

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
export const GRACE_NOTE_SCALE = 0.66
const GRACE_NOTE_SPACING = STAFF_LINE_GAP * 1.45
const GRACE_STEM_LENGTH = STAFF_LINE_GAP * 2.1

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
  'natural-sharp': '♮♯',
  'natural-flat': '♮♭',
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
    for (const note of [...(group.notes ?? []), ...(group.rests ?? [])]) {
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
export function buildStaffGeometry(
  staves,
  {
    grandStaffGapGaps = GRAND_STAFF_GAP_GAPS,
    topMarginGaps = STAFF_MARGIN_GAPS,
    bottomMarginGaps = STAFF_MARGIN_GAPS,
  } = {},
) {
  const resolvedTopMarginGaps =
    Number.isFinite(Number(topMarginGaps)) && Number(topMarginGaps) > 0
      ? Number(topMarginGaps)
      : STAFF_MARGIN_GAPS
  const resolvedBottomMarginGaps =
    Number.isFinite(Number(bottomMarginGaps)) && Number(bottomMarginGaps) > 0
      ? Number(bottomMarginGaps)
      : STAFF_MARGIN_GAPS
  const topMargin = resolvedTopMarginGaps * STAFF_LINE_GAP
  const bottomMargin = resolvedBottomMarginGaps * STAFF_LINE_GAP
  const useTreble = staves.hasTreble || !staves.hasBass
  const useBass = staves.hasBass
  const resolvedGrandStaffGapGaps =
    Number.isFinite(Number(grandStaffGapGaps)) && Number(grandStaffGapGaps) > 0
      ? Number(grandStaffGapGaps)
      : GRAND_STAFF_GAP_GAPS

  const result = {
    grandStaff: Boolean(useTreble && useBass),
    staves: {},
    lines: [],
    height: 0,
    topMarginGaps: resolvedTopMarginGaps,
    bottomMarginGaps: resolvedBottomMarginGaps,
  }

  let y = topMargin
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
      y += resolvedGrandStaffGapGaps * STAFF_LINE_GAP
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

  result.height = y + bottomMargin
  return result
}

/**
 * Expand only the outer staff margins needed by retained source directions.
 * The marks stay at their MusicXML distance from the first staff; the lane
 * grows around them instead of clipping or clamping their engraving.
 */
export function sourceDirectionMarginGaps(
  structuralMarks,
  staves,
  { grandStaffGapGaps = GRAND_STAFF_GAP_GAPS } = {},
) {
  const resolvedGrandGap =
    Number.isFinite(Number(grandStaffGapGaps)) && Number(grandStaffGapGaps) > 0
      ? Number(grandStaffGapGaps)
      : GRAND_STAFF_GAP_GAPS
  const lastStaffBottomFromFirstTop =
    staves?.hasTreble && staves?.hasBass ? 8 + resolvedGrandGap : 4
  const marks = [
    ...(structuralMarks?.dynamics ?? []),
    ...(structuralMarks?.wedges ?? []),
    ...(structuralMarks?.octaveShifts ?? []),
  ].filter((mark) => mark?.printObject !== false)
  let top = STAFF_MARGIN_GAPS
  let bottom = STAFF_MARGIN_GAPS
  for (const mark of marks) {
    const defaultY = Number(mark?.defaultY)
    const relativeY = mark?.relativeY == null ? 0 : Number(mark.relativeY)
    if (
      mark?.defaultY == null ||
      !Number.isFinite(defaultY) ||
      !Number.isFinite(relativeY)
    ) {
      continue
    }
    const positionFromFirstTop = -(defaultY + relativeY) / 10
    if (positionFromFirstTop < 0) {
      top = Math.max(top, -positionFromFirstTop + 1.25)
    } else if (positionFromFirstTop > lastStaffBottomFromFirstTop) {
      bottom = Math.max(
        bottom,
        positionFromFirstTop - lastStaffBottomFromFirstTop + 1.25,
      )
    }
  }
  return { topMarginGaps: top, bottomMarginGaps: bottom }
}

/**
 * Apply one source system's MusicXML staff-distance declaration to the native
 * reconstructed staff geometry. MusicXML stores the distance from the bottom
 * line of the preceding staff to the top line of the requested staff in
 * tenths (10 tenths = one interline space).
 */
export function buildSourceSystemStaffGeometry(geometry, system) {
  const treble = geometry?.staves?.[STAFF_KIND.TREBLE]
  const bass = geometry?.staves?.[STAFF_KIND.BASS]
  const staffDistanceTenths = Number(system?.staffDistances?.['2'])
  if (!treble || !bass || !(staffDistanceTenths > 0)) {
    return geometry
  }

  const bassTopY =
    treble.lines[treble.lines.length - 1] +
    (staffDistanceTenths / 10) * STAFF_LINE_GAP
  const bassLines = [0, 1, 2, 3, 4].map(
    (index) => bassTopY + index * STAFF_LINE_GAP,
  )
  const resolvedBass = {
    ...bass,
    topLineY: bassLines[0],
    lines: bassLines,
  }
  return {
    ...geometry,
    staves: {
      ...geometry.staves,
      [STAFF_KIND.BASS]: resolvedBass,
    },
    lines: [...treble.lines, ...bassLines],
    height: Math.max(
      geometry.height,
      bassLines[bassLines.length - 1] +
        Number(geometry.bottomMarginGaps ?? STAFF_MARGIN_GAPS) * STAFF_LINE_GAP,
    ),
  }
}

function geometryForSourceObject(geometry, sourceLayout, object, group) {
  const system = resolveSourceFidelitySystem(sourceLayout, object, group)
  return buildSourceSystemStaffGeometry(geometry, system)
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

const CLEF_REFERENCE_DIATONICS = {
  G: 32, // G4
  F: 24, // F3
  C: 28, // C4
}

function staffDiatonicBounds(staff, clef) {
  const sign = String(clef?.sign ?? '').toUpperCase()
  const reference = CLEF_REFERENCE_DIATONICS[sign]
  const line = Number(clef?.line)
  if (!Number.isFinite(reference) || !Number.isFinite(line) || line < 1 || line > 5) {
    return {
      top: staff.topLineDiatonic,
      bottom: staff.bottomLineDiatonic,
      source: 'semantic-fallback',
    }
  }
  const octaveChange = Number(clef?.octaveChange ?? 0)
  const referenceWithOctave =
    reference + (Number.isFinite(octaveChange) ? octaveChange * 7 : 0)
  return {
    top: referenceWithOctave + (5 - line) * 2,
    bottom: referenceWithOctave - (line - 1) * 2,
    source: 'musicxml-clef',
  }
}

export function staffYForDiatonic(diatonic, staffKind, geometry, clef = null) {
  const staff = geometry.staves[staffKind] ?? Object.values(geometry.staves)[0]
  const bounds = staffDiatonicBounds(staff, clef)
  const y = staff.topLineY + (bounds.top - diatonic) * HALF_STEP

  const ledgerLines = []
  if (diatonic > bounds.top) {
    for (let d = bounds.top + 2; d <= diatonic; d += 2) {
      ledgerLines.push(staff.topLineY + (bounds.top - d) * HALF_STEP)
    }
  } else if (diatonic < bounds.bottom) {
    for (let d = bounds.bottom - 2; d >= diatonic; d -= 2) {
      ledgerLines.push(staff.topLineY + (bounds.top - d) * HALF_STEP)
    }
  }

  return { y, ledgerLines, sourceYMode: bounds.source }
}

function ledgerLinesForSourceY(y, staffKind, geometry) {
  const staff = geometry.staves[staffKind] ?? Object.values(geometry.staves)[0]
  if (!staff) return []
  const top = staff.lines[0]
  const bottom = staff.lines[staff.lines.length - 1]
  const ledgerLines = []
  if (y < top - HALF_STEP) {
    for (let ledgerY = top - STAFF_LINE_GAP; ledgerY >= y - 0.001; ledgerY -= STAFF_LINE_GAP) {
      ledgerLines.push(ledgerY)
    }
  } else if (y > bottom + HALF_STEP) {
    for (let ledgerY = bottom + STAFF_LINE_GAP; ledgerY <= y + 0.001; ledgerY += STAFF_LINE_GAP) {
      ledgerLines.push(ledgerY)
    }
  }
  return ledgerLines
}

/**
 * MusicXML default-y is source engraving evidence in tenths, measured upward
 * from the source staff coordinate frame. Multi-staff exports include the
 * inter-staff distance in that frame, so its origin maps to the top line of
 * the first reconstructed staff. Translate that evidence when present;
 * otherwise abstain so semantic clef/pitch layout remains the fallback.
 */
function sourceYForObject(object, staffKind, geometry) {
  const layout = object?.sourceLayout
  const defaultY = Number(layout?.defaultY)
  const relativeY = layout?.relativeY == null ? 0 : Number(layout.relativeY)
  if (
    layout?.source !== VISUAL_LAYOUT_SOURCE.MUSICXML ||
    layout.defaultY == null ||
    !Number.isFinite(defaultY) ||
    !Number.isFinite(relativeY)
  ) {
    return null
  }
  const firstStaff =
    geometry.staves[STAFF_KIND.TREBLE] ?? Object.values(geometry.staves)[0]
  if (!firstStaff) return null
  const y = firstStaff.lines[0] - ((defaultY + relativeY) / 10) * STAFF_LINE_GAP
  return {
    y,
    ledgerLines: ledgerLinesForSourceY(y, staffKind, geometry),
    sourceYMode: 'musicxml-default-y',
    sourceDefaultY: defaultY,
    sourceRelativeY: relativeY,
  }
}

function sourceXModeForObject(object) {
  const layout = object?.sourceLayout
  if (
    layout?.source === VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP &&
    layout.x != null &&
    Number.isFinite(Number(layout.x))
  ) {
    return VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP
  }
  if (
    layout?.source === VISUAL_LAYOUT_SOURCE.MUSICXML &&
    layout.xInMeasure != null &&
    Number.isFinite(Number(layout.xInMeasure))
  ) {
    return VISUAL_LAYOUT_SOURCE.MUSICXML
  }
  return VISUAL_LAYOUT_SOURCE.SEMANTIC_FALLBACK
}

/**
 * Reconstruct printed dynamic text from source direction events. MusicXML
 * default-y shares the same score-wide tenths frame as positioned notes;
 * when absent, conventional placement around the owning staff is the safe
 * semantic fallback.
 */
export function buildStaffLaneDynamicMarks(
  structuralMarks,
  geometry,
  { sourceSystemGeometries = new Map() } = {},
) {
  return (structuralMarks?.dynamics ?? [])
    .filter((dynamic) => dynamic?.printObject !== false && dynamic?.mark)
    .map((dynamic) => {
      const dynamicGeometry =
        sourceSystemGeometries.get(dynamic.systemOccurrence) ?? geometry
      const staffKind = resolveStaffKind(dynamic)
      const staff =
        dynamicGeometry.staves[staffKind] ?? Object.values(dynamicGeometry.staves)[0]
      const firstStaff =
        dynamicGeometry.staves[STAFF_KIND.TREBLE] ??
        Object.values(dynamicGeometry.staves)[0]
      if (!staff || !firstStaff) return null

      const defaultY = Number(dynamic.defaultY)
      const relativeY = dynamic.relativeY == null ? 0 : Number(dynamic.relativeY)
      const hasSourceY =
        dynamic.defaultY != null &&
        Number.isFinite(defaultY) &&
        Number.isFinite(relativeY)
      const placement = dynamic.placement === 'above' ? 'above' : 'below'
      const y = hasSourceY
        ? firstStaff.lines[0] - ((defaultY + relativeY) / 10) * STAFF_LINE_GAP
        : placement === 'above'
          ? staff.lines[0] - STAFF_LINE_GAP * 1.55
          : staff.lines[staff.lines.length - 1] + STAFF_LINE_GAP * 1.55

      return {
        ...dynamic,
        staffKind,
        placement,
        y,
        sourceYMode: hasSourceY
          ? 'musicxml-default-y'
          : 'semantic-placement-fallback',
      }
    })
    .filter(Boolean)
}

/**
 * Translate structural hairpin segments into native staff-lane line geometry.
 * MusicXML default-y is score-wide tenths from the first staff; otherwise the
 * owning staff and direction placement provide a conventional fallback.
 */
export function buildStaffLaneWedgeMarks(
  structuralMarks,
  geometry,
  { sourceSystemGeometries = new Map() } = {},
) {
  return (structuralMarks?.wedges ?? [])
    .filter(
      (wedge) =>
        wedge?.printObject !== false &&
        (wedge?.type === 'crescendo' || wedge?.type === 'diminuendo'),
    )
    .map((wedge) => {
      const wedgeGeometry =
        sourceSystemGeometries.get(wedge.systemOccurrence) ?? geometry
      const staffKind = resolveStaffKind(wedge)
      const staff =
        wedgeGeometry.staves[staffKind] ?? Object.values(wedgeGeometry.staves)[0]
      const firstStaff =
        wedgeGeometry.staves[STAFF_KIND.TREBLE] ??
        Object.values(wedgeGeometry.staves)[0]
      if (!staff || !firstStaff) return null

      const defaultY = Number(wedge.defaultY)
      const relativeY = wedge.relativeY == null ? 0 : Number(wedge.relativeY)
      const hasSourceY =
        wedge.defaultY != null &&
        Number.isFinite(defaultY) &&
        Number.isFinite(relativeY)
      const placement = wedge.placement === 'above' ? 'above' : 'below'
      const centerY = hasSourceY
        ? firstStaff.lines[0] - ((defaultY + relativeY) / 10) * STAFF_LINE_GAP
        : placement === 'above'
          ? staff.lines[0] - STAFF_LINE_GAP * 1.45
          : staff.lines[staff.lines.length - 1] + STAFF_LINE_GAP * 1.45
      const spreadTenths =
        wedge.spread != null && Number.isFinite(Number(wedge.spread))
          ? Math.max(0, Number(wedge.spread))
          : 15
      const halfSpread = (spreadTenths / 20) * STAFF_LINE_GAP
      const startHalfSpread = halfSpread * Number(wedge.apertureStart ?? 0)
      const endHalfSpread = halfSpread * Number(wedge.apertureEnd ?? 0)

      return {
        ...wedge,
        staffKind,
        placement,
        centerY,
        yTopStart: centerY - startHalfSpread,
        yTopEnd: centerY - endHalfSpread,
        yBottomStart: centerY + startHalfSpread,
        yBottomEnd: centerY + endHalfSpread,
        sourceYMode: hasSourceY
          ? 'musicxml-default-y'
          : 'semantic-placement-fallback',
      }
    })
    .filter(Boolean)
}

function octaveShiftLabel(type, size) {
  if (Number(size) === 15) return type === 'up' ? '15mb' : '15ma'
  return type === 'up' ? '8vb' : '8va'
}

/** Native 8va/8vb (and 15ma/15mb) bracket geometry. */
export function buildStaffLaneOctaveShiftMarks(
  structuralMarks,
  geometry,
  { sourceSystemGeometries = new Map() } = {},
) {
  return (structuralMarks?.octaveShifts ?? [])
    .filter(
      (shift) =>
        shift?.printObject !== false &&
        (shift?.type === 'up' || shift?.type === 'down'),
    )
    .map((shift) => {
      const shiftGeometry =
        sourceSystemGeometries.get(shift.systemOccurrence) ?? geometry
      const staffKind = resolveStaffKind(shift)
      const staff =
        shiftGeometry.staves[staffKind] ?? Object.values(shiftGeometry.staves)[0]
      const firstStaff =
        shiftGeometry.staves[STAFF_KIND.TREBLE] ??
        Object.values(shiftGeometry.staves)[0]
      if (!staff || !firstStaff) return null

      const defaultY = Number(shift.defaultY)
      const relativeY = shift.relativeY == null ? 0 : Number(shift.relativeY)
      const hasSourceY =
        shift.defaultY != null &&
        Number.isFinite(defaultY) &&
        Number.isFinite(relativeY)
      const placement = shift.placement === 'below' ? 'below' : 'above'
      const y = hasSourceY
        ? firstStaff.lines[0] - ((defaultY + relativeY) / 10) * STAFF_LINE_GAP
        : placement === 'below'
          ? staff.lines[staff.lines.length - 1] + STAFF_LINE_GAP * 2.2
          : staff.lines[0] - STAFF_LINE_GAP * 2.2
      const label = octaveShiftLabel(shift.type, shift.size)
      const lineXStart = shift.showLabel
        ? Number(shift.xStart) + STAFF_LINE_GAP * (label.startsWith('15') ? 2.7 : 2.2)
        : Number(shift.xStart)
      const hookDirection = placement === 'below' ? -1 : 1
      const dashLength =
        shift.dashLength != null && Number.isFinite(Number(shift.dashLength))
          ? Math.max(1, (Number(shift.dashLength) / 10) * STAFF_LINE_GAP)
          : STAFF_LINE_GAP * 0.55
      const spaceLength =
        shift.spaceLength != null && Number.isFinite(Number(shift.spaceLength))
          ? Math.max(1, (Number(shift.spaceLength) / 10) * STAFF_LINE_GAP)
          : STAFF_LINE_GAP * 0.42

      return {
        ...shift,
        staffKind,
        placement,
        label,
        y,
        lineXStart: Math.min(lineXStart, Number(shift.xEnd)),
        hookY: y + hookDirection * STAFF_LINE_GAP * 0.8,
        dashArray: `${dashLength} ${spaceLength}`,
        sourceYMode: hasSourceY
          ? 'musicxml-default-y'
          : 'semantic-placement-fallback',
      }
    })
    .filter(Boolean)
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

function keySignatureOrder(type, staff, clef) {
  if (!clef || !CLEF_REFERENCE_DIATONICS[String(clef.sign ?? '').toUpperCase()]) {
    return KEY_SIGNATURE_DIATONICS[staff.kind][type]
  }
  const bounds = staffDiatonicBounds(staff, clef)
  const octaveShift = Math.round((bounds.top - TREBLE_TOP_LINE_DIATONIC) / 7) * 7
  return KEY_SIGNATURE_DIATONICS[STAFF_KIND.TREBLE][type].map(
    (diatonic) => diatonic + octaveShift,
  )
}

export function buildKeySignatureMarks(
  keySignature,
  geometry,
  { clefs = [] } = {},
) {
  const fifths = Math.max(-7, Math.min(7, Math.round(Number(keySignature?.fifths) || 0)))
  const cancelFifths = Math.max(
    -7,
    Math.min(7, Math.round(Number(keySignature?.cancelFifths) || 0)),
  )
  const marks = []
  const cancelType = keySignatureType(cancelFifths)
  const type = keySignatureType(fifths)
  for (const staff of Object.values(geometry.staves)) {
    const staffNumber = staff.kind === STAFF_KIND.BASS ? 2 : 1
    const clef = clefs.find((candidate) => Number(candidate.staff) === staffNumber) ?? null
    let column = 0
    if (cancelType) {
      const cancelOrder = keySignatureOrder(cancelType, staff, clef)
      for (let index = 0; index < Math.abs(cancelFifths); index += 1) {
        const position = staffYForDiatonic(
          cancelOrder[index],
          staff.kind,
          geometry,
          clef,
        )
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
      const order = keySignatureOrder(type, staff, clef)
      for (let index = 0; index < Math.abs(fifths); index += 1) {
        const position = staffYForDiatonic(order[index], staff.kind, geometry, clef)
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

export const REST_GLYPH_BY_NOTE_TYPE = Object.freeze({
  whole: '\u{1D13B}',
  breve: '\u{1D13A}',
  half: '\u{1D13C}',
  quarter: '\u{1D13D}',
  eighth: '\u{1D13E}',
  '8th': '\u{1D13E}',
  sixteenth: '\u{1D13F}',
  '16th': '\u{1D13F}',
  '32nd': '\u{1D140}',
  '64th': '\u{1D141}',
})

function inferredRestType(rest) {
  if (REST_GLYPH_BY_NOTE_TYPE[rest?.noteType]) return rest.noteType
  const quarters = Number(rest?.durationQuarters)
  if (Number.isFinite(quarters)) {
    if (quarters >= 4) return 'whole'
    if (quarters >= 2) return 'half'
    if (quarters >= 1) return 'quarter'
    if (quarters >= 0.5) return 'eighth'
    if (quarters >= 0.25) return 'sixteenth'
    return '32nd'
  }
  return 'quarter'
}

export function restGlyphForNoteType(noteType) {
  return REST_GLYPH_BY_NOTE_TYPE[noteType] ?? REST_GLYPH_BY_NOTE_TYPE.quarter
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
const TRILL_NOTE_OFFSET_Y = STAFF_LINE_GAP * 1.6
const TRILL_STAFF_OFFSET_Y = STAFF_LINE_GAP * 0.65
const TIE_VERTICAL_OFFSET = STAFF_LINE_GAP * 0.88
const SLUR_VERTICAL_OFFSET = STAFF_LINE_GAP * 1.35

/**
 * Position printed rests from the same semantic event stream as notes. Rests
 * use standard Unicode music symbols with music-font fallbacks in CSS; no PDF
 * glyph geometry or source-page spacing reaches this layer.
 */
export function buildStaffLaneRests(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    sourceLayout = null,
  } = {},
) {
  const rests = []
  const laneLayout = sourceLayout ?? { mode: 'temporal-fallback', pixelsPerSecond }
  for (const group of groups ?? []) {
    for (let index = 0; index < (group.rests?.length ?? 0); index += 1) {
      const rest = group.rests[index]
      if (rest.printObject === false) continue
      const objectGeometry = geometryForSourceObject(
        geometry,
        laneLayout,
        rest,
        group,
      )
      const staffKind = resolveStaffKind(rest)
      const staff =
        objectGeometry.staves[staffKind] ?? Object.values(objectGeometry.staves)[0]
      if (!staff) continue
      const noteType = inferredRestType(rest)
      const sourcePosition = sourceYForObject(rest, staffKind, objectGeometry)
      rests.push({
        id: rest.visualRestId ?? `${group.id}-rest-${index}`,
        groupId: group.id,
        status: group.status ?? null,
        laneOutcome: group.laneOutcome ?? null,
        x: resolveSourceFidelityObjectX(
          laneLayout,
          rest,
          group,
          group.timeSeconds ?? rest.timeSeconds ?? 0,
        ),
        y: sourcePosition?.y ?? staff.lines[2],
        sourceYMode: sourcePosition?.sourceYMode ?? 'semantic-fallback',
        staffKind,
        voice: rest.voice ?? 1,
        measureNumber: rest.measureNumber ?? group.measureNumber ?? null,
        durationSeconds: sanitizeVisualDurationSeconds(rest.durationSeconds, 0),
        durationQuarters: rest.durationQuarters ?? null,
        noteType,
        glyph: restGlyphForNoteType(noteType),
        dots: Math.max(0, Math.round(Number(rest.dots) || 0)),
        xOffset: 0,
        visualNoteId: rest.visualRestId ?? rest.id ?? `${group.id}-rest-${index}`,
        markings: rest.markings ?? [],
      })
    }
  }
  return rests
}

/**
 * Flatten visual lane groups into positioned staff notes.
 * x = timeSeconds × pixelsPerSecond — deterministic, no incremental state.
 */
export function buildStaffLaneNotes(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    sourceLayout = null,
  } = {},
) {
  const notes = []
  const laneLayout = sourceLayout ?? { mode: 'temporal-fallback', pixelsPerSecond }
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
      if (note.printObject === false || !isFiniteMidi(note.midi)) {
        continue
      }
      const renderGroup = entry.renderGroup
      const x = resolveSourceFidelityObjectX(
        laneLayout,
        note,
        renderGroup,
        entry.timeSeconds ?? 0,
      )
      const staffKind = resolveStaffKind(note)
      const written = resolveVisualWrittenPitch(note)
      const objectGeometry = geometryForSourceObject(
        geometry,
        laneLayout,
        note,
        renderGroup,
      )
      const semanticPosition = staffYForDiatonic(
        written.diatonic,
        staffKind,
        objectGeometry,
        note.clef,
      )
      const sourcePosition = sourceYForObject(note, staffKind, objectGeometry)
      const { y, ledgerLines } = sourcePosition ?? semanticPosition
      const durationSeconds = sanitizeVisualDurationSeconds(note.durationSeconds, 0)
      const noteType = note.noteType ?? null
      notes.push({
        id: `${renderGroup.id}-${note.midi}-${entryIndex}`,
        groupId: renderGroup.id,
        status: renderGroup.status ?? null,
        laneOutcome: renderGroup.laneOutcome ?? null,
        x,
        xOffset: 0,
        sourceXMode: sourceXModeForObject(note),
        y,
        sourceYMode: sourcePosition?.sourceYMode ?? semanticPosition.sourceYMode,
        sourceDefaultY: sourcePosition?.sourceDefaultY ?? null,
        sourceRelativeY: sourcePosition?.sourceRelativeY ?? null,
        staffKind,
        staffTopY:
          objectGeometry.staves[staffKind]?.lines?.[0] ??
          Object.values(objectGeometry.staves)[0]?.lines?.[0] ??
          y,
        staffBottomY:
          objectGeometry.staves[staffKind]?.lines?.at(-1) ??
          Object.values(objectGeometry.staves)[0]?.lines?.at(-1) ??
          y,
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
        clef: note.clef ?? null,
        measureNumber: note.measureNumber ?? null,
        partId: note.partId ?? null,
        voice: note.voice ?? 1,
        slurs: note.slurs ?? [],
        graceNotesBefore: note.graceNotesBefore ?? [],
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
        prev.xOffset === 0 &&
        !(
          curr.sourceXMode !== VISUAL_LAYOUT_SOURCE.SEMANTIC_FALLBACK &&
          prev.sourceXMode !== VISUAL_LAYOUT_SOURCE.SEMANTIC_FALLBACK &&
          Math.abs(curr.x - prev.x) > 0.001
        )
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

/**
 * Grace notes are visual children of the following principal note. They never
 * enter playback or Wait For You checkpoints. Exact MusicXML X/Y wins when
 * present; coordinate-less scores use a compact lead-in immediately before
 * the owning principal note.
 */
export function buildStaffLaneGraceNotes(
  principalNotes,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    sourceLayout = null,
  } = {},
) {
  const laneLayout = sourceLayout ?? { mode: 'temporal-fallback', pixelsPerSecond }
  const notes = []
  const beams = []
  const slurs = []

  for (const principal of principalNotes ?? []) {
    const sourceGraceNotes = (principal.graceNotesBefore ?? []).filter(
      (grace) => grace?.printObject !== false && isFiniteMidi(grace?.midi),
    )
    if (!sourceGraceNotes.length) continue
    const renderGroup = {
      id: principal.groupId,
      timeSeconds: principal.timeSeconds,
      status: principal.status,
      laneOutcome: principal.laneOutcome,
    }
    const positioned = sourceGraceNotes.map((grace, index) => {
      const staffKind = resolveStaffKind(grace)
      const objectGeometry = geometryForSourceObject(
        geometry,
        laneLayout,
        grace,
        renderGroup,
      )
      const written = resolveVisualWrittenPitch(grace)
      const semanticPosition = staffYForDiatonic(
        written.diatonic,
        staffKind,
        objectGeometry,
        grace.clef,
      )
      const sourcePosition = sourceYForObject(grace, staffKind, objectGeometry)
      const sourceOwnedX = laneLayout.objectXById?.get(
        grace.visualNoteId ?? grace.id,
      )
      const x = Number.isFinite(sourceOwnedX)
        ? sourceOwnedX
        : principal.x + principal.xOffset -
          (sourceGraceNotes.length - index) * GRACE_NOTE_SPACING
      const { y, ledgerLines } = sourcePosition ?? semanticPosition
      const stemDown = grace.stemDirection === 'down'
      const headRx = NOTEHEAD_RX * GRACE_NOTE_SCALE
      const headRy = NOTEHEAD_RY * GRACE_NOTE_SCALE
      const stemX = x + (stemDown ? -headRx : headRx)
      const stemY1 = y
      const stemY2 = stemDown ? y + GRACE_STEM_LENGTH : y - GRACE_STEM_LENGTH
      return {
        ...grace,
        id: `${principal.id}-grace-${index}`,
        principalNoteId: principal.visualNoteId,
        status: principal.status,
        laneOutcome: principal.laneOutcome,
        x,
        y,
        headRx,
        headRy,
        stemDown,
        stemX,
        stemY1,
        stemY2,
        staffKind,
        sourceXMode: Number.isFinite(sourceOwnedX)
          ? grace.sourceLayout?.source ?? 'source-owned'
          : 'semantic-lead-in-fallback',
        sourceYMode: sourcePosition?.sourceYMode ?? semanticPosition.sourceYMode,
        ledgerLines,
        accidentalType: written.accidentalType,
        accidentalGlyph: decoratedAccidentalGlyph(
          written.accidentalGlyph,
          grace.accidental,
        ),
        slash: grace.grace?.slash === true,
        flagCount: (grace.beams?.length ?? 0) > 0
          ? 0
          : flagCountForNoteType(grace.noteType),
      }
    })
    notes.push(...positioned)

    const openBeams = new Map()
    for (const note of positioned) {
      for (const mark of note.beams ?? []) {
        const number = Math.max(1, Math.round(Number(mark.number) || 1))
        const value = String(mark.value ?? '').toLowerCase()
        if (value === 'begin') {
          openBeams.set(number, note)
        } else if (value === 'end') {
          const start = openBeams.get(number)
          if (start) {
            const offset = (number - 1) * STAFF_LINE_GAP * 0.32 *
              (start.stemDown ? -1 : 1)
            beams.push({
              id: `${principal.id}-grace-beam-${number}-${beams.length}`,
              number,
              x1: start.stemX,
              y1: start.stemY2 + offset,
              x2: note.stemX,
              y2: note.stemY2 + offset,
              status: principal.status,
            })
            openBeams.delete(number)
          }
        }
      }
    }

    for (const grace of positioned) {
      const start = (grace.slurs ?? []).find((slur) => slur.type === 'start')
      if (!start) continue
      const matchingStop = (principal.slurs ?? []).find(
        (slur) => slur.type === 'stop' && String(slur.number ?? '1') === String(start.number ?? '1'),
      )
      if (!matchingStop) continue
      const placement = start.placement === 'below' ? 'below' : 'above'
      const direction = placement === 'below' ? 1 : -1
      const x1 = grace.x + grace.headRx * 0.7
      const x2 = principal.x + principal.xOffset - NOTEHEAD_RX * 0.8
      const y1 = grace.y + direction * STAFF_LINE_GAP * 0.55
      const y2 = principal.y + direction * STAFF_LINE_GAP * 0.65
      slurs.push({
        id: `${grace.id}-to-${principal.id}-slur-${start.number ?? '1'}`,
        placement,
        status: principal.status,
        path: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${
          (y1 + y2) / 2 + direction * STAFF_LINE_GAP * 0.8
        } ${x2} ${y2}`,
      })
    }
  }

  return { notes, beams, slurs }
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
    sourceLayout = null,
  } = {},
) {
  const laneLayout = sourceLayout ?? { mode: 'temporal-fallback', pixelsPerSecond }
  const notes =
    prebuiltNotes ??
    buildStaffLaneNotes(groups, geometry, { pixelsPerSecond, sourceLayout: laneLayout })

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
    const headXs = chord.map((note) => note.x + note.xOffset)
    const topY = Math.min(...ys)
    const bottomY = Math.max(...ys)
    const length = STEM_LENGTH_GAPS * STAFF_LINE_GAP

    stems.push({
      id: `stem-${chord[0].groupId}-${chord[0].staffKind}-v${chord[0].voice ?? 1}`,
      groupId: chord[0].groupId,
      staffKind: chord[0].staffKind,
      voice: chord[0].voice ?? 1,
      status: chord[0].status ?? null,
      stemDown,
      x: stemDown
        ? Math.min(...headXs) - noteheadRx
        : Math.max(...headXs) + noteheadRx,
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
  const alignedStems = stems.map((stem) => ({ ...stem }))
  const stemByKey = new Map(
    alignedStems.map((stem) => [`${stem.groupId}:${stem.staffKind}:${stem.voice ?? 1}`, stem]),
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
  const completeGroups = []
  for (const record of records) {
    if (!record.stem || !record.beamOwner) {
      continue
    }
    for (const mark of record.marks) {
      const number = Math.max(1, Math.round(Number(mark.number) || 1))
      const value = String(mark.value ?? '').toLowerCase()
      const key = beamKey(record.beamOwner, number)
      if (value === 'begin') {
        open.set(key, [record])
        continue
      }
      if (value === 'continue') {
        const group = open.get(key)
        if (group) {
          if (group.at(-1) !== record) group.push(record)
        } else {
          // A printed beam can begin on a semantic spacer note marked
          // print-object=no. The spacer is intentionally absent from Visual,
          // so the first visible continuation becomes the reconstructed start.
          open.set(key, [record])
        }
        continue
      }
      if (value === 'end') {
        const group = open.get(key)
        open.delete(key)
        if (!group?.length) {
          continue
        }
        if (group.at(-1) !== record) group.push(record)
        const visible = group.filter((entry) => entry.stem)
        if (visible.length > 1) completeGroups.push({ key, number, records: visible })
        continue
      }
    }
  }

  // The primary beam is the physical stem baseline. Preserve every written
  // stem direction, including cross-staff beams whose stems approach the beam
  // from opposite sides, and extend intermediate stems to the same line.
  for (const group of completeGroups.filter(({ number }) => number === 1)) {
    const start = group.records[0]
    const end = group.records.at(-1)
    const dx = end.stem.x - start.stem.x
    for (const record of group.records.slice(1, -1)) {
      const progress = dx === 0 ? 0 : (record.stem.x - start.stem.x) / dx
      record.stem.y2 = start.stem.y2 + (end.stem.y2 - start.stem.y2) * progress
    }
  }

  for (const group of completeGroups) {
    const start = group.records[0]
    const end = group.records.at(-1)
    const offsetDirection = start.stem.stemDown ? -1 : 1
    const offset = offsetDirection * (group.number - 1) * (STAFF_LINE_GAP * 0.46)
    const staffKinds = [...new Set(group.records.map((record) => record.stem.staffKind))]
    beamMarks.push({
      id: `beam-${group.key}-${start.key}-${end.key}`,
      number: group.number,
      x1: start.stem.x,
      y1: start.stem.y2 + offset,
      x2: end.stem.x,
      y2: end.stem.y2 + offset,
      status: rhythmStatus(start.chord[0], end.chord[0]),
      stemCount: group.records.length,
      crossStaff: staffKinds.length > 1,
    })
  }

  for (const record of records) {
    if (!record.stem || !record.beamOwner) continue
    for (const mark of record.marks) {
      const value = String(mark.value ?? '').toLowerCase()
      if (value !== 'forward hook' && value !== 'backward hook') continue
      const number = Math.max(1, Math.round(Number(mark.number) || 1))
      const key = beamKey(record.beamOwner, number)
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
        stemCount: 1,
        crossStaff: false,
        hook: true,
      })
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

  return { stems: alignedStems, beams: beamMarks, flags, dots }
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

function sourceSystemForStaffNote(laneLayout, note) {
  return resolveSourceFidelitySystem(
    laneLayout,
    { visualNoteId: note?.visualNoteId },
    { id: note?.groupId },
  )
}

function splitStaffSpanAcrossSourceSystems(start, end, marking, laneLayout) {
  const startSystem = sourceSystemForStaffNote(laneLayout, start)
  const endSystem = sourceSystemForStaffNote(laneLayout, end)
  if (
    !startSystem ||
    !endSystem ||
    startSystem.occurrence === endSystem.occurrence ||
    startSystem.occurrence > endSystem.occurrence
  ) {
    return [{
      ...marking,
      path: staffSpanPath(start, end, marking),
      status: marking.status ?? staffSpanStatus(start, end),
    }]
  }

  const systems = (laneLayout.systems ?? []).filter(
    (system) =>
      system.occurrence >= startSystem.occurrence &&
      system.occurrence <= endSystem.occurrence,
  )
  if (systems.length < 2) {
    return [{
      ...marking,
      path: staffSpanPath(start, end, marking),
      status: marking.status ?? staffSpanStatus(start, end),
    }]
  }

  return systems.map((system, index) => {
    const first = index === 0
    const last = index === systems.length - 1
    const progress = systems.length > 1 ? index / (systems.length - 1) : 0
    const boundaryY = start.y + (end.y - start.y) * progress
    const segmentStart = first
      ? start
      : {
          ...end,
          x: system.xStart + STAFF_LINE_GAP - NOTEHEAD_RX * 0.9,
          xOffset: 0,
          y: boundaryY,
        }
    const segmentEnd = last
      ? end
      : {
          ...start,
          x: system.xEnd - STAFF_LINE_GAP + NOTEHEAD_RX * 0.9,
          xOffset: 0,
          y: boundaryY,
        }
    return {
      ...marking,
      id: `${marking.id}-system-${system.occurrence}`,
      path: staffSpanPath(segmentStart, segmentEnd, marking),
      status: marking.status ?? staffSpanStatus(start, end),
      segmentIndex: index,
      segmentCount: systems.length,
      systemOccurrence: system.occurrence,
      continuedFromPrevious: !first,
      continuesToNext: !last,
    }
  })
}

function buildStaffNoteMarkingGeometry(notes) {
  const supportedKinds = new Set([
    VISUAL_MARKING_KIND.STACCATO,
    VISUAL_MARKING_KIND.STACCATISSIMO,
    VISUAL_MARKING_KIND.ACCENT,
    VISUAL_MARKING_KIND.TENUTO,
    VISUAL_MARKING_KIND.MARCATO,
    VISUAL_MARKING_KIND.FERMATA,
    VISUAL_MARKING_KIND.TRILL,
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
      marking.kind === VISUAL_MARKING_KIND.TRILL
        ? placement === 'below'
          ? Math.max(
              anchor.y + TRILL_NOTE_OFFSET_Y,
              anchor.staffBottomY + TRILL_STAFF_OFFSET_Y,
            )
          : Math.min(
              anchor.y - TRILL_NOTE_OFFSET_Y,
              anchor.staffTopY - TRILL_STAFF_OFFSET_Y,
            )
        : anchor.y +
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
      } else if (marking.kind === VISUAL_MARKING_KIND.STACCATISSIMO) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-wedge`,
          shape: 'text',
          text: placement === 'below' ? '▾' : '▴',
          x,
          y,
          fontSize: STAFF_LINE_GAP * 0.82,
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
      } else if (marking.kind === VISUAL_MARKING_KIND.TRILL) {
        markings.push({
          ...common,
          id: `${marking.id}-staff-trill`,
          shape: 'text',
          text: 'tr',
          x,
          y,
          fontSize: STAFF_LINE_GAP * 1.12,
        })
      }
  }
  return markings
}

function buildStaffTremoloGeometry(spans, notesById, stems) {
  const stemFor = (note) => (stems ?? []).find(
    (stem) =>
      stem.groupId === note?.groupId &&
      stem.staffKind === note?.staffKind &&
      Number(stem.voice ?? 1) === Number(note?.voice ?? 1),
  )
  return (spans ?? []).flatMap((span) => {
    const start = notesById.get(span.fromNoteId)
    const end = notesById.get(span.toNoteId)
    const startStem = stemFor(start)
    const endStem = stemFor(end)
    if (!start || !end || !startStem || !endStem || endStem.x <= startStem.x) {
      return []
    }
    const marks = Math.max(1, Math.min(4, Math.round(Number(span.marks) || 1)))
    const startTowardHead = startStem.stemDown ? -1 : 1
    const endTowardHead = endStem.stemDown ? -1 : 1
    return Array.from({ length: marks }, (_, index) => ({
      ...span,
      id: `${span.id}-stroke-${index + 1}`,
      spanId: span.id,
      strokeIndex: index,
      strokeCount: marks,
      x1: startStem.x,
      y1: startStem.y2 + startTowardHead * index * STAFF_LINE_GAP * 0.48,
      x2: endStem.x,
      y2: endStem.y2 + endTowardHead * index * STAFF_LINE_GAP * 0.48,
      status: span.status ?? staffSpanStatus(start, end),
    }))
  })
}

function buildStaffTupletGeometry(spans, notesById, stems, beams) {
  const stemFor = (note) => (stems ?? []).find(
    (stem) =>
      stem.groupId === note?.groupId &&
      stem.staffKind === note?.staffKind &&
      Number(stem.voice ?? 1) === Number(note?.voice ?? 1),
  )
  return (spans ?? []).flatMap((span) => {
    const start = notesById.get(span.fromNoteId)
    const end = notesById.get(span.toNoteId)
    if (!start || !end || end.x <= start.x) return []

    const startStem = stemFor(start)
    const endStem = stemFor(end)
    const x1 = start.x + start.xOffset
    const x2 = end.x + end.xOffset
    const x = (x1 + x2) / 2
    const beam = (beams ?? []).find(
      (candidate) =>
        Number(candidate.number) === 1 &&
        candidate.x1 <= x1 + STAFF_LINE_GAP &&
        candidate.x2 >= x2 - STAFF_LINE_GAP,
    )
    const inferredPlacement =
      span.placement ?? (startStem?.stemDown || endStem?.stemDown ? 'below' : 'above')
    let y
    if (beam) {
      const progress = (x - beam.x1) / Math.max(1e-9, beam.x2 - beam.x1)
      const beamY = beam.y1 + (beam.y2 - beam.y1) * progress
      y = beamY + (inferredPlacement === 'below' ? 1 : -1) * STAFF_LINE_GAP * 0.92
    } else {
      const outerY = inferredPlacement === 'below'
        ? Math.max(start.y, end.y)
        : Math.min(start.y, end.y)
      y = outerY + (inferredPlacement === 'below' ? 1 : -1) * STAFF_LINE_GAP * 1.7
    }
    const actual = Math.max(1, Math.round(Number(span.actualNotes) || 3))
    const normal = Math.max(1, Math.round(Number(span.normalNotes) || 2))
    const label = span.showNumber === 'both' ? `${actual}:${normal}` : String(actual)
    const bracketY = y + (inferredPlacement === 'below' ? -1 : 1) * STAFF_LINE_GAP * 0.18
    const hook = (inferredPlacement === 'below' ? -1 : 1) * STAFF_LINE_GAP * 0.62
    const labelGap = Math.max(STAFF_LINE_GAP * 0.72, label.length * STAFF_LINE_GAP * 0.38)
    const bracketPath = span.renderBracket
      ? `M ${x1} ${bracketY + hook} L ${x1} ${bracketY} L ${x - labelGap} ${bracketY} M ${
          x + labelGap
        } ${bracketY} L ${x2} ${bracketY} L ${x2} ${bracketY + hook}`
      : null
    return [{
      ...span,
      id: `${span.id}-staff-tuplet`,
      spanId: span.id,
      x,
      y,
      x1,
      x2,
      label,
      bracketPath,
      placement: inferredPlacement,
      status: span.status ?? staffSpanStatus(start, end),
    }]
  })
}

export function buildStaffLaneNotationMarkings(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    notes: prebuiltNotes = null,
    stems: prebuiltStems = null,
    beams: prebuiltBeams = null,
    rests: prebuiltRests = null,
    sourceLayout = null,
  } = {},
) {
  const laneLayout = sourceLayout ?? { mode: 'temporal-fallback', pixelsPerSecond }
  const notes =
    prebuiltNotes ??
    buildStaffLaneNotes(groups, geometry, { pixelsPerSecond, sourceLayout: laneLayout })
  const notesById = new Map(notes.map((note) => [note.visualNoteId, note]))
  const stems =
    prebuiltStems ??
    buildStaffLaneStems(groups, geometry, {
      pixelsPerSecond,
      notes,
      sourceLayout: laneLayout,
    })
  const visualSpans = buildVisualSpanMarkings(groups)

  const markingObjects = [
    ...notes,
    ...(prebuiltRests ??
      buildStaffLaneRests(groups, geometry, {
        pixelsPerSecond,
        sourceLayout: laneLayout,
      })),
  ]

  const spanMarkings = visualSpans
    .filter((marking) =>
      marking.kind === VISUAL_MARKING_KIND.TIE || marking.kind === VISUAL_MARKING_KIND.SLUR,
    )
    .flatMap((marking) => {
      const start = notesById.get(marking.fromNoteId)
      let end = notesById.get(marking.toNoteId)
      if (start && !end && marking.toTimeSeconds > marking.fromTimeSeconds) {
        end = {
          ...start,
          x: resolveSourceFidelityLaneX(laneLayout, marking.toTimeSeconds),
        }
      }
      if (!start || !end) {
        return []
      }
      return splitStaffSpanAcrossSourceSystems(
        start,
        end,
        marking,
        laneLayout,
      )
    })
  const tremoloMarkings = buildStaffTremoloGeometry(
    visualSpans.filter((marking) => marking.kind === VISUAL_MARKING_KIND.TREMOLO),
    notesById,
    stems,
  )
  const tupletMarkings = buildStaffTupletGeometry(
    visualSpans.filter((marking) => marking.kind === VISUAL_MARKING_KIND.TUPLET),
    notesById,
    stems,
    prebuiltBeams,
  )

  return {
    noteMarkings: buildStaffNoteMarkingGeometry(markingObjects),
    spanMarkings,
    tremoloMarkings,
    tupletMarkings,
  }
}
