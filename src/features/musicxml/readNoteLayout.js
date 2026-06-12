import { asNumber } from './xmlUtils.js'

/**
 * MusicXML note layout attributes (tenths / staff-relative when present).
 */
export function readNoteLayout(noteNode) {
  if (!noteNode) {
    return {
      defaultX: null,
      defaultY: null,
      relativeX: null,
      relativeY: null,
      staff: null,
    }
  }

  const defaultX = asNumber(noteNode['@_default-x'], NaN)
  const defaultY = asNumber(noteNode['@_default-y'], NaN)
  const relativeX = asNumber(noteNode['@_relative-x'], NaN)
  const relativeY = asNumber(noteNode['@_relative-y'], NaN)
  const staffRaw = noteNode.staff ?? noteNode['@_staff']
  const staff = asNumber(staffRaw, NaN)

  return {
    defaultX: Number.isFinite(defaultX) ? defaultX : null,
    defaultY: Number.isFinite(defaultY) ? defaultY : null,
    relativeX: Number.isFinite(relativeX) ? relativeX : null,
    relativeY: Number.isFinite(relativeY) ? relativeY : null,
    staff: Number.isFinite(staff) && staff > 0 ? staff : null,
  }
}

export function noteHasLayout(layout) {
  if (!layout) {
    return false
  }
  return (
    layout.defaultX != null ||
    layout.defaultY != null ||
    layout.relativeX != null ||
    layout.relativeY != null ||
    layout.staff != null
  )
}
