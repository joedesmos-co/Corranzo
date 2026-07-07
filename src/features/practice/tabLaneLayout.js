import { VISUAL_LANE_DEFAULTS } from './visualLaneConstants.js'
import { resolveLaneNoteClass } from './visualLaneFeedback.js'
import {
  VISUAL_GUITAR_TECHNIQUE_SYMBOLS,
  VISUAL_MARKING_KIND,
  buildVisualSpanMarkings,
} from './visualNotationMarkings.js'
import { isFiniteMidi, sanitizeVisualDurationSeconds } from './visualNoteSanitize.js'

/**
 * Tablature-lane layout for Visual practice mode (fretted instruments).
 *
 * Pure geometry, the fretboard sibling of staffLaneLayout.js: maps the same
 * visual lane groups (built from Wait For You note checkpoints) onto
 * horizontal string lines — string 1 (highest) on top, exactly like printed
 * tablature — with fret numbers at deterministic x positions
 * (seconds × pixelsPerSecond). The scrolling offset is applied elsewhere as a
 * single transform; no timing logic lives here.
 */

/** Vertical distance between adjacent string lines, in SVG units. */
export const TAB_LINE_GAP = 15

/** Margin above/below the string block, in line gaps. */
const TAB_MARGIN_GAPS = 2.5

/** Fret-number disc radius, in SVG units. */
export const FRET_DISC_RADIUS = 8.6

export const FRETBOARD_DISPLAY_START_FRET = 1
export const FRETBOARD_DISPLAY_MIN_END_FRET = 6
const TECHNIQUE_TEXT_OFFSET_Y = TAB_LINE_GAP * 0.92
const TECHNIQUE_ARC_OFFSET_Y = TAB_LINE_GAP * 0.7

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function pitchClassName(midi) {
  return PITCH_CLASS_NAMES[((midi % 12) + 12) % 12]
}

/**
 * String-line geometry for a string config ({ count, tuning }).
 * `lines[i]` is the y of string i+1 (string 1 = top line).
 */
export function buildTabGeometry(strings) {
  const stringCount = strings?.count ?? strings?.tuning?.length ?? 6
  const margin = TAB_MARGIN_GAPS * TAB_LINE_GAP
  const lines = Array.from({ length: stringCount }, (_, index) => margin + index * TAB_LINE_GAP)
  return {
    stringCount,
    lines,
    height: margin * 2 + (stringCount - 1) * TAB_LINE_GAP,
    /** Open-string names top-down (e.g. E B G D A E), for the static labels. */
    stringLabels: (strings?.tuning ?? []).map((midi) => pitchClassName(midi)),
  }
}

/** y for a 1-based string number. */
export function yForString(stringNumber, geometry) {
  const index = Math.min(
    Math.max(0, (stringNumber ?? 1) - 1),
    geometry.lines.length - 1,
  )
  return geometry.lines[index]
}

/**
 * Flatten visual lane groups into positioned tab notes.
 *
 * Positions resolve from the note itself (explicit MusicXML/OMR string+fret)
 * or the supplied `positions` map (note.id → { string, fret }) produced by
 * getTabPositionsForTimingMap. Notes with no resolvable position are skipped
 * (counted in `unplacedCount`) rather than guessed at render time.
 */
