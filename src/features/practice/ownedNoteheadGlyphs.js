/** OSMD returns every head in the chord; VexFlow's key index owns one head. */
export function ownedNoteheadGlyphs(note) {
  const graphical = note?.graphicalNote
  if (!graphical) return []
  try {
    const heads = graphical.getNoteheadSVGs?.() ?? []
    if (heads.length <= 1) return heads
    const index = graphical.vfnote?.[1]
    return Number.isInteger(index) && heads[index] ? [heads[index]] : []
  } catch {
    return []
  }
}
