import { describe, expect, it } from 'vitest'
import {
  buildGuidance,
  buildEscalatingHint,
  buildTargetHint,
  missingLabels,
  expectedLabelFor,
  staffHandHint,
  WFY_GUIDANCE,
} from '../src/features/practice/waitForYouGuidance.js'
import {
  evaluateNoteInput,
  evaluateMicNoteInput,
  createChordMatchState,
  getExpectedMidis,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  buildInputFeedback,
  WFY_INPUT_OUTCOME,
} from '../src/features/practice/waitForYouInputFeedback.js'
import { normalizeMatchSettings, WFY_MATCH_DEFAULTS } from '../src/features/practice/waitForYouMatchSettings.js'
import { getNextCheckpointIndex } from '../src/features/practice/waitForYouEngine.js'
import { midiToNoteLabel } from '../src/features/midi-input/midiNoteLabel.js'
import { buildCursorMotionTimeline, resolveCursorMotion } from '../src/features/score-follow/cursorMotionTimeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'

const C4 = 60
const E4 = 64
const F4 = 65
const G4 = 67
const settings = normalizeMatchSettings(WFY_MATCH_DEFAULTS)
const noteCheckpoint = (midis, notes = null) => ({
  expectedMidis: midis,
  expectedMidi: midis[0],
  isChord: midis.length > 1,
  notes,
})
const fb = (args) => buildInputFeedback(args)

