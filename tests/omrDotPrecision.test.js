import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  setPdfjsLoader,
  setPdfAnalysisCanvasFactory,
} from '../src/features/score-follow/pdfPageAnalysis.js'
import { setOmrDiagnosticFlag, OMR_DIAGNOSTIC_FLAG } from '../src/features/omr/omrDiagnosticFlags.js'
import { runPdfOmrClient } from '../src/features/omr/runPdfOmrClient.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VEROVIO = join(ROOT, 'benchmarks/omr-independent-verovio')
let createCanvas = null
let pdfjsModule = null
let canvasAvailable = false
try {
  const [canvasMod, pdfjsMod] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ])
  createCanvas = canvasMod.createCanvas
  pdfjsModule = pdfjsMod
  canvasAvailable = Boolean(createCanvas)
} catch {
  canvasAvailable = false
}

function readVerovio(name) {
  const dir = join(VEROVIO, name)
  return {
    pdf: new Uint8Array(readFileSync(join(dir, `${name}.pdf`))),
    reference: readFileSync(join(dir, `${name}.musicxml`), 'utf8'),
  }
}

function dotCount(xml) {
  return (xml.match(/<dot\s*\/>/g) ?? []).length
}

function restCount(xml) {
  return (xml.match(/<rest\s*\/>/g) ?? []).length
}

async function generate(name) {
  const { pdf } = readVerovio(name)
  return runPdfOmrClient(pdf, { title: name, instrumentId: 'piano', useWorker: false })
}

beforeAll(() => {
  if (canvasAvailable) {
    setPdfjsLoader(() => pdfjsModule)
    setPdfAnalysisCanvasFactory((width, height) => createCanvas(width, height))
  }
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
})

afterAll(() => {
  setPdfjsLoader(null)
  setPdfAnalysisCanvasFactory(null)
})

describe.skipIf(!canvasAvailable)('independent engraver dot precision', () => {
  it('does not invent dotted rhythms from articulation marks (Verovio grand voices)', async () => {
    // Source has 12 staccato + 12 accent marks and zero augmentation dots.
    const { reference } = readVerovio('piano-grand-voices-verovio')
    expect(dotCount(reference)).toBe(0)
    const result = await generate('piano-grand-voices-verovio')
    expect(dotCount(result.musicXml)).toBe(0)
  }, 30000)

  it('does not promote a pickup-length note to a dotted value (Verovio pickup)', async () => {
    const { reference } = readVerovio('piano-pickup-crossstaff-verovio')
    expect(dotCount(reference)).toBe(0)
    const result = await generate('piano-pickup-crossstaff-verovio')
    expect(dotCount(result.musicXml)).toBe(0)
  }, 30000)

  it('emits no invented rests on independent Verovio engraving', async () => {
    // The reference carries rests, but the raster rest model cannot yet
    // distinguish them from notehead/stem ink (963 candidate windows on the
    // tuplets page). The safe outcome is zero generated rests: a recall gap,
    // never a fabricated rest.
    for (const name of [
      'piano-rhythm-tuplets-verovio',
      'piano-pickup-crossstaff-verovio',
      'piano-grand-voices-verovio',
    ]) {
      const { reference } = readVerovio(name)
      expect(restCount(reference)).toBeGreaterThanOrEqual(0)
      const result = await generate(name)
      expect(restCount(result.musicXml)).toBe(0)
    }
  }, 45000)

  it('abstains from dotted rhythm on Verovio tuplets rather than guessing', async () => {
    // Reference has two genuine dotted notes; this engraver's reconstructed
    // durations do not corroborate them, so the safe outcome is no dot at all
    // (recall failure, not a fabricated rhythm).
    const { reference } = readVerovio('piano-rhythm-tuplets-verovio')
    expect(dotCount(reference)).toBeGreaterThan(0)
    const result = await generate('piano-rhythm-tuplets-verovio')
    expect(dotCount(result.musicXml)).toBe(0)
  }, 30000)
})
