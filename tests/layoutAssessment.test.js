/**
 * Robust PDF score alignment: the PDF is the source of truth for page/system/
 * measure placement; MusicXML supplies timing/notes/widths but its embedded
 * layout must not override the printed PDF when they disagree.
 *
 * Covers the honest layer that is verifiable without a canvas: layout-mismatch
 * detection, confidence grading, and that PDF-derived per-system counts (the
 * preferred allocation) reproduce the printed system starts — including final
 * systems with fewer measures. The pixel detection that produces those counts
 * is unchanged here.
 */
import { describe, expect, it } from 'vitest'
import {
  allocateSpansByCounts,
  groupMeasuresBySystemBreaks,
} from '../src/features/score-follow/allocateMeasuresToSystems.js'
import {
  ALLOCATION_MODE,
  LAYOUT_CONFIDENCE,
  LAYOUT_MISMATCH_MESSAGE,
  assessLayoutConfidence,
  detectLayoutMismatch,
  pageCountFromMusicXml,
  systemStartsFromMusicXml,
  systemStartsFromSpans,
} from '../src/features/score-follow/layoutAssessment.js'

// Printed PDF system starts the user verified for Guren (4 pages, 19 systems).
const GUREN_PRINTED_STARTS = [
  1, 6, 11, 15, 19, // page 1
  23, 27, 31, 35, 38, 41, // page 2
  45, 49, 53, 57, 61, // page 3
  65, 69, 74, // page 4
]
// Pages each printed system belongs to.
const GUREN_PRINTED_PAGES = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4]
// MusicXML `<print>` system starts for the same file (a different engraving).
const GUREN_MUSICXML_STARTS = [
  1, 6, 10, 14, 18, 22, 26, 30, 34, 37, 40, 44, 48, 52, 56, 60, 64, 68, 72,
]

const measureNumbers = Array.from({ length: 75 }, (_, i) => i + 1)

function countsFromStarts(starts, lastMeasure) {
  return starts.map((start, i) =>
    (i + 1 < starts.length ? starts[i + 1] - 1 : lastMeasure) - start + 1,
  )
}

describe('Guren printed layout via PDF barline counts', () => {
  const counts = countsFromStarts(GUREN_PRINTED_STARTS, 75)
  const entries = GUREN_PRINTED_PAGES.map((page) => ({ page }))
  const spans = allocateSpansByCounts(entries, measureNumbers, counts)

  it('reproduces all four pages of printed system starts', () => {
    expect(systemStartsFromSpans(spans)).toEqual(GUREN_PRINTED_STARTS)
  })

  it('is contiguous and covers every measure (incl. the short final system 74–75)', () => {
    expect(spans[0].measureStart).toBe(1)
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].measureStart).toBe(spans[i - 1].measureEnd + 1)
    }
    const last = spans.at(-1)
    expect(last.measureStart).toBe(74)
    expect(last.measureEnd).toBe(75)
    expect(last.measuresInSpan).toBe(2)
  })

  it('assigns systems to the correct printed pages', () => {
    expect(spans.map((s) => s.page)).toEqual(GUREN_PRINTED_PAGES)
  })
})

