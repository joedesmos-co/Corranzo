import { describe, expect, it } from 'vitest'
import { buildOmrV3GuitarFusion } from '../src/features/omr/v3/omrV3Guitar.js'
import { buildOmrV3DocumentMeasureColumns } from '../src/features/omr/v3/omrV3Measures.js'
import { assignOmrV3DocumentSymbolOwnership } from '../src/features/omr/v3/omrV3Ownership.js'
import { analyzeOmrV3PageStructure } from '../src/features/omr/v3/omrV3Structure.js'
import {
  createOmrDocumentIR,
  OMR_V3_RELATIONSHIP_TYPE,
  validateOmrDocumentIR,
} from '../src/features/omr/v3/omrV3Ir.js'

function bar(x) {
  return { x, kind: 'barline', confidence: 0.94, verticalSpanRatio: 0.95 }
}

function band({ y, lines = 5, sourceId, tab = false } = {}) {
  return {
    sourceId,
    space: 'normalized',
    lineRows: Array.from({ length: lines }, (_, index) => y + index * 0.01),
    xStart: 0.1,
    xEnd: 0.9,
    clefs: tab ? [] : ['treble-8vb'],
    noteheadCount: tab ? 0 : 12,
    explicitTab: tab,
    tabDigitCount: tab ? 12 : 0,
    barlines: [bar(0.3), bar(0.5), bar(0.7)],
    confidence: 0.9,
  }
}

function structuralDocument(mode = 'notation-tab', { largeGap = false } = {}) {
  const staffBands =
    mode === 'tab-only'
      ? [band({ y: 0.2, lines: 6, sourceId: 'tab', tab: true })]
      : mode === 'notation-only'
        ? [band({ y: 0.16, sourceId: 'notation' })]
        : [
            band({ y: 0.08, sourceId: 'notation' }),
            band({ y: largeGap ? 0.29 : 0.22, lines: 6, sourceId: 'tab', tab: true }),
          ]
  const page = analyzeOmrV3PageStructure({
    documentId: `guitar-${mode}`,
    pageIndex: 0,
    pageWidth: 1000,
    pageHeight: 1400,
    instrumentId: 'guitar',
    staffBands,
  }).page
  return buildOmrV3DocumentMeasureColumns(
    createOmrDocumentIR({
      documentId: `guitar-${mode}`,
      metadata: { instrumentId: 'guitar' },
      pages: [page],
    }),
  ).document
}

function symbol(id, kind, x, y, overrides = {}) {
  return {
    id,
    kind,
    geometry: { x, y, width: 0.008, height: 0.009, space: 'normalized' },
    confidence: 0.92,
    ...overrides,
  }
}

function fuse(document, symbols) {
  const owned = assignOmrV3DocumentSymbolOwnership(document, { symbolsByPage: symbols }).document
  return buildOmrV3GuitarFusion(owned)
}

function events(document) {
  return document.pages.flatMap((page) =>
    page.systems.flatMap((system) =>
      system.measureColumns.flatMap((measure) =>
        measure.voices.flatMap((voice) => voice.events),
      ),
    ),
  )
}

