import { assertBufferNotDetached } from './omrPixelBuffer.js'
import { omrTrace } from './omrTrace.js'

export function describePdfSourceType(source) {
  if (source == null) {
    return 'null'
  }
  if (typeof source === 'string') {
    return 'url'
  }
  if (source instanceof ArrayBuffer) {
    return 'array-buffer'
  }
  if (ArrayBuffer.isView(source)) {
    return 'typed-array'
  }
  if (typeof source === 'object' && source.data && ArrayBuffer.isView(source.data)) {
    return 'pdfjs-data-object'
  }
  if (source instanceof Blob) {
    return 'blob'
  }
  return typeof source
}

export function isPdfBufferAttached(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    return null
  }
  try {
    assertBufferNotDetached(buffer, 'isPdfBufferAttached')
    return true
  } catch {
    return false
  }
}

export function cloneArrayBuffer(buffer, label = 'cloneArrayBuffer') {
  assertBufferNotDetached(buffer, label)
  const copy = buffer.slice(0)
  assertBufferNotDetached(copy, `${label}:copy`)
  return copy
}

/**
 * Clone PDF bytes for an isolated pdf.js load. Never pass App-state buffers directly.
 */
export function cloneOmrPdfSource(source, label = 'cloneOmrPdfSource') {
  if (source == null) {
    throw new Error(`[OMR ${label}] missing PDF source`)
  }
  if (typeof source === 'string') {
    return source
  }
  if (source instanceof ArrayBuffer) {
    return cloneArrayBuffer(source, label)
  }
  if (ArrayBuffer.isView(source)) {
    assertBufferNotDetached(source.buffer, `${label}:view-buffer`)
    const copy = new Uint8Array(source.byteLength)
    for (let i = 0; i < source.byteLength; i += 1) {
      copy[i] = source[i]
    }
    assertBufferNotDetached(copy.buffer, `${label}:view-copy`)
    return copy
  }
  if (typeof source === 'object' && source.data && ArrayBuffer.isView(source.data)) {
    return { data: cloneOmrPdfSource(source.data, `${label}:data`) }
  }
  throw new Error(
    `[OMR ${label}] unsupported PDF source type: ${describePdfSourceType(source)}`,
  )
}

/**
 * Resolve owned PDF bytes for OMR. Prefer blob URL over shared App-state ArrayBuffer.
 */
export async function resolveOmrPdfSource({
  pdfSource = null,
  pdfFileUrl = null,
  traceRunId = null,
} = {}) {
  omrTrace(
    'client:pdfSource-before-normalize',
    {
      type: describePdfSourceType(pdfSource),
      pdfFileUrl: typeof pdfFileUrl === 'string' && pdfFileUrl.length > 0,
      appBufferAttached:
        pdfSource instanceof ArrayBuffer ? isPdfBufferAttached(pdfSource) : null,
    },
    traceRunId,
  )

  if (typeof pdfFileUrl === 'string' && pdfFileUrl.length > 0) {
    omrTrace('client:pdfSource-load-from-blob-url', null, traceRunId)
    const response = await fetch(pdfFileUrl)
    if (!response.ok) {
      throw new Error(`[OMR pdf source from blob url] fetch failed (${response.status})`)
    }
    const buffer = await response.arrayBuffer()
    const owned = cloneArrayBuffer(buffer, 'omr pdf source from blob url')
    omrTrace(
      'client:pdfSource-after-clone',
      { byteLength: owned.byteLength, via: 'blob-url' },
      traceRunId,
    )
    return { data: new Uint8Array(owned) }
  }

  if (pdfSource == null) {
    throw new Error('[OMR pdf source] missing PDF bytes and blob URL')
  }

  const cloned = cloneOmrPdfSource(pdfSource, 'omr pdf source before load')
  if (typeof cloned === 'string') {
    omrTrace('client:pdfSource-after-clone', { via: 'url' }, traceRunId)
    return cloned
  }

  const bytes = cloned instanceof ArrayBuffer ? new Uint8Array(cloned) : cloned
  omrTrace(
    'client:pdfSource-after-clone',
    { byteLength: bytes.byteLength, via: 'clone' },
    traceRunId,
  )
  return { data: bytes }
}
