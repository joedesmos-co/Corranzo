import { describe, expect, it } from 'vitest'
import {
  buildOmrV3DocumentMeasureColumns,
  buildOmrV3MeasureColumnsForSystem,
  summarizeOmrV3MeasureGeometry,
} from '../src/features/omr/v3/omrV3Measures.js'
import { analyzeOmrV3PageStructure } from '../src/features/omr/v3/omrV3Structure.js'
import {
  createOmrDocumentIR,
  validateOmrDocumentIR,
} from '../src/features/omr/v3/omrV3Ir.js'

function bar(x, overrides = {}) {
  return {
    x,
    confidence: 0.92,
    kind: 'barline',
    verticalSpanRatio: 0.94,
    ...overrides,
  }
}

function staffBand({
  y,
  lines = 5,
  sourceId,
  clefs = [],
  noteheadCount = 0,
  explicitTab = false,
  tabDigitCount = 0,
  barlines = [],
} = {}) {
  return {
    sourceId,
    space: 'normalized',
    lineRows: Array.from({ length: lines }, (_, index) => y + index * 0.01),
    xStart: 0.1,
    xEnd: 0.9,
    clefs,
    noteheadCount,
    explicitTab,
    tabDigitCount,
    barlines,
    confidence: 0.9,
  }
}

function systemFrom(staffBands, instrumentId = 'piano') {
  return analyzeOmrV3PageStructure({
    documentId: 'measure-fixture',
    pageIndex: 0,
    pageWidth: 1000,
    pageHeight: 1400,
    staffBands,
    instrumentId,
  }).page.systems[0]
}

function grandStaff(barlinesByStaff) {
  return systemFrom([
    staffBand({
      y: 0.1,
      sourceId: 'treble',
      clefs: ['treble'],
      noteheadCount: 8,
      barlines: barlinesByStaff[0],
    }),
    staffBand({
      y: 0.18,
      sourceId: 'bass',
      clefs: ['bass'],
      noteheadCount: 7,
      barlines: barlinesByStaff[1],
    }),
  ])
}

