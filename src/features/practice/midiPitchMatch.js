/**
 * Apply transposition offset to the played MIDI note before comparison.
 * Positive offset means the keyboard sounds higher than written
 * (e.g. offset +2: playing written C4 is heard as D4).
 */
export function applyTransposition(playedMidi, transpositionOffset) {
  return playedMidi - (transpositionOffset || 0)
}

export function pitchClass(midi) {
  return ((midi % 12) + 12) % 12
}

/**
 * Whether a played note matches an expected pitch under tolerance settings.
 */
export function pitchMatches(playedMidi, expectedMidi, settings) {
  const adjusted = applyTransposition(playedMidi, settings.transpositionOffset)

  if (adjusted === expectedMidi) {
    return true
  }

  if (settings.allowOctaveMistakes) {
    return pitchClass(adjusted) === pitchClass(expectedMidi)
  }

  return false
}

/**
 * Find the first unmatched expected index that matches the played note.
 */
export function findMatchingExpectedIndex(playedMidi, expectedMidis, matchedIndices, settings) {
  for (let index = 0; index < expectedMidis.length; index += 1) {
    if (matchedIndices.has(index)) {
      continue
    }
    if (pitchMatches(playedMidi, expectedMidis[index], settings)) {
      return index
    }
  }
  return null
}

/**
 * Whether any expected pitch matches the played note (for wrong-note detection).
 */
export function matchesAnyExpected(playedMidi, expectedMidis, settings) {
  return expectedMidis.some((expected) => pitchMatches(playedMidi, expected, settings))
}
