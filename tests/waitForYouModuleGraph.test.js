import { describe, expect, it } from 'vitest'
import { missingLabels, chordLabel } from '../src/features/practice/waitForYouLabels.js'
import { getExpectedMidis } from '../src/features/practice/waitForYouNoteMatch.js'
import { evaluateMicChordCollection } from '../src/features/practice/waitForYouMicChordCollection.js'
import { buildGuidance } from '../src/features/practice/waitForYouGuidance.js'
import { resolveWfyDisplayStatus } from '../src/features/practice/waitForYouDisplayStatus.js'
import { WFY_GUIDANCE } from '../src/features/practice/waitForYouGuidanceConstants.js'

describe('waitForYou module graph', () => {
  it('has no circular-import TDZ on label + match helpers', () => {
    expect(chordLabel([60, 64])).toBe('C4 + E4')
    expect(missingLabels([60, 64, 67], new Set([1]))).toEqual(['C4', 'G4'])
    expect(getExpectedMidis({ expectedMidis: [60] })).toEqual([60])
    expect(
      evaluateMicChordCollection({
        expected: [60, 64],
        playedMidi: 60,
        state: { matchedIndices: new Set(), pendingIndex: null, pendingHits: 0, wrongStreak: 0 },
        settings: { micCentsTolerance: 35 },
      }).outcome,
    ).toBeTruthy()
    expect(
      buildGuidance({
        checkpoint: { expectedMidis: [60], isChord: false },
        inputFeedback: { outcome: 'idle' },
      }).primary,
    ).toContain('C4')
    expect(
      resolveWfyDisplayStatus({
        active: true,
        engineStatus: 'waiting',
        guidance: { state: WFY_GUIDANCE.WRONG },
      }),
    ).toBe('missed')
  })
})
