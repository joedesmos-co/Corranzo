import { describe, expect, it } from 'vitest'
import {
  analyzeOmrV3PageStructure,
  buildOmrV3StaffCandidates,
  collapseDoubledStaffRows,
  recoverOmrV3DocumentStructure,
  segmentMergedStaffRows,
  summarizeOmrV3Structure,
} from '../src/features/omr/v3/omrV3Structure.js'
import {
  createOmrDocumentIR,
  OMR_V3_NOTATION_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
  validateOmrDocumentIR,
} from '../src/features/omr/v3/omrV3Ir.js'

const BARLINES = [0.12, 0.32, 0.52, 0.72, 0.9]

function staffBand({
  y,
  lines = 5,
  gap = 0.01,
  sourceId = `staff-${y}`,
  clefs = [],
  noteheadCount = 0,
  explicitTab = false,
  tabDigitCount = 0,
  barlines = BARLINES,
  xStart = 0.1,
  xEnd = 0.92,
} = {}) {
  return {
    sourceId,
    space: 'normalized',
    lineRows: Array.from({ length: lines }, (_, index) => y + index * gap),
    xStart,
    xEnd,
    clefs,
    noteheadCount,
    explicitTab,
    tabDigitCount,
    barlines,
    confidence: 0.9,
  }
}

function analyze(staffBands, instrumentId = 'piano') {
  return analyzeOmrV3PageStructure({
    documentId: 'fixture-document',
    pageIndex: 0,
    pageWidth: 1000,
    pageHeight: 1400,
    contentBounds: { x: 0.08, y: 0.05, width: 0.86, height: 0.9, space: 'normalized' },
    staffBands,
    instrumentId,
  })
}

