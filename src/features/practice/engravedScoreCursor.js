/**
 * Engraved score cursor geometry.
 *
 * The PDF practice surface gets its red cursor from the PDF's own source-notehead
 * geometry. An Audio Vision arrangement has no PDF, so its cursor must come from
 * the engraved score itself: OSMD has drawn every notehead, and the canonical
 * timing map has already been paired with those engraved notes (see
 * `pairOsmdNotes`). This module turns that pairing into a cursor position.
 *
 * Nothing here schedules audio or decides practice state: it reads the
 * canonical clock's time and reports where the line belongs. The practice
 * clock stays the single source of truth.
 */

/**
 * Bounding box of an engraved notehead, in the SVG's user coordinate system.
 * Returns null when the glyph is not in the DOM (an OSMD note without an
 * exposed notehead SVG).
 */
export function engravedNoteheadBox(engraving) {
  const graphical = engraving?.graphicalNote
  if (!graphical) return null
  let element = null
  try {
    const heads = graphical.getNoteheadSVGs?.() ?? []
    element = heads[0] ?? null
  } catch {
    element = null
  }
  if (!element || typeof element.getBBox !== 'function') return null
  let box
  try {
    box = element.getBBox()
  } catch {
    return null
  }
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return null
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/**
 * Canonical notes in sounding order, with their engraved notehead.
 * Ties and TAB mirrors are excluded from the cursor path: the cursor points at
 * the notation staff's notehead, and a TAB copy is a mirror of the same note.
 */
export function engravedCursorNotes(pairs) {
  if (!pairs?.pairs) return []
  const entries = []
  for (const [note, engravings] of pairs.pairs) {
    if (!note || note.isRest) continue
    if (!Number.isFinite(note.timeSeconds)) continue
    const engraving = (engravings ?? []).find((candidate) => candidate && !candidate.isTab) ?? null
    if (!engraving) continue
    entries.push({ note, engraving })
  }
  entries.sort((a, b) => a.note.timeSeconds - b.note.timeSeconds)
  return entries
}

/**
 * The note sounding at `seconds`, plus the neighbours.
 *
 * `ratio` is the progress through the SILENCE before the sounding note (0 at
 * the end of the previous note, 1 at this note's onset). The line therefore
 * travels across the rest and lands exactly on the notehead as the note
 * sounds, instead of sliding away from a note that is still ringing.
 */
export function soundingEngravedNote(cursorNotes, seconds) {
  if (!cursorNotes.length || !Number.isFinite(seconds)) {
    return { current: null, next: null, previous: null, ratio: 1 }
  }
  let current = null
  for (const entry of cursorNotes) {
    if (entry.note.timeSeconds <= seconds + 1e-6) {
      current = entry
    } else {
      break
    }
  }
  if (!current) {
    // Before the first note: hold the first notehead.
    return { current: cursorNotes[0], next: null, previous: null, ratio: 1 }
  }
  const index = cursorNotes.indexOf(current)
  const next = cursorNotes[index + 1] ?? null
  const previous = index > 0 ? cursorNotes[index - 1] : null
  const previousEnd = previous
    ? previous.note.timeSeconds + Number(previous.note.durationSeconds ?? 0)
    : Number.NaN
  const gapStart = Number.isFinite(previousEnd) ? previousEnd : current.note.timeSeconds
  const gapLength = current.note.timeSeconds - gapStart
  const ratio = gapLength > 1e-6
    ? Math.max(0, Math.min(1, (seconds - gapStart) / gapLength))
    : 1
  return { current, next, previous, ratio }
}

/**
 * Pixel position of a notehead inside the score container.
 *
 * The engraved score is an SVG that scales to the container width, so the
 * SVG's user units are converted with the live scale factor. The container's
 * scroll offset is added so the line stays glued to the scrolling content.
 */
export function noteheadPositionInContainer(box, svg, container) {
  if (!box || !svg || !container) return null
  const svgRect = svg.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  if (!svgRect.width || !containerRect.width) return null
  const viewBox = svg.viewBox?.baseVal
  const viewWidth = viewBox && Number.isFinite(viewBox.width) && viewBox.width > 0
    ? viewBox.width
    : svgRect.width
  const viewX = viewBox && Number.isFinite(viewBox.x) ? viewBox.x : 0
  const viewY = viewBox && Number.isFinite(viewBox.y) ? viewBox.y : 0
  const scale = svgRect.width / viewWidth
  if (!Number.isFinite(scale) || scale <= 0) return null
  const scrollLeft = container.scrollLeft ?? 0
  const scrollTop = container.scrollTop ?? 0
  // The cursor is absolutely positioned inside the container's padding box, so
  // the SVG's offset is measured from the border box and the border width is
  // removed.
  const borderLeft = container.clientLeft ?? 0
  const borderTop = container.clientTop ?? 0
  return {
    left: svgRect.left - containerRect.left + scrollLeft + (box.x - viewX) * scale - borderLeft,
    top: svgRect.top - containerRect.top + scrollTop + (box.y - viewY) * scale - borderTop,
    width: box.width * scale,
    height: box.height * scale,
  }
}
