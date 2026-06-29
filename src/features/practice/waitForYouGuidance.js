import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import { WFY_INPUT_OUTCOME } from './waitForYouInputFeedback.js'
import { getExpectedMidis } from './waitForYouNoteMatch.js'

/**
 * Wait For You guidance layer (pure). Turns the current checkpoint + the latest
 * input result + how the attempt is going (wrong-attempt count, timeout, explicit
 * hint request) into a single "what should I tell the player" object the UI can
 * render directly. Keeps all the assistant wording in one tested place.
 */

export const WFY_GUIDANCE = {
  IDLE: 'idle',
  WAITING: 'waiting',
  CORRECT: 'correct',
  WRONG: 'wrong',
  PARTIAL: 'partial',
  HINT: 'hint',
  COMPLETE: 'complete',
}

/** Number of wrong attempts at which the cursor target is revealed automatically. */
export const HINT_AFTER_WRONG_ATTEMPTS = 2

export function chordLabel(midis) {
  return (midis ?? []).map((m) => midiToNoteLabel(m)).join(' + ')
}

export function expectedLabelFor(expectedMidis) {
  if (!expectedMidis?.length) return null
  return expectedMidis.length > 1 ? chordLabel(expectedMidis) : midiToNoteLabel(expectedMidis[0])
}

/** Labels of expected notes not yet matched (for chord "missing" feedback). */
export function missingLabels(expectedMidis, matchedIndices) {
  if (!expectedMidis?.length) return []
  return expectedMidis
    .map((midi, index) => ({ midi, index }))
    .filter(({ index }) => !(matchedIndices && matchedIndices.has(index)))
    .map(({ midi }) => midiToNoteLabel(midi))
}

/**
 * "right hand" / "left hand" when every note in the checkpoint is on one staff
 * (treble = 1 ≈ right, bass = 2 ≈ left). Null when mixed/unknown.
 */
export function staffHandHint(checkpoint) {
  const staves = new Set(
    (checkpoint?.notes ?? [])
      .map((n) => n?.staff)
      .filter((s) => s === 1 || s === 2),
  )
  if (staves.size !== 1) return null
  return staves.has(1) ? 'right hand' : 'left hand'
}

/**
 * Escalating hint that gets more specific the more times the player is wrong:
 *   1 → gentle nudge, 2 → reveal the note, 3+ → reveal note + which hand.
 */
export function buildEscalatingHint({ expectedMidis, wrongAttempts, checkpoint }) {
  if (!expectedMidis?.length || wrongAttempts <= 0) return null
  const isChord = expectedMidis.length > 1
  const label = expectedLabelFor(expectedMidis)
  if (wrongAttempts === 1) return 'Not quite — try again.'
  if (wrongAttempts === 2) return `Expected ${label}.`
  const hand = staffHandHint(checkpoint)
  if (isChord) return `Play ${label} together${hand ? ` with your ${hand}` : ''}.`
  return `Play ${label}${hand ? ` with your ${hand}` : ''}.`
}

/** Plain "play this" hint used on timeout or when the player asks for help. */
export function buildTargetHint({ expectedMidis }) {
  const label = expectedLabelFor(expectedMidis)
  return label ? `Play ${label}` : null
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
}) {
  const expectedMidis = getExpectedMidis(checkpoint)
  const isChord = expectedMidis.length > 1
  const expectedLabel = expectedLabelFor(expectedMidis)
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
      primary: isChord ? 'Chord — nice!' : 'Correct!',
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.WRONG) {
    return {
      ...base,
      state: WFY_GUIDANCE.WRONG,
      tone: 'error',
      primary: 'Missed / late',
      playedLabel,
      hint: buildEscalatingHint({ expectedMidis, wrongAttempts, checkpoint }),
      // After enough wrong tries, surface the target on the score too.
      showTarget: wrongAttempts >= HINT_AFTER_WRONG_ATTEMPTS,
    }
  }

  if (outcome === WFY_INPUT_OUTCOME.CHORD_PARTIAL) {
    const heard = inputFeedback?.heardLabels ?? []
    const missing =
      inputFeedback?.remainingLabels ??
      missingLabels(expectedMidis, inputFeedback?.matchedIndices)
    let primary = missing.length ? `Still need ${missing.join(', ')}` : 'Almost — hold the chord'
    if (heard.length && missing.length) {
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
      primary: buildTargetHint({ expectedMidis }),
      hint:
        buildEscalatingHint({ expectedMidis, wrongAttempts, checkpoint }) ??
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
        ? `Play the chord: ${expectedLabel}`
        : `Play ${expectedLabel}`
      : `Play ${expectedLabel}, or tap Continue`,
  }
}
