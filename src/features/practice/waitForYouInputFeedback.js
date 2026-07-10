import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'

function formatExpectedChord(midis) {
  return (midis ?? []).map((midi) => midiToNoteLabel(midi)).join(' + ')
}

export const WFY_INPUT_OUTCOME = {
  IDLE: 'idle',
  WRONG: 'wrong',
  CORRECT: 'correct',
  CHORD_PARTIAL: 'chord-partial',
  CHORD_WAITING: 'chord-waiting',
}

/**
 * Derive UI feedback from the latest match evaluation.
 */
export function buildInputFeedback({
  outcome,
  playedMidi,
  expectedMidis,
  matchedIndices,
  isChord,
  chordAsSequence = false,
}) {
  if (!expectedMidis?.length) {
    return {
      outcome: WFY_INPUT_OUTCOME.IDLE,
      message: null,
      tone: 'neutral',
    }
  }

  const playedLabel = playedMidi != null ? midiToNoteLabel(playedMidi) : null
  const matchedCount = matchedIndices?.size ?? 0
  const total = expectedMidis.length

  if (outcome === WFY_INPUT_OUTCOME.WRONG) {
    return {
      outcome,
      message: playedLabel
        ? `Missed / late — ${playedLabel}`
        : 'Missed / late',
      tone: 'error',
      playedMidi,
      playedLabel,
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.CORRECT) {
    return {
      outcome,
      message: isChord
        ? `Chord matched (${total} notes)`
        : `Correct — ${playedLabel ?? 'note'}`,
      tone: 'success',
      playedMidi,
      playedLabel,
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.CHORD_PARTIAL) {
    const remaining = expectedMidis
      .map((midi, index) => ({ midi, index }))
      .filter(({ index }) => !matchedIndices.has(index))
      .map(({ midi }) => midiToNoteLabel(midi))

    return {
      outcome,
      message: remaining.length
        ? `${matchedCount}/${total} — need ${remaining.join(', ')}`
        : `${matchedCount}/${total} matched`,
      tone: 'partial',
      matchedCount,
      total,
      remainingLabels: remaining,
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.CHORD_WAITING) {
    return {
      outcome,
      message: chordAsSequence
        ? `Play ${formatExpectedChord(expectedMidis)} one at a time`
        : `Play ${formatExpectedChord(expectedMidis)} together`,
      tone: 'waiting',
      matchedCount,
      total,
    }
  }

  return {
    outcome: WFY_INPUT_OUTCOME.IDLE,
    message: isChord
      ? chordAsSequence
        ? `Chord practice sequence: play ${formatExpectedChord(expectedMidis)} one at a time`
        : `Play ${formatExpectedChord(expectedMidis)} together`
      : `Play ${midiToNoteLabel(expectedMidis[0])}`,
    tone: 'neutral',
  }
}

export function idleFeedbackForCheckpoint(checkpoint, options = {}) {
  const expectedMidis = checkpoint?.expectedMidis?.length
    ? checkpoint.expectedMidis
    : checkpoint?.expectedMidi != null
      ? [checkpoint.expectedMidi]
      : []

  const feedback = buildInputFeedback({
    outcome: WFY_INPUT_OUTCOME.IDLE,
    expectedMidis,
    matchedIndices: new Set(),
    isChord: Boolean(checkpoint?.isChord),
    chordAsSequence: Boolean(options.chordAsSequence),
  })
  if (expectedMidis.length > 1 && checkpoint?.displayLabel && !options.chordAsSequence) {
    return {
      ...feedback,
      message: checkpoint.displayLabel,
    }
  }
  if (expectedMidis.length > 1 && options.chordAsSequence && checkpoint?.displayLabel) {
    return {
      ...feedback,
      message: `Chord practice sequence: ${checkpoint.displayLabel.replace(/^Play\s+/i, '')}`,
    }
  }
  return feedback
}
