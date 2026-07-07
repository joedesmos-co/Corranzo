import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import { enrichPianoChordCheckpoint } from '../src/features/practice/pianoChordCheckpoint.js'
import { buildGuidance } from '../src/features/practice/waitForYouGuidance.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('piano chord WFY UI', () => {
  it('uses the same concise target card structure as guitar', () => {
    const section = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(section).toContain('conciseChordTargetLabel')
    expect(section).toContain('wait-for-you__target-details')
    expect(section).toContain('isRollingChordMic')
    expect(section).not.toContain('Chord practice sequence: play one chord tone at a time')
  })

  it('does not show the legacy mic chord sequence hint banner', () => {
    const section = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(section).not.toContain('wait-for-you__mic-chord-hint')
    expect(section).not.toContain('Chord practice sequence: play one chord tone at a time')
  })

  it('shows concise piano chord guidance instead of one-at-a-time copy', () => {
    const checkpoint = enrichPianoChordCheckpoint(
      {
        isChord: true,
        chordSymbol: 'C',
        expectedMidis: [60, 64, 67],
        displayLabel: 'Play C chord',
        notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }],
      },
      { instrumentId: INSTRUMENT_IDS.PIANO },
    )
    const guidance = buildGuidance({
      checkpoint,
      inputFeedback: { outcome: 'idle' },
      matchingActive: true,
      rollingChordMicMode: true,
      chordAsSequence: false,
      instrument: { id: 'piano', notation: { grandStaff: true } },
    })
    expect(guidance.primary).toBe('Play C chord')
    expect(guidance.primary).not.toContain('one at a time')
  })
})
