import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'

/** Human-readable chord label, e.g. "C4 + E4 + G4". */
export function chordLabel(midis) {
  return (midis ?? [])
    .filter((midi) => Number.isFinite(midi))
    .map((midi) => midiToNoteLabel(midi))
    .join(' + ')
}

/** Labels of expected notes not yet matched (for chord "missing" feedback). */
export function missingLabels(expectedMidis, matchedIndices) {
  if (!expectedMidis?.length) {
    return []
  }
  // Defensive: producers pass Sets, but a drifted Array must never crash
  // the whole practice tree (error boundary remount kills the session).
  const isMatched = (index) => {
    if (matchedIndices == null) {
      return false
    }
    if (typeof matchedIndices.has === 'function') {
      return matchedIndices.has(index)
    }
    if (Array.isArray(matchedIndices)) {
      return matchedIndices.includes(index)
    }
    return false
  }
  return expectedMidis
    .map((midi, index) => ({ midi, index }))
    .filter(({ midi, index }) => Number.isFinite(midi) && !isMatched(index))
    .map(({ midi }) => midiToNoteLabel(midi))
}

export function formatExpectedChord(midis) {
  return chordLabel(midis)
}