describe('OMR V3 shared measure-column geometry', () => {
  it('reconciles Piano barlines into shared columns owned by both staves', () => {
    const bars = [bar(0.3), bar(0.5), bar(0.7)]
    const input = grandStaff([bars, bars.map((entry) => ({ ...entry, x: entry.x + 0.002 }))])
    const result = buildOmrV3MeasureColumnsForSystem(input)

    expect(result.measureColumns).toHaveLength(4)
    expect(result.diagnostics.acceptedBoundaryCount).toBe(3)
    expect(result.measureColumns.every((measure) => measure.expectedStaffParticipation.length === 2)).toBe(true)
    expect(
      result.system.staffGroups[0].staves.every(
        (staff) => staff.measureMembership.length === result.measureColumns.length,
      ),
    ).toBe(true)
  })

  it('uses one timeline for a Guitar notation/TAB staff group', () => {
    const bars = [bar(0.3), bar(0.5), bar(0.7)]
    const input = systemFrom(
      [
        staffBand({
          y: 0.1,
          sourceId: 'notation',
          clefs: ['treble-8vb'],
          noteheadCount: 8,
          barlines: bars,
        }),
        staffBand({
          y: 0.25,
          lines: 6,
          sourceId: 'tab',
          explicitTab: true,
          tabDigitCount: 12,
          barlines: bars,
        }),
      ],
      'guitar',
    )
    const result = buildOmrV3MeasureColumnsForSystem(input)

    expect(result.measureColumns).toHaveLength(4)
    expect(result.system.staffGroups).toHaveLength(1)
    expect(result.system.staffGroups[0].staves).toHaveLength(2)
  })

  it('infers one faint shared boundary from consistent neighboring widths', () => {
    const observed = [bar(0.2), bar(0.3), bar(0.4), bar(0.6), bar(0.7), bar(0.8)]
    const result = buildOmrV3MeasureColumnsForSystem(
      grandStaff([observed, observed]),
      { expectedMeasureWidth: 0.1 },
    )

    expect(result.system.systemBarlines.some((entry) => Math.abs(entry.x - 0.5) < 0.001)).toBe(true)
    expect(result.diagnostics.inferredBoundaryCount).toBe(1)
    expect(result.system.diagnostics.map((entry) => entry.code)).toContain('missing-barline-inferred')
  })

  it('does not subdivide a detector-declared complete measure grid', () => {
    const observed = [0.2, 0.3, 0.4, 0.6, 0.7, 0.8].map((x) =>
      bar(x, { completeGrid: true }),
    )
    const result = buildOmrV3MeasureColumnsForSystem(
      grandStaff([observed, observed]),
      { expectedMeasureWidth: 0.1 },
    )

    expect(result.measureColumns).toHaveLength(7)
    expect(result.diagnostics.inferredBoundaryCount).toBe(0)
    expect(result.diagnostics.completeGridEvidence).toBe(true)
  })

  it('rejects stem-like single-staff candidates instead of inflating measures', () => {
    const input = systemFrom([
      staffBand({
        y: 0.2,
        sourceId: 'solo',
        clefs: ['treble'],
        noteheadCount: 5,
        barlines: [
          bar(0.3),
          bar(0.4, { kind: 'stem', stemLikelihood: 0.95 }),
          bar(0.5),
          bar(0.7),
        ],
      }),
    ])
    const result = buildOmrV3MeasureColumnsForSystem(input)

    expect(result.measureColumns).toHaveLength(4)
    expect(result.diagnostics.rejectedBoundaryCount).toBe(1)
    expect(result.system.diagnostics.map((entry) => entry.code)).toContain('barline-candidate-rejected')
  })

  it('preserves an empty interior measure column', () => {
    const bars = [bar(0.3), bar(0.5), bar(0.7)]
    const result = buildOmrV3MeasureColumnsForSystem(grandStaff([bars, bars]), {
      symbolXs: [0.2, 0.35, 0.75],
    })

    expect(result.measureColumns).toHaveLength(4)
    expect(result.measureColumns[2]).toMatchObject({ xStart: 0.5, xEnd: 0.7 })
  })

  it('rejects a short empty synthetic trailing span', () => {
    const bars = [bar(0.3), bar(0.5), bar(0.7), bar(0.84)]
    const result = buildOmrV3MeasureColumnsForSystem(grandStaff([bars, bars]), {
      expectedMeasureWidth: 0.2,
      symbolXs: [0.2, 0.4, 0.6, 0.8],
    })

    expect(result.diagnostics.trailingSpanRejected).toBe(true)
    expect(result.measureColumns.at(-1).xEnd).toBeCloseTo(0.84)
    expect(result.system.diagnostics.map((entry) => entry.code)).toContain(
      'invented-trailing-measure-rejected',
    )
  })

  it('recovers sparse boundaries from stable neighboring-system widths', () => {
    const completeBars = [bar(0.3), bar(0.5), bar(0.7)]
    const first = grandStaff([completeBars, completeBars])
    const sparse = analyzeOmrV3PageStructure({
      documentId: 'measure-continuity',
      pageIndex: 1,
      pageWidth: 1000,
      pageHeight: 1400,
      staffBands: [
        staffBand({
          y: 0.1,
          sourceId: 'sparse-treble',
          clefs: ['treble'],
          noteheadCount: 8,
          barlines: [bar(0.5)],
        }),
        staffBand({
          y: 0.18,
          sourceId: 'sparse-bass',
          clefs: ['bass'],
          noteheadCount: 7,
          barlines: [bar(0.5)],
        }),
      ],
      instrumentId: 'piano',
    }).page.systems[0]
    const document = createOmrDocumentIR({
      documentId: 'measure-continuity',
      pages: [
        { pageIndex: 0, width: 1000, height: 1400, systems: [first] },
        { pageIndex: 1, width: 1000, height: 1400, systems: [sparse] },
      ],
    })
    const result = buildOmrV3DocumentMeasureColumns(document)
    const secondSystem = result.document.pages[1].systems[0]

    expect(secondSystem.measureColumns).toHaveLength(4)
    expect(
      secondSystem.systemBarlines.filter((entry) => entry.kind === 'inferred-missing-barline'),
    ).toHaveLength(2)
    expect(result.systems[1].strongExternalWidthConsensus).toBe(true)
    expect(result.totalMeasures).toBe(8)
  })

  it('numbers columns across systems without mutating the source document', () => {
    const bars = [bar(0.3), bar(0.5), bar(0.7)]
    const first = grandStaff([bars, bars])
    const secondAnalysis = analyzeOmrV3PageStructure({
      documentId: 'measure-fixture',
      pageIndex: 1,
      pageWidth: 1000,
      pageHeight: 1400,
      staffBands: [
        staffBand({
          y: 0.2,
          sourceId: 'page-two-solo',
          clefs: ['treble'],
          noteheadCount: 5,
          barlines: bars,
        }),
      ],
      instrumentId: 'piano',
    })
    const document = createOmrDocumentIR({
      documentId: 'measure-fixture',
      pages: [
        {
          pageIndex: 0,
          width: 1000,
          height: 1400,
          systems: [first],
        },
        secondAnalysis.page,
      ],
    })
    const original = JSON.stringify(document)
    const result = buildOmrV3DocumentMeasureColumns(document)

    expect(JSON.stringify(document)).toBe(original)
    expect(result.totalMeasures).toBe(8)
    expect(
      result.document.pages.flatMap((page) => page.systems).flatMap((system) => system.measureColumns)
        .map((measure) => measure.measureNumber),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(summarizeOmrV3MeasureGeometry(result.document).measureCount).toBe(8)
    expect(validateOmrDocumentIR(result.document)).toEqual({ valid: true, errors: [], warnings: [] })
  })
})