describe('layout mismatch detection (PDF wins)', () => {
  it('flags Guren: MusicXML layout differs from the printed PDF', () => {
    const result = detectLayoutMismatch({
      pdfStarts: GUREN_PRINTED_STARTS,
      musicXmlStarts: GUREN_MUSICXML_STARTS,
      pdfPageCount: 4,
      musicXmlPageCount: 5,
    })
    expect(result.mismatch).toBe(true)
    expect(result.message).toBe(LAYOUT_MISMATCH_MESSAGE)
    expect(result.reasons.join(' ')).toMatch(/system|page/i)
  })

  it('does NOT flag a matching layout (good scores like Iris/Gymnopédie)', () => {
    const starts = [1, 5, 9, 13]
    const result = detectLayoutMismatch({
      pdfStarts: starts,
      musicXmlStarts: starts,
      pdfPageCount: 2,
      musicXmlPageCount: 2,
    })
    expect(result.mismatch).toBe(false)
    expect(result.message).toBeNull()
    expect(result.reasons).toEqual([])
  })

  it('flags a pure page-count difference even when system starts line up', () => {
    const starts = [1, 5, 9, 13]
    const result = detectLayoutMismatch({
      pdfStarts: starts,
      musicXmlStarts: starts,
      pdfPageCount: 2,
      musicXmlPageCount: 3,
    })
    expect(result.mismatch).toBe(true)
    expect(result.reasons.some((r) => /page/i.test(r))).toBe(true)
  })

  it('flags differing per-system boundaries at equal system count', () => {
    const result = detectLayoutMismatch({
      pdfStarts: [1, 6, 11, 15],
      musicXmlStarts: [1, 6, 10, 14],
    })
    expect(result.mismatch).toBe(true)
    expect(result.reasons[0]).toMatch(/2 system starts differ/)
  })
})

describe('layout confidence grading', () => {
  it('EXACT: staff-line systems + barline counts that agree with score data', () => {
    const c = assessLayoutConfidence({
      stage: 'staff-lines',
      allocationMode: ALLOCATION_MODE.BARLINE_COUNTS,
      plausible: true,
      lowConfidence: false,
      mismatch: false,
    })
    expect(c.level).toBe(LAYOUT_CONFIDENCE.EXACT)
  })

  it('GOOD: PDF barlines used but printed layout differs from score data', () => {
    const c = assessLayoutConfidence({
      stage: 'staff-lines',
      allocationMode: ALLOCATION_MODE.BARLINE_COUNTS,
      plausible: true,
      lowConfidence: false,
      mismatch: true,
    })
    expect(c.level).toBe(LAYOUT_CONFIDENCE.GOOD)
  })

  it('APPROXIMATE: MusicXML fallback (PDF systems not detected)', () => {
    const c = assessLayoutConfidence({
      stage: 'geometric',
      allocationMode: ALLOCATION_MODE.MUSICXML_FALLBACK,
      plausible: true,
      lowConfidence: true,
      mismatch: false,
    })
    expect(c.level).toBe(LAYOUT_CONFIDENCE.APPROXIMATE)
  })

  it('NEEDS_SETUP: implausible mapping → quick setup', () => {
    const c = assessLayoutConfidence({ plausible: false })
    expect(c.level).toBe(LAYOUT_CONFIDENCE.NEEDS_SETUP)
  })

  it('reports the weakest (lowest-ink) system index', () => {
    const c = assessLayoutConfidence({
      stage: 'staff-lines',
      allocationMode: ALLOCATION_MODE.BARLINE_COUNTS,
      plausible: true,
      perSystemInk: [0.9, 0.4, 0.8],
    })
    expect(c.weakestSystem).toBe(1)
  })
})

describe('MusicXML layout helpers', () => {
  const timingMap = {
    measures: measureNumbers.map((n) => ({
      number: n,
      systemBreakBefore: GUREN_MUSICXML_STARTS.includes(n) && n !== 1,
      pageBreakBefore: [18, 37, 52, 68].includes(n),
    })),
  }

  it('derives MusicXML system starts from <print new-system> hints', () => {
    expect(systemStartsFromMusicXml(timingMap)).toEqual(GUREN_MUSICXML_STARTS)
  })

  it('counts MusicXML pages from <print new-page> hints', () => {
    expect(pageCountFromMusicXml(timingMap)).toBe(5)
  })

  it('groupMeasuresBySystemBreaks matches the MusicXML starts (and not the print)', () => {
    const starts = groupMeasuresBySystemBreaks(measureNumbers, timingMap).map((g) => g[0])
    expect(starts).toEqual(GUREN_MUSICXML_STARTS)
    expect(starts).not.toEqual(GUREN_PRINTED_STARTS)
  })
})
