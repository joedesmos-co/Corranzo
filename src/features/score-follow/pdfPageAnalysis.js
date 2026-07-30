// Higher analysis resolution so thin staff lines and barlines survive
// rasterisation on real high-DPI score PDFs (needed by the staff-line detector).
import { extractPdfVectorCurvesFromOperatorList } from '../omr/extractPdfVectorCurves.js'
import { extractPdfVectorAccidentalPathsFromOperatorList } from '../omr/detectVectorPathAccidentals.js'

const ANALYSIS_WIDTH = 1000

let cachedDocumentKey = null
let cachedDocument = null
/** Generation token so a late destroy() cannot kill a newer cached document. */
let cacheGeneration = 0
/**
 * Active OMR (or analysis) run ids that hold the cached PDFDocumentProxy.
 * clearPdfAnalysisCache must NOT destroy while any pin remains — that was the
 * post-pageCount-fix regression (mid-run destroy → empty pages → "could not read").
 */
const cachePins = new Set()

/** Optional override for fixture scripts (e.g. pdfjs-dist in Node). */
let pdfjsLoader = null

/** Optional Node/canvas factory for fixture scripts: (width, height) => canvas-like element */
let analysisCanvasFactory = null

function toBytes(input) {
  if (input == null) {
    return null
  }
  if (input instanceof ArrayBuffer) {
    // Copy — never return a view of a buffer pdf.js may later transfer/detach.
    return new Uint8Array(input.slice(0))
  }
  if (ArrayBuffer.isView(input)) {
    // TypedArray(view) copies element-wise; avoids sharing the caller's buffer.
    return new Uint8Array(input)
  }
  if (typeof input === 'object' && input.data != null) {
    return toBytes(input.data)
  }
  return null
}

/**
 * Clone byte-backed PDF sources before pdf.js load.
 * pdf.js may transfer/detach the ArrayBuffer; callers (and later cache-key
 * recomputation) must keep a valid copy of the original bytes.
 */
function clonePdfSourceForLoad(pdfSource) {
  if (pdfSource == null || typeof pdfSource === 'string') {
    return pdfSource
  }
  if (pdfSource instanceof ArrayBuffer) {
    return pdfSource.slice(0)
  }
  if (ArrayBuffer.isView(pdfSource)) {
    return new Uint8Array(pdfSource)
  }
  if (typeof pdfSource === 'object' && pdfSource.data != null) {
    return { ...pdfSource, data: clonePdfSourceForLoad(pdfSource.data) }
  }
  return pdfSource
}