export function buildTabLaneNotes(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    positions = null,
  } = {},
) {
  const notes = []
  let unplacedCount = 0

  for (const group of groups ?? []) {
    const x = group.timeSeconds * pixelsPerSecond
    const durations = (group.notes ?? []).map((note) =>
      sanitizeVisualDurationSeconds(note.durationSeconds, 0.25),
    )
    const groupDuration = durations.length ? Math.max(...durations, 0.25) : 0.25
    const groupSustainWidth = Math.max(FRET_DISC_RADIUS * 1.6, groupDuration * pixelsPerSecond)
    for (let index = 0; index < (group.notes?.length ?? 0); index += 1) {
      const note = group.notes[index]
      if (!isFiniteMidi(note.midi)) {
        continue
      }
      const explicit =
        note.string != null && note.fret != null
          ? { string: note.string, fret: note.fret }
          : null
      const position = explicit ?? positions?.get(note.id) ?? null
      if (!position) {
        unplacedCount += 1
        continue
      }
      const durationSeconds = sanitizeVisualDurationSeconds(note.durationSeconds, 0.25)
      const sustainWidth = group.isChord
        ? groupSustainWidth
        : Math.max(FRET_DISC_RADIUS * 1.6, durationSeconds * pixelsPerSecond)
      notes.push({
        id: `${group.id}-s${position.string}-${index}`,
        groupId: group.id,
        status: group.status ?? null,
        laneOutcome: group.laneOutcome ?? null,
        x,
        y: yForString(position.string, geometry),
        string: position.string,
        fret: position.fret,
        midi: note.midi,
        label: note.label,
        durationSeconds,
        sustainWidth,
        isChord: Boolean(group.isChord),
        visualNoteId: note.visualNoteId ?? note.id ?? `${group.id}-${index}`,
        sourceNoteId: note.sourceNoteId ?? note.id ?? null,
        markings: note.markings ?? [],
      })
    }
  }

  notes.unplacedCount = unplacedCount
  return notes
}

/** Vertical band behind guitar chord / double-stop sustain shapes. */
export function buildTabChordShapeOverlays(notes = []) {
  const byGroup = new Map()
  for (const note of notes) {
    if (!note.isChord) {
      continue
    }
    const list = byGroup.get(note.groupId) ?? []
    list.push(note)
    byGroup.set(note.groupId, list)
  }
  const overlays = []
  for (const [groupId, groupNotes] of byGroup.entries()) {
    if (groupNotes.length < 2) {
      continue
    }
    const sustainWidth = Math.max(...groupNotes.map((note) => note.sustainWidth ?? 0))
    overlays.push({
      id: `${groupId}-shape`,
      x: groupNotes[0].x,
      minY: Math.min(...groupNotes.map((note) => note.y)),
      maxY: Math.max(...groupNotes.map((note) => note.y)),
      width: Math.max(FRET_DISC_RADIUS * 2.4, sustainWidth),
      status: groupNotes[0].status ?? 'upcoming',
      laneOutcome: groupNotes[0].laneOutcome ?? null,
    })
  }
  return overlays
}

/**
 * Strings + frets for the target strip under the lane: which (string, fret)
 * positions the player should form right now.
 */
export function buildTargetPositions(targetGroup, positions = null) {
  if (!targetGroup?.notes?.length) {
    return []
  }
  const result = []
  for (const note of targetGroup.notes) {
    if (!isFiniteMidi(note.midi)) {
      continue
    }
    const explicit =
      note.string != null && note.fret != null
        ? { string: note.string, fret: note.fret }
        : null
    const position = explicit ?? positions?.get(note.id) ?? null
    if (position) {
      result.push({ ...position, midi: note.midi, label: note.label })
    }
  }
  return result
}

/**
 * Fretboard markers are physical finger placements. Open strings are still
 * valid TAB targets, but they do not get a fret dot on the fretboard strip.
 */
export function buildFretboardTargetPositions(targetGroup, positions = null) {
  return buildTargetPositions(targetGroup, positions).filter(
    (position) => Number(position.fret) > 0,
  )
}

/**
 * Fretboard display columns are visual frets, not TAB values. Open strings are
 * described in labels and shown as 0 in TAB, but the strip starts at fret 1.
 */
