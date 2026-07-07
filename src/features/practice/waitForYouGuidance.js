import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import { WFY_INPUT_OUTCOME } from './waitForYouInputFeedback.js'
import { getExpectedMidis } from './waitForYouNoteMatch.js'
import { chordLabel, missingLabels } from './waitForYouLabels.js'
import { describeTabPosition } from '../instruments/fretboard.js'
import { HINT_AFTER_WRONG_ATTEMPTS, WFY_GUIDANCE } from './waitForYouGuidanceConstants.js'

export { chordLabel, missingLabels } from './waitForYouLabels.js'
export { HINT_AFTER_WRONG_ATTEMPTS, WFY_GUIDANCE } from './waitForYouGuidanceConstants.js'

/**
 * Wait For You guidance layer (pure). Turns the current checkpoint + the latest
 * input result + how the attempt is going (wrong-attempt count, timeout, explicit
 * hint request) into a single "what should I tell the player" object the UI can
 * render directly. Keeps all the assistant wording in one tested place.
 */

export function expectedLabelFor(expectedMidis, checkpoint = null) {
  if (checkpoint?.chordSymbol) {
    return checkpoint.chordSymbol
  }
  if (!expectedMidis?.length) return null
  return expectedMidis.length > 1 ? chordLabel(expectedMidis) : midiToNoteLabel(expectedMidis[0])
}

function conciseChordName(expectedMidis, checkpoint = null) {
  if (checkpoint?.chordSymbol) {
    return `${checkpoint.chordSymbol} chord`
  }
  if (checkpoint?.displayLabel) {
    return checkpoint.displayLabel.replace(/^Play\s+/i, '')
  }
  return `${expectedMidis.length}-note chord`
}

/**
 * "right hand" / "left hand" when every note in the checkpoint is on one staff
 * (treble = 1 ≈ right, bass = 2 ≈ left). Null when mixed/unknown — and null
 * for instruments without a grand staff (a guitar has no per-staff hands).
 */
export function staffHandHint(checkpoint, instrument = null) {
  if (instrument && !instrument.notation?.grandStaff) {
    return null
  }
  const staves = new Set(
    (checkpoint?.notes ?? [])
      .map((n) => n?.staff)
      .filter((s) => s === 1 || s === 2),
  )
  if (staves.size !== 1) return null
  return staves.has(1) ? 'right hand' : 'left hand'
}

/**
 * Fretted-instrument position phrase for the checkpoint's notes, e.g.
 * "fret 2 · D string" or "open A string + fret 3 · B string". Null for
 * keyboard instruments or when no positions are known.
 */
export function positionHintForCheckpoint(checkpoint, { strings = null, tabPositions = null } = {}) {
  if (!strings || !checkpoint?.notes?.length) {
    return null
  }
  const parts = []
  for (const note of checkpoint.notes) {
    if (note?.midi == null) {
      continue
    }
    const position =
      note.string != null && note.fret != null
        ? { string: note.string, fret: note.fret }
        : tabPositions?.get(note.id) ?? null
    const label = position ? describeTabPosition(position, strings) : null
    if (label) {
      parts.push(label)
    }
  }
  return parts.length ? parts.join(' + ') : null
}

/**
 * Escalating hint that gets more specific the more times the player is wrong:
 *   1 → gentle nudge, 2 → reveal the note, 3+ → reveal note + which hand
 * (piano) or fretboard position (guitar).
 */
