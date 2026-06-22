// Higher analysis resolution so thin staff lines and barlines survive
// rasterisation on real high-DPI score PDFs (needed by the staff-line detector).
const ANALYSIS_WIDTH = 1000

let cachedDocumentKey = null
let cachedDocument = null

/** Optional override for fixture scripts (e.g. pdfjs-dist in Node). */
let pdfjsLoader = null

/** Optional Node/canvas factory for fixture scripts: (width, height) => canvas-like element */
let analysisCanvasFactory = null

export function setPdfjsLoader(loader) {
  pdfjsLoader = loader ?? null
  clearPdfAnalysisCache()
}

async function resolvePdfjs() {
  if (pdfjsLoader) {
    return pdfjsLoader()
  }
  const { pdfjs } = await import('react-pdf')
  return pdfjs
}

export function setPdfAnalysisCanvasFactory(factory) {
  analysisCanvasFactory = factory ?? null
}

function createAnalysisCanvas(width, height) {
  if (analysisCanvasFactory) {
    const canvas = analysisCanvasFactory(width, height)
    canvas.width = width
    canvas.height = height
    return canvas
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function loadPdfDocument(pdfSource) {
  const key = typeof pdfSource === 'string' ? pdfSource : pdfSource?.byteLength ?? 'buffer'
  if (cachedDocument && cachedDocumentKey === key) {
    return cachedDocument
  }
  const pdfjs = await resolvePdfjs()
  cachedDocument = await pdfjs.getDocument(pdfSource).promise
  cachedDocumentKey = key
  return cachedDocument
}

export function clearPdfAnalysisCache() {
  cachedDocument = null
  cachedDocumentKey = null
}

/**
 * Render one PDF page to ImageData for lightweight client-side analysis.
 */
export async function renderPdfPageImageData(pdfSource, pageNumber, targetWidth = ANALYSIS_WIDTH) {
  const pdf = await loadPdfDocument(pdfSource)
  const page = await pdf.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = targetWidth / baseViewport.width
  const viewport = page.getViewport({ scale })

  const canvas = createAnalysisCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Could not create canvas for PDF analysis.')
  }

  // Paint white first: many PDFs (esp. engraving exports) don't draw their own
  // background, so the canvas would otherwise stay transparent and every pixel
  // would read as black ink, breaking staff/barline detection.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise

  return {
    width: canvas.width,
    height: canvas.height,
    imageData: context.getImageData(0, 0, canvas.width, canvas.height),
  }
}

export function getPageInkRatio(imageData) {
  const { data, width, height } = imageData
  const bounds = detectInkBoundsQuick(imageData)
  let dark = 0
  let total = 0

  for (let y = 0; y < height; y += 2) {
    for (let x = bounds.left; x <= bounds.right; x += 2) {
      const index = (y * width + x) * 4
      total += 1
      const lum = compositeLuminance(data, index)
      // 230 (not 200) so light/thin classical staff lines count as ink and the
      // page isn't skipped as blank. Clean white paper (~255) stays well above.
      if (lum < 230) {
        dark += 1
      }
    }
  }

  return total > 0 ? dark / total : 0
}

/** Luminance composited over white so transparent PDF backgrounds aren't ink. */
function compositeLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

function detectInkBoundsQuick(imageData) {
  const { width, height, data } = imageData
  let left = 0
  let right = width - 1
  let top = 0
  let bottom = height - 1

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 4) {
      const index = (y * width + x) * 4
      if (compositeLuminance(data, index) < 240) {
        left = x
        x = width
        break
      }
    }
  }

  for (let x = width - 1; x >= 0; x -= 1) {
    for (let y = 0; y < height; y += 4) {
      const index = (y * width + x) * 4
      if (compositeLuminance(data, index) < 240) {
        right = x
        x = -1
        break
      }
    }
  }

  return { left, right, top, bottom }
}