export function buildFretboardDisplayFrets(
  targets = [],
  {
    startFret = FRETBOARD_DISPLAY_START_FRET,
    minEndFret = FRETBOARD_DISPLAY_MIN_END_FRET,
  } = {},
) {
  const start = Math.max(1, Math.round(Number(startFret) || FRETBOARD_DISPLAY_START_FRET))
  const minEnd = Math.max(start, Math.round(Number(minEndFret) || FRETBOARD_DISPLAY_MIN_END_FRET))
  const maxTargetFret = (targets ?? []).reduce((max, target) => {
    const fret = Number(target?.fret)
    return Number.isFinite(fret) && fret > 0 ? Math.max(max, Math.round(fret)) : max
  }, 0)
  const end = Math.max(minEnd, maxTargetFret)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function tabTechniqueStatus(start, end) {
  if (start.status === 'current' || end.status === 'current') {
    return 'current'
  }
  if (start.status === 'past' && end.status === 'past') {
    return 'past'
  }
  return end.status ?? start.status ?? null
}

function tabArcPath(start, end) {
  const x1 = start.x
  const x2 = Math.max(x1 + TAB_LINE_GAP, end.x)
  const yBase = Math.min(start.y, end.y) - TECHNIQUE_ARC_OFFSET_Y
  const arch = Math.max(TAB_LINE_GAP * 0.8, Math.min(TAB_LINE_GAP * 1.8, (x2 - x1) * 0.16))
  return `M ${x1} ${yBase} Q ${(x1 + x2) / 2} ${yBase - arch} ${x2} ${yBase}`
}

function slideSymbol(start, end) {
  return end.y <= start.y ? '/' : '\\'
}

export function buildTabLaneTechniqueMarkings(
  groups,
  geometry,
  {
    pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
    positions = null,
    notes: prebuiltNotes = null,
  } = {},
) {
  const notes = prebuiltNotes ?? buildTabLaneNotes(groups, geometry, { pixelsPerSecond, positions })
  const notesById = new Map(notes.map((note) => [note.visualNoteId, note]))
  const markings = []

  for (const note of notes) {
    for (const marking of note.markings ?? []) {
      if (
        marking.kind !== VISUAL_MARKING_KIND.BEND &&
        marking.kind !== VISUAL_MARKING_KIND.VIBRATO
      ) {
        continue
      }
      markings.push({
        ...marking,
        id: `${marking.id}-tab-technique`,
        render: 'text',
        text: VISUAL_GUITAR_TECHNIQUE_SYMBOLS[marking.kind] ?? marking.symbol,
        x: note.x,
        y: note.y - TECHNIQUE_TEXT_OFFSET_Y,
        status: note.status,
      })
    }
  }

  for (const span of buildVisualSpanMarkings(groups)) {
    if (
      span.kind !== VISUAL_MARKING_KIND.HAMMER_ON &&
      span.kind !== VISUAL_MARKING_KIND.PULL_OFF &&
      span.kind !== VISUAL_MARKING_KIND.SLIDE
    ) {
      continue
    }
    const start = notesById.get(span.fromNoteId)
    const end = notesById.get(span.toNoteId)
    if (!start || !end) {
      continue
    }
    const status = span.status ?? tabTechniqueStatus(start, end)
    if (span.kind === VISUAL_MARKING_KIND.SLIDE) {
      const text = slideSymbol(start, end)
      markings.push({
        ...span,
        id: `${span.id}-tab-slide-line`,
        render: 'line',
        x1: start.x + FRET_DISC_RADIUS * 0.85,
        y1: start.y,
        x2: end.x - FRET_DISC_RADIUS * 0.85,
        y2: end.y,
        text,
        textX: (start.x + end.x) / 2,
        textY: (start.y + end.y) / 2 - TAB_LINE_GAP * 0.45,
        status,
      })
    } else {
      markings.push({
        ...span,
        id: `${span.id}-tab-arc`,
        render: 'arc',
        path: tabArcPath(start, end),
        text: VISUAL_GUITAR_TECHNIQUE_SYMBOLS[span.kind],
        textX: (start.x + end.x) / 2,
        textY: Math.min(start.y, end.y) - TECHNIQUE_TEXT_OFFSET_Y,
        status,
      })
    }
  }

  return markings
}
