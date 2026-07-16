import { describe, expect, it } from 'vitest'
import { buildOmrV3DocumentMeasureColumns } from '../src/features/omr/v3/omrV3Measures.js'
import {
  assignOmrV3DocumentSymbolOwnership,
  assignOmrV3PageSymbolOwnership,
} from '../src/features/omr/v3/omrV3Ownership.js'
import { analyzeOmrV3PageStructure } from '../src/features/omr/v3/omrV3Structure.js'
import { createOmrDocumentIR, validateOmrDocumentIR } from '../src/features/omr/v3/omrV3Ir.js'

function bar(x) {
  return { x, kind: 'barline', confidence: 0.94, verticalSpanRatio: 0.95 }
}

function staffBand({ y, lines = 5, sourceId, tab = false } = {}) {
  return {
    sourceId,
    space: 'normalized',
    lineRows: Array.from({ length: lines }, (_, index) => y + index * 0.01),
    xStart: 0.1,
    xEnd: 0.9,
    clefs: tab ? [] : ['treble-8vb'],
    noteheadCount: tab ? 0 : 10,
    explicitTab: tab,
    tabDigitCount: tab ? 12 : 0,
    barlines: [bar(0.3), bar(0.5), bar(0.7)],
    confidence: 0.9,
  }
}

function guitarDocument() {
  const structure = analyzeOmrV3PageStructure({
    documentId: 'ownership-fixture',
    pageIndex: 0,
    pageWidth: 1000,
    pageHeight: 1400,
    instrumentId: 'guitar',
    staffBands: [
      staffBand({ y: 0.1, sourceId: 'notation' }),
      staffBand({ y: 0.25, lines: 6, sourceId: 'tab', tab: true }),
    ],
  })
  const document = createOmrDocumentIR({
    documentId: 'ownership-fixture',
    pages: [structure.page],
  })
  return buildOmrV3DocumentMeasureColumns(document).document
}

function symbol(id, kind, x, y, overrides = {}) {
  return {
    id,
    kind,
    geometry: { x, y, width: 0.01, height: 0.01, space: 'normalized' },
    confidence: 0.9,
    ...overrides,
  }
}

function allMeasures(page) {
  return page.systems.flatMap((system) => system.measureColumns)
}

describe('OMR V3 symbol ownership and onset columns', () => {
  it('groups vertical note stacks and aligned notation/TAB evidence into one onset', () => {
    const document = guitarDocument()
    const result = assignOmrV3PageSymbolOwnership(document.pages[0], [
      symbol('high', 'notehead', 0.193, 0.1),
      symbol('low', 'notehead', 0.193, 0.125),
      symbol('fret-1', 'tab-digit', 0.19, 0.27, {
        text: '1',
        string: 2,
        geometry: { x: 0.19, y: 0.27, width: 0.008, height: 0.01, space: 'normalized' },
      }),
      symbol('fret-2', 'tab-digit', 0.198, 0.27, {
        text: '2',
        string: 2,
        geometry: { x: 0.198, y: 0.27, width: 0.008, height: 0.01, space: 'normalized' },
      }),
      symbol('stem', 'stem', 0.195, 0.1),
      symbol('sharp', 'accidental', 0.181, 0.1),
    ])

    const onset = allMeasures(result.page)[0].onsetColumns[0]
    expect(onset.symbols.noteheads).toHaveLength(2)
    expect(onset.symbols.tabDigits).toHaveLength(1)
    expect(onset.symbols.stems).toHaveLength(1)
    expect(onset.symbols.accidentals).toHaveLength(1)
    expect(result.symbols.find((entry) => entry.kind === 'tab-digit')).toMatchObject({
      text: '12',
      value: 12,
    })
    expect(result.summary.mergedTabDigitCount).toBe(1)
  })

  it('keeps repeated notes and grace notes in distinct onset columns', () => {
    const document = guitarDocument()
    const result = assignOmrV3PageSymbolOwnership(document.pages[0], [
      symbol('repeat-a', 'notehead', 0.35, 0.11),
      symbol('repeat-b', 'notehead', 0.37, 0.11),
      symbol('grace', 'notehead', 0.43, 0.11, { grace: true }),
      symbol('principal', 'notehead', 0.43, 0.12),
    ])
    const columns = allMeasures(result.page)[1].onsetColumns

    expect(columns).toHaveLength(4)
    expect(columns.filter((column) => column.grace)).toHaveLength(1)
    expect(new Set(columns.map((column) => column.onsetColumnId)).size).toBe(4)
  })

  it('excludes lyrics, chord text, and watermarks without creating duplicate onsets', () => {
    const document = guitarDocument()
    const result = assignOmrV3PageSymbolOwnership(document.pages[0], [
      symbol('anchor', 'notehead', 0.59, 0.11),
      symbol('lyric', 'lyric', 0.59, 0.14, { text: 'love' }),
      symbol('chord', 'chord-symbol', 0.585, 0.09, { text: 'Am7' }),
      symbol('mark', 'watermark', 0.595, 0.12, { text: 'SAMPLE' }),
    ])
    const measure = allMeasures(result.page)[2]

    expect(measure.onsetColumns).toHaveLength(1)
    expect(measure.onsetColumns[0].symbols.excludedSymbols).toHaveLength(3)
    expect(result.summary.excludedSymbolCount).toBe(3)
  })

  it('retains safe structural ownership and reports symbols outside every system', () => {
    const document = guitarDocument()
    const result = assignOmrV3PageSymbolOwnership(document.pages[0], [
      symbol('owned', 'notehead', 0.2, 0.11),
      symbol('outside', 'notehead', 0.2, 0.9),
    ])
    const owned = result.symbols.find((entry) => entry.sourceRefs.includes('owned'))

    expect(owned.ownership).toMatchObject({
      pageId: document.pages[0].pageId,
      systemId: document.pages[0].systems[0].systemId,
      measureId: document.pages[0].systems[0].measureColumns[0].measureId,
    })
    expect(owned.ownership.staffGroupId).toBeTruthy()
    expect(owned.ownership.staffId).toBeTruthy()
    expect(owned.ownership.onsetColumnId).toBeTruthy()
    expect(result.page.unassignedSymbols).toHaveLength(1)
    expect(result.page.unassignedSymbols[0].rejectionReason).toBe('no-safe-structural-owner')
  })

  it('applies ownership document-wide as a pure, serializable transformation', () => {
    const document = guitarDocument()
    const before = JSON.stringify(document)
    const result = assignOmrV3DocumentSymbolOwnership(document, {
      symbolsByPage: [symbol('note', 'notehead', 0.2, 0.11)],
    })

    expect(JSON.stringify(document)).toBe(before)
    expect(result.totals).toMatchObject({
      inputSymbolCount: 1,
      assignedSymbolCount: 1,
      unassignedSymbolCount: 0,
      onsetColumnCount: 1,
    })
    expect(validateOmrDocumentIR(result.document)).toEqual({ valid: true, errors: [], warnings: [] })
    expect(() => JSON.stringify(result.document)).not.toThrow()
  })
})
