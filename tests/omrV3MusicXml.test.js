import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  serializeOmrV3MusicXml,
  validateOmrV3DocumentForSerialization,
} from '../src/features/omr/v3/omrV3MusicXml.js'
import {
  createOmrDocumentIR,
  OMR_V3_NOTATION_TYPE,
  OMR_V3_RELATIONSHIP_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
} from '../src/features/omr/v3/omrV3Ir.js'

const TIE_ID = 'tie-rel'

function confidence() {
  return { overall: 0.9, stages: { test: 0.9 } }
}

function note(eventId, overrides = {}) {
  return {
    eventId,
    staffId: 'treble',
    measureId: 'm1',
    onsetColumnId: 'o1',
    kind: 'note',
    onset: 0,
    duration: { divisions: 4, type: 'quarter', dots: 0, exact: true },
    pitch: { step: 'C', alter: 0, octave: 5, midi: 72 },
    technical: {},
    confidence: confidence(),
    sourceRefs: [eventId],
    ...overrides,
  }
}

function voice(voiceId, staffId, events, onsetColumnIds) {
  return {
    voiceId,
    staffId,
    candidateRank: 0,
    events,
    onsetColumnIds,
    overlapConstraints: [{ kind: 'monophonic-no-overlap', satisfied: true }],
    confidence: confidence(),
  }
}

function serializerDocument() {
  const chordGroupId = 'chord-1'
  const tieStart = note('g-start', {
    onset: 4,
    onsetColumnId: 'o2',
    pitch: { step: 'G', alter: 0, octave: 5, midi: 79 },
    relationships: [TIE_ID],
    technical: { tieStart: true },
  })
  const trebleEvents = [
    note('c5', { chordGroupId, string: 2, fret: 1, technical: { hammerOn: true } }),
    note('e5', {
      chordGroupId,
      pitch: { step: 'E', alter: 0, octave: 5, midi: 76 },
    }),
    tieStart,
  ]
  const bassRest = note('bass-rest', {
    staffId: 'bass',
    kind: 'rest',
    duration: { divisions: 16, type: 'whole', dots: 0, exact: true },
    pitch: null,
  })
  const tieStop = note('g-stop', {
    measureId: 'm2',
    onsetColumnId: 'o3',
    pitch: { step: 'G', alter: 0, octave: 5, midi: 79 },
    relationships: [TIE_ID],
    technical: { tieStop: true },
  })
  return createOmrDocumentIR({
    documentId: 'serializer-fixture',
    metadata: {
      title: 'V3 & serializer',
      instrumentId: 'piano',
      musical: {
        keySignature: { fifths: 2 },
        timeSignature: { beats: 3, beatType: 4 },
        tempo: { bpm: 96 },
      },
    },
    pages: [
      {
        pageId: 'p1',
        pageIndex: 0,
        width: 1000,
        height: 1400,
        systems: [
          {
            systemId: 's1',
            boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2, space: 'normalized' },
            staffGroups: [
              {
                staffGroupId: 'grand',
                type: OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF,
                staves: [
                  {
                    staffId: 'treble',
                    lineCount: 5,
                    notationType: OMR_V3_NOTATION_TYPE.NOTATION,
                    measureMembership: ['m1', 'm2', 'm3'],
                    confidence: confidence(),
                  },
                  {
                    staffId: 'bass',
                    lineCount: 5,
                    notationType: OMR_V3_NOTATION_TYPE.NOTATION,
                    measureMembership: ['m1', 'm2', 'm3'],
                    confidence: confidence(),
                  },
                ],
                confidence: confidence(),
              },
            ],
            measureColumns: [
              {
                measureId: 'm1',
                measureNumber: 1,
                xStart: 0.1,
                xEnd: 0.35,
                expectedStaffParticipation: ['treble', 'bass'],
                onsetColumns: [
                  { onsetColumnId: 'o1', x: 0.18, measureRelativePosition: 0.2 },
                  { onsetColumnId: 'o2', x: 0.26, measureRelativePosition: 0.6 },
                ],
                voices: [
                  voice('treble-v1-m1', 'treble', trebleEvents, ['o1', 'o2']),
                  voice('bass-v1-m1', 'bass', [bassRest], ['o1']),
                ],
                confidence: confidence(),
              },
              {
                measureId: 'm2',
                measureNumber: 2,
                xStart: 0.35,
                xEnd: 0.6,
                expectedStaffParticipation: ['treble', 'bass'],
                onsetColumns: [{ onsetColumnId: 'o3', x: 0.4, measureRelativePosition: 0.2 }],
                voices: [voice('treble-v1-m2', 'treble', [tieStop], ['o3'])],
                confidence: confidence(),
              },
              {
                measureId: 'm3',
                measureNumber: 3,
                xStart: 0.6,
                xEnd: 0.9,
                expectedStaffParticipation: ['treble', 'bass'],
                confidence: confidence(),
              },
            ],
            confidence: confidence(),
          },
        ],
        confidence: confidence(),
      },
    ],
    relationships: [
      {
        relationshipId: TIE_ID,
        type: OMR_V3_RELATIONSHIP_TYPE.TIE,
        members: ['g-start', 'g-stop'],
        directed: true,
        confidence: confidence(),
      },
    ],
    confidence: confidence(),
  })
}

