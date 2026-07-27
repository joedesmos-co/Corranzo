import { describe, expect, it } from 'vitest'
import {
  PIANO_HAND_TEXTURE,
  buildPianoPracticeInstruction,
  classifyPianoHandTexture,
} from '../src/features/practice/pianoPracticeInstructions.js'
import { enrichPianoPracticeCheckpoint } from '../src/features/practice/pianoChordCheckpoint.js'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import { buildGuidance } from '../src/features/practice/waitForYouGuidance.js'
import { defaultChordDisplayLabel, resolveChordCheckpointKind } from '../src/features/practice/chordCheckpoint.js'

describe('piano practice instructions', () => {
  it('never uses double-stop or raw N-note chord wording', () => {
    const rhInterval = buildPianoPracticeInstruction({
      expectedMidis: [60, 64],
      notes: [
        { midi: 60, staff: 1 },
        { midi: 64, staff: 1 },
      ],
    })
    const bothHands = buildPianoPracticeInstruction({
      expectedMidis: [48, 60, 64],
      notes: [
        { midi: 48, staff: 2 },
        { midi: 60, staff: 1 },
        { midi: 64, staff: 1 },
      ],
    })
    expect(rhInterval).toBe('Play both notes together')
    expect(bothHands).toBe('Play both hands together')
    expect(rhInterval.toLowerCase()).not.toContain('double-stop')
    expect(bothHands.toLowerCase()).not.toContain('note chord')
    expect(bothHands.toLowerCase()).not.toContain('double-stop')
  })

  it('distinguishes single note, interval, same-hand chord, and hands', () => {
    expect(
      buildPianoPracticeInstruction({
        expectedMidis: [67],
        notes: [{ midi: 67, staff: 1 }],
      }),
    ).toBe('Play G4')

    expect(
      buildPianoPracticeInstruction({
        expectedMidis: [48],
        notes: [{ midi: 48, staff: 2 }],
      }),
    ).toBe('Play the left-hand note')

    expect(
      buildPianoPracticeInstruction({
        expectedMidis: [60, 64],
        notes: [
          { midi: 60, staff: 1 },
          { midi: 64, staff: 1 },
        ],
      }),
    ).toBe('Play both notes together')

    expect(
      buildPianoPracticeInstruction({
        expectedMidis: [60, 64, 67],
        notes: [
          { midi: 60, staff: 1 },
          { midi: 64, staff: 1 },
          { midi: 67, staff: 1 },
        ],
      }),
    ).toBe('Play the chord')

    expect(
      buildPianoPracticeInstruction({
        expectedMidis: [60, 64, 67],
        chordSymbol: 'C',
        notes: [
          { midi: 60, staff: 1 },
          { midi: 64, staff: 1 },
          { midi: 67, staff: 1 },
        ],
      }),
    ).toBe('Play the C chord')

    expect(
      classifyPianoHandTexture({
        expectedMidis: [48, 60],
        notes: [
          { midi: 48, staff: 2 },
          { midi: 60, staff: 1 },
        ],
      }),
    ).toBe(PIANO_HAND_TEXTURE.BOTH_HANDS)
  })

  it('overwrites guitar-style checkpoint labels during piano enrichment', () => {
    const kind = resolveChordCheckpointKind([60, 64])
    const guitarish = defaultChordDisplayLabel({ kind, expectedMidis: [60, 64] })
    expect(guitarish).toBe('Play this double-stop')

    const enriched = enrichPianoPracticeCheckpoint(
      {
        isChord: true,
        expectedMidis: [60, 64],
        displayLabel: guitarish,
        notes: [
          { midi: 60, staff: 1 },
          { midi: 64, staff: 1 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.PIANO },
    )
    expect(enriched.displayLabel).toBe('Play both notes together')
    expect(enriched.displayLabel).not.toContain('double-stop')
  })

  it('uses both-hands copy when a stack spans staves', () => {
    const enriched = enrichPianoPracticeCheckpoint(
      {
        isChord: true,
        expectedMidis: [48, 60, 64],
        displayLabel: 'Play 3-note chord',
        notes: [
          { midi: 48, staff: 2 },
          { midi: 60, staff: 1 },
          { midi: 64, staff: 1 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.PIANO },
    )
    expect(enriched.displayLabel).toBe('Play both hands together')
    const guidance = buildGuidance({
      checkpoint: enriched,
      inputFeedback: { outcome: 'idle' },
      matchingActive: true,
      rollingChordMicMode: true,
      instrument: { id: 'piano', notation: { grandStaff: true } },
    })
    expect(guidance.primary).toBe('Play both hands together')
  })

  it('keeps guitar double-stop wording for guitar enrichment path', () => {
    const label = defaultChordDisplayLabel({
      kind: resolveChordCheckpointKind([60, 64]),
      expectedMidis: [60, 64],
    })
    expect(label).toBe('Play this double-stop')
  })
})
