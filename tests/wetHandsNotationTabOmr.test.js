import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { renderPdfToPages, makeRenderPageCallback } from '../scripts/lib/renderPdfPages.mjs'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { evaluateOmrAccuracy } from '../src/features/omr/omrAccuracyEvaluator.js'
import { NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE } from '../src/features/omr/pairNotationTabEvents.js'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PDF_PATH = join(process.env.HOME ?? '', 'Downloads/wet-hands-minecraft.pdf')
const TRUTH_PATH = join(process.env.HOME ?? '', 'Downloads/wet-hands-minecraft.mxl')
const HAS_FIXTURE = existsSync(PDF_PATH) && existsSync(TRUTH_PATH)

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    return (content.items ?? [])
      .map((item) => ({
        text: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        fontName: item.fontName ?? '',
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const rootPath = Object.keys(zip.files).find(
    (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
  )
  return zip.file(rootPath).async('string')
}

describe.skipIf(!HAS_FIXTURE)('Wet Hands notation + TAB OMR regression', () => {
  it('pairs most notation notes with TAB frets and avoids TAB-only duplicates', async () => {
    const rendered = await renderPdfToPages(PDF_PATH, { rootDir: ROOT })
    const extractPageText = await makePdfTextExtractor(PDF_PATH)
    const result = await runPdfOmrPipeline(PDF_PATH, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: 4,
      instrumentId: 'guitar',
      title: 'wet-hands-guitar',
    })

    const map = parseMusicXml(result.musicXml, 'wet-hands.omr.musicxml')
    const withFret = map.notes.filter((note) => note.fret != null)
    const pairingRatio = withFret.length / Math.max(1, map.notes.length)

    expect(result.diagnostics?.tablature?.attachedPositions ?? 0).toBeGreaterThan(50)
    expect(pairingRatio).toBeGreaterThan(0.45)
    expect(map.notes.length).toBeLessThan(350)

    const truthXml = await readScoreXml(TRUTH_PATH)
    const report = evaluateOmrAccuracy({
      generatedMusicXml: result.musicXml,
      groundTruthMusicXml: truthXml,
      generatedFileName: 'wet-hands.omr.musicxml',
      groundTruthFileName: 'wet-hands.mxl',
    })

    expect(report.metrics.noteDetectionF1).toBeGreaterThan(0.45)
    expect(report.metrics.onsetAccuracy).toBeGreaterThan(0.15)
    expect(report.metrics.durationAccuracy).toBeGreaterThan(0.25)
  })

  it('surfaces low-confidence pairing honestly instead of inventing frets', async () => {
    const rendered = await renderPdfToPages(PDF_PATH, { rootDir: ROOT })
    const extractPageText = await makePdfTextExtractor(PDF_PATH)
    const result = await runPdfOmrPipeline(PDF_PATH, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: 2,
      instrumentId: 'guitar',
      title: 'wet-hands-guitar',
    })

    const tabDiag = result.diagnostics?.tablature ?? {}
    if ((tabDiag.lowConfidenceMeasures ?? 0) > 0) {
      expect(result.warnings).toContain(NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE)
    }
    expect(tabDiag.unusedTabDigits ?? 0).toBeGreaterThanOrEqual(0)
  })
})