describe('OMR V3 MusicXML serializer', () => {
  it('is byte-deterministic and emits chords, voices, ties, staff numbers, and technical data', () => {
    const document = serializerDocument()
    const first = serializeOmrV3MusicXml(document)
    const second = serializeOmrV3MusicXml(document)

    expect(first.musicXml).toBe(second.musicXml)
    expect(first.musicXml).toContain('<chord/>')
    expect(first.musicXml).toContain('<backup><duration>16</duration></backup>')
    expect(first.musicXml).toContain('<staves>2</staves>')
    expect(first.musicXml).toContain('<key><fifths>2</fifths></key>')
    expect(first.musicXml).toContain('<time><beats>3</beats><beat-type>4</beat-type></time>')
    expect(first.musicXml).toContain('<sound tempo="96"/>')
    expect(first.musicXml).toContain('<string>2</string><fret>1</fret>')
    expect(first.musicXml).toContain('<tied type="start"/>')
    expect(first.musicXml).toContain('<tied type="stop"/>')
    expect(first.musicXml).toContain('<measure number="3"><note><rest measure="yes"/>')
    expect(first.musicXml).not.toMatch(/NaN|undefined|Infinity/)
    expect(first.summary).toMatchObject({
      emittedMeasureCount: 3,
      invalidEventCount: 0,
      duplicateEventCount: 0,
      voiceOverlapViolations: 0,
      deterministic: true,
      promotedToRuntime: false,
    })
  })

  it('round-trips through the MusicXML timing parser', () => {
    const result = serializeOmrV3MusicXml(serializerDocument())
    const timing = parseMusicXml(result.musicXml, 'v3-shadow.musicxml')

    expect(timing.measures).toHaveLength(3)
    expect(timing.notes.filter((entry) => !entry.isRest)).toHaveLength(4)
    expect(timing.notes.some((entry) => entry.midi === 72)).toBe(true)
  })

  it('rejects invalid primaries, ignores unresolved candidates, and never writes non-finite values', () => {
    const document = serializerDocument()
    const measure = document.pages[0].systems[0].measureColumns[0]
    measure.voices = [
      voice(
        'bad-primary',
        'treble',
        [note('bad', { onset: 15, duration: { divisions: 4, exact: true }, pitch: null })],
        ['o1'],
      ),
      { ...voice('unresolved', 'treble', [note('candidate')], ['o1']), candidateRank: 2 },
    ]
    const preflight = validateOmrV3DocumentForSerialization(document)
    const result = serializeOmrV3MusicXml(document)

    expect(preflight.summary.invalidEventCount).toBe(1)
    expect(result.musicXml).not.toContain('bad-primary')
    expect(result.musicXml).not.toMatch(/NaN|undefined|Infinity/)
    expect(result.diagnostics.map((entry) => entry.code)).toContain('v3-event-not-serializable')
  })

  it('quantizes only explicitly approximate rhythm and labels the operation', () => {
    const document = serializerDocument()
    const event = document.pages[0].systems[0].measureColumns[1].voices[0].events[0]
    event.onset = 1.4
    event.duration = { divisions: 2.6, type: null, dots: 0, exact: false }
    const result = serializeOmrV3MusicXml(document)

    expect(result.summary.approximateQuantizationCount).toBe(1)
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'v3-approximate-rhythm-quantized',
    )
  })
})
