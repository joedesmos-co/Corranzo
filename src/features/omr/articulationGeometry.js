/**
 * Shared geometry helpers for per-note articulations (staccato, accent, …).
 *
 * Staff-space must not depend solely on a note's assigned clef: mis-cleffed
 * heads on a grand staff can see a near-zero bass/treble gap and reject valid
 * marks that sit a few spaces above the chord.
 */

export function staffSpacePixelsForArticulation(measureBox, imageData, clef = null) {
  const gaps = []
  for (const role of ['treble', 'bass']) {
    const lines = measureBox?.staffLines?.[role]
    if (!lines?.length || lines.length < 2) {
      continue
    }
    const gap = Math.abs(lines[1] - lines[0]) * imageData.height
    if (Number.isFinite(gap) && gap >= 4) {
      gaps.push(gap)
    }
  }
  let preferred = null
  if (clef === 'treble' || clef === 'bass') {
    const lines = measureBox?.staffLines?.[clef]
    if (lines?.length >= 2) {
      const gap = Math.abs(lines[1] - lines[0]) * imageData.height
      if (Number.isFinite(gap) && gap >= 4) {
        preferred = gap
      }
    }
  }
  const raw = preferred != null ? Math.max(preferred, ...gaps) : gaps.length ? Math.max(...gaps) : 8
  // Articulation placement is unstable when staff-gap estimation collapses
  // below a typical notehead diameter; floor to a conservative working space.
  return Math.max(raw, 10)
}

/**
 * One articulation glyph above/below a chord applies to every vertically stacked
 * head that shares the attack column — matching common MusicXML encoding.
 */
export function broadcastArticulationToChordMates(
  assignments,
  notes,
  seedIndex,
  articulation,
  staffSpace,
) {
  const seed = notes[seedIndex]
  if (!seed) {
    return
  }
  const maxDx = staffSpace * 0.75
  const maxDy = staffSpace * 4.5
  for (let index = 0; index < notes.length; index += 1) {
    if (index === seedIndex || assignments.has(index)) {
      continue
    }
    const note = notes[index]
    if (Math.abs(note.cx - seed.cx) > maxDx) {
      continue
    }
    if (Math.abs(note.cy - seed.cy) > maxDy) {
      continue
    }
    if (seed.clef && note.clef && seed.clef !== note.clef) {
      continue
    }
    assignments.set(index, { ...articulation })
  }
}