describe('OMR V3 Guitar notation/TAB fusion', () => {
  it('creates one six-note chord timeline from notation rhythm plus TAB position', () => {
    const document = structuralDocument('notation-tab', { largeGap: true })
    const strings = [1, 2, 3, 4, 5, 6]
    const frets = [0, 1, 2, 3, 2, 0]
    const sounding = [64, 60, 57, 53, 47, 40]
    const symbols = strings.flatMap((stringNumber, index) => [
      symbol(`note-${stringNumber}`, 'notehead', 0.19, 0.075 + index * 0.012, {
        midi: sounding[index] + 12,
        onsetDivisions: 0,
        durationDivisions: 4,
      }),
      symbol(`tab-${stringNumber}`, 'tab-digit', 0.19, 0.285 + index * 0.01, {
        text: String(frets[index]),
        string: stringNumber,
        technical: stringNumber === 2 ? { hammerOn: true } : {},
      }),
    ])
    const result = fuse(document, symbols)
    const fused = events(result.document)

    expect(fused).toHaveLength(6)
    expect(new Set(fused.map((event) => event.chordGroupId)).size).toBe(1)
    expect(new Set(fused.map((event) => event.string))).toEqual(new Set(strings))
    expect(fused.every((event) => event.pitch.writtenMidi - event.pitch.soundingMidi === 12)).toBe(true)
    expect(fused.find((event) => event.string === 2).technical.hammerOn).toBe(true)
    expect(result.relationships).toHaveLength(6)
    expect(
      result.relationships.every(
        (relationship) => relationship.type === OMR_V3_RELATIONSHIP_TYPE.NOTATION_TAB_MIRROR,
      ),
    ).toBe(true)
    expect(result.totals).toMatchObject({ eventCount: 6, pairedCount: 6, duplicateEventCount: 0 })
  })

  it('keeps a multi-digit fret intact and does not emit its TAB mirror', () => {
    const result = fuse(structuralDocument(), [
      symbol('note-e4', 'notehead', 0.19, 0.09, {
        midi: 64,
        onsetDivisions: 0,
        durationDivisions: 4,
      }),
      symbol('fret-one', 'tab-digit', 0.188, 0.25, {
        text: '1',
        string: 6,
      }),
      symbol('fret-two', 'tab-digit', 0.196, 0.25, {
        text: '2',
        string: 6,
      }),
    ])
    const fused = events(result.document)

    expect(fused).toHaveLength(1)
    expect(fused[0]).toMatchObject({ string: 6, fret: 12 })
    expect(fused[0].pitch).toMatchObject({ writtenMidi: 64, soundingMidi: 52 })
    expect(result.totals.duplicateEventCount).toBe(0)
  })

  it('retains notation events with missing TAB, rejects extra TAB duplication, and excludes watermarks', () => {
    const result = fuse(structuralDocument(), [
      symbol('paired-note', 'notehead', 0.19, 0.09, {
        midi: 64,
        onsetDivisions: 0,
        durationDivisions: 4,
      }),
      symbol('unpaired-note', 'notehead', 0.19, 0.11, {
        midi: 67,
        onsetDivisions: 0,
        durationDivisions: 4,
      }),
      symbol('matching-tab', 'tab-digit', 0.19, 0.25, { text: '2', string: 4 }),
      symbol('extra-tab', 'tab-digit', 0.19, 0.26, { text: '7', string: 1 }),
      symbol('watermark', 'watermark', 0.19, 0.12, { text: 'SAMPLE' }),
      symbol('capo', 'capo', 0.2, 0.1, { text: 'capo 2', warning: 'Capo 2 requires review.' }),
      symbol('coda', 'coda', 0.21, 0.1, { warning: 'Coda navigation preserved.' }),
    ])
    const fused = events(result.document)
    const diagnostics = result.document.pages[0].systems[0].measureColumns[0].diagnostics
    const systemDiagnostics = result.document.pages[0].systems[0].diagnostics

    expect(fused).toHaveLength(2)
    expect(diagnostics.map((entry) => entry.code)).toContain('guitar-notation-event-unpaired-tab')
    expect(diagnostics.map((entry) => entry.code)).toContain('guitar-tab-evidence-unpaired')
    expect(systemDiagnostics.filter((entry) => entry.code === 'guitar-control-warning-preserved')).toHaveLength(2)
    expect(fused.some((event) => event.technical.tabSymbolId === 'watermark')).toBe(false)
    expect(result.totals.duplicateEventCount).toBe(0)
  })

  it('marks TAB-only chord timing approximate instead of claiming exact rhythm', () => {
    const result = fuse(structuralDocument('tab-only'), [
      symbol('tab-a', 'tab-digit', 0.19, 0.21, { text: '3', string: 1 }),
      symbol('tab-b', 'tab-digit', 0.19, 0.23, { text: '5', string: 2 }),
      symbol('tab-c', 'tab-digit', 0.24, 0.25, { text: '7', string: 3 }),
    ])
    const fused = events(result.document)
    const firstMeasure = result.document.pages[0].systems[0].measureColumns[0]

    expect(fused).toHaveLength(3)
    expect(fused.every((event) => event.duration.exact === false)).toBe(true)
    expect(fused.every((event) => event.technical.approximateRhythm)).toBe(true)
    expect(firstMeasure.voices.every((voice) => voice.ambiguous)).toBe(true)
    expect(firstMeasure.diagnostics.map((entry) => entry.code)).toContain(
      'tab-only-approximate-rhythm',
    )
  })

  it('supports standard-notation Guitar without inventing TAB data', () => {
    const result = fuse(structuralDocument('notation-only'), [
      symbol('standard-note', 'notehead', 0.19, 0.17, {
        midi: 64,
        onsetDivisions: 0,
        durationDivisions: 4,
      }),
    ])
    const fused = events(result.document)

    expect(fused).toHaveLength(1)
    expect(fused[0]).toMatchObject({ string: null, fret: null })
    expect(result.relationships).toHaveLength(0)
  })

  it('is pure and emits valid serializable relationships', () => {
    const document = structuralDocument()
    const owned = assignOmrV3DocumentSymbolOwnership(document, {
      symbolsByPage: [
        symbol('note', 'notehead', 0.19, 0.09, {
          midi: 64,
          onsetDivisions: 0,
          durationDivisions: 4,
        }),
        symbol('tab', 'tab-digit', 0.19, 0.25, { text: '2', string: 4 }),
      ],
    }).document
    const before = JSON.stringify(owned)
    const result = buildOmrV3GuitarFusion(owned)

    expect(JSON.stringify(owned)).toBe(before)
    expect(result.totals.inputMutated).toBe(false)
    expect(validateOmrDocumentIR(result.document)).toEqual({ valid: true, errors: [], warnings: [] })
    expect(() => JSON.stringify(result.document)).not.toThrow()
  })
})
