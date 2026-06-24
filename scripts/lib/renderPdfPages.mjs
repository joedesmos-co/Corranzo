/**
 * Render a PDF to page ImageData arrays for Node calibration/diagnostic scripts.
 * Requires @napi-rs/canvas + pdfjs-dist (optional dev install).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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

export async function renderPdfToPages(pdfPath, { analysisWidth = CALIBRATION_ANALYSIS_WIDTH, rootDir } = {}) {
  const { createCanvas, pdfjs } = await loadPdfRenderDependencies(rootDir)
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
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
