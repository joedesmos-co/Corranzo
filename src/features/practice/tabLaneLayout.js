import { VISUAL_LANE_DEFAULTS } from './visualPracticeLane.js'

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
    for (let index = 0; index < (group.notes?.length ?? 0); index += 1) {
      const note = group.notes[index]
      if (note.midi == null) {
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
      notes.push({
        id: `${group.id}-s${position.string}-${index}`,
        groupId: group.id,
        status: group.status ?? null,
        x,
        y: yForString(position.string, geometry),
        string: position.string,
        fret: position.fret,
        midi: note.midi,
        label: note.label,
        durationSeconds: note.durationSeconds ?? 0,
      })
    }
  }

  notes.unplacedCount = unplacedCount
  return notes
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
    if (note.midi == null) {
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
