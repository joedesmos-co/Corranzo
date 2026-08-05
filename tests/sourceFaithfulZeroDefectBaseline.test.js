/**
 * Freeze accepted source-faithful behavior at zero-defect closeout HEAD f091ee7.
 *
 * These assertions protect production outcomes that must not regress when chasing
 * remaining original-corpus evaluator defects that are benchmark/policy truth.
 *
 * Do not weaken these to imitate unprinted tempos, hidden naturals, half-vs-quarter
 * MusicXML mismatches, slur-as-tie encoding, or tuplets m8 glyph contradictions.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../scripts/lib/renderPdfPages.mjs'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  detectVoltaEnding,
  finalizeEndingStops,
  shouldEmitEnding,
} from '../src/features/omr/detectOmrRepeatBarline.js'
import { detectVoltaFromRaster } from '../src/features/omr/detectRasterVoltaEnding.js'
import { finalizeRasterPageSlurs } from '../src/features/omr/finalizeRasterPageSlurs.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_PDF = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
)
const PAIRED_PDF = join(
  ROOT,
  'benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.pdf',
)
const STANDARD_PDF = join(
  ROOT,
  'benchmarks/omr-fixtures/guitar-standard-chords-vector/guitar-standard-chords-vector.pdf',
)

async function runFixture(pdfPath, { instrumentId, preprocessPages = false } = {}) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 2 })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  return runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.pages.length,
    maxPages: 2,
    preprocessPages,
    instrumentId,
    title: pdfPath.split('/').pop(),
  })
}

function blankImage(width = 200, height = 120) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { width, height, data }
}

function paintInk(imageData, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) continue
      const i = (y * imageData.width + x) * 4
      imageData.data[i] = 20
      imageData.data[i + 1] = 20
      imageData.data[i + 2] = 20
    }
  }
}

describe('source-faithful zero-defect baseline freeze (f091ee7)', () => {
  it(
    'scan PDF emits 88 notes, endings, voltas, and no incorrect ties',
    async () => {
      const result = await runFixture(SCAN_PDF, {
        instrumentId: 'piano',
        preprocessPages: true,
      })
      expect(result.acceptance).toBe('accepted')
      expect(result.noteCount).toBe(88)
      expect(result.measureCount).toBe(8)

      const xml = result.musicXml
      expect(xml).toContain('ending number="1" type="start"')
      expect(xml).toContain('ending number="1" type="stop"')
      expect(xml).toContain('ending number="2" type="start"')
      expect(xml).toContain('ending number="2" type="stop"')
      expect(xml).toContain('repeat direction="forward"')
      expect(xml).toContain('repeat direction="backward"')
      expect(xml).toMatch(/<slur[^>]*type="start"/)
      expect(xml).toMatch(/<slur[^>]*type="stop"/)
      expect(xml).toMatch(/<accent[\s/>]/)
      expect(xml).toMatch(/<staccato[\s/>]/)
      // Source-faithful: m3 A4→m4 A♯4 is emitted as slur, never as tie.
      expect(xml).toContain('slur type="start" number="1" placement="below"')
      expect(xml).not.toMatch(/measure number="3"[\s\S]*?<tie type="start"/)

      const timing = parseMusicXml(xml, 'scan-freeze.musicxml')
      const notes = timing.notes.filter((n) => !n.isRest && n.midi != null)
      expect(notes).toHaveLength(88)
      expect(notes.some((n) => n.accent)).toBe(true)
      expect(notes.some((n) => n.staccato)).toBe(true)
    },
    45_000,
  )

  it(
    'guitar paired and standard PDFs remain accepted with full note recovery',
    async () => {
      const paired = await runFixture(PAIRED_PDF, { instrumentId: 'guitar' })
      const standard = await runFixture(STANDARD_PDF, { instrumentId: 'guitar' })
      expect(paired.acceptance).toBe('accepted')
      expect(standard.acceptance).toBe('accepted')
      expect(paired.noteCount).toBe(116)
      expect(standard.noteCount).toBe(115)
      expect(paired.measureCount).toBe(8)
      expect(standard.measureCount).toBe(8)
    },
    45_000,
  )

  it('raster volta path still requires bracket + hook + digit (no bare measure numbers)', () => {
    const image = blankImage()
    paintInk(image, 10, 70, 190, 70) // staff line only
    paintInk(image, 44, 34, 46, 44) // bare digit-like stem, no bracket
    const box = {
      x0: 0.2,
      x1: 0.55,
      y0: 70 / 120,
      y1: 0.95,
      staffLines: { treble: [0, 1, 2, 3, 4].map((i) => 70 / 120 + i * (8 / 120)) },
    }
    expect(detectVoltaFromRaster(image, box, 170)).toBeNull()
  })

  it('PDF text volta path remains preferred and finalizes adjacent ending stops', () => {
    const imageData = {
      width: 1000,
      height: 1000,
      data: new Uint8ClampedArray(1000 * 1000 * 4),
    }
    const pageText = [
      {
        text: '1.',
        x: 320,
        y: 620,
        width: 8,
        height: 10,
        pageWidth: 1000,
        pageHeight: 1000,
      },
      {
        text: '2.',
        x: 520,
        y: 620,
        width: 8,
        height: 10,
        pageWidth: 1000,
        pageHeight: 1000,
      },
    ]
    const m7 = detectVoltaEnding(
      imageData,
      { x0: 0.3, x1: 0.5, y0: 0.38, y1: 0.55 },
      170,
      pageText,
    )
    const m8 = detectVoltaEnding(
      imageData,
      { x0: 0.5, x1: 0.7, y0: 0.38, y1: 0.55 },
      170,
      pageText,
    )
    expect(m7?.endingStartNumbers).toEqual([1])
    expect(m8?.endingStartNumbers).toEqual([2])
    expect(shouldEmitEnding(m7)).toBe(true)
    const records = [{ endingMarking: { ...m7 } }, { endingMarking: { ...m8 } }]
    finalizeEndingStops(records)
    expect(records[0].endingMarking.endingStop).toBe(true)
    expect(records[1].endingMarking.endingStop).toBe(true)
  })

  it('different-pitch slur emission does not create tie sustain', () => {
    const width = 1000
    const height = 400
    const imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    }
    const setInk = (x, y) => {
      const px = Math.round(x)
      const py = Math.round(y)
      const i = (py * width + px) * 4
      imageData.data[i] = 0
      imageData.data[i + 1] = 0
      imageData.data[i + 2] = 0
    }
    for (let x = 204; x <= 316; x += 1) {
      const t = (x - 200) / 120
      const arc = 200 - 4 - Math.round(14 * Math.sin(t * Math.PI))
      setInk(x, arc)
      setInk(x, arc - 1)
    }
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            durationType: 'quarter',
            cx: 200,
            notes: [{ midi: 65, clef: 'treble', cx: 200, cy: 200 }],
          },
          {
            type: 'note',
            startDivision: 8,
            durationDivisions: 4,
            durationType: 'quarter',
            cx: 320,
            notes: [{ midi: 67, clef: 'treble', cx: 320, cy: 195 }],
          },
        ],
      },
    ]
    const boxes = new Map([
      [
        1,
        {
          measureNumber: 1,
          x0: 0.15,
          x1: 0.4,
          playableX0: 0.15,
          y0: 0.1,
          y1: 0.45,
          staffLines: { treble: [0.2, 0.23, 0.26, 0.29, 0.32] },
        },
      ],
    ])
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: boxes,
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(1)
    const left = records[0].events[0].notes[0]
    const right = records[0].events[1].notes[0]
    expect(left.slurStart).toBe(true)
    expect(right.slurStop).toBe(true)
    expect(left.tieStart).toBeUndefined()
    expect(right.tieStop).toBeUndefined()

    const xml = buildOmrMusicXml({ measures: records })
    expect(xml).toMatch(/<slur/)
    expect(xml).not.toMatch(/<tie /)
  })
})
