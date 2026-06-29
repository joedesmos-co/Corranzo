import { describe, expect, it } from 'vitest'
import { OMR_ACCURACY_DEFAULTS } from '../src/features/omr/omrAccuracyEvaluator.js'
import {
  matchMeasureNotes,
  matchMeasureNotesGreedy,
} from '../src/features/omr/omrMeasureNoteMatching.js'

const options = OMR_ACCURACY_DEFAULTS

function note(midi, onsetQuarters = 0) {
  return {
    measureNumber: 1,
    onsetQuarters,
    durationQuarters: 1,
    midi,
    timeSeconds: onsetQuarters,
  }
}

describe('matchMeasureNotes', () => {
  it('avoids legacy greedy pitch swaps when onset timing competes', () => {
    const truth = [note(60, 0), note(64, 0)]
    const generated = [note(60, 0.5), note(64, 0)]

    const greedy = matchMeasureNotesGreedy(truth, generated, options)
    expect(greedy.matches.every((match) => match.pitchCorrect)).toBe(false)

    const matched = matchMeasureNotes(truth, generated, options)
    expect(matched.matches).toHaveLength(2)
    expect(matched.matches.every((match) => match.pitchCorrect)).toBe(true)
  })

  it('still respects the onset match window', () => {
    const truth = [note(60, 0)]
    const generated = [note(60, 1)]

    const matched = matchMeasureNotes(truth, generated, options)
    expect(matched.matches).toHaveLength(0)
    expect(matched.missing).toHaveLength(1)
    expect(matched.extra).toHaveLength(1)
  })

  it('minimizes total pitch distance for competing candidates', () => {
    const truth = [note(36, 0), note(43, 0)]
    const generated = [note(48, 0), note(68, 0)]

    const matched = matchMeasureNotes(truth, generated, options)
    const totalPitchDelta = matched.matches.reduce(
      (sum, match) => sum + Math.abs(match.pitchDeltaSemitones),
      0,
    )
    expect(totalPitchDelta).toBe(37)
  })
})
