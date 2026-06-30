import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildVoiceSerializedOmrMusicXml,
  simulateBeamOwnershipVoices,
} from '../src/features/omr/beamOwnershipVoiceSimulation.js'

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
    staffRole: 'upper',
    clef: 'treble',
    confidence: 0.88,
    ...overrides,
  }
}

describe('beam ownership voice serialization simulation', () => {
  it('serializes beamed moving notes and sustained notes as separate voices', () => {
    const moving = note('moving', { midi: 76 })
    const sustain = note('sustain', { midi: 64 })
    const measures = [
      {
        measureNumber: 1,
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
              ownerships: [
                ownership('moving-head', {
                  beamCount: 1,
                  beamLevel: 1,
                  beamGroupId: 'rg-1-1',
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

    const simulation = simulateBeamOwnershipVoices(measures)
    const xml = buildVoiceSerializedOmrMusicXml({
      title: 'voice simulation test',
      measures: simulation.measures,
      includeDisclaimer: false,
    })
    const timing = parseMusicXml(xml, 'voice-sim.musicxml')
    const parsedNotes = timing.notes.filter((entry) => !entry.isRest)

    expect(simulation.summary.candidateEvents).toBe(1)
    expect(simulation.summary.appliedEvents).toBe(1)
    expect(simulation.summary.noteCountChanged).toBe(false)
    expect(simulation.summary.measureCountChanged).toBe(false)
    expect(xml).toContain('<backup><duration>2</duration></backup>')
    expect(parsedNotes).toHaveLength(2)
    expect(parsedNotes.map((entry) => entry.midi).sort((a, b) => a - b)).toEqual([64, 76])
    expect(new Set(parsedNotes.map((entry) => entry.quarterTime))).toEqual(new Set([1]))
    expect(new Set(parsedNotes.map((entry) => entry.voice)).size).toBe(2)
    expect(parsedNotes.find((entry) => entry.midi === 76)?.durationQuarters).toBe(0.5)
    expect(parsedNotes.find((entry) => entry.midi === 64)?.durationQuarters).toBe(0.75)
    expect(measures[0].events).toHaveLength(1)
  })

  it('skips candidates without strong ownership confidence', () => {
    const moving = note('moving')
    const sustain = note('sustain')
    const measures = [
      {
        measureNumber: 2,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 3,
            notes: [moving, sustain],
          },
        ],
        beamStemGraph: {
          eventOwnership: [
            {
              eventIndex: 0,
              splitCandidate: true,
              beamedExpectedDivisions: 2,
              ownerships: [
                ownership('moving-head', {
                  beamCount: 1,
                  beamGroupId: 'rg-2-1',
                  attachedBeamIds: ['beam-1'],
                  expectedDivisions: 2,
                  likelyVoiceRole: 'beamed-eighth-voice',
                  confidence: 0.5,
                }),
                ownership('sustain-head'),
              ],
            },
          ],
        },
      },
    ]

    const simulation = simulateBeamOwnershipVoices(measures)

    expect(simulation.summary.candidateEvents).toBe(1)
    expect(simulation.summary.appliedEvents).toBe(0)
    expect(simulation.summary.skippedReasons['low-ownership-confidence']).toBe(1)
    expect(simulation.measures[0].events).toHaveLength(1)
  })
})