/** Fast content fingerprint — length alone is NOT unique across PDFs. */
export function pdfBytesContentHash(bytes) {
  if (!bytes || bytes.byteLength === 0) {
    return 'empty'
  }
  // Sample head + mid + tail so large PDFs stay cheap but distinct.
  const length = bytes.byteLength
  const sampleSize = Math.min(4096, length)
  let hash = 0x811c9dc5
  const mix = (offset, count) => {
    for (let i = 0; i < count; i += 1) {
      hash ^= bytes[offset + i]
      hash = Math.imul(hash, 0x01000193)
    }
  }
  mix(0, sampleSize)
  if (length > sampleSize * 2) {
    mix(Math.floor(length / 2) - Math.floor(sampleSize / 2), sampleSize)
  }
  if (length > sampleSize) {
    mix(length - sampleSize, sampleSize)
  }
  // Fold length so same samples at different sizes cannot collide.
  hash ^= length >>> 0
  hash = Math.imul(hash, 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Cache key for a PDF source. MUST distinguish different PDFs.
 *
 * Bug history:
 * 1. `{ data: Uint8Array }` keyed as `'buffer'` → B reused A's proxy (wrong pageCount).
 * 2. Keying by byteLength alone is still wrong — different PDFs can share a size.
 */
export function pdfAnalysisCacheKey(pdfSource, { pdfHash = null, scoreId = null } = {}) {
  if (scoreId && pdfHash) {
    return `score:${scoreId}:pdf:${pdfHash}`
  }
  if (pdfHash) {
    return `pdf:${pdfHash}`
  }
  if (pdfSource == null) {
    return 'null'
  }
  if (typeof pdfSource === 'string') {
    return `url:${pdfSource}`
  }
  const bytes = toBytes(pdfSource)
  if (bytes) {
    return `bytes:${bytes.byteLength}:${pdfBytesContentHash(bytes)}`
  }
  if (typeof Blob !== 'undefined' && pdfSource instanceof Blob) {
    return `blob:${pdfSource.size}`
  }
  return `unknown:${typeof pdfSource}`
}

function logPdfCache(action, extra = {}) {
  const entry = {
    action,
    cacheKey: cachedDocumentKey,
    pinned: cachePins.size,
    generation: cacheGeneration,
    ...extra,
    at: Date.now(),
  }
  if (typeof window !== 'undefined') {
    const bag = window.__SCOREFLOW_PDF_CACHE_LOG__ ?? { entries: [] }
    bag.entries = [...(bag.entries ?? []), entry].slice(-60)
    bag.latest = entry
    window.__SCOREFLOW_PDF_CACHE_LOG__ = bag
  }
  try {
    console.info(
      [
        'PDF CACHE:',
        `action=${action}`,
        `scoreId=${extra.scoreId ?? '-'}`,
        `runId=${extra.runId ?? '-'}`,
        `pdfHash=${extra.pdfHash ?? '-'}`,
        `cacheKey=${entry.cacheKey ?? '-'}`,
      ].join(' '),
      entry,
    )
  } catch {
    // ignore
  }
  return entry
}

export function setPdfjsLoader(loader) {
  pdfjsLoader = loader ?? null
  clearPdfAnalysisCache({ force: true, reason: 'set-pdfjs-loader' })
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

async function destroyDocument(doc, generation, reason) {
  if (!doc) {
    return
  }
  try {
    await doc.destroy?.()
  } catch {
    // ignore destroy errors from an already-closed doc
  }
  logPdfCache('destroy', { reason, generation })
}

async function loadPdfDocument(pdfSource, identity = {}) {
  const key = pdfAnalysisCacheKey(pdfSource, identity)
  if (cachedDocument && cachedDocumentKey === key) {
    logPdfCache('hit', { ...identity, cacheKey: key })
    return cachedDocument
  }
  logPdfCache('miss', { ...identity, cacheKey: key, previousKey: cachedDocumentKey })

  // Drop the previous proxy only when nothing has it pinned.
  if (cachedDocument) {
    if (cachePins.size > 0) {
      // Soft-evict: keep the pinned document alive; caller must finish first.
      // Loading a second document without destroying the pinned one.
      const pdfjs = await resolvePdfjs()
      const next = await pdfjs.getDocument(clonePdfSourceForLoad(pdfSource)).promise
      // Do not replace the pinned cache entry — return an uncached doc for this call.
      // (OMR should pin before load so this path is rare.)
      logPdfCache('miss-uncached-while-pinned', { ...identity, cacheKey: key })
      return next
    }
    const previous = cachedDocument
    const previousGeneration = cacheGeneration
    cachedDocument = null
    cachedDocumentKey = null
    await destroyDocument(previous, previousGeneration, 'replace-before-load')
  }

  const pdfjs = await resolvePdfjs()
  const nextGeneration = cacheGeneration + 1
  cacheGeneration = nextGeneration
  const loaded = await pdfjs.getDocument(clonePdfSourceForLoad(pdfSource)).promise
  // A concurrent clear/pin race: only publish if generation still matches intent.
  if (cacheGeneration !== nextGeneration) {
    await destroyDocument(loaded, nextGeneration, 'stale-load-discard')
    // Retry once against current cache state.
    return loadPdfDocument(pdfSource, identity)
  }
  cachedDocument = loaded
  cachedDocumentKey = key
  logPdfCache('load', { ...identity, cacheKey: key, generation: nextGeneration })
  return cachedDocument
}

/**
 * Pin the analysis document for an active OMR run. Clears must not destroy
 * while any pin is held.
 */
export function pinPdfAnalysisCache(runId, meta = {}) {
  if (runId == null) {
    return
  }
  cachePins.add(runId)
  logPdfCache('pin', { runId, scoreId: meta.scoreId, pdfHash: meta.pdfHash })
}

export function unpinPdfAnalysisCache(runId, meta = {}) {
  if (runId == null) {
    return
  }
  cachePins.delete(runId)
  logPdfCache('unpin', { runId, scoreId: meta.scoreId, pdfHash: meta.pdfHash })
}

/**
 * Drop the cached PDFDocumentProxy.
 * While pins remain, this is a no-op (unless force:true) so an active OMR run
 * never loses its document mid-analysis.
 */
export function clearPdfAnalysisCache({ force = false, reason = 'clear', ...meta } = {}) {
  if (!force && cachePins.size > 0) {
    logPdfCache('clear-skipped-pinned', { reason, ...meta, pinned: cachePins.size })
    return { cleared: false, reason: 'pinned' }
  }
  const previous = cachedDocument
  const previousGeneration = cacheGeneration
  const previousKey = cachedDocumentKey
  cachedDocument = null
  cachedDocumentKey = null
  if (force) {
    cachePins.clear()
  }
  logPdfCache('clear', { reason, ...meta, cacheKey: previousKey, generation: previousGeneration })
  // Fire-and-forget destroy after nulling so a late resolve cannot race a newer load
  // that shares the same generation check in loadPdfDocument.
  void destroyDocument(previous, previousGeneration, reason)
  return { cleared: true }
}

export async function getPdfPageCount(pdfSource, identity = {}) {
  const pdf = await loadPdfDocument(pdfSource, identity)
  return pdf.numPages
}

/**
 * Render one PDF page to ImageData for lightweight client-side analysis.
 */
export async function renderPdfPageImageData(pdfSource, pageNumber, targetWidth = ANALYSIS_WIDTH, identity = {}) {
  const pdf = await loadPdfDocument(pdfSource, identity)
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

/**
 * Extract text items from a PDF page (local pdf.js — no cloud OCR).
 * Returns [] when the page has no text layer.
 */
export async function extractPdfPageText(pdfSource, pageNumber, identity = {}) {
  const pdf = await loadPdfDocument(pdfSource, identity)
  const page = await pdf.getPage(pageNumber)
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

/**
 * Extract original vector tie/slur candidates at the same pixel scale used by
 * OMR. This shares the pinned PDF document and does not alter cache ownership.
 */
export async function extractPdfPageVectorCurves(
  pdfSource,
  pageNumber,
  identity = {},
  targetWidth = ANALYSIS_WIDTH,
) {
  const [pdf, pdfjs] = await Promise.all([
    loadPdfDocument(pdfSource, identity),
    resolvePdfjs(),
  ])
  const page = await pdf.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1, rotation: 0 })
  const viewport = page.getViewport({
    scale: targetWidth / baseViewport.width,
    rotation: 0,
  })
  const operatorList = await page.getOperatorList()
  const curves = extractPdfVectorCurvesFromOperatorList({
    operatorList,
    ops: pdfjs.OPS,
    viewportTransform: viewport.transform,
    pageNumber,
    targetWidth: viewport.width,
  })
  const accidentalPaths = extractPdfVectorAccidentalPathsFromOperatorList({
    operatorList,
    ops: pdfjs.OPS,
    viewportTransform: viewport.transform,
    pageNumber,
    targetWidth: viewport.width,
  })
  curves.accidentalPaths = accidentalPaths
  return curves
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
  if (Number(diagnostics.refinementRemoved) > 0) {
    parts.push(`refinement-removed=${diagnostics.refinementRemoved}`)
  }
  if (diagnostics.densityAmbiguous) {
    parts.push('density-ambiguous')
  }
  return parts.join(', ')
}