export function buildEscalatingHint({
  expectedMidis,
  wrongAttempts,
  checkpoint,
  instrument = null,
  strings = null,
  tabPositions = null,
  chordAsSequence = false,
  guitarChordShapeMode = false,
  rollingChordMicMode = false,
}) {
  if (!expectedMidis?.length || wrongAttempts <= 0) return null
  const isChord = expectedMidis.length > 1
  const label = expectedLabelFor(expectedMidis, checkpoint)
  if (guitarChordShapeMode || rollingChordMicMode) {
    if (wrongAttempts === 1) {
      return rollingChordMicMode && !guitarChordShapeMode
        ? 'Not quite — play the chord again.'
        : 'Not quite — strum the highlighted shape again.'
    }
    if (wrongAttempts === 2) {
      return checkpoint?.displayLabel ?? (guitarChordShapeMode ? 'Play this shape.' : 'Play this chord.')
    }
    const position = positionHintForCheckpoint(checkpoint, { strings, tabPositions })
    const fallback = checkpoint?.displayLabel ?? (guitarChordShapeMode ? 'Play this shape.' : 'Play this chord.')
    return position ? `${fallback} (${position.replace(/ \+ /g, ', ')})` : fallback
  }
  if (wrongAttempts === 1) return 'Not quite — try again.'
  if (wrongAttempts === 2) return `Expected ${label}.`
  const position = positionHintForCheckpoint(checkpoint, { strings, tabPositions })
  if (position) {
    if (isChord && chordAsSequence) {
      return `Play ${label} one at a time (${position}).`
    }
    return isChord ? `Play ${label} together (${position}).` : `Play ${label} (${position}).`
  }
  const hand = staffHandHint(checkpoint, instrument)
  if (isChord && chordAsSequence) {
    return `Play ${label} one at a time${hand ? ` with your ${hand}` : ''}.`
  }
  if (isChord) return `Play ${label} together${hand ? ` with your ${hand}` : ''}.`
  return `Play ${label}${hand ? ` with your ${hand}` : ''}.`
}

/** Plain "play this" hint used on timeout or when the player asks for help. */
export function buildTargetHint({
  expectedMidis,
  chordAsSequence = false,
  checkpoint = null,
  guitarChordShapeMode = false,
  rollingChordMicMode = false,
}) {
  if (guitarChordShapeMode || rollingChordMicMode) {
    return checkpoint?.displayLabel ?? (guitarChordShapeMode ? 'Play this shape' : 'Play this chord')
  }
  if (expectedMidis?.length > 1 && checkpoint?.displayLabel && !chordAsSequence) {
    return checkpoint.displayLabel
  }
  const label = expectedLabelFor(expectedMidis, checkpoint)
  if (!label) return null
  return chordAsSequence && expectedMidis.length > 1
    ? `Chord practice sequence: ${conciseChordName(expectedMidis, checkpoint)}`
    : `Play ${label}`
}

/**
 * Single source of truth for what to display in Wait For You.
 */
