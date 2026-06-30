import { describe, expect, it } from 'vitest'
import { simulateBeamOwnershipSplits } from '../src/features/omr/beamOwnershipSimulation.js'

function note(id, overrides = {}) {
  return {
    id,
    midi: 72,
    clef: 'treble',
    ...overrides,
  }
}

function ownership(noteheadId, overrides = {}) {
  return {
    noteheadId,
    beamCount: 0,
    beamLevel: 0,
    beamGroupId: null,
    attachedBeamIds: [],
    expectedDivisions: null,
    likelyVoiceRole: 'stemmed-sustain-or-quarter-voice',
    stemDirection: 'down',
    ...overrides,
  }
}

describe('beam ownership split simulation', () => {
  it('splits a single beamed ownership group from sustained notes without changing note count', () => {
    const moving = note('moving')
    const sustain = note('sustain', { midi: 60, clef: 'bass' })
    const measures = [
      {
        measureNumber: 12,
        events: [
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 3,
            durationType: 'quarter',
            notes: [moving, sustain],
          },
        ],
        beamStemGraph: {
          eventOwnership: [
            {
              eventIndex: 0,
              splitCandidate: true,
              beamedExpectedDivisions: 2,
              reasons: [
                'beamed-and-unbeamed-notes',
                'event-longer-than-beam-unit',
              ],
              ownerships: [
                ownership('moving-head', {
                  beamCount: 1,
                  beamLevel: 1,
                  beamGroupId: 'rg-12-1',
                  attachedBeamIds: ['beam-1'],
                  expectedDivisions: 2,
                  likelyVoiceRole: 'beamed-eighth-voice',
                  stemDirection: 'up',
                }),
                ownership('sustain-head'),
              ],
            },
          ],
        },
      },
    ]

    const result = simulateBeamOwnershipSplits(measures)
    const events = result.measures[0].events

    expect(result.summary.candidateEvents).toBe(1)
    expect(result.summary.appliedEvents).toBe(1)
    expect(result.summary.noteCountChanged).toBe(false)
    expect(result.summary.measureCountChanged).toBe(false)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      durationDivisions: 2,
      durationType: 'eighth',
      notes: [moving],
      beamOwnershipSimulation: { role: 'beamed-moving-note-event' },
    })
    expect(events[1]).toMatchObject({
      durationDivisions: 3,
      notes: [sustain],
      beamOwnershipSimulation: { role: 'sustained-unbeamed-voice-event' },
    })
    expect(measures[0].events).toHaveLength(1)
  })

  it('skips split candidates with ambiguous beam groups', () => {
    const left = note('left')
    const right = note('right')
    const sustain = note('sustain')
    const measures = [
      {
        measureNumber: 9,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 3,
            notes: [left, right, sustain],
          },
        ],
        beamStemGraph: {
          eventOwnership: [
            {
              eventIndex: 0,
              splitCandidate: true,
              beamedExpectedDivisions: 2,
              ownerships: [
                ownership('left', {
                  beamCount: 1,
                  beamGroupId: 'rg-9-1',
                  attachedBeamIds: ['beam-1'],
                  expectedDivisions: 2,
                  likelyVoiceRole: 'beamed-eighth-voice',
                }),
                ownership('right', {
                  beamCount: 1,
                  beamGroupId: 'rg-9-2',
                  attachedBeamIds: ['beam-2'],
                  expectedDivisions: 2,
                  likelyVoiceRole: 'beamed-eighth-voice',
                }),
                ownership('sustain'),
              ],
            },
          ],
        },
      },
    ]

    const result = simulateBeamOwnershipSplits(measures)

    expect(result.summary.candidateEvents).toBe(1)
    expect(result.summary.appliedEvents).toBe(0)
    expect(result.summary.skippedReasons['ambiguous-beam-group']).toBe(1)
    expect(result.measures[0].events).toHaveLength(1)
  })
})