describe('OMR V3 structure-first page analysis', () => {
  it('classifies canonical lines while preserving noisier raw scan rows', () => {
    const result = analyzeOmrV3PageStructure({
      documentId: 'raw-row-provenance',
      pageIndex: 0,
      pageWidth: 1000,
      pageHeight: 1400,
      instrumentId: 'piano',
      staffBands: [
        {
          sourceId: 'scan-staff',
          space: 'normalized',
          lineRows: [0.2, 0.21, 0.22, 0.23, 0.24],
          rawLineRows: [0.1998, 0.2, 0.2098, 0.21, 0.2198, 0.22, 0.2298, 0.23, 0.2398, 0.24],
          xStart: 0.1,
          xEnd: 0.9,
          clefs: ['treble'],
          noteheadCount: 4,
        },
      ],
    })

    const staff = result.page.systems[0].staffGroups[0].staves[0]
    expect(staff.lineCount).toBe(5)
    expect(staff.normalizedLineGeometry).toHaveLength(5)
    expect(staff.rawLineGeometry).toHaveLength(10)
  })

  it('collapses doubled raster rows while preserving their raw groups', () => {
    const result = collapseDoubledStaffRows([100, 101, 110, 111, 120, 121, 130, 131, 140, 141])

    expect(result.rows).toEqual([100.5, 110.5, 120.5, 130.5, 140.5])
    expect(result.groups.every((group) => group.length === 2)).toBe(true)
    expect(result.collapsedCount).toBe(5)
  })

  it('groups two Piano grand staffs without merging across system whitespace', () => {
    const result = analyze([
      staffBand({ y: 0.1, sourceId: 's1-t', clefs: ['treble'], noteheadCount: 8 }),
      staffBand({ y: 0.18, sourceId: 's1-b', clefs: ['bass'], noteheadCount: 6 }),
      staffBand({ y: 0.42, sourceId: 's2-t', clefs: ['treble'], noteheadCount: 10 }),
      staffBand({ y: 0.5, sourceId: 's2-b', clefs: ['bass'], noteheadCount: 7 }),
    ])

    expect(result.page.systems).toHaveLength(2)
    expect(result.page.systems.map((system) => system.readingOrder)).toEqual([0, 1])
    expect(
      result.page.systems.map((system) => system.staffGroups[0].type),
    ).toEqual([
      OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF,
      OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF,
    ])
    expect(result.page.systems.every((system) => system.staffGroups[0].staves.length === 2)).toBe(true)
    expect(result.rejectedPairings.some((pair) => pair.rejectionReason)).toBe(true)
  })

  it('preserves a notation-only single staff as one musical system', () => {
    const result = analyze([
      staffBand({ y: 0.2, sourceId: 'solo', clefs: ['treble'], noteheadCount: 5 }),
    ])

    expect(result.page.systems).toHaveLength(1)
    expect(result.page.systems[0].staffGroups[0].type).toBe(
      OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION,
    )
    expect(result.page.systems[0].staffGroups[0].staves[0].notationType).toBe(
      OMR_V3_NOTATION_TYPE.NOTATION,
    )
  })

  it('uses notation, TAB text/digits, geometry, and barlines to create one Guitar system', () => {
    const result = analyze(
      [
        staffBand({
          y: 0.12,
          sourceId: 'notation',
          clefs: ['treble-8vb'],
          noteheadCount: 8,
        }),
        staffBand({
          y: 0.26,
          lines: 6,
          sourceId: 'tab',
          explicitTab: true,
          tabDigitCount: 12,
        }),
      ],
      'guitar',
    )

    expect(result.page.systems).toHaveLength(1)
    const group = result.page.systems[0].staffGroups[0]
    expect(group.type).toBe(OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB)
    expect(group.staves.map((staff) => staff.notationType)).toEqual([
      OMR_V3_NOTATION_TYPE.NOTATION,
      OMR_V3_NOTATION_TYPE.TAB,
    ])
    expect(group.pairingEvidence.map((entry) => entry.signal)).toContain('barline-alignment')
  })

  it('supports TAB-only systems and does not classify six lines alone as TAB', () => {
    const tabOnly = analyze(
      [staffBand({ y: 0.2, lines: 6, explicitTab: true, tabDigitCount: 6 })],
      'guitar',
    )
    const ambiguous = analyze([staffBand({ y: 0.2, lines: 6 })], 'guitar')

    expect(tabOnly.page.systems[0].staffGroups[0].type).toBe(
      OMR_V3_STAFF_GROUP_TYPE.TAB_ONLY,
    )
    expect(ambiguous.page.systems[0].staffGroups[0].type).toBe(
      OMR_V3_STAFF_GROUP_TYPE.UNKNOWN,
    )
    expect(ambiguous.page.diagnostics.map((entry) => entry.code)).toContain(
      'unassigned-or-ambiguous-staves',
    )
  })

  it('pairs a spacious notation/TAB layout when explicit role and shared barlines agree', () => {
    const result = analyze(
      [
        staffBand({ y: 0.08, clefs: ['treble-8vb'], noteheadCount: 6 }),
        staffBand({
          y: 0.29,
          lines: 6,
          explicitTab: true,
          tabDigitCount: 9,
        }),
      ],
      'guitar',
    )

    expect(result.page.systems).toHaveLength(1)
    expect(result.page.systems[0].staffGroups[0].type).toBe(
      OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB,
    )
  })

  it('splits a regular 10-line merged band but preserves an ambiguous 7-line band', () => {
    const tenLines = [0.1, 0.11, 0.12, 0.13, 0.14, 0.18, 0.19, 0.2, 0.21, 0.22]
    const segmented = segmentMergedStaffRows(tenLines, tenLines.map((row) => [row]))
    expect(segmented.split).toBe(true)
    expect(segmented.segments.map((segment) => segment.rows.length)).toEqual([5, 5])

    const candidateResult = buildOmrV3StaffCandidates({
      documentId: 'merged',
      pageIndex: 0,
      pageWidth: 1000,
      pageHeight: 1400,
      staffBands: [
        {
          sourceId: 'merged-grand',
          space: 'normalized',
          lineRows: tenLines,
          xStart: 0.1,
          xEnd: 0.9,
          clefs: ['treble', 'bass'],
          noteheadCount: 8,
          barlines: BARLINES,
        },
        staffBand({ y: 0.5, lines: 7, sourceId: 'ambiguous-seven', barlines: [] }),
      ],
    })

    expect(candidateResult.candidates.map((staff) => staff.lineCount)).toEqual([5, 5, 7])
    expect(candidateResult.diagnostics.map((entry) => entry.code)).toContain(
      'ambiguous-merged-staff-band',
    )
  })

  it('handles dense pages with three distinct systems in top-to-bottom order', () => {
    const result = analyze([
      staffBand({ y: 0.05, sourceId: 'a1', clefs: ['treble'], noteheadCount: 20 }),
      staffBand({ y: 0.115, sourceId: 'a2', clefs: ['bass'], noteheadCount: 18 }),
      staffBand({ y: 0.35, sourceId: 'b1', clefs: ['treble'], noteheadCount: 24 }),
      staffBand({ y: 0.415, sourceId: 'b2', clefs: ['bass'], noteheadCount: 20 }),
      staffBand({ y: 0.65, sourceId: 'c1', clefs: ['treble'], noteheadCount: 22 }),
      staffBand({ y: 0.715, sourceId: 'c2', clefs: ['bass'], noteheadCount: 19 }),
    ])
    const summary = summarizeOmrV3Structure(result.page)

    expect(summary.systemCount).toBe(3)
    expect(summary.staffCount).toBe(6)
    expect(summary.groupTypes[OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF]).toBe(3)
    expect(result.page.systems.map((system) => system.boundingBox.y)).toEqual(
      [...result.page.systems.map((system) => system.boundingBox.y)].sort((a, b) => a - b),
    )
  })

  it('recovers one incomplete grand staff from repeated document geometry', () => {
    const analysis = analyze([
      staffBand({ y: 0.08, sourceId: 'a-t', clefs: ['treble'], noteheadCount: 8 }),
      staffBand({ y: 0.15, sourceId: 'a-b', clefs: ['bass'], noteheadCount: 7 }),
      staffBand({ y: 0.36, sourceId: 'b-t', clefs: ['treble'], noteheadCount: 8, barlines: [] }),
      staffBand({ y: 0.43, sourceId: 'b-b', clefs: ['bass'], noteheadCount: 7, barlines: [] }),
      staffBand({ y: 0.64, sourceId: 'c-t', clefs: ['treble'], noteheadCount: 8 }),
      staffBand({ y: 0.71, sourceId: 'c-b', clefs: ['bass'], noteheadCount: 7 }),
    ])
    expect(analysis.page.systems).toHaveLength(4)
    const document = createOmrDocumentIR({
      documentId: 'fixture-document',
      pages: [analysis.page],
    })
    const original = JSON.stringify(document)
    const recovered = recoverOmrV3DocumentStructure(document)

    expect(JSON.stringify(document)).toBe(original)
    expect(recovered.recoveredPairings).toHaveLength(1)
    expect(recovered.document.pages[0].systems).toHaveLength(3)
    expect(
      recovered.document.pages[0].systems.every(
        (system) =>
          system.staffGroups[0].type === OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF &&
          system.staffGroups[0].staves.length === 2,
      ),
    ).toBe(true)
    expect(
      recovered.document.pages[0].systems[1].diagnostics.map((entry) => entry.code),
    ).toContain('staff-group-recovered-from-document-continuity')
    expect(validateOmrDocumentIR(recovered.document)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  it('produces a document-valid, serializable structure hierarchy', () => {
    const result = analyze([
      staffBand({ y: 0.1, clefs: ['treble'], noteheadCount: 6 }),
      staffBand({ y: 0.18, clefs: ['bass'], noteheadCount: 6 }),
    ])
    const document = createOmrDocumentIR({
      documentId: 'fixture-document',
      pages: [result.page],
    })

    expect(validateOmrDocumentIR(document)).toEqual({ valid: true, errors: [], warnings: [] })
    expect(() => JSON.stringify(document)).not.toThrow()
  })
})
