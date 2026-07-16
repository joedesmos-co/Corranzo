import { describe, expect, it } from 'vitest'
import {
  assertValidOmrDocumentIR,
  createOmrDocumentIR,
  createOmrV3Id,
  deepFreezeOmrIR,
  exportOmrV3DebugJson,
  OMR_V3_NOTATION_TYPE,
  OMR_V3_RELATIONSHIP_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
  parseOmrDocumentIR,
  serializeOmrDocumentIR,
  validateOmrDocumentIR,
} from '../src/features/omr/v3/omrV3Ir.js'

function buildValidDocument() {
  const documentId = createOmrV3Id('document', 'fixture')
  const pageId = createOmrV3Id('page', documentId, 0)
  const systemId = createOmrV3Id('system', pageId, 0)
  const staffId = createOmrV3Id('staff', systemId, 0)
  const measureId = createOmrV3Id('measure', systemId, 1)
  const onsetColumnId = createOmrV3Id('onset', measureId, 0.25, 0)
  const voiceId = createOmrV3Id('voice', staffId, 0)
  const eventId = createOmrV3Id('event', staffId, 0, 0)
  const tiedEventId = createOmrV3Id('event', staffId, 4, 1)

  return createOmrDocumentIR({
    documentId,
    metadata: { title: 'IR fixture' },
    confidence: { overall: 0.82, stages: { structure: 0.9 } },
    pages: [
      {
        pageId,
        pageIndex: 0,
        width: 1000,
        height: 1400,
        systems: [
          {
            systemId,
            boundingBox: { x: 0.1, y: 0.12, width: 0.8, height: 0.2 },
            readingOrder: 0,
            staffGroups: [
              {
                type: OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION,
                staves: [
                  {
                    staffId,
                    lineCount: 5,
                    notationType: OMR_V3_NOTATION_TYPE.NOTATION,
                    rawLineGeometry: Array.from({ length: 5 }, (_, index) => ({
                      xStart: 100,
                      xEnd: 900,
                      yStart: 200 + index * 10,
                      yEnd: 200 + index * 10,
                      space: 'pixels',
                    })),
                    normalizedLineGeometry: Array.from({ length: 5 }, (_, index) => ({
                      xStart: 0.1,
                      xEnd: 0.9,
                      yStart: (200 + index * 10) / 1400,
                      yEnd: (200 + index * 10) / 1400,
                      space: 'normalized',
                    })),
                    boundingBox: { x: 0.1, y: 0.14, width: 0.8, height: 0.04 },
                    measureMembership: [measureId],
                  },
                ],
              },
            ],
            measureColumns: [
              {
                measureId,
                measureNumber: 1,
                xStart: 0.1,
                xEnd: 0.5,
                boundingBox: { x: 0.1, y: 0.12, width: 0.4, height: 0.2 },
                expectedStaffParticipation: [staffId],
                onsetColumns: [
                  {
                    onsetColumnId,
                    x: 0.2,
                    measureRelativePosition: 0.25,
                    noteheads: ['source:notehead:1'],
                  },
                ],
                voices: [
                  {
                    voiceId,
                    staffId,
                    onsetColumnIds: [onsetColumnId],
                    events: [
                      {
                        eventId,
                        onsetColumnId,
                        onset: 0,
                        duration: { divisions: 4, type: 'quarter', dots: 0, exact: true },
                        pitch: { step: 'C', octave: 4, alter: 0, midi: 60 },
                        sourceRefs: ['source:notehead:1'],
                      },
                      {
                        eventId: tiedEventId,
                        onsetColumnId,
                        onset: 4,
                        duration: { divisions: 4, type: 'quarter', dots: 0, exact: true },
                        pitch: { step: 'C', octave: 4, alter: 0, midi: 60 },
                        sourceRefs: ['source:notehead:2'],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    relationships: [
      {
        type: OMR_V3_RELATIONSHIP_TYPE.TIE,
        members: [eventId, tiedEventId],
        directed: true,
        confidence: 0.7,
      },
    ],
  })
}

describe('OMR V3 document IR', () => {
  it('creates deterministic, normalized IDs', () => {
    expect(createOmrV3Id('Staff Group', 'Page 1', 'Treble/Bass')).toBe(
      'omr3:staff-group:page-1:treble-bass',
    )
    expect(createOmrV3Id('Staff Group', 'Page 1', 'Treble/Bass')).toBe(
      createOmrV3Id('Staff Group', 'Page 1', 'Treble/Bass'),
    )
  })

  it('constructs a JSON-serializable hierarchy with valid references', () => {
    const document = buildValidDocument()
    const validation = validateOmrDocumentIR(document)

    expect(validation).toEqual({ valid: true, errors: [], warnings: [] })
    expect(() => assertValidOmrDocumentIR(document)).not.toThrow()
    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
  })

  it('round-trips canonical debug JSON deterministically', () => {
    const document = buildValidDocument()
    const compact = serializeOmrDocumentIR(document)
    const debug = exportOmrV3DebugJson(document)
    const reparsed = parseOmrDocumentIR(debug)

    expect(serializeOmrDocumentIR(reparsed)).toBe(compact)
    expect(debug).toContain('\n  "confidence"')
    expect(debug).not.toContain('[object Object]')
  })

  it('does not mutate constructor inputs and can deep-freeze the result', () => {
    const input = {
      documentId: 'doc',
      metadata: { title: 'Original' },
      pages: [{ pageIndex: 0, width: 100, height: 200, systems: [] }],
    }
    const before = structuredClone(input)
    const document = createOmrDocumentIR(input)

    expect(input).toEqual(before)
    deepFreezeOmrIR(document)
    expect(Object.isFrozen(document)).toBe(true)
    expect(Object.isFrozen(document.pages[0])).toBe(true)
  })

  it('guards malformed geometry, duplicate IDs, and dangling references', () => {
    const document = buildValidDocument()
    document.pages[0].systems[0].boundingBox.width = Number.NaN
    document.pages[0].systems[0].measureColumns[0].expectedStaffParticipation.push('missing-staff')
    document.pages[0].systems[0].measureColumns[0].voices[0].events[1].eventId =
      document.pages[0].systems[0].measureColumns[0].voices[0].events[0].eventId

    const result = validateOmrDocumentIR(document)
    const codes = result.errors.map((error) => error.code)

    expect(result.valid).toBe(false)
    expect(codes).toContain('non-finite-geometry')
    expect(codes).toContain('duplicate-id')
    expect(codes).toContain('dangling-reference')
    expect(() => serializeOmrDocumentIR(document)).toThrow(/Invalid OMR V3 IR/)
  })

  it('rejects malformed JSON and unsupported schema versions', () => {
    expect(() => parseOmrDocumentIR('{')).toThrow(/Invalid OMR V3 JSON/)
    const document = buildValidDocument()
    document.schemaVersion = 99
    expect(validateOmrDocumentIR(document).errors[0].code).toBe('unsupported-schema-version')
  })
})
