import { describe, expect, it } from 'vitest'
import { buildOmrV3DocumentMeasureColumns } from '../src/features/omr/v3/omrV3Measures.js'
import { assignOmrV3DocumentSymbolOwnership } from '../src/features/omr/v3/omrV3Ownership.js'
import { analyzeOmrV3PageStructure } from '../src/features/omr/v3/omrV3Structure.js'
import {
  buildOmrV3PianoVoiceCandidates,
  countOmrV3VoiceOverlapViolations,
} from '../src/features/omr/v3/omrV3Voices.js'
import {
  createOmrDocumentIR,
  OMR_V3_RELATIONSHIP_TYPE,
  validateOmrDocumentIR,
} from '../src/features/omr/v3/omrV3Ir.js'

function bar(x) {
  return { x, kind: 'barline', confidence: 0.94, verticalSpanRatio: 0.95 }
}

function pianoStructure() {
  const page = analyzeOmrV3PageStructure({
    documentId: 'piano-voice-fixture',
    pageIndex: 0,
    pageWidth: 1000,
    pageHeight: 1400,
    instrumentId: 'piano',
    staffBands: [
      {
        sourceId: 'treble',
        space: 'normalized',
        lineRows: [0.1, 0.11, 0.12, 0.13, 0.14],
        xStart: 0.1,
        xEnd: 0.9,
        clefs: ['treble'],
        noteheadCount: 12,
        barlines: [bar(0.3), bar(0.5), bar(0.7)],
      },
      {
        sourceId: 'bass',
        space: 'normalized',
        lineRows: [0.18, 0.19, 0.2, 0.21, 0.22],
        xStart: 0.1,
        xEnd: 0.9,
        clefs: ['bass'],
        noteheadCount: 10,
        barlines: [bar(0.3), bar(0.5), bar(0.7)],
      },
    ],
  }).page
  return buildOmrV3DocumentMeasureColumns(
    createOmrDocumentIR({ documentId: 'piano-voice-fixture', pages: [page] }),
  ).document
}

function musicalSymbol(id, kind, x, y, overrides = {}) {
  return {
    id,
    kind,
    geometry: { x, y, width: 0.01, height: 0.01, space: 'normalized' },
    confidence: 0.92,
    ...overrides,
  }
}

function ownedPianoDocument(extraSymbols = []) {
  const document = pianoStructure()
  const [treble, bass] = document.pages[0].systems[0].staffGroups[0].staves
  const symbols = [
    musicalSymbol('c5', 'notehead', 0.18, 0.11, {
      midi: 72,
      onsetDivisions: 0,
      durationDivisions: 4,
      stemDirection: 'up',
      stemGroupId: 'stem-up-1',
      beamGroupId: 'beam-up-1',
      slurStart: true,
      slurId: 'slur-a',
      crossStaffTargetStaffId: bass.staffId,
    }),
    musicalSymbol('e5', 'notehead', 0.18, 0.125, {
      midi: 76,
      onsetDivisions: 0,
      durationDivisions: 4,
      stemDirection: 'up',
      stemGroupId: 'stem-up-1',
      beamGroupId: 'beam-up-1',
    }),
    musicalSymbol('c4-down', 'notehead', 0.181, 0.135, {
      midi: 60,
      onsetDivisions: 0,
      durationDivisions: 8,
      stemDirection: 'down',
      stemGroupId: 'stem-down-1',
    }),
    musicalSymbol('d5-tie-start', 'notehead', 0.24, 0.115, {
      midi: 74,
      onsetDivisions: 4,
      durationDivisions: 4,
      stemDirection: 'up',
      stemGroupId: 'stem-up-2',
      beamGroupId: 'beam-up-1',
      tieStart: true,
      tieId: 'tie-a',
    }),
    musicalSymbol('upper-rest', 'rest', 0.265, 0.12, {
      onsetDivisions: 8,
      durationDivisions: 4,
      voiceHint: 1,
    }),
    musicalSymbol('bass-whole', 'notehead', 0.18, 0.195, {
      midi: 48,
      onsetDivisions: 0,
      durationDivisions: 16,
      stemDirection: 'down',
    }),
    musicalSymbol('d5-tie-stop', 'notehead', 0.36, 0.115, {
      midi: 74,
      onsetDivisions: 0,
      durationDivisions: 4,
      stemDirection: 'up',
      tieStop: true,
      tieId: 'tie-a',
      slurStop: true,
      slurId: 'slur-a',
    }),
    ...extraSymbols,
  ]
  return {
    document: assignOmrV3DocumentSymbolOwnership(document, { symbolsByPage: symbols }).document,
    treble,
    bass,
  }
}

function measures(document) {
  return document.pages.flatMap((page) =>
    page.systems.flatMap((system) => system.measureColumns),
  )
}

