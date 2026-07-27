/**
 * Render a PDF to page ImageData arrays for Node calibration/diagnostic scripts.
 * Requires @napi-rs/canvas + pdfjs-dist (optional dev install).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractPdfVectorCurvesFromOperatorList } from '../../src/features/omr/extractPdfVectorCurves.js'

export const CALIBRATION_ANALYSIS_WIDTH = 1000

export async function loadPdfRenderDependencies(rootDir) {
  const root = rootDir ?? join(dirname(fileURLToPath(import.meta.url)), '../..')
  const { createCanvas } = await import(join(root, 'node_modules/@napi-rs/canvas/index.js'))
  const pdfjs = await import(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(
      new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url),
    )
  } catch {
    // optional worker
  }
  return { createCanvas, pdfjs, root }
}

export async function renderPdfToPages(pdfPath, { analysisWidth = CALIBRATION_ANALYSIS_WIDTH, maxPages = null, rootDir } = {}) {
  const { createCanvas, pdfjs } = await loadPdfRenderDependencies(rootDir)
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []

  const renderCount = Number.isInteger(maxPages)
    ? Math.min(doc.numPages, Math.max(1, maxPages))
    : doc.numPages
  for (let pageNumber = 1; pageNumber <= renderCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: analysisWidth / base.width })
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    pages.push({
      pageNumber,
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    })
  }

  return { numPages: doc.numPages, pages }
}

export function makeRenderPageCallback(pages) {
  return async (_pdfSource, pageNumber) => ({
    imageData: {
      width: pages[pageNumber - 1].width,
      height: pages[pageNumber - 1].height,
      data: pages[pageNumber - 1].data,
    },
  })
}

/**
 * Node-safe PDF text extractor using pdfjs-dist legacy build.
 * Required when runPdfOmrPipeline is given numPages (skips default extractPdfPageText).
 */
export async function makePdfTextExtractor(pdfPath, { rootDir } = {}) {
  const { pdfjs } = await loadPdfRenderDependencies(rootDir)
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

/** Node-safe original PDF tie/slur path extractor for real-score probes. */
export async function makePdfCurveExtractor(
  pdfPath,
  { analysisWidth = CALIBRATION_ANALYSIS_WIDTH, rootDir } = {},
) {
  const { pdfjs } = await loadPdfRenderDependencies(rootDir)
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1, rotation: 0 })
    const viewport = page.getViewport({
      scale: analysisWidth / base.width,
      rotation: 0,
    })
    return extractPdfVectorCurvesFromOperatorList({
      operatorList: await page.getOperatorList(),
      ops: pdfjs.OPS,
      viewportTransform: viewport.transform,
      pageNumber,
      targetWidth: viewport.width,
    })
  }
}
