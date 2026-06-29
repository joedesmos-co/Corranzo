/**
 * Deduplicate detected noteheads without collapsing spatially distinct heads
 * that share a mapped MIDI (common in dense scores when pitch mapping overlaps).
 */

export function noteheadDedupeKey(note) {
  const cxBucket = Number.isFinite(note?.cx) ? Math.round(note.cx / 6) : 0
  const cyBucket = Number.isFinite(note?.cy) ? Math.round(note.cy / 6) : 0
  const clef = note?.clef ?? 'treble'
  const midi = note?.midi ?? note?.naturalMidi ?? -1
  return `${clef}:${midi}:${cxBucket}:${cyBucket}`
}

export function dedupeNoteheads(notes = []) {
  const seen = new Set()
  const deduped = []
  for (const note of notes) {
    const key = noteheadDedupeKey(note)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(note)
  }
  return deduped
}

/** @deprecated alias — use dedupeNoteheads */
export function dedupeNotesByMidi(notes = []) {
  return dedupeNoteheads(notes)
}