describe('OMR V3 Piano voice candidates', () => {
  it('builds voices for a single notation staff', () => {
    const page = analyzeOmrV3PageStructure({
      documentId: 'single-notation-voice',
      pageIndex: 0,
      pageWidth: 1000,
      pageHeight: 1400,
      instrumentId: 'piano',
      staffBands: [
        {
          sourceId: 'solo-staff',
          space: 'normalized',
          lineRows: [0.1, 0.11, 0.12, 0.13, 0.14],
          xStart: 0.1,
          xEnd: 0.9,
          clefs: ['treble'],
          noteheadCount: 4,
          barlines: [bar(0.1), bar(0.9)],
        },
      ],
    }).page
    const measured = buildOmrV3DocumentMeasureColumns(
      createOmrDocumentIR({ documentId: 'single-notation-voice', pages: [page] }),
    ).document
    const document = assignOmrV3DocumentSymbolOwnership(measured, {
      symbolsByPage: [
        musicalSymbol('solo-note', 'notehead', 0.3, 0.12, {
          midi: 72,
          onsetDivisions: 0,
          durationDivisions: 4,
        }),
      ],
    }).document
    const result = buildOmrV3PianoVoiceCandidates(document)
    const primary = measures(result.document).flatMap((measure) =>
      measure.voices.filter((voice) => voice.candidateRank === 0),
    )

    expect(result.totals.pianoMeasureCount).toBe(1)
    expect(primary).toHaveLength(1)
  })

  it('builds separate staff voices, shared-onset chords, and rest constraints', () => {
    const input = ownedPianoDocument().document
    const result = buildOmrV3PianoVoiceCandidates(input)
    const firstMeasure = measures(result.document)[0]
    const primary = firstMeasure.voices.filter((voice) => voice.candidateRank === 0)
    const trebleVoices = primary.filter(
      (voice) => voice.staffId === input.pages[0].systems[0].staffGroups[0].staves[0].staffId,
    )

    expect(primary).toHaveLength(3)
    expect(trebleVoices).toHaveLength(2)
    expect(
      trebleVoices.flatMap((voice) => voice.events).filter((event) => event.chordGroupId),
    ).toHaveLength(2)
    expect(primary.flatMap((voice) => voice.events).some((event) => event.kind === 'rest')).toBe(true)
    expect(countOmrV3VoiceOverlapViolations(result.document)).toBe(0)
    expect(result.totals.voiceOverlapViolations).toBe(0)
  })

  it('preserves tie, slur, beam, stem-group, and cross-staff relationships', () => {
    const result = buildOmrV3PianoVoiceCandidates(ownedPianoDocument().document)
    const relationshipTypes = new Set(result.relationships.map((relationship) => relationship.type))

    expect(relationshipTypes).toEqual(
      new Set([
        OMR_V3_RELATIONSHIP_TYPE.TIE,
        OMR_V3_RELATIONSHIP_TYPE.SLUR,
        OMR_V3_RELATIONSHIP_TYPE.BEAM,
        OMR_V3_RELATIONSHIP_TYPE.STEM_GROUP,
        OMR_V3_RELATIONSHIP_TYPE.CROSS_STAFF,
      ]),
    )
    const tiedEvents = measures(result.document)
      .flatMap((measure) => measure.voices)
      .flatMap((voice) => voice.events)
      .filter((event) => event.relationships.length > 0)
    expect(tiedEvents.length).toBeGreaterThan(0)
  })

  it('retains ambiguous overlap and unresolved rhythm candidates without invalid primaries', () => {
    const { document } = ownedPianoDocument([
      musicalSymbol('ambiguous-long', 'notehead', 0.58, 0.11, {
        midi: 67,
        onsetDivisions: 0,
        durationDivisions: 8,
      }),
      musicalSymbol('ambiguous-overlap', 'notehead', 0.64, 0.12, {
        midi: 69,
        onsetDivisions: 4,
        durationDivisions: 4,
      }),
      musicalSymbol('overflow', 'notehead', 0.66, 0.13, {
        midi: 71,
        onsetDivisions: 14,
        durationDivisions: 4,
      }),
      musicalSymbol('unknown-duration', 'notehead', 0.68, 0.12, {
        midi: 72,
        onsetDivisions: 12,
      }),
    ])
    const result = buildOmrV3PianoVoiceCandidates(document)
    const third = measures(result.document)[2]

    expect(third.voices.some((voice) => voice.candidateRank === 1 && voice.ambiguous)).toBe(true)
    expect(third.voices.some((voice) => voice.candidateRank === 2 && voice.ambiguous)).toBe(true)
    expect(third.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'event-exceeds-measure-duration',
    )
    expect(result.totals.rejectedEventGroupCount).toBe(1)
    expect(result.totals.unresolvedEventGroupCount).toBe(1)
    expect(result.totals.voiceOverlapViolations).toBe(0)
  })

  it('is pure and produces a valid serializable IR', () => {
    const input = ownedPianoDocument().document
    const before = JSON.stringify(input)
    const result = buildOmrV3PianoVoiceCandidates(input)

    expect(JSON.stringify(input)).toBe(before)
    expect(result.totals.inputMutated).toBe(false)
    expect(validateOmrDocumentIR(result.document)).toEqual({ valid: true, errors: [], warnings: [] })
    expect(() => JSON.stringify(result.document)).not.toThrow()
  })
})
