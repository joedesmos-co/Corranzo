import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildTabMeasureEvents,
  classifySystemStaves,
  detectTabTextAnnotations,
  extractTabDigitNotes,
  resolveGuitarSystemRoles,
  systemsContainTablature,
  TAB_APPROXIMATE_RHYTHM_WARNING,
  TAB_CAPO_UNSUPPORTED_WARNING,
  TAB_COMPRESSED_TIMING_WARNING,
  TAB_NO_USABLE_NOTES_MESSAGE,
  TAB_REPEAT_CODA_WARNING,
  TAB_TEMPO_TEXT_WARNING,
} from '../src/features/omr/detectTabNotation.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { getInstrument } from '../src/features/instruments/instruments.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../src/features/omr/omrDiagnosticFlags.js'

function makeWhitePage(width = 1000, height = 700) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  return { width, height, data }
}

function setInk(page, x, y) {
  if (x < 0 || y < 0 || x >= page.width || y >= page.height) {
    return
  }
  const index = (Math.round(y) * page.width + Math.round(x)) * 4
  page.data[index] = 24
  page.data[index + 1] = 24
  page.data[index + 2] = 24
}

function drawHorizontal(page, y, x0, x1) {
  for (let x = x0; x <= x1; x += 1) {
    setInk(page, x, y)
  }
}

function drawVertical(page, x, y0, y1) {
  for (let y = y0; y <= y1; y += 1) {
    setInk(page, x, y)
  }
}

function drawStaff(page, top, lineCount, { x0 = 100, x1 = 900, gap = 10 } = {}) {
  for (let line = 0; line < lineCount; line += 1) {
    drawHorizontal(page, top + line * gap, x0, x1)
  }
  return { top, bottom: top + (lineCount - 1) * gap }
}

function tabTextItem(page, { text, x, y, width = 8, height = 10, fontName = 'TabDigit' }) {
  return {
    text,
    x,
    y: page.height - y,
    width,
    height,
    fontName,
    pageWidth: page.width,
    pageHeight: page.height,
  }
}

