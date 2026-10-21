/**
 * Native notehead feedback.
 *
 * Corranzo's red vertical playback cursor is the primary score-following
 * indicator and is never touched by this module. This is the SECOND layer: the
 * musician's own note recognition, painted onto the ACTUAL engraved notehead
 * so the score itself reports what was played.
 *
 * Everything here is presentation only. The note states come from the existing
 * recognition engine (WFY checkpoints, Play Along lane outcomes); this module
 * only decides how a recognised note is drawn.
 *
 * Design rules (user requirement):
 *   - the notehead keeps its own engraved shape (filled / half / whole);
 *   - a correct note is blue, a note completed with help is yellow, a missed
 *     expected note is red;
 *   - nothing floats above the staff: no dots, no rings, no boxes;
 *   - Preview draws nothing at all — the red cursor and the black engraving
 *     are the whole presentation there.
 */

/** Feedback colours, chosen for contrast on Corranzo's white score paper. */
export const NOTEHEAD_FEEDBACK_COLORS = {
  /** Played correctly. */
  correct: '#1d4ed8',
  /** Completed with help (a hint). */
  assisted: '#a16207',
  /** Expected note that was not played. */
  missed: '#b91c1c',
  /** Soft focus ring for the note the musician is expected to play. */
  focus: '#1d4ed8',
}

export const NOTEHEAD_SHAPE = {
  FILLED: 'filled',
  HALF: 'half',
  WHOLE: 'whole',
}

/**
 * The engraved shape of a notehead, from the note's written type.
 * Half and whole notes are hollow; everything else is a filled head.
 */
export function noteheadShapeForNote(note) {
  const type = String(note?.noteType ?? '').toLowerCase()
  if (type === 'whole' || type === 'breve' || type === 'long') {
    return NOTEHEAD_SHAPE.WHOLE
  }
  if (type === 'half') {
    return NOTEHEAD_SHAPE.HALF
  }
  return NOTEHEAD_SHAPE.FILLED
}

/**
 * Geometry of a notehead inside its own box (0..100 viewBox units).
 * A filled/half head is a slanted oval; a whole head is upright and wider.
 */
export function noteheadGeometryForShape(shape) {
  if (shape === NOTEHEAD_SHAPE.WHOLE) {
    return { cx: 50, cy: 50, rx: 50, ry: 36, rotate: 0, filled: false }
  }
  if (shape === NOTEHEAD_SHAPE.HALF) {
    return { cx: 50, cy: 50, rx: 50, ry: 42, rotate: -20, filled: false }
  }
  return { cx: 50, cy: 50, rx: 50, ry: 42, rotate: -20, filled: true }
}

/**
 * The feedback colour for a practice state, or null when the state should not
 * paint the notehead at all.
 *
 *   completed        -> blue  (the musician played it)
 *   current-partial  -> null  (a chord is half done; the caller paints each
 *                               recognised member blue and leaves the rest
 *                               black)
 *   current          -> null  (black by default; the caller may add a soft
 *                               focus ring)
 *   wrong            -> red   (a wrong attempt flashes the REQUIRED notehead
 *                               red — it never lights a correct note and
 *                               never advances the score)
 *   missed           -> red   (Play Along: an expected note that was not played)
 */
export function feedbackColorForState(state, { assisted = false } = {}) {
  switch (state) {
    case 'completed':
      return assisted ? NOTEHEAD_FEEDBACK_COLORS.assisted : NOTEHEAD_FEEDBACK_COLORS.correct
    case 'missed':
    case 'wrong':
      return NOTEHEAD_FEEDBACK_COLORS.missed
    default:
      return null
  }
}

/**
 * Map a notehead box back to the note it belongs to, so the drawn shape
 * matches the engraving. Boxes carry the source notehead id; the checkpoint's
 * notes carry the same id plus the written note type.
 */
export function buildNoteBySourceId(notes) {
  const map = new Map()
  for (const note of notes ?? []) {
    const id = note?.sourceNoteheadId
    if (id == null) continue
    if (!map.has(id)) {
      map.set(id, note)
    }
  }
  return map
}

/**
 * The notehead boxes of one practice entry, each with the shape of the note
 * it belongs to.
 *
 * The highlight owns one box per note of the checkpoint, in the same order, so
 * a box and its note are matched by index — and by the printed notehead id
 * when the score owns exact geometry.
 *
 * A box taken from the printed notehead IS that head's own extent and is used
 * as-is. A layout-derived box is only a small marker around the note's
 * position, so the head is sized from the staff instead.
 */
export function noteheadBoxesForEntry(entry) {
  const target = entry?.target
  const notes = entry?.checkpoint?.notes ?? []
  const bySourceId = buildNoteBySourceId(notes)
  const size = target?.noteheadSize ?? null

  // Preferred source: the event's own note placements — one per note, with
  // the printed notehead's own extent when the score owns exact geometry.
  const placements = Array.isArray(target?.notePlacements) ? target.notePlacements : null
  if (placements && placements.length > 0) {
    return placements.map((placement, index) => {
      const note = placement.sourceNoteheadId != null
        ? (bySourceId.get(placement.sourceNoteheadId) ?? notes[index] ?? null)
        : (notes[index] ?? null)
      const rect = placement.sourceBBox
        ? placement.sourceBBox
        : noteheadRectAt(placement, size)
      return {
        sourceNoteheadId: placement.sourceNoteheadId ?? null,
        midi: Number.isFinite(placement.midi) ? placement.midi : (note?.midi ?? null),
        shape: noteheadShapeForNote(note),
        rect,
      }
    })
  }

  // Fallback: the highlight's own per-note boxes.
  const highlight = target?.highlight
  if (!highlight) {
    return []
  }
  const boxes = Array.isArray(highlight.noteBoxes) ? highlight.noteBoxes : []
  if (boxes.length === 0) {
    return []
  }
  return boxes.map((box, index) => {
    const note =
      box.sourceNoteheadId != null
        ? (bySourceId.get(box.sourceNoteheadId) ?? notes[index] ?? null)
        : (notes[index] ?? null)
    const exact = box.sourceNoteheadId != null
    let rect = box
    if (!exact && size) {
      const cx = (box.x0 + box.x1) / 2
      const cy = (box.y0 + box.y1) / 2
      rect = {
        x0: cx - size.width / 2,
        y0: cy - size.height / 2,
        x1: cx + size.width / 2,
        y1: cy + size.height / 2,
      }
    }
    return {
      sourceNoteheadId: box.sourceNoteheadId ?? null,
      midi: Number.isFinite(box.midi) ? box.midi : (note?.midi ?? null),
      shape: noteheadShapeForNote(note),
      rect,
    }
  })
}

/** A notehead-sized box centred on a note's position. */
function noteheadRectAt(placement, size) {
  if (!size || !Number.isFinite(placement?.x) || !Number.isFinite(placement?.y)) {
    return null
  }
  return {
    x0: placement.x - size.width / 2,
    y0: placement.y - size.height / 2,
    x1: placement.x + size.width / 2,
    y1: placement.y + size.height / 2,
  }
}
