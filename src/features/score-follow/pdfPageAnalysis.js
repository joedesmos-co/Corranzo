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
  // Render the RAW page (rotation: 0), ignoring the PDF's native /Rotate metadata.
  // A page rotated only in Preview/Finder stores /Rotate metadata over unchanged
  // (upright) pixels; honoring it would show the page sideways/upside-down and
  // line-energy detection can't see a 180° flip. Working from raw pixels keeps
  // analysis consistent with the viewer (which also renders raw) and lets pixel
  // detection handle genuinely sideways scans. For a /Rotate 0 PDF this is a no-op.
  const baseViewport = page.getViewport({ scale: 1, rotation: 0 })
  const scale = targetWidth / baseViewport.width
  const viewport = page.getViewport({ scale, rotation: 0 })

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

/** Compact summary of barline-candidate rejections for diagnostic scripts. */
export function summarizeBarlineRejections(rejected) {
  if (!rejected || typeof rejected !== 'object') {
    return ''
  }
  return Object.entries(rejected)
    .filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ')
}

/** Rejection summary plus retained low-confidence counts for benchmark diagnostics. */
export function summarizeBarlineDiagnostics(diagnostics) {
  if (!diagnostics) {
    return ''
  }
  const parts = []
  const rejected = summarizeBarlineRejections(diagnostics.rejected ?? diagnostics)
  if (rejected) {
    parts.push(rejected)
  }
  if (Number(diagnostics.retainedLowConfidence) > 0) {
    parts.push(`retained-low-confidence=${diagnostics.retainedLowConfidence}`)
  }
  if (Number(diagnostics.thinningRemoved) > 0) {
    parts.push(`thinning-removed=${diagnostics.thinningRemoved}`)
  }
  if (diagnostics.densityAmbiguous) {
    parts.push('density-ambiguous')
  }
  return parts.join(', ')
}