export function buildGuidance({
  checkpoint,
  inputFeedback,
  wrongAttempts = 0,
  timedOut = false,
  hintRequested = false,
  complete = false,
  matchingActive = true,
  instrument = null,
  strings = null,
  tabPositions = null,
  chordAsSequence = false,
  guitarChordShapeMode = false,
  rollingChordMicMode = false,
}) {
  const expectedMidis = getExpectedMidis(checkpoint)
  const isChord = expectedMidis.length > 1
  const expectedLabel = expectedLabelFor(expectedMidis, checkpoint)
  const outcome = inputFeedback?.outcome ?? WFY_INPUT_OUTCOME.IDLE
  const playedLabel = inputFeedback?.playedLabel ?? null

  const base = {
    expectedMidis,
    expectedLabel,
    isChord,
    playedLabel,
    missingLabels: [],
    hint: null,
    showTarget: false,
  }

  if (complete) {
    return { ...base, state: WFY_GUIDANCE.COMPLETE, tone: 'success', primary: 'Section complete' }
  }
  if (!expectedMidis.length) {
    return { ...base, state: WFY_GUIDANCE.WAITING, tone: 'neutral', primary: 'Continue when ready' }
  }

  if (outcome === WFY_INPUT_OUTCOME.CORRECT) {
    return {
      ...base,
      state: WFY_GUIDANCE.CORRECT,
      tone: 'success',
      primary: isChord
        ? (chordAsSequence
            ? 'Sequence complete — nice!'
            : guitarChordShapeMode
              ? 'Chord shape — nice!'
              : rollingChordMicMode
                ? 'Chord — nice!'
                : 'Chord — nice!')
        : 'Correct!',
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.WRONG) {
    return {
      ...base,
      state: WFY_GUIDANCE.WRONG,
      tone: 'error',
      primary: 'Missed / late',
      playedLabel,
      hint: buildEscalatingHint({
        expectedMidis,
        wrongAttempts,
        checkpoint,
        instrument,
        strings,
        tabPositions,
        chordAsSequence,
        guitarChordShapeMode,
        rollingChordMicMode,
      }),
      // After enough wrong tries, surface the target on the score too.
      showTarget: wrongAttempts >= HINT_AFTER_WRONG_ATTEMPTS,
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.CHORD_PARTIAL) {
    const heard = inputFeedback?.heardLabels ?? []
    const missing =
      inputFeedback?.remainingLabels ??
      missingLabels(expectedMidis, inputFeedback?.matchedIndices)
    let primary = missing.length
      ? guitarChordShapeMode || rollingChordMicMode
        ? `Heard part of the chord — need ${Math.max(1, (checkpoint?.minimumRequiredTones ?? checkpoint?.minimumChordTonesRequired ?? 2) - (inputFeedback?.matchedCount ?? heard.length))} more tone(s)`
        : `Still need ${missing.join(', ')}`
      : chordAsSequence
        ? 'Sequence almost complete'
        : guitarChordShapeMode
          ? 'Almost — keep strumming the shape'
          : rollingChordMicMode
            ? 'Almost — keep playing the chord'
            : 'Almost — hold the chord'
    if (heard.length && missing.length && !guitarChordShapeMode && !rollingChordMicMode) {
      primary = `Heard ${heard.join(' + ')} — still need ${missing.join(', ')}`
    } else if (heard.length && !missing.length) {
      primary = `Heard ${heard.join(' + ')}`
    }
    return {
      ...base,
      state: WFY_GUIDANCE.PARTIAL,
      tone: 'partial',
      primary,
      missingLabels: missing,
      heardLabels: heard,
    }
  }

  // No definitive input yet. Show a hint if the player asked or waited too long.
  if (hintRequested || timedOut) {
    return {
      ...base,
      state: WFY_GUIDANCE.HINT,
      tone: 'hint',
      primary: buildTargetHint({ expectedMidis, chordAsSequence, checkpoint, guitarChordShapeMode, rollingChordMicMode }),
      hint:
        buildEscalatingHint({
          expectedMidis,
          wrongAttempts,
          checkpoint,
          instrument,
          strings,
          tabPositions,
          chordAsSequence,
        }) ??
        positionHintForCheckpoint(checkpoint, { strings, tabPositions }) ??
        (timedOut ? 'Take your time — here is the note.' : null),
      showTarget: true,
    }
  }

  return {
    ...base,
    state: WFY_GUIDANCE.WAITING,
    tone: 'neutral',
    primary: matchingActive
      ? isChord
        ? guitarChordShapeMode
          ? checkpoint?.displayLabel ?? 'Play this shape'
          : rollingChordMicMode
            ? checkpoint?.displayLabel ?? 'Play this chord'
            : chordAsSequence
              ? checkpoint?.chordSymbol
                ? `Play ${checkpoint.chordSymbol} chord tones one at a time`
                : `Chord practice sequence: ${conciseChordName(expectedMidis, checkpoint)}`
              : checkpoint?.displayLabel
                ? checkpoint.displayLabel
                : checkpoint?.chordSymbol
                  ? `Play the ${checkpoint.chordSymbol} chord`
                  : `Play ${expectedMidis.length}-note chord`
        : `Play ${expectedLabel}`
      : `Play ${expectedLabel}, or tap Continue`,
  }
}