describe('guitar OMR tablature detection', () => {
  beforeAll(() => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
  })

  it('uses raw six-line staff positions for TAB even when pitch lineYs are five-line', () => {
    const detectedLineYs = [0.2, 0.28, 0.36, 0.44, 0.52, 0.6]
    const system = {
      lineCount: 6,
      detectedLineYs,
      lineYs: detectedLineYs.slice(0, 5),
    }

    const classified = classifySystemStaves(system, { stringCount: 6 })
    expect(classified.notationStaves).toHaveLength(0)
    expect(classified.tabStaves).toHaveLength(1)
    expect(classified.tabStaves[0].lineYs).toEqual(detectedLineYs)
    expect(systemsContainTablature([system], { stringCount: 6 })).toBe(true)

    const notes = extractTabDigitNotes(
      [{ text: '3', x: 50, y: 60, width: 4 }],
      classified.tabStaves[0],
      [{ measureNumber: 1, x0: 0.1, playableX0: 0.1, x1: 0.9 }],
      { width: 100, height: 100 },
    )

    expect(notes).toEqual([
      expect.objectContaining({
        measureNumber: 1,
        string: 6,
        fret: 3,
      }),
    ])
  })

  it('does not classify five-line notation staves as TAB', () => {
    const system = {
      lineCount: 5,
      detectedLineYs: [0.2, 0.28, 0.36, 0.44, 0.52],
      lineYs: [0.2, 0.28, 0.36, 0.44, 0.52],
    }

    expect(classifySystemStaves(system, { stringCount: 6 }).tabStaves).toHaveLength(0)
    expect(systemsContainTablature([system], { stringCount: 6 })).toBe(false)
  })

  it('collapses doubled raster rows before classifying six-line TAB staves', () => {
    const tabLineYs = [0.32, 0.33, 0.34, 0.35, 0.36, 0.37]
    const doubled = tabLineYs.flatMap((y) => [y, y + 0.0007])
    const system = {
      lineCount: doubled.length,
      detectedLineYs: doubled,
      lineYs: doubled.slice(0, 5),
    }

    const classified = classifySystemStaves(system, { stringCount: 6 })

    expect(classified.notationStaves).toHaveLength(0)
    expect(classified.tabStaves).toHaveLength(1)
    expect(classified.tabStaves[0].lineYs).toHaveLength(6)
    expect(systemsContainTablature([system], { stringCount: 6 })).toBe(true)
  })

  it('keeps first-beat TAB digits left of the cursor playable start', () => {
    const tabStave = {
      lineYs: [0.2, 0.28, 0.36, 0.44, 0.52, 0.6],
    }

    const notes = extractTabDigitNotes(
      [
        { text: '0', x: 15, y: 20, width: 4 },
        { text: '1', x: 35, y: 20, width: 4 },
      ],
      tabStave,
      [{ measureNumber: 1, x0: 0.1, playableX0: 0.3, x1: 0.5 }],
      { width: 100, height: 100 },
    )

    expect(notes.map((note) => note.fret)).toEqual([0, 1])
    expect(notes.every((note) => note.measureNumber === 1)).toBe(true)
  })

  it('rejects chord symbols, lyric numbers, and watermark digits as TAB frets', () => {
    const tabStave = {
      lineYs: [0.2, 0.22, 0.24, 0.26, 0.28, 0.3],
    }
    const imageData = { width: 1000, height: 1000 }
    const y = tabStave.lineYs[2] * imageData.height

    const notes = extractTabDigitNotes(
      [
        { text: '3', sourceText: '3', x: 160, y, width: 8, height: 12 },
        { text: '7', sourceText: 'G7', x: 260, y, width: 8, height: 12 },
        { text: '4', sourceText: 'lyric 4', x: 360, y, width: 8, height: 12 },
        { text: '2', sourceText: '2024', x: 460, y, width: 44, height: 90 },
      ],
      tabStave,
      [{ measureNumber: 1, x0: 0.1, playableX0: 0.1, x1: 0.6 }],
      imageData,
    )

    expect(notes.map((note) => note.fret)).toEqual([3])
  })

  it('clusters adjacent TAB digits on one string into multi-digit frets', () => {
    const tabStave = {
      lineYs: [0.2, 0.22, 0.24, 0.26, 0.28, 0.3],
    }
    const imageData = { width: 1000, height: 1000 }
    const y = tabStave.lineYs[0] * imageData.height

    const notes = extractTabDigitNotes(
      [
        { text: '1', sourceText: '10', x: 160, y, width: 8, height: 12 },
        { text: '0', sourceText: '10', x: 168, y, width: 8, height: 12 },
        { text: '3', sourceText: '3', x: 260, y, width: 8, height: 12 },
      ],
      tabStave,
      [{ measureNumber: 1, x0: 0.1, playableX0: 0.1, x1: 0.4 }],
      imageData,
    )

    expect(notes.map((note) => note.fret)).toEqual([10, 3])
    expect(notes[0]).toEqual(expect.objectContaining({ string: 1, midi: 74 }))
  })


  it('detects unsupported TAB-only text annotations without applying them silently', () => {
    const annotations = detectTabTextAnnotations([
      { text: 'Capo 2' },
      { text: 'D.S. al Coda' },
      { text: '1.' },
      { text: 'rit.' },
    ])

    expect(annotations.capoText).toBe('Capo 2')
    expect(annotations.unsupportedMarkers).toEqual(
      expect.arrayContaining(['capo', 'd-s-coda', 'coda', 'repeat-ending', 'tempo-text']),
    )
    expect(annotations.warnings).toEqual(
      expect.arrayContaining([
        `${TAB_CAPO_UNSUPPORTED_WARNING} (Capo 2)`,
        TAB_REPEAT_CODA_WARNING,
        TAB_TEMPO_TEXT_WARNING,
      ]),
    )
  })

  it('reads a paired notation-over-TAB system from the notation measure boxes', () => {
    const page = makeWhitePage()
    const notation = drawStaff(page, 100, 5)
    drawStaff(page, 175, 6)
    for (const x of [100, 300, 500, 700, 900]) {
      drawVertical(page, x, notation.top, notation.bottom)
    }

    const pageText = [200, 400, 600, 800].map((x, index) => ({
      text: String(index),
      x,
      y: page.height - 225,
      width: 8,
      height: 10,
      fontName: 'TabDigit',
      pageWidth: page.width,
      pageHeight: page.height,
    }))

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    expect(result.source).toBe('tab-vector')
    expect(result.stats.measures).toBe(4)
    expect(result.stats.notes).toBe(4)
    expect(result.tabDiagnostics).toEqual(
      expect.objectContaining({
        tabStaves: 1,
        tabNotes: 4,
        tabPositionalMeasures: 4,
      }),
    )
    expect(result.measureRhythms.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
  })

  it('does not let leading unsupported notation bands shift generated TAB measure numbers', () => {
    const page = makeWhitePage(1000, 820)
    const leading = drawStaff(page, 60, 5)
    const notation = drawStaff(page, 240, 5)
    drawStaff(page, 315, 6)
    for (const x of [100, 300, 500, 700, 900]) {
      drawVertical(page, x, leading.top, leading.bottom)
      drawVertical(page, x, notation.top, notation.bottom)
    }

    const pageText = [200, 400, 600, 800].map((x, index) => ({
      text: String(index),
      x,
      y: page.height - 365,
      width: 8,
      height: 10,
      fontName: 'TabDigit',
      pageWidth: page.width,
      pageHeight: page.height,
    }))

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    expect(result.measureRhythms.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
    expect(result.measureGrid.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
    expect(result.nextMeasureNumber).toBe(5)
    expect(result.stats.measures).toBe(4)
  })

  it('pairs a spacious notation-over-TAB layout when barline structure matches', () => {
    // Section text or airy engraving can push the notation→TAB gap past the
    // proximity bound. Both bands engraving the same barlines is the evidence
    // they are one system — an unpaired TAB band would double-count measures.
    const fiveLines = [0.1, 0.112, 0.124, 0.136, 0.148]
    const sixLines = [0.36, 0.372, 0.384, 0.396, 0.408, 0.42]
    const notation = {
      y0: 0.1,
      y1: 0.148,
      lineCount: 5,
      detectedLineYs: fiveLines,
      lineYs: fiveLines,
      barlineCount: 5,
    }
    const tab = {
      y0: 0.36,
      y1: 0.42,
      lineCount: 6,
      detectedLineYs: sixLines,
      lineYs: sixLines,
      barlineCount: 5,
    }

    // Gap (0.212) far exceeds 2.4 × notation height (0.115) — only the
    // matching barline structure can pair these bands.
    const roles = resolveGuitarSystemRoles([notation, tab], { stringCount: 6 })
    expect(roles[0].kind).toBe('notation')
    expect(roles[1]).toEqual(
      expect.objectContaining({ kind: 'tab', pairedWithIndex: 0 }),
    )

    // Same spacious layout with disagreeing barlines stays honest TAB-only.
    const unrelatedTab = { ...tab, barlineCount: 3 }
    const unpaired = resolveGuitarSystemRoles([notation, unrelatedTab], { stringCount: 6 })
    expect(unpaired[1]).toEqual(
      expect.objectContaining({ kind: 'tab', pairedWithIndex: null }),
    )

    // Close layouts keep pairing on proximity alone (no barline data needed).
    const closeTab = {
      ...tab,
      y0: 0.2,
      y1: 0.26,
      detectedLineYs: sixLines.map((y) => y - 0.16),
      lineYs: sixLines.map((y) => y - 0.16),
      barlineCount: 0,
    }
    const proximityRoles = resolveGuitarSystemRoles([notation, closeTab], { stringCount: 6 })
    expect(proximityRoles[1]).toEqual(
      expect.objectContaining({ kind: 'tab', pairedWithIndex: 0 }),
    )
  })

  it('keeps barline numbering when a TAB bar has no fret digits', () => {
    const page = makeWhitePage()
    const tabStaff = drawStaff(page, 100, 6)
    for (const x of [100, 300, 500, 700, 900]) {
      drawVertical(page, x, tabStaff.top, tabStaff.bottom)
    }

    // Digits in bars 1, 2, and 4 — bar 3 (x 500–700) is intentionally silent.
    const pageText = [
      { digit: '0', x: 200 },
      { digit: '2', x: 400 },
      { digit: '3', x: 800 },
    ].map(({ digit, x }) => ({
      text: digit,
      x,
      y: page.height - tabStaff.bottom,
      width: 8,
      height: 10,
      fontName: 'TabDigit',
      pageWidth: page.width,
      pageHeight: page.height,
    }))

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    expect(result.source).toBe('tab-vector')
    // The silent bar keeps its number; later bars must not shift left.
    expect(result.measureRhythms.map((measure) => measure.measureNumber)).toEqual([1, 2, 3, 4])
    expect(result.nextMeasureNumber).toBe(5)

    const silentBar = result.measureRhythms[2]
    expect(silentBar.events).toEqual([
      expect.objectContaining({ type: 'rest', startDivision: 0, durationDivisions: 16 }),
    ])
    const lastBar = result.measureRhythms[3]
    expect(lastBar.events[0].notes[0]).toEqual(
      expect.objectContaining({ fret: 3 }),
    )
  })

  it('preserves interior empty TAB measures without inventing trailing padding bars', () => {
    const page = makeWhitePage()
    const tabStaff = drawStaff(page, 100, 6)
    for (const x of [100, 300, 500, 700, 900]) {
      drawVertical(page, x, tabStaff.top, tabStaff.bottom)
    }

    const pageText = [
      tabTextItem(page, {
        text: '3',
        x: 200,
        y: tabStaff.bottom,
      }),
      tabTextItem(page, {
        text: '5',
        x: 600,
        y: tabStaff.bottom,
      }),
    ]

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    expect(result.measureRhythms.map((measure) => measure.measureNumber)).toEqual([1, 2, 3])
    expect(result.measureRhythms[1].events).toEqual([
      expect.objectContaining({ type: 'rest', startDivision: 0, durationDivisions: 16 }),
    ])
    expect(result.measureRhythms[2].events[0].notes[0]).toEqual(
      expect.objectContaining({ fret: 5 }),
    )
    expect(result.tabDiagnostics).toEqual(
      expect.objectContaining({
        rhythmApproximate: true,
        tabApproximateRhythmMeasures: 3,
        tabEmptyMeasures: 1,
      }),
    )
  })

  it('merges TAB notes that quantize to the same onset into one chord event', () => {
    const { events } = buildTabMeasureEvents([
      { string: 1, fret: 0, midi: 64, x: 80, positionInMeasure: 0.86 },
      { string: 2, fret: 1, midi: 60, x: 84, positionInMeasure: 0.89 },
    ])

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(
      expect.objectContaining({
        startDivision: 12,
        notes: [
          expect.objectContaining({ string: 1, fret: 0 }),
          expect.objectContaining({ string: 2, fret: 1 }),
        ],
      }),
    )
  })

  it('keeps repeated notes on the same string separate when x positions differ', () => {
    const { events, timingModel } = buildTabMeasureEvents([
      { string: 3, fret: 2, midi: 57, x: 100, positionInMeasure: 0.1 },
      { string: 3, fret: 2, midi: 57, x: 124, positionInMeasure: 0.13 },
    ])

    expect(events).toHaveLength(2)
    expect(events.map((event) => event.startDivision)).toEqual([0, 4])
    expect(timingModel).toEqual(
      expect.objectContaining({
        groupCount: 2,
        eventCount: 2,
        coalesced: false,
      }),
    )
  })

  it('uses bounded even timing for dense TAB-only measures', () => {
    const measureNotes = Array.from({ length: 12 }, (_, index) => ({
      string: (index % 6) + 1,
      fret: index % 5,
      midi: 52 + index,
      x: 80 + index * 16,
      positionInMeasure: index / 11,
    }))

    const { events, rhythmApproximate, timingModel } = buildTabMeasureEvents(measureNotes)

    expect(rhythmApproximate).toBe(true)
    expect(timingModel).toEqual(
      expect.objectContaining({
        kind: 'tab-approximate-even',
        maxOnsets: 16,
        groupCount: 12,
        eventCount: 12,
        coalesced: false,
        compressed: false,
      }),
    )
    expect(events).toHaveLength(12)
    expect(events.every((event) => event.durationDivisions >= 1)).toBe(true)
  })

  it('compresses only over-dense TAB measures beyond the safe sixteenth grid', () => {
    const measureNotes = Array.from({ length: 20 }, (_, index) => ({
      string: (index % 6) + 1,
      fret: index % 5,
      midi: 52 + index,
      x: 80 + index * 12,
      positionInMeasure: index / 19,
    }))

    const { events, timingModel, confidence } = buildTabMeasureEvents(measureNotes)

    expect(events.length).toBeLessThanOrEqual(16)
    expect(timingModel).toEqual(
      expect.objectContaining({
        maxOnsets: 16,
        groupCount: 20,
        compressed: true,
        coalesced: true,
      }),
    )
    expect(confidence).toBeLessThan(0.55)
  })

  it('warns when dense TAB-only playback is compressed to the safe timing grid', async () => {
    const page = makeWhitePage()
    const tabStaff = drawStaff(page, 100, 6)
    for (const x of [100, 900]) {
      drawVertical(page, x, tabStaff.top, tabStaff.bottom)
    }

    const pageText = Array.from({ length: 20 }, (_, index) =>
      tabTextItem(page, {
        text: String(index % 5),
        x: 120 + index * 39,
        y: tabStaff.top + (index % 6) * 10,
      }),
    )

    const result = await runPdfOmrPipeline('synthetic-dense-tab-only', {
      renderPage: async () => page,
      extractPageText: async () => pageText,
      numPages: 1,
      instrumentId: 'guitar',
      title: 'Synthetic dense TAB-only',
    })

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        TAB_APPROXIMATE_RHYTHM_WARNING,
        TAB_COMPRESSED_TIMING_WARNING,
      ]),
    )
    expect(result.diagnostics.tablature).toEqual(
      expect.objectContaining({
        tabOnly: true,
        rhythmApproximate: true,
        tabCompressedTimingMeasures: 1,
      }),
    )
  })

  it('marks TAB-only page analysis as approximate and warns about repeat/capo text', () => {
    const page = makeWhitePage()
    const tabStaff = drawStaff(page, 100, 6)
    for (const x of [100, 300, 500]) {
      drawVertical(page, x, tabStaff.top, tabStaff.bottom)
    }

    const pageText = [
      tabTextItem(page, { text: 'Capo 3', x: 120, y: tabStaff.top - 36, width: 48 }),
      tabTextItem(page, { text: 'D.S. al Coda', x: 520, y: tabStaff.top - 36, width: 96 }),
      tabTextItem(page, { text: 'G7', x: 155, y: tabStaff.bottom, width: 18 }),
      tabTextItem(page, { text: 'lyric 4', x: 190, y: tabStaff.bottom, width: 54 }),
      tabTextItem(page, { text: '2024', x: 220, y: tabStaff.bottom, width: 140, height: 90 }),
      tabTextItem(page, { text: '3', x: 210, y: tabStaff.bottom }),
    ]

    const result = processOmrPageAnalysis(page, {
      page: 1,
      measureNumberStart: 1,
      pageText,
      stavesPerSystem: 1,
      instrument: getInstrument('guitar'),
      timeSignature: { beats: 4, beatType: 4, confidence: 0 },
    })

    const playableNotes = result.measureRhythms.flatMap((measure) =>
      measure.events.flatMap((event) => event.notes ?? []),
    )
    expect(playableNotes.map((note) => note.fret)).toEqual([3])
    expect(result.measureRhythms.every((measure) => measure.rhythmApproximate)).toBe(true)
    expect(result.tabDiagnostics.warnings).toEqual(
      expect.arrayContaining([
        TAB_APPROXIMATE_RHYTHM_WARNING,
        `${TAB_CAPO_UNSUPPORTED_WARNING} (Capo 3)`,
        TAB_REPEAT_CODA_WARNING,
      ]),
    )
    expect(result.tabDiagnostics.unsupportedMarkers).toEqual(
      expect.arrayContaining(['capo', 'd-s-coda', 'coda']),
    )
  })

  it('returns honest full-pipeline warnings for TAB-only approximate timing', async () => {
    const page = makeWhitePage()
    const tabStaff = drawStaff(page, 100, 6)
    for (const x of [100, 300, 500]) {
      drawVertical(page, x, tabStaff.top, tabStaff.bottom)
    }

    const pageText = [
      tabTextItem(page, { text: 'Capo 5', x: 110, y: tabStaff.top - 34, width: 48 }),
      tabTextItem(page, { text: '1.', x: 320, y: tabStaff.top - 34, width: 18 }),
      tabTextItem(page, { text: '0', x: 200, y: tabStaff.bottom }),
    ]

    const result = await runPdfOmrPipeline('synthetic-tab-only', {
      renderPage: async () => page,
      extractPageText: async () => pageText,
      numPages: 1,
      instrumentId: 'guitar',
      title: 'Synthetic TAB-only',
    })

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        TAB_APPROXIMATE_RHYTHM_WARNING,
        `${TAB_CAPO_UNSUPPORTED_WARNING} (Capo 5)`,
        TAB_REPEAT_CODA_WARNING,
      ]),
    )
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0.42)
    expect(result.overallConfidence).toBeLessThan(0.65)
    expect(result.diagnostics.tablature).toEqual(
      expect.objectContaining({
        tabOnly: true,
        rhythmApproximate: true,
        tabApproximateRhythmMeasures: 1,
      }),
    )
    expect(result.musicXml).toContain('TAB notes detected')
  })

  it('rejects TAB staff lines without readable frets using a TAB-specific message', async () => {
    const page = makeWhitePage()
    const tabStaff = drawStaff(page, 100, 6)
    for (const x of [100, 300, 500]) {
      drawVertical(page, x, tabStaff.top, tabStaff.bottom)
    }

    const pageText = [
      tabTextItem(page, { text: 'Capo 2', x: 120, y: tabStaff.top - 34, width: 48 }),
      tabTextItem(page, { text: 'G7', x: 160, y: tabStaff.bottom, width: 18 }),
      tabTextItem(page, { text: 'lyrics only', x: 210, y: tabStaff.bottom + 32, width: 80 }),
    ]

    await expect(
      runPdfOmrPipeline('synthetic-tab-no-frets', {
        renderPage: async () => page,
        extractPageText: async () => pageText,
        numPages: 1,
        instrumentId: 'guitar',
        title: 'Synthetic TAB with no readable frets',
      }),
    ).rejects.toThrow(TAB_NO_USABLE_NOTES_MESSAGE)
  })
})