describe('Wait For You — note matching (MIDI path)', () => {
  it('a correct single note completes (advances)', () => {
    const r = evaluateNoteInput(noteCheckpoint([E4]), E4, createChordMatchState(), settings)
    expect(r.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('a wrong single note is WRONG', () => {
    const r = evaluateNoteInput(noteCheckpoint([E4]), F4, createChordMatchState(), settings)
    expect(r.outcome).toBe(MATCH_OUTCOME.WRONG)
    expect(r.playedMidi).toBe(F4)
  })

  it('octave mistakes are rejected by default but accepted when allowed', () => {
    const strict = evaluateNoteInput(noteCheckpoint([E4]), E4 + 12, createChordMatchState(), settings)
    expect(strict.outcome).toBe(MATCH_OUTCOME.WRONG)
    const lenient = evaluateNoteInput(
      noteCheckpoint([E4]),
      E4 + 12,
      createChordMatchState(),
      normalizeMatchSettings({ ...WFY_MATCH_DEFAULTS, exactPitch: false, allowOctaveMistakes: true }),
    )
    expect(lenient.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('a chord completes once all notes arrive within the window', () => {
    const state = createChordMatchState()
    const cp = noteCheckpoint([C4, E4, G4])
    expect(evaluateNoteInput(cp, C4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, G4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('a partial chord reports progress (missing notes derivable)', () => {
    const state = createChordMatchState()
    const cp = noteCheckpoint([C4, E4, G4])
    evaluateNoteInput(cp, C4, state, settings)
    const r = evaluateNoteInput(cp, G4, state, settings)
    expect(r.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(r.matchedIndices.size).toBe(2)
    const feedback = fb({
      outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
      expectedMidis: [C4, E4, G4],
      matchedIndices: r.matchedIndices,
      isChord: true,
    })
    expect(feedback.remainingLabels).toEqual([midiToNoteLabel(E4)])
  })

  it('a duplicate/extra chord tone is tolerated, not flagged wrong', () => {
    const state = createChordMatchState()
    const cp = noteCheckpoint([C4, E4, G4])
    evaluateNoteInput(cp, C4, state, settings)
    const dup = evaluateNoteInput(cp, C4, state, settings) // C4 again
    expect(dup.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(dup.duplicate).toBe(true)
  })

  it('a note not in the chord at all is WRONG', () => {
    const state = createChordMatchState()
    const cp = noteCheckpoint([C4, E4, G4])
    const r = evaluateNoteInput(cp, F4, state, settings)
    expect(r.outcome).toBe(MATCH_OUTCOME.WRONG)
  })
})

describe('Wait For You — mic path', () => {
  it('a correct mic pitch completes; a wrong one is WRONG', () => {
    expect(evaluateMicNoteInput(noteCheckpoint([E4]), E4, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
    expect(evaluateMicNoteInput(noteCheckpoint([E4]), F4, settings).outcome).toBe(MATCH_OUTCOME.WRONG)
  })

  it('mic chord uses single-tone matching (any chord tone completes)', () => {
    const r = evaluateMicNoteInput(noteCheckpoint([C4, E4, G4]), E4, settings)
    expect(r.outcome).toBe(MATCH_OUTCOME.COMPLETE)
    expect(r.isChord).toBe(true)
  })
})

describe('Wait For You — guidance feedback', () => {
  it('correct → green', () => {
    const g = buildGuidance({
      checkpoint: noteCheckpoint([E4]),
      inputFeedback: fb({ outcome: WFY_INPUT_OUTCOME.CORRECT, playedMidi: E4, expectedMidis: [E4], matchedIndices: new Set([0]) }),
    })
    expect(g.state).toBe(WFY_GUIDANCE.CORRECT)
    expect(g.tone).toBe('success')
  })

  it('wrong → red with Expected vs You played', () => {
    const g = buildGuidance({
      checkpoint: noteCheckpoint([E4]),
      inputFeedback: fb({ outcome: WFY_INPUT_OUTCOME.WRONG, playedMidi: F4, expectedMidis: [E4], matchedIndices: new Set() }),
      wrongAttempts: 1,
    })
    expect(g.state).toBe(WFY_GUIDANCE.WRONG)
    expect(g.tone).toBe('error')
    expect(g.expectedLabel).toBe(midiToNoteLabel(E4))
    expect(g.playedLabel).toBe(midiToNoteLabel(F4))
  })

  it('partial chord → shows the missing note', () => {
    const g = buildGuidance({
      checkpoint: noteCheckpoint([C4, E4, G4]),
      inputFeedback: fb({
        outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
        expectedMidis: [C4, E4, G4],
        matchedIndices: new Set([0, 2]),
        isChord: true,
      }),
    })
    expect(g.state).toBe(WFY_GUIDANCE.PARTIAL)
    expect(g.missingLabels).toEqual([midiToNoteLabel(E4)])
    expect(g.primary).toContain(midiToNoteLabel(E4))
  })

  it('timeout → reveals the target note as a hint', () => {
    const g = buildGuidance({
      checkpoint: noteCheckpoint([E4]),
      inputFeedback: fb({ outcome: WFY_INPUT_OUTCOME.IDLE, expectedMidis: [E4], matchedIndices: new Set() }),
      timedOut: true,
    })
    expect(g.state).toBe(WFY_GUIDANCE.HINT)
    expect(g.tone).toBe('hint')
    expect(g.primary).toBe(`Play ${midiToNoteLabel(E4)}`)
    expect(g.showTarget).toBe(true)
  })

  it('explicit hint request reveals the target', () => {
    const g = buildGuidance({
      checkpoint: noteCheckpoint([E4]),
      inputFeedback: fb({ outcome: WFY_INPUT_OUTCOME.IDLE, expectedMidis: [E4], matchedIndices: new Set() }),
      hintRequested: true,
    })
    expect(g.state).toBe(WFY_GUIDANCE.HINT)
    expect(g.showTarget).toBe(true)
  })

  it('waiting (no input yet) → neutral "Play X"', () => {
    const g = buildGuidance({
      checkpoint: noteCheckpoint([E4]),
      inputFeedback: fb({ outcome: WFY_INPUT_OUTCOME.IDLE, expectedMidis: [E4], matchedIndices: new Set() }),
    })
    expect(g.state).toBe(WFY_GUIDANCE.WAITING)
    expect(g.tone).toBe('neutral')
    expect(g.primary).toContain(midiToNoteLabel(E4))
  })

  it('complete → success', () => {
    const g = buildGuidance({ checkpoint: noteCheckpoint([E4]), inputFeedback: null, complete: true })
    expect(g.state).toBe(WFY_GUIDANCE.COMPLETE)
  })
})

describe('Wait For You — escalating hints', () => {
  it('gets more specific with each wrong attempt (single note)', () => {
    const cp = noteCheckpoint([E4], [{ staff: 1 }])
    expect(buildEscalatingHint({ expectedMidis: [E4], wrongAttempts: 0, checkpoint: cp })).toBeNull()
    expect(buildEscalatingHint({ expectedMidis: [E4], wrongAttempts: 1, checkpoint: cp })).toBe('Not quite — try again.')
    expect(buildEscalatingHint({ expectedMidis: [E4], wrongAttempts: 2, checkpoint: cp })).toBe(`Expected ${midiToNoteLabel(E4)}.`)
    expect(buildEscalatingHint({ expectedMidis: [E4], wrongAttempts: 3, checkpoint: cp })).toBe(`Play ${midiToNoteLabel(E4)} with your right hand.`)
  })

  it('uses left hand for bass-staff targets and omits the hand when unknown', () => {
    expect(buildEscalatingHint({ expectedMidis: [C4], wrongAttempts: 3, checkpoint: noteCheckpoint([C4], [{ staff: 2 }]) }))
      .toContain('left hand')
    expect(buildEscalatingHint({ expectedMidis: [C4], wrongAttempts: 3, checkpoint: noteCheckpoint([C4], null) }))
      .toBe(`Play ${midiToNoteLabel(C4)}.`)
  })

  it('chord hint lists all notes', () => {
    const label = expectedLabelFor([C4, E4, G4])
    expect(label).toBe(`${midiToNoteLabel(C4)} + ${midiToNoteLabel(E4)} + ${midiToNoteLabel(G4)}`)
    expect(buildEscalatingHint({ expectedMidis: [C4, E4, G4], wrongAttempts: 3, checkpoint: noteCheckpoint([C4, E4, G4]) }))
      .toContain(label)
  })

  it('helpers: target hint and missing labels', () => {
    expect(buildTargetHint({ expectedMidis: [E4] })).toBe(`Play ${midiToNoteLabel(E4)}`)
    expect(missingLabels([C4, E4, G4], new Set([0, 2]))).toEqual([midiToNoteLabel(E4)])
    expect(staffHandHint(noteCheckpoint([E4], [{ staff: 1 }]))).toBe('right hand')
  })
})

describe('Wait For You — controls', () => {
  it('skip advances to the next checkpoint', () => {
    expect(getNextCheckpointIndex(0, 3)).toBe(1)
    expect(getNextCheckpointIndex(2, 3)).toBe(3) // past the end → complete
  })

  it('replay target resolves the expected midis to play', () => {
    expect(getExpectedMidis(noteCheckpoint([C4, E4, G4]))).toEqual([C4, E4, G4])
  })
})

describe('Wait For You — score follow engine untouched', () => {
  it('the motion timeline still builds and resolves (no regression)', () => {
    const tm = parseMusicXml(F.straight4())
    const anchors = [
      { id: 'm1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual', meta: { playableStartX: 0.1, playableEndX: 0.3, systemEndX: 0.95 } },
      { id: 'm2', page: 1, x: 0.3, y: 0.3, measureNumber: 2, source: 'manual', meta: { playableStartX: 0.3, playableEndX: 0.5, systemEndX: 0.95 } },
    ]
    const tl = buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors })
    const cursor = resolveCursorMotion(tl, 0.5)
    expect(cursor).not.toBeNull()
    expect(cursor.visible).toBe(true)
  })
})
